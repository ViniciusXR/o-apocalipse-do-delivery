// Cenario base da Black Friday: ramp-up -> steady -> ramp-down.
// Estabelece a LINHA DE BASE de desempenho (sem caos) contra os SLOs.
//
//   k6 run load/black-friday.js
//   k6 run -e STEADY_VUS=100 -e STEADY_DURATION=2m load/black-friday.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { CHECKOUT_URL, novoPedido, jsonParams, baselineThresholds } from './lib/config.js';

const STEADY_VUS = Number(__ENV.STEADY_VUS || 50);
const RAMP_UP = __ENV.RAMP_UP || '30s';
const STEADY = __ENV.STEADY_DURATION || '1m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '20s';

const processados = new Counter('pedidos_processados');
const recusados = new Counter('pedidos_recusados');
const erros_gateway = new Counter('pedidos_erro_gateway');

export const options = {
  scenarios: {
    black_friday: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: STEADY_VUS }, // ramp-up
        { duration: STEADY, target: STEADY_VUS }, // steady (pico sustentado)
        { duration: RAMP_DOWN, target: 0 }, // ramp-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: baselineThresholds,
};

export default function () {
  const res = http.post(CHECKOUT_URL, novoPedido('aprovado'), jsonParams);

  check(res, {
    'status 200': (r) => r.status === 200,
    'latencia < 2500ms': (r) => r.timings.duration < 2500,
  });

  if (res.status === 200) processados.add(1);
  else if (res.status === 500 && String(res.body).includes('recusado')) recusados.add(1);
  else erros_gateway.add(1);

  sleep(Math.random() * 0.5);
}
