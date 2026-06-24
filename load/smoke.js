// Smoke test: valida que a stack esta de pe e o caminho feliz responde 200
// antes de partir para os cenarios pesados.
//
//   k6 run load/smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { CHECKOUT_URL, novoPedido, jsonParams } from './lib/config.js';

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const res = http.post(CHECKOUT_URL, novoPedido('aprovado'), jsonParams);
  check(res, {
    'status 200': (r) => r.status === 200,
    'pedido PROCESSADO': (r) => r.json('pedido.resultado') === 'PROCESSADO',
  });
  sleep(0.2);
}
