const express = require('express');
const { CheckoutService } = require('./services/CheckoutService');

const app = express();
app.use(express.json());

// Mocks simulados de infraestrutura para o servidor rodar localmente antes do Toxiproxy
const gatewayPagamentoMock = {
  cobrar: async (valor) => {
    // Simula o tempo de resposta padrão de uma API de terceiros (I/O Bound)
    return new Promise(resolve => setTimeout(() => resolve({ status: 'APROVADO' }), 300));
  }
};

const pedidoRepositoryMock = {
  salvar: async (pedido) => {
    // Simula a escrita no banco de dados
    return { ...pedido, id: Math.floor(Math.random() * 10000) };
  }
};

const emailServiceMock = {
  enviarConfirmacao: async (email, msg) => console.log(`E-mail enviado para ${email}`)
};

// Instanciação do serviço legado
const checkoutService = new CheckoutService(gatewayPagamentoMock, pedidoRepositoryMock, emailServiceMock);

// ENDPOINT CRÍTICO: Rota que receberá a carga massiva da Black Friday
app.post('/api/v1/checkout', async (req, res) => {
  const { clienteEmail, valor, cartao } = req.body;
  
  if (!clienteEmail || !valor || !cartao) {
    return res.status(400).json({ erro: 'Dados incompletos para checkout' });
  }

  const pedido = { clienteEmail, valor, cartao, status: 'PENDENTE' };
  
  // Executa o checkout
  const resultado = await checkoutService.processar(pedido);

  if (resultado && resultado.status === 'PROCESSADO') {
    return res.status(200).json({ mensagem: 'Pedido finalizado com sucesso!', pedido: resultado });
  }
  
  return res.status(500).json({ erro: 'Não foi possível processar seu pagamento. Tente mais tarde.' });
});

// Endpoint auxiliar para simular o comportamento de Thundering Herd (Manada Estourada)
// Útil para limpar o cache de sessões/cupons de desconto de forma abrupta sob carga
app.post('/api/v1/cache/flush', (req, res) => {
  console.log("💥 CACHE LIMPO ABRUPTAMENTE!");
  res.json({ status: 'cache_invalidated' });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Servidor da EntregasJá rodando na porta ${PORT}`));