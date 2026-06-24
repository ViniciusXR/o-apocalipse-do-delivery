'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { CircuitBreaker } = require('../src/resilience/CircuitBreaker');
const { InfraError, BusinessError, CircuitOpenError } = require('../src/errors');

function makeBreaker(now) {
  return new CircuitBreaker({
    errorThreshold: 0.5,
    volumeThreshold: 4,
    windowSize: 10,
    resetTimeoutMs: 1000,
    now,
  });
}

test('abre apos taxa de erro de infra ultrapassar o limite', async () => {
  const breaker = makeBreaker(() => 0);
  const falha = () => breaker.execute(async () => {
    throw new InfraError('5xx');
  });

  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(falha);
  }

  assert.strictEqual(breaker.state, 'OPEN');
  // Com o breaker aberto, a chamada falha rapido (CircuitOpenError) sem executar.
  await assert.rejects(() => breaker.execute(async () => 'nao deveria rodar'), CircuitOpenError);
});

test('erro de negocio NAO abre o breaker', async () => {
  const breaker = makeBreaker(() => 0);
  for (let i = 0; i < 6; i += 1) {
    await assert.rejects(() => breaker.execute(async () => {
      throw new BusinessError('RECUSADO');
    }));
  }
  assert.strictEqual(breaker.state, 'CLOSED');
});

test('half-open recupera para CLOSED apos sucesso', async () => {
  let agora = 0;
  const breaker = makeBreaker(() => agora);

  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(() => breaker.execute(async () => {
      throw new InfraError('5xx');
    }));
  }
  assert.strictEqual(breaker.state, 'OPEN');

  agora += 1500; // passou o resetTimeout -> proxima chamada e HALF_OPEN
  const r = await breaker.execute(async () => 'recuperou');
  assert.strictEqual(r, 'recuperou');
  assert.strictEqual(breaker.state, 'CLOSED');
});
