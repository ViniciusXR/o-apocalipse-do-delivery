'use strict';

/**
 * No de Cache SIMULADO (ex: Redis).
 *
 * E a dependencia que o Toxiproxy vai "derrubar" no cenario Thundering Herd
 * (ou que recebe /admin/flush para esvaziar de repente). Ja vem populado com a
 * chave de antifraude para que o caminho normal tenha cache hit.
 */
const express = require('express');

const app = express();
app.use(express.json());

const PORT = Number(process.env.CACHE_PORT || 4002);

const store = new Map();
seed();

function seed() {
  store.set('checkout:antifraude', {
    chave: 'checkout:antifraude',
    taxaAntifraude: 0.015,
    fonte: 'CACHE',
    carregadoEm: Date.now(),
  });
}

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'cache-sim', keys: store.size })
);

app.get('/cache/:key', (req, res) => {
  const value = store.get(req.params.key);
  if (value === undefined) return res.status(404).json({ erro: 'MISS' });
  return res.json({ value });
});

app.put('/cache/:key', (req, res) => {
  store.set(req.params.key, req.body && req.body.value);
  res.json({ status: 'ok' });
});

// Thundering Herd: esvazia o cache de repente.
app.post('/admin/flush', (_req, res) => {
  const antes = store.size;
  store.clear();
  console.log(`[cache-sim] FLUSH! ${antes} chave(s) removida(s)`);
  res.json({ status: 'flushed', removidas: antes });
});

// Repovoa (para medir recuperacao/MTTR apos o caos).
app.post('/admin/seed', (_req, res) => {
  seed();
  res.json({ status: 'seeded', keys: store.size });
});

app.listen(PORT, () => console.log(`[cache-sim] ouvindo em http://127.0.0.1:${PORT}`));
