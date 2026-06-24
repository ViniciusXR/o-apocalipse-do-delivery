'use strict';

const { CircuitOpenError, BusinessError, ValidationError } = require('../errors');

/**
 * Circuit Breaker (RN07).
 *
 * Estados:
 *  - CLOSED:    deixa passar. Mede a taxa de erro numa janela deslizante.
 *               Se (volume >= volumeThreshold) e (taxaErro > errorThreshold),
 *               abre o disjuntor.
 *  - OPEN:      bloqueia imediatamente (falha rapida) por resetTimeoutMs.
 *               E isto que evita a exaustao de threads: em vez de esperar 2s
 *               de timeout x4 retentativas, a requisicao falha em ~0ms.
 *  - HALF_OPEN: apos o resetTimeout, libera 1 chamada de teste. Sucesso ->
 *               fecha (recupera). Falha -> reabre.
 *
 * Importante: SOMENTE falhas de infraestrutura contam para abrir o breaker.
 * Cartao recusado (erro de negocio) e comportamento esperado do gateway, nao
 * uma falha da dependencia.
 */
class CircuitBreaker {
  constructor({
    errorThreshold = 0.5,
    volumeThreshold = 10,
    windowSize = 20,
    resetTimeoutMs = 3000,
    name = 'breaker',
    now = () => Date.now(),
  } = {}) {
    this.errorThreshold = errorThreshold;
    this.volumeThreshold = volumeThreshold;
    this.windowSize = windowSize;
    this.resetTimeoutMs = resetTimeoutMs;
    this.name = name;
    this.now = now;

    this.state = 'CLOSED';
    this.window = []; // true = sucesso, false = falha de infra
    this.openedAt = 0;
    this.nextHalfOpenAttempt = false;

    this.stats = { opens: 0, shortCircuited: 0, success: 0, failure: 0 };
  }

  isInfraFailure(err) {
    if (err instanceof BusinessError) return false;
    if (err instanceof ValidationError) return false;
    return true;
  }

  record(success) {
    this.window.push(success);
    if (this.window.length > this.windowSize) this.window.shift();
  }

  errorRate() {
    if (this.window.length === 0) return 0;
    const failures = this.window.filter((ok) => ok === false).length;
    return failures / this.window.length;
  }

  trip() {
    if (this.state !== 'OPEN') this.stats.opens += 1;
    this.state = 'OPEN';
    this.openedAt = this.now();
    this.window = [];
  }

  toClosed() {
    this.state = 'CLOSED';
    this.window = [];
  }

  /**
   * @param {() => Promise<any>} task
   */
  async execute(task) {
    if (this.state === 'OPEN') {
      const elapsed = this.now() - this.openedAt;
      if (elapsed >= this.resetTimeoutMs && !this.nextHalfOpenAttempt) {
        this.state = 'HALF_OPEN';
        this.nextHalfOpenAttempt = true;
      } else {
        this.stats.shortCircuited += 1;
        throw new CircuitOpenError(
          `Circuit breaker "${this.name}" OPEN: falha rapida (sem chamar a dependencia)`
        );
      }
    }

    const wasHalfOpen = this.state === 'HALF_OPEN';

    try {
      const result = await task();
      this.onSuccess(wasHalfOpen);
      return result;
    } catch (err) {
      this.onError(err, wasHalfOpen);
      throw err;
    }
  }

  onSuccess(wasHalfOpen) {
    this.stats.success += 1;
    this.nextHalfOpenAttempt = false;
    if (wasHalfOpen) {
      this.toClosed();
      return;
    }
    this.record(true);
  }

  onError(err, wasHalfOpen) {
    const infra = this.isInfraFailure(err);
    if (infra) this.stats.failure += 1;
    this.nextHalfOpenAttempt = false;

    if (wasHalfOpen) {
      if (infra) {
        this.trip(); // chamada de teste falhou -> reabre
      } else {
        this.toClosed(); // negocio respondeu -> dependencia esta de pe
      }
      return;
    }

    if (!infra) return; // erro de negocio nao afeta o breaker

    this.record(false);
    if (
      this.window.length >= this.volumeThreshold &&
      this.errorRate() > this.errorThreshold
    ) {
      this.trip();
    }
  }

  snapshot() {
    return {
      name: this.name,
      state: this.state,
      errorRate: Number(this.errorRate().toFixed(3)),
      windowSize: this.window.length,
      ...this.stats,
    };
  }
}

module.exports = { CircuitBreaker };
