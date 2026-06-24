'use strict';

const { InfraError, BusinessError } = require('../errors');

/**
 * Adapter HTTP para o Gateway de Pagamento parceiro.
 *
 * Faz uma chamada de REDE REAL (fetch/undici). Em modo caos, a GATEWAY_URL
 * aponta para a porta do Toxiproxy, que fica entre o checkout e o gateway
 * simulado e injeta latencia/queda. O AbortSignal vindo do withTimeout aborta
 * o socket de verdade quando o timeout de 2s estoura.
 *
 * Convencao de erros (essencial para o retry e o breaker):
 *  - APROVADO            -> retorna { status: 'APROVADO' }
 *  - RECUSADO/etc        -> lanca BusinessError (NAO retenta, NAO abre breaker)
 *  - HTTP 5xx / rede     -> lanca InfraError (retenta e conta para o breaker)
 */
class HttpPaymentGateway {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async cobrar(valor, cartao, signal) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/charge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ valor, cartao }),
        signal,
      });
    } catch (err) {
      // AbortError (timeout) ou erro de conexao (ECONNREFUSED/ECONNRESET).
      throw new InfraError(`Falha de rede ao contatar o gateway: ${err.message}`, err);
    }

    if (res.status >= 500) {
      throw new InfraError(`Gateway respondeu HTTP ${res.status}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new InfraError('Resposta malformada do gateway', err);
    }

    if (data && data.status === 'APROVADO') {
      return { status: 'APROVADO', autorizacao: data.autorizacao };
    }

    const status = (data && data.status) || 'RECUSADO';
    throw new BusinessError(`Pagamento ${status}`, status);
  }
}

module.exports = { HttpPaymentGateway };
