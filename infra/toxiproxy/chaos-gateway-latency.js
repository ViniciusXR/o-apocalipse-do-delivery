'use strict';

/**
 * CAOS 2 - "Gateway Lento": injeta 5000ms de latencia na comunicacao com a API
 * de pagamento (Fase 4, item 2). Como o timeout do checkout e 2000ms, toda
 * tentativa estoura -> o circuit breaker abre -> o app passa a falhar rapido
 * (degradacao graciosa) em vez de travar threads.
 *
 * Uso:
 *   node infra/toxiproxy/chaos-gateway-latency.js on        # liga e mantem
 *   node infra/toxiproxy/chaos-gateway-latency.js off       # desliga
 *   node infra/toxiproxy/chaos-gateway-latency.js 30        # liga, segura 30s, desliga (mede MTTR)
 */
const { addToxic, removeToxic, reset } = require('./client');

const PROXY = 'gateway';
const TOXIC = 'latency_5s';
const LATENCY_MS = Number(process.env.GATEWAY_LATENCY_MS || 5000);

async function ligar() {
  // reset evita erro de "toxico ja existe" em reexecucoes
  await safeRemove();
  await addToxic(PROXY, {
    name: TOXIC,
    type: 'latency',
    stream: 'upstream',
    toxicity: 1.0,
    attributes: { latency: LATENCY_MS, jitter: 0 },
  });
  console.log(`[caos] gateway-lento LIGADO (+${LATENCY_MS}ms) em ${new Date().toISOString()}`);
}

async function desligar() {
  await safeRemove();
  console.log(`[caos] gateway-lento DESLIGADO em ${new Date().toISOString()} (inicio do MTTR)`);
}

async function safeRemove() {
  try {
    await removeToxic(PROXY, TOXIC);
  } catch (_e) {
    /* toxico pode nao existir ainda */
  }
}

(async () => {
  const arg = process.argv[2] || 'on';

  if (arg === 'off') {
    await desligar();
    return;
  }

  if (/^\d+$/.test(arg)) {
    const segundos = Number(arg);
    await ligar();
    console.log(`[caos] segurando por ${segundos}s...`);
    await new Promise((r) => setTimeout(r, segundos * 1000));
    await desligar();
    return;
  }

  await ligar();
})().catch(async (err) => {
  console.error(err.message);
  try {
    await reset();
  } catch (_e) {
    /* ignore */
  }
  process.exit(1);
});
