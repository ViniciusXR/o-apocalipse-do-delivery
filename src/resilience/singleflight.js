'use strict';

/**
 * Single-flight (coalescencia de requisicoes).
 *
 * Quando o cache cai (Thundering Herd), milhares de requisicoes tentam ler a
 * MESMA chave do banco ao mesmo tempo. O single-flight garante que, para uma
 * chave, apenas UMA chamada ao banco esteja em voo: as demais requisicoes
 * concorrentes "pegam carona" na mesma Promise. E a defesa principal que
 * impede a manada (10.000 req) de derrubar o banco.
 */
class SingleFlight {
  constructor() {
    this.inFlight = new Map();
    this.coalesced = 0;
  }

  async do(key, task) {
    if (this.inFlight.has(key)) {
      this.coalesced += 1;
      return this.inFlight.get(key);
    }

    const promise = (async () => task())().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  snapshot() {
    return { inFlight: this.inFlight.size, coalesced: this.coalesced };
  }
}

module.exports = { SingleFlight };
