'use strict';

const { withTimeout } = require('../resilience/timeout');
const { withRetry } = require('../resilience/retry');
const { BusinessError } = require('../errors');

/**
 * CheckoutService RESILIENTE (Fase 2/4).
 *
 * Orquestra o checkout aplicando as politicas de tolerancia a falha exigidas
 * pela especificacao (RF02..RF05):
 *
 *   processar()
 *     -> obtem config (cache -> DB com single-flight + backoff/jitter)  [Herd]
 *     -> cobranca = retry( circuitBreaker( timeout( gateway.cobrar ) ) ) [RF04/05]
 *          . timeout 2s por tentativa            (RN04)
 *          . ate 3 retentativas + backoff 500ms  (RN05/RN06)
 *          . breaker abre se erro de rede > 50%   (RN07) -> falha rapida
 *     -> APROVADO    : status PROCESSADO + e-mail ASSINCRONO   (RF02)
 *     -> RECUSADO    : status FALHOU, SEM e-mail               (RF03)
 *     -> esgotou/open: status ERRO_GATEWAY, fallback limpo     (RF05)
 *
 * Resultado: { ...pedido, resultado: 'PROCESSADO'|'FALHOU'|'ERRO_GATEWAY' }
 * O servico NUNCA lanca excecao para fora (degradacao graciosa).
 */
class CheckoutService {
  constructor({
    gateway,
    repository,
    emailService,
    configProvider,
    circuitBreaker,
    timeoutMs = 2000,
    retry = { maxAttempts: 3, backoffMs: 500, jitterMs: 250 },
  }) {
    this.gateway = gateway;
    this.repository = repository;
    this.emailService = emailService;
    this.configProvider = configProvider;
    this.breaker = circuitBreaker;
    this.timeoutMs = timeoutMs;
    this.retry = retry;

    this.metrics = { PROCESSADO: 0, FALHOU: 0, ERRO_GATEWAY: 0, degradado: 0 };
  }

  // CircuitOpenError e InfraError "de circuito" nao devem ser retentados:
  // se o breaker esta aberto, retentar so adiciona latencia inutil.
  static _retryable(err) {
    return Boolean(err && err.isInfra === true && !err.isCircuitOpen);
  }

  async processar(pedido) {
    // Enriquecimento via cache/DB. Protegido contra Thundering Herd e tolerante
    // a falha: se nem o banco responder, segue em modo degradado com default.
    try {
      pedido.config = await this.configProvider.obter('checkout:antifraude');
    } catch (err) {
      this.metrics.degradado += 1;
      pedido.config = { fonte: 'default-degradado', taxaAntifraude: 0.02 };
    }

    let resposta;
    try {
      resposta = await withRetry(
        () =>
          this.breaker.execute(() =>
            withTimeout(
              (signal) => this.gateway.cobrar(pedido.valor, pedido.cartao, signal),
              this.timeoutMs,
              'cobranca no gateway'
            )
          ),
        {
          maxAttempts: this.retry.maxAttempts,
          backoffMs: this.retry.backoffMs,
          jitterMs: this.retry.jitterMs,
          retryable: CheckoutService._retryable,
        }
      );
    } catch (err) {
      if (err instanceof BusinessError) {
        return this._finalizarFalha(pedido, 'FALHOU', err.status || 'RECUSADO');
      }
      // InfraError / TimeoutError / CircuitOpenError -> RF05 fallback
      return this._finalizarFalha(pedido, 'ERRO_GATEWAY', err.name);
    }

    // RF02 - caminho feliz
    pedido.status = 'PROCESSADO';
    const salvo = await this._salvarSeguro(pedido);
    this._dispararEmailAssincrono(pedido.clienteEmail);
    this.metrics.PROCESSADO += 1;
    return { ...salvo, resultado: 'PROCESSADO', autorizacao: resposta.autorizacao };
  }

  async _finalizarFalha(pedido, status, motivo) {
    pedido.status = status;
    const salvo = await this._salvarSeguro(pedido);
    this.metrics[status] += 1;
    return { ...salvo, resultado: status, motivo };
  }

  // RF02: o e-mail e disparado de forma assincrona (fire-and-forget) e seu
  // sucesso/falha jamais retem ou derruba a resposta HTTP do checkout.
  _dispararEmailAssincrono(email) {
    Promise.resolve()
      .then(() => this.emailService.enviarConfirmacao(email, 'Pagamento Aprovado'))
      .catch((err) => console.error('[checkout] falha no e-mail (ignorada):', err.message));
  }

  // RN07: falhar de forma limpa. Se ate o banco estiver indisponivel, nao
  // propagamos a excecao - registramos e devolvemos o pedido mesmo assim.
  async _salvarSeguro(pedido) {
    try {
      return await this.repository.salvar(pedido);
    } catch (err) {
      console.error('[checkout] falha ao persistir pedido (degradado):', err.message);
      return { ...pedido, persistido: false };
    }
  }

  snapshot() {
    return { ...this.metrics };
  }
}

module.exports = { CheckoutService };
