// CAOS 2 - "Gateway Lento" sob carga.
// Mantem carga constante enquanto o operador injeta +5000ms no gateway via
// Toxiproxy. Objetivo: PROVAR a degradacao graciosa -> o circuit breaker abre
// e o app passa a falhar RAPIDO (sem travar threads), em vez de colapsar.
//
// Roteiro (2 terminais):
//   T1: k6 run load/gateway-lento.js
//   T2: (apos ~15s) npm run chaos:gateway-latency 30
//
// Leia o resultado junto com GET /internal/metrics (estado do breaker).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { CHECKOUT_URL, novoPedido, jsonParams, SLO } from './lib/config.js';

const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '1m';

// SLIs especificos da degradacao graciosa:
const disponibilidade = new Rate('disponibilidade'); // respondeu HTTP (nao caiu / nao deu erro de conexao)
const falhaRapida = new Rate('falha_rapida'); // dos 500, quantos voltaram < 500ms (breaker protegendo)
const duracaoErro = new Trend('duracao_erros', true);

export const options = {
  scenarios: {
    gateway_lento: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    // Disponibilidade do PROCESSO deve se manter alta mesmo com o gateway fora:
    // o servidor responde (ainda que 500) em vez de derrubar conexoes.
    disponibilidade: ['rate>0.99'],
    // p95 das requisicoes nao deve explodir: o breaker corta a latencia.
    http_req_duration: [`p(95)<${SLO.p95Ms}`],
  },
};

export default function () {
  const res = http.post(CHECKOUT_URL, novoPedido('aprovado'), jsonParams, {
    timeout: '15s',
  });

  // status 0 = conexao caiu/timeout no nivel do cliente (colapso). Qualquer
  // status HTTP >= 200 conta como "servidor respondeu".
  disponibilidade.add(res.status !== 0);

  if (res.status >= 500) {
    duracaoErro.add(res.timings.duration);
    falhaRapida.add(res.timings.duration < 500);
  }

  check(res, {
    'servidor respondeu (status != 0)': (r) => r.status !== 0,
  });

  sleep(0.3);
}
