'use strict';

/**
 * Disparador de rajada CONCORRENTE (plano B para o Thundering Herd sem k6).
 * Usa um POOL de workers com keep-alive (concorrencia sustentada), refletindo
 * clientes reais e evitando a "tempestade de SYN" de abrir N sockets de uma vez.
 *
 * Uso:
 *   node scripts/burst.js                  # N=300, concorrencia=100
 *   node scripts/burst.js 2000 200         # N=2000 com 200 conexoes simultaneas
 *   node scripts/burst.js 500 100 5000111  # forca cartao (infra) p/ testar breaker
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const N = Number(process.argv[2] || 300);
const CONCURRENCY = Number(process.argv[3] || 100);
const numeroCartao = process.argv[4] || '6011';

function corpo() {
  return JSON.stringify({
    clienteEmail: `c${Math.floor(Math.random() * 1e6)}@entregaja.com`,
    valor: Number((Math.random() * 200 + 10).toFixed(2)),
    cartao: { numero: numeroCartao, validade: '12/29', cvv: '123' },
  });
}

async function umaReq() {
  const ini = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/v1/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corpo(),
    });
    return { status: res.status, ms: Date.now() - ini };
  } catch (err) {
    return { status: 0, ms: Date.now() - ini, err: err.message };
  }
}

(async () => {
  console.log(
    `Disparando ${N} requisicoes (${CONCURRENCY} simultaneas) para ${BASE_URL} ...`
  );
  const ini = Date.now();

  // Pool de workers: mantem CONCURRENCY requisicoes em voo ao mesmo tempo.
  const resultados = [];
  let proxima = 0;
  async function worker() {
    while (proxima < N) {
      proxima += 1;
      resultados.push(await umaReq());
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, N) }, worker)
  );

  const total = Date.now() - ini;

  const porStatus = {};
  let somaMs = 0;
  const tempos = [];
  for (const r of resultados) {
    porStatus[r.status] = (porStatus[r.status] || 0) + 1;
    somaMs += r.ms;
    tempos.push(r.ms);
  }
  tempos.sort((a, b) => a - b);
  const p = (q) => tempos[Math.min(tempos.length - 1, Math.floor(q * tempos.length))];

  console.log(`\nConcluido em ${total}ms`);
  console.log('Status:', porStatus);
  console.log(`Latencia ms -> avg=${Math.round(somaMs / N)} p50=${p(0.5)} p95=${p(0.95)} max=${tempos.at(-1)}`);

  try {
    const m = await (await fetch(`${BASE_URL}/internal/metrics`)).json();
    console.log('\n--- /internal/metrics ---');
    console.log(`DB pool.peak (max=${m.repository.pool.max}): ${m.repository.pool.peak}  | queries=${m.repository.queries} | rejeitadas_pool=${m.repository.pool.rejectedByTimeout}`);
    console.log(`single-flight coalesced: ${m.configProvider.singleFlight.coalesced} | config dbLoads: ${m.configProvider.dbLoads}`);
    console.log(`cache hits/misses/errors: ${m.cache.hits}/${m.cache.misses}/${m.cache.errors}`);
    console.log(`breaker: state=${m.breaker.state} opens=${m.breaker.opens} shortCircuited=${m.breaker.shortCircuited}`);
    console.log(`checkout: PROCESSADO=${m.checkout.PROCESSADO} FALHOU=${m.checkout.FALHOU} ERRO_GATEWAY=${m.checkout.ERRO_GATEWAY} degradado=${m.checkout.degradado}`);
  } catch (_e) {
    /* ignore */
  }
})();
