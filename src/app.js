'use strict';

const express = require('express');

const { config } = require('./config');
const { CheckoutService } = require('./services/CheckoutService');
const { ConfigProvider } = require('./services/ConfigProvider');
const { CircuitBreaker } = require('./resilience/CircuitBreaker');
const { HttpPaymentGateway } = require('./adapters/HttpPaymentGateway');
const { HttpCache } = require('./adapters/HttpCache');
const { InMemoryPedidoRepository } = require('./adapters/InMemoryPedidoRepository');
const { EmailService } = require('./adapters/EmailService');
const { validarPedido } = require('./domain/validarPedido');

/**
 * Composition root: instancia e conecta todas as dependencias e devolve o app
 * Express pronto. Recebe overrides opcionais para facilitar os testes.
 */
function buildApp(overrides = {}) {
  const gateway = overrides.gateway || new HttpPaymentGateway(config.gatewayUrl);
  const cache = overrides.cache || new HttpCache(config.cacheUrl, config.cacheTimeoutMs);
  const repository =
    overrides.repository ||
    new InMemoryPedidoRepository({
      maxConcurrency: config.db.maxConcurrency,
      queueTimeoutMs: config.db.queueTimeoutMs,
    });
  const emailService = overrides.emailService || new EmailService();

  const circuitBreaker =
    overrides.circuitBreaker ||
    new CircuitBreaker({
      name: 'gateway',
      errorThreshold: config.breaker.errorThreshold,
      volumeThreshold: config.breaker.volumeThreshold,
      windowSize: config.breaker.windowSize,
      resetTimeoutMs: config.breaker.resetTimeoutMs,
    });

  const configProvider =
    overrides.configProvider ||
    new ConfigProvider(cache, repository, {
      maxAttempts: config.retry.maxAttempts,
      backoffMs: config.retry.backoffMs,
      jitterMs: config.retry.jitterMs,
    });

  const checkoutService = new CheckoutService({
    gateway,
    repository,
    emailService,
    configProvider,
    circuitBreaker,
    timeoutMs: config.gatewayTimeoutMs,
    retry: config.retry,
  });

  const app = express();
  app.use(express.json());

  // Healthcheck simples
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // ENDPOINT CRITICO: recebe a carga massiva da Black Friday
  app.post('/api/v1/checkout', async (req, res) => {
    const erros = validarPedido(req.body); // RF01
    if (erros.length > 0) {
      return res.status(400).json({ erro: 'Dados invalidos para checkout', detalhes: erros });
    }

    const { clienteEmail, valor, cartao } = req.body;
    const pedido = { clienteEmail, valor, cartao, status: 'PENDENTE' };

    let resultado;
    try {
      resultado = await checkoutService.processar(pedido);
    } catch (err) {
      // Rede de seguranca: o service nao deveria lancar, mas garantimos que o
      // processo Node jamais caia por uma uncaught exception (RN07).
      console.error('[checkout] excecao inesperada:', err);
      return res.status(500).json({ erro: 'Erro interno inesperado.' });
    }

    // Codigos HTTP conforme a Matriz de Rastreabilidade da especificacao (DER):
    // PROCESSADO->200, payload invalido->400 (acima), FALHOU/ERRO_GATEWAY->500.
    switch (resultado.resultado) {
      case 'PROCESSADO':
        return res.status(200).json({ mensagem: 'Pedido finalizado com sucesso!', pedido: resultado });
      case 'FALHOU':
        return res.status(500).json({ erro: 'Pagamento recusado.', motivo: resultado.motivo });
      case 'ERRO_GATEWAY':
      default:
        return res
          .status(500)
          .json({ erro: 'Nao foi possivel processar seu pagamento. Tente mais tarde.' });
    }
  });

  // Thundering Herd manual: invalida o cache de forma abrupta.
  app.post('/api/v1/cache/flush', async (_req, res) => {
    try {
      await fetch(`${config.cacheUrl}/admin/flush`, { method: 'POST' });
    } catch (_err) {
      // ignora: em modo caos o no de cache pode estar caido de proposito
    }
    res.json({ status: 'cache_invalidated' });
  });

  // Observabilidade: estado interno para provar a degradacao graciosa e o MTTR.
  app.get('/internal/metrics', (_req, res) => {
    res.json({
      checkout: checkoutService.snapshot(),
      breaker: circuitBreaker.snapshot(),
      configProvider: configProvider.snapshot(),
      cache: cache.snapshot ? cache.snapshot() : undefined,
      repository: repository.snapshot ? repository.snapshot() : undefined,
      email: emailService.snapshot ? emailService.snapshot() : undefined,
      ts: Date.now(),
    });
  });

  return { app, deps: { checkoutService, circuitBreaker, repository, cache, configProvider } };
}

module.exports = { buildApp };
