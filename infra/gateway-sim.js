'use strict';

/**
 * Gateway de Pagamento parceiro SIMULADO (API externa).
 *
 * E a dependencia que o Toxiproxy vai interceptar para injetar 5000ms de
 * latencia ("Gateway Lento"). Sozinho ele responde em ~300ms (RF: I/O bound).
 *
 * Controle deterministico via numero do cartao (util para o k6/BDD):
 *   - numero iniciando em "4000" -> RECUSADO (falha de negocio)
 *   - numero iniciando em "5000" -> HTTP 500 (falha de infra, dispara retry)
 *   - demais                     -> APROVADO  (ou conforme /admin/mode)
 *
 * /admin/mode permite simular caos SEM Toxiproxy (latencyMs/failRate/declineRate),
 * util como plano B caso o Toxiproxy nao esteja instalado.
 */
const express = require('express');

const app = express();
app.use(express.json());

const PORT = Number(process.env.GATEWAY_PORT || 4001);

const mode = {
  baseLatencyMs: 300,
  latencyMs: 0, // latencia extra forcada (plano B sem Toxiproxy)
  failRate: 0, // proporcao de respostas 5xx
  declineRate: 0, // proporcao de respostas RECUSADO
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway-sim' }));

app.get('/admin/mode', (_req, res) => res.json(mode));
app.post('/admin/mode', (req, res) => {
  Object.assign(mode, req.body || {});
  console.log('[gateway-sim] modo atualizado:', mode);
  res.json(mode);
});

app.post('/charge', async (req, res) => {
  await sleep(mode.baseLatencyMs + mode.latencyMs);

  const numero = String((req.body && req.body.cartao && req.body.cartao.numero) || '');

  if (numero.startsWith('5000') || Math.random() < mode.failRate) {
    return res.status(500).json({ erro: 'INTERNAL_GATEWAY_ERROR' });
  }
  if (numero.startsWith('4000') || Math.random() < mode.declineRate) {
    return res.status(200).json({ status: 'RECUSADO', motivo: 'CARTAO_RECUSADO' });
  }

  return res.status(200).json({ status: 'APROVADO', autorizacao: `AUTH-${Date.now()}` });
});

app.listen(PORT, () => console.log(`[gateway-sim] ouvindo em http://127.0.0.1:${PORT}`));
