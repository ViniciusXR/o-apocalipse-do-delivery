'use strict';

/**
 * CAOS 1 - "Thundering Herd" (Manada Estourada): derruba/esvazia o no de cache
 * de repente enquanto o k6 dispara ~10.000 requisicoes simultaneas (Fase 4,
 * item 1). Sem cache, todas as requisicoes tentariam ler a mesma chave no
 * banco ao mesmo tempo. A defesa (single-flight + backoff/jitter + pool
 * limitado) deve manter o banco vivo.
 *
 * Uso:
 *   node infra/toxiproxy/chaos-thundering-herd.js flush         # so esvazia o cache (fica cold)
 *   node infra/toxiproxy/chaos-thundering-herd.js down 15       # derruba o no de cache por 15s
 *   node infra/toxiproxy/chaos-thundering-herd.js               # flush + derruba por 15s (default)
 */
const { setEnabled } = require('./client');

const CACHE_DIRECT_URL = process.env.CACHE_DIRECT_URL || 'http://127.0.0.1:4002';
const PROXY = 'cache';

async function flush() {
  try {
    const res = await fetch(`${CACHE_DIRECT_URL}/admin/flush`, { method: 'POST' });
    const data = await res.json();
    console.log(`[caos] cache FLUSH ok:`, data);
  } catch (err) {
    console.error(`[caos] falha ao flushar cache: ${err.message}`);
  }
}

async function reseed() {
  try {
    await fetch(`${CACHE_DIRECT_URL}/admin/seed`, { method: 'POST' });
  } catch (_e) {
    /* ignore */
  }
}

async function down(segundos) {
  console.log(`[caos] derrubando no de cache em ${new Date().toISOString()}`);
  await setEnabled(PROXY, false); // proxy desabilitado = conexao recusada
  console.log(`[caos] cache OFFLINE por ${segundos}s (manada vai para o banco)`);
  await new Promise((r) => setTimeout(r, segundos * 1000));
  await setEnabled(PROXY, true);
  await reseed();
  console.log(`[caos] cache ONLINE novamente em ${new Date().toISOString()} (inicio do MTTR)`);
}

(async () => {
  const arg = process.argv[2];
  const segundos = Number(process.argv[3] || process.env.HERD_DOWN_SECONDS || 15);

  if (arg === 'flush') {
    await flush();
    return;
  }
  if (arg === 'down') {
    await down(segundos);
    return;
  }

  // default: flush + derruba o no
  await flush();
  await down(segundos);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
