class CheckoutService {
  constructor(gatewayPagamento, pedidoRepository, emailService) {
    this.gatewayPagamento = gatewayPagamento;
    this.pedidoRepository = pedidoRepository;
    this.emailService = emailService; // Dependência externa para e-mail
  }

  async processar(pedido) {
    try {
      // 1. Tenta a cobrança chamando o gateway bancário externo
      const resposta = await this.gatewayPagamento.cobrar(pedido.valor, pedido.cartao);
      
      if (resposta.status === 'APROVADO') {
        pedido.status = 'PROCESSADO';
        const pedidoSalvo = await this.pedidoRepository.salvar(pedido);
        
        // PROBLEMA: Disparo de e-mail síncrono acoplado ao fluxo principal
        await this.emailService.enviarConfirmacao(pedido.clienteEmail, "Pagamento Aprovado");
        
        return pedidoSalvo;
      } else {
        // 2. Caminho infeliz: Falha de negócio (Ex: Cartão Recusado)
        pedido.status = 'FALHOU';
        await this.pedidoRepository.salvar(pedido);
        return null;
      }
    } catch (error) {
      // 3. Caminho infeliz: Falha de infraestrutura (Ex: Timeout da API externa)
      console.error("Falha catastrófica no gateway bancário:", error.message);
      pedido.status = 'ERRO_GATEWAY';
      await this.pedidoRepository.salvar(pedido);
      
      // Reparem como o código atual falha de forma bruta sem tentar retries ou fallbacks
      return null;
    }
  }
}

module.exports = { CheckoutService };