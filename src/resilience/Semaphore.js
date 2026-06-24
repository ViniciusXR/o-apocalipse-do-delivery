'use strict';

const { TimeoutError } = require('../errors');

/**
 * Semaforo com fila e timeout de espera.
 *
 * Simula um POOL DE CONEXOES de banco com tamanho fixo. Quando todas as vagas
 * estao ocupadas, as proximas requisicoes aguardam na fila ate uma vaga
 * liberar ou ate estourar o queueTimeoutMs. Isso modela a "exaustao de
 * threads/conexoes" que o trabalho pede para evitar: o banco NUNCA recebe
 * mais que `max` chamadas simultaneas.
 */
class Semaphore {
  constructor(max, queueTimeoutMs = 3000) {
    this.max = max;
    this.queueTimeoutMs = queueTimeoutMs;
    this.inUse = 0;
    this.queue = [];
    this.peak = 0;
    this.rejectedByTimeout = 0;
  }

  acquire() {
    if (this.inUse < this.max) {
      this.inUse += 1;
      this.peak = Math.max(this.peak, this.inUse);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) this.queue.splice(idx, 1);
        this.rejectedByTimeout += 1;
        reject(new TimeoutError('Pool de conexoes do banco esgotado (espera excedeu o limite)'));
      }, this.queueTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const entry = { resolve, timer };
      this.queue.push(entry);
    });
  }

  release() {
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      this.peak = Math.max(this.peak, this.inUse);
      next.resolve();
    } else {
      this.inUse = Math.max(0, this.inUse - 1);
    }
  }

  async run(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  snapshot() {
    return {
      max: this.max,
      inUse: this.inUse,
      queued: this.queue.length,
      peak: this.peak,
      rejectedByTimeout: this.rejectedByTimeout,
    };
  }
}

module.exports = { Semaphore };
