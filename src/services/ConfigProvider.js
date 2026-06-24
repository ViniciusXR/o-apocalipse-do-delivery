'use strict';

const { SingleFlight } = require('../resilience/singleflight');
const { withRetry } = require('../resilience/retry');

/**
 * Provedor de configuracao "read-through" (cache -> banco).
 *
 * Fluxo:
 *   1. Tenta o cache (rapido, tolerante a falha).
 *   2. Miss/queda -> busca no banco protegido por:
 *        - SingleFlight: coalesce N requisicoes concorrentes da mesma chave
 *          em UMA unica query (defesa central contra Thundering Herd).
 *        - withRetry + backoff + JITTER: se o banco engasgar (pool cheio),
 *          espalha as retentativas no tempo em vez de bater todas juntas.
 *   3. Repovoa o cache (best-effort).
 *
 * E o ponto que prova "o banco sobrevive a manada usando backoff e jitter".
 */
class ConfigProvider {
  constructor(cache, repository, retryOpts) {
    this.cache = cache;
    this.repository = repository;
    this.retryOpts = retryOpts;
    this.singleFlight = new SingleFlight();
    this.dbLoads = 0;
  }

  async obter(chave) {
    const cached = await this.cache.get(chave);
    if (cached) return cached;

    return this.singleFlight.do(chave, async () => {
      const valor = await withRetry(
        () => this.repository.carregarConfig(chave),
        this.retryOpts
      );
      this.dbLoads += 1;
      this.cache.set(chave, valor); // best-effort, nao espera
      return valor;
    });
  }

  snapshot() {
    return { dbLoads: this.dbLoads, singleFlight: this.singleFlight.snapshot() };
  }
}

module.exports = { ConfigProvider };
