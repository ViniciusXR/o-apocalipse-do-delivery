'use strict';

/**
 * VERSAO LEGADA (antes da Fase 2/4) - mantida apenas para comparacao no video.
 *
 * Problemas conhecidos (por que ela colapsa sob caos):
 *  - Sem timeout: uma chamada lenta do gateway (5000ms) segura o handler e
 *    leva a exaustao do event loop sob carga.
 *  - Sem retry/backoff: qualquer soluco de rede ja vira ERRO_GATEWAY.
 *  - Sem circuit breaker: continua martelando a dependencia quebrada.
 *  - E-mail SINCRONO acoplado: a latencia do SMTP entra no tempo de resposta.
 *  - Sem protecao de banco: a manada (cache flush) bate direto no DB.
 */
class CheckoutService {
  constructor(gatewayPagamento, pedidoRepository, emailService) {
    this.gatewayPagamento = gatewayPagamento;
    this.pedidoRepository = pedidoRepository;
    this.emailService = emailService;
  }

  async processar(pedido) {
    try {
      const resposta = await this.gatewayPagamento.cobrar(pedido.valor, pedido.cartao);

      if (resposta.status === 'APROVADO') {
        pedido.status = 'PROCESSADO';
        const pedidoSalvo = await this.pedidoRepository.salvar(pedido);
        await this.emailService.enviarConfirmacao(pedido.clienteEmail, 'Pagamento Aprovado');
        return pedidoSalvo;
      } else {
        pedido.status = 'FALHOU';
        await this.pedidoRepository.salvar(pedido);
        return null;
      }
    } catch (error) {
      console.error('Falha catastrofica no gateway bancario:', error.message);
      pedido.status = 'ERRO_GATEWAY';
      await this.pedidoRepository.salvar(pedido);
      return null;
    }
  }
}

module.exports = { CheckoutService };
