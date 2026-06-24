'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { CheckoutService } = require('../src/services/CheckoutService');
const { CircuitBreaker } = require('../src/resilience/CircuitBreaker');
const { BusinessError, InfraError } = require('../src/errors');

const tick = () => new Promise((r) => setTimeout(r, 30));

function build(gatewayCobrar) {
  // Mock para asserir COMPORTAMENTO do e-mail.
  const emailCalls = [];
  const emailService = {
    enviarConfirmacao: async (email, msg) => {
      emailCalls.push({ email, msg });
    },
  };
  // Stub de estado para repositorio e config.
  const salvos = [];
  const repository = {
    salvar: async (pedido) => {
      salvos.push({ ...pedido });
      return { ...pedido, id: salvos.length };
    },
  };
  const configProvider = { obter: async () => ({ fonte: 'stub' }) };

  const service = new CheckoutService({
    gateway: { cobrar: gatewayCobrar },
    repository,
    emailService,
    configProvider,
    circuitBreaker: new CircuitBreaker({ volumeThreshold: 1000, name: 'test' }),
    timeoutMs: 200,
    retry: { maxAttempts: 2, backoffMs: 1, jitterMs: 0 },
  });

  return { service, emailCalls, salvos };
}

const pedidoBase = () => ({
  clienteEmail: 'a@b.com',
  valor: 100,
  cartao: { numero: '6011', validade: '12/29', cvv: '123' },
  status: 'PENDENTE',
});

test('RF02: APROVADO -> PROCESSADO e dispara e-mail (assincrono)', async () => {
  const { service, emailCalls, salvos } = build(async () => ({ status: 'APROVADO' }));

  const r = await service.processar(pedidoBase());
  await tick(); // deixa o e-mail fire-and-forget rodar

  assert.strictEqual(r.resultado, 'PROCESSADO');
  assert.strictEqual(salvos.at(-1).status, 'PROCESSADO');
  assert.strictEqual(emailCalls.length, 1);
});

test('RF03: RECUSADO -> FALHOU e NAO dispara e-mail', async () => {
  const { service, emailCalls, salvos } = build(async () => {
    throw new BusinessError('RECUSADO', 'RECUSADO');
  });

  const r = await service.processar(pedidoBase());
  await tick();

  assert.strictEqual(r.resultado, 'FALHOU');
  assert.strictEqual(salvos.at(-1).status, 'FALHOU');
  assert.strictEqual(emailCalls.length, 0); // regra critica RN03
});

test('RF05: falha de infra persistente -> ERRO_GATEWAY (fallback limpo)', async () => {
  let chamadas = 0;
  const { service, emailCalls } = build(async () => {
    chamadas += 1;
    throw new InfraError('gateway fora');
  });

  const r = await service.processar(pedidoBase());
  await tick();

  assert.strictEqual(r.resultado, 'ERRO_GATEWAY');
  assert.strictEqual(chamadas, 3); // 1 + 2 retries
  assert.strictEqual(emailCalls.length, 0);
});

test('RF04: gateway lento dispara timeout e vira ERRO_GATEWAY', async () => {
  const { service } = build(
    () => new Promise((resolve) => setTimeout(() => resolve({ status: 'APROVADO' }), 1000))
  );

  const r = await service.processar(pedidoBase());
  assert.strictEqual(r.resultado, 'ERRO_GATEWAY');
});
