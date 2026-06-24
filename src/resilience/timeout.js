'use strict';

const { TimeoutError } = require('../errors');

/**
 * Executa uma tarefa com um timeout rigido (RN04).
 *
 * A funcao recebe um AbortSignal: clientes HTTP modernos (fetch/undici)
 * abortam a conexao TCP de verdade quando o signal dispara, evitando que
 * sockets pendentes retenham recursos do event loop do Node.
 *
 * @param {(signal: AbortSignal) => Promise<any>} task
 * @param {number} ms
 * @param {string} [label]
 */
function withTimeout(task, ms, label = 'operacao') {
  const controller = new AbortController();
  let timer;

  const taskPromise = Promise.resolve().then(() => task(controller.signal));
  // Se o timeout vencer a corrida, a task ainda pode rejeitar depois (ex: o
  // fetch aborta). Registramos um catch vazio para nao gerar UnhandledRejection.
  taskPromise.catch(() => {});

  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Timeout de ${ms}ms excedido na ${label}`));
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return Promise.race([taskPromise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
