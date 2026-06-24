'use strict';

const { withTimeout } = require('../resilience/timeout');

/**
 * Adapter HTTP para o no de Cache (ex: Redis simulado).
 *
 * Em modo caos a CACHE_URL aponta para o Toxiproxy, que pode "derrubar" o no
 * de cache (Thundering Herd). Por isso TODA leitura de cache e tolerante a
 * falha: se o cache cair ou der timeout, retornamos null (miss) em vez de
 * propagar a excecao. Quem decide o fallback para o banco e o CheckoutService.
 */
class HttpCache {
  constructor(baseUrl, timeoutMs = 500) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.stats = { hits: 0, misses: 0, errors: 0 };
  }

  async get(key) {
    try {
      const res = await withTimeout(
        (signal) => fetch(`${this.baseUrl}/cache/${encodeURIComponent(key)}`, { signal }),
        this.timeoutMs,
        'leitura de cache'
      );
      if (res.status === 404) {
        this.stats.misses += 1;
        return null;
      }
      if (!res.ok) {
        this.stats.errors += 1;
        return null;
      }
      const data = await res.json();
      this.stats.hits += 1;
      return data.value;
    } catch (err) {
      // Cache fora do ar / timeout = tratado como indisponibilidade -> miss.
      this.stats.errors += 1;
      return null;
    }
  }

  async set(key, value) {
    try {
      await withTimeout(
        (signal) =>
          fetch(`${this.baseUrl}/cache/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value }),
            signal,
          }),
        this.timeoutMs,
        'escrita de cache'
      );
    } catch (err) {
      // Escrita de cache e best-effort: ignora falhas.
    }
  }

  snapshot() {
    return { ...this.stats };
  }
}

module.exports = { HttpCache };
