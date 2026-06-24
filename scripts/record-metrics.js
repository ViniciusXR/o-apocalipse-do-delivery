'use strict';

/**
 * Grava a linha do tempo de /internal/metrics durante os experimentos de caos.
 * Serve para evidenciar a DEGRADACAO GRACIOSA e calcular o MTTR (tempo entre o
 * fim da falha e a volta do breaker para CLOSED / sucesso normalizado).
 *
 * Uso:
 *   node scripts/record-metrics.js               # imprime a cada 1s ate Ctrl+C
 *   node scripts/record-metrics.js 0.5 90         # a cada 0.5s por 90s
 *
 * Saida: tabela no console + CSV em load/results/metrics-<timestamp>.csv
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const intervalo = Number(process.argv[2] || 1) * 1000;
const limiteS = Number(process.argv[3] || 0); // 0 = infinito

const outDir = path.join(__dirname, '..', 'load', 'results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `metrics-${Date.now()}.csv`);
const header =
  't_ms,breaker_state,breaker_errorRate,proc,falhou,erro_gateway,degradado,db_peak,db_pool_inUse,db_queued,sf_coalesced,cache_hits,cache_misses,cache_errors';
fs.writeFileSync(outFile, header + '\n');
console.log(header);

const t0 = Date.now();
let parar = false;

async function tick() {
  let m;
  try {
    const res = await fetch(`${BASE_URL}/internal/metrics`);
    m = await res.json();
  } catch (err) {
    console.error(`[monitor] falha ao ler metrics: ${err.message}`);
    return;
  }

  const t = Date.now() - t0;
  const c = m.checkout || {};
  const b = m.breaker || {};
  const pool = (m.repository && m.repository.pool) || {};
  const sf = (m.configProvider && m.configProvider.singleFlight) || {};
  const cache = m.cache || {};

  const linha = [
    t,
    b.state,
    b.errorRate,
    c.PROCESSADO,
    c.FALHOU,
    c.ERRO_GATEWAY,
    c.degradado,
    pool.peak,
    pool.inUse,
    pool.queued,
    sf.coalesced,
    cache.hits,
    cache.misses,
    cache.errors,
  ].join(',');

  console.log(linha);
  fs.appendFileSync(outFile, linha + '\n');
}

(async () => {
  await tick();
  const timer = setInterval(async () => {
    if (parar) return;
    await tick();
    if (limiteS && Date.now() - t0 >= limiteS * 1000) {
      clearInterval(timer);
      console.log(`\nGravado em ${outFile}`);
      process.exit(0);
    }
  }, intervalo);
})();

process.on('SIGINT', () => {
  parar = true;
  console.log(`\nGravado em ${outFile}`);
  process.exit(0);
});
