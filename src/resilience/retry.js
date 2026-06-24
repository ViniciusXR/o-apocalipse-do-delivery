'use strict';

const { BusinessError, ValidationError } = require('../errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Politica de retentativas com backoff fixo + jitter (RN05/RN06).
 *
 * - Retenta SOMENTE falhas de infraestrutura (timeout, 5xx, rede). Erros de
 *   negocio (cartao recusado) e de validacao nunca sao retentados.
 * - "maxAttempts" = retentativas ADICIONAIS. Total de execucoes = 1 + maxAttempts.
 * - Backoff fixo (RN06: 500ms) + jitter aleatorio. O jitter espalha as
 *   retentativas no tempo e e o que protege o banco/gateway contra o efeito
 *   "thundering herd" de todos retentando no mesmo milissegundo.
 *
 * @param {() => Promise<any>} task
 * @param {object} opts
 * @param {number} opts.maxAttempts
 * @param {number} opts.backoffMs
 * @param {number} [opts.jitterMs]
 * @param {(err: Error) => boolean} [opts.retryable]
 * @param {(info: {attempt: number, delay: number, error: Error}) => void} [opts.onRetry]
 */
async function withRetry(task, opts) {
  const {
    maxAttempts,
    backoffMs,
    jitterMs = 0,
    retryable = defaultRetryable,
    onRetry,
  } = opts;

  let lastError;
  const totalTries = maxAttempts + 1;

  for (let attempt = 1; attempt <= totalTries; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === totalTries;
      if (isLastAttempt || !retryable(err)) {
        throw err;
      }

      const delay = backoffMs + Math.floor(Math.random() * (jitterMs + 1));
      if (onRetry) onRetry({ attempt, delay, error: err });
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Por padrao, erros de negocio e validacao NAO sao retentaveis. */
function defaultRetryable(err) {
  if (err instanceof BusinessError) return false;
  if (err instanceof ValidationError) return false;
  return true;
}

module.exports = { withRetry, sleep, defaultRetryable };
