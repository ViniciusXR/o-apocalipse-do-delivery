'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { withTimeout } = require('../src/resilience/timeout');
const { TimeoutError } = require('../src/errors');

test('resolve quando a tarefa termina dentro do prazo', async () => {
  const r = await withTimeout(
    () => new Promise((resolve) => setTimeout(() => resolve('ok'), 20)),
    200
  );
  assert.strictEqual(r, 'ok');
});

test('rejeita com TimeoutError quando excede o prazo', async () => {
  await assert.rejects(
    () => withTimeout(() => new Promise((resolve) => setTimeout(resolve, 200)), 30),
    TimeoutError
  );
});

test('aborta o signal quando estoura o timeout', async () => {
  let abortado = false;
  await assert.rejects(
    () =>
      withTimeout((signal) => {
        signal.addEventListener('abort', () => {
          abortado = true;
        });
        return new Promise((resolve) => setTimeout(resolve, 200));
      }, 30),
    TimeoutError
  );
  assert.strictEqual(abortado, true);
});
