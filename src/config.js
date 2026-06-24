'use strict';

/**
 * Configuracao central do CheckoutService.
 * Le variaveis de ambiente (com defaults seguros) para que o mesmo binario
 * possa rodar em modo normal ou em modo caos (apontando para o Toxiproxy)
 * apenas trocando GATEWAY_URL / CACHE_URL.
 */

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const config = {
  port: num('PORT', 3000),

  gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:4001',
  cacheUrl: process.env.CACHE_URL || 'http://127.0.0.1:4002',

  // RF04 - Timeout / Retry / Backoff
  gatewayTimeoutMs: num('GATEWAY_TIMEOUT_MS', 2000),
  retry: {
    maxAttempts: num('RETRY_MAX_ATTEMPTS', 3),
    backoffMs: num('RETRY_BACKOFF_MS', 500),
    jitterMs: num('RETRY_JITTER_MS', 250),
  },

  // RF05 - Circuit Breaker
  breaker: {
    errorThreshold: num('BREAKER_ERROR_THRESHOLD', 0.5),
    volumeThreshold: num('BREAKER_VOLUME_THRESHOLD', 10),
    windowSize: num('BREAKER_WINDOW_SIZE', 20),
    resetTimeoutMs: num('BREAKER_RESET_TIMEOUT_MS', 3000),
  },

  // Protecao do banco contra Thundering Herd
  db: {
    maxConcurrency: num('DB_MAX_CONCURRENCY', 20),
    queueTimeoutMs: num('DB_QUEUE_TIMEOUT_MS', 3000),
  },

  cacheTimeoutMs: num('CACHE_TIMEOUT_MS', 500),

  toxiproxy: {
    host: process.env.TOXIPROXY_HOST || '127.0.0.1',
    port: num('TOXIPROXY_PORT', 8474),
  },
};

module.exports = { config };
