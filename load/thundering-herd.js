// CAOS 1 - "Thundering Herd" (Manada Estourada) sob carga massiva.
// Dispara uma rajada de requisicoes simultaneas enquanto o operador derruba o
// no de cache. Objetivo: PROVAR que o banco sobrevive a manada graças a
// single-flight + backoff/jitter + pool de conexoes limitado.
//
// Roteiro (2 terminais):
//   T1: k6 run load/thundering-herd.js
//   T2: (no pico) npm run chaos:herd            (flush + derruba o cache ~15s)
//
// Verifique GET /internal/metrics:
//   repository.pool.peak  <= DB_MAX_CONCURRENCY   (banco nunca foi alem do pool)
//   configProvider.singleFlight.coalesced >> 0    (manada coalescida em 1 query)
//
// Para se aproximar de "10.000 simultaneas", aumente os parametros conforme o
// hardware:  k6 run -e PEAK_RPS=5000 -e MAX_VUS=10000 load/thundering-herd.js
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { CHECKOUT_URL, novoPedido, jsonParams, SLO } from './lib/config.js';

const PEAK_RPS = Number(__ENV.PEAK_RPS || 1000);
const MAX_VUS = Number(__ENV.MAX_VUS || 1000);
const PRE_VUS = Number(__ENV.PRE_VUS || 200);

const sucesso = new Rate('checkout_sucesso');
const duracao = new Trend('checkout_duracao', true);

export const options = {
  scenarios: {
    thundering_herd: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { duration: '10s', target: 50 }, // warm-up
        { duration: '10s', target: PEAK_RPS }, // sobe para o pico (manada)
        { duration: '30s', target: PEAK_RPS }, // pico sustentado (derrube o cache aqui)
        { duration: '10s', target: 0 }, // ramp-down
      ],
    },
  },
  thresholds: {
    // O banco sobrevivendo = sucesso alto mesmo com o cache fora.
    checkout_sucesso: ['rate>0.95'],
    http_req_duration: [`p(95)<${SLO.p95Ms}`],
    http_req_failed: [`rate<${SLO.errorRate}`],
  },
};

export default function () {
  const res = http.post(CHECKOUT_URL, novoPedido('aprovado'), jsonParams, {
    timeout: '15s',
  });

  sucesso.add(res.status === 200);
  duracao.add(res.timings.duration);

  check(res, {
    'status 200': (r) => r.status === 200,
    'sem colapso (status != 0)': (r) => r.status !== 0,
  });
}
