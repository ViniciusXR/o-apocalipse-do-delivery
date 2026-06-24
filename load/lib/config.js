// Configuracao compartilhada dos testes k6.
// Valores podem ser sobrescritos por variaveis de ambiente (-e CHAVE=valor).

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
export const CHECKOUT_URL = `${BASE_URL}/api/v1/checkout`;
export const METRICS_URL = `${BASE_URL}/internal/metrics`;

// --- SLO / SLI (espelham a especificacao - secao 5 do DER) ---
//  p95 das requisicoes < 2500ms ; taxa de sucesso > 95% (erro < 5%).
export const SLO = {
  p95Ms: Number(__ENV.SLO_P95_MS || 2500),
  errorRate: Number(__ENV.SLO_ERROR_RATE || 0.05),
};

// Thresholds padrao aplicados aos cenarios de baseline/carga.
export const baselineThresholds = {
  http_req_duration: [`p(95)<${SLO.p95Ms}`],
  http_req_failed: [`rate<${SLO.errorRate}`],
  checks: ['rate>0.95'],
};

// Gera um payload de checkout valido.
//   tipo: 'aprovado' (default) | 'recusado' | 'infra'
// O gateway-sim decide o desfecho pelo prefixo do numero do cartao.
export function novoPedido(tipo = 'aprovado') {
  const prefixo =
    tipo === 'recusado' ? '4000' : tipo === 'infra' ? '5000' : '6011';
  return JSON.stringify({
    clienteEmail: `cliente${Math.floor(Math.random() * 1e6)}@entregaja.com`,
    valor: Number((Math.random() * 200 + 10).toFixed(2)),
    cartao: {
      numero: `${prefixo}${Math.floor(Math.random() * 1e6)}`,
      validade: '12/29',
      cvv: '123',
    },
  });
}

export const jsonParams = { headers: { 'Content-Type': 'application/json' } };
