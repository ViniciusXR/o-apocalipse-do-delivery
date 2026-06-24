'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { withRetry } = require('../src/resilience/retry');
const { InfraError, BusinessError } = require('../src/errors');

const opts = { maxAttempts: 3, backoffMs: 1, jitterMs: 0 };

test('retenta falha de infra e eventualmente tem sucesso', async () => {
  let tentativas = 0;
  const result = await withRetry(async () => {
    tentativas += 1;
    if (tentativas < 3) throw new InfraError('rede instavel');
    return 'ok';
  }, opts);

  assert.strictEqual(result, 'ok');
  assert.strictEqual(tentativas, 3);
});

test('NAO retenta erro de negocio (cartao recusado)', async () => {
  let tentativas = 0;
  await assert.rejects(
    () =>
      withRetry(async () => {
        tentativas += 1;
        throw new BusinessError('RECUSADO');
      }, opts),
    /RECUSADO/
  );
  assert.strictEqual(tentativas, 1);
});

test('esgota as tentativas (1 + maxAttempts) e propaga o ultimo erro', async () => {
  let tentativas = 0;
  await assert.rejects(
    () =>
      withRetry(async () => {
        tentativas += 1;
        throw new InfraError('caiu');
      }, opts),
    /caiu/
  );
  assert.strictEqual(tentativas, 4); // 1 original + 3 retries
});
