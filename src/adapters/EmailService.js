'use strict';

/**
 * Servico de e-mail (SMTP externo) simulado.
 *
 * RF02 exige que o disparo seja ASSINCRONO e nao bloqueie a resposta HTTP do
 * checkout. Aqui apenas simulamos a latencia de rede de um provedor SMTP.
 */
class EmailService {
  constructor() {
    this.enviados = 0;
  }

  async enviarConfirmacao(email, mensagem) {
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
    this.enviados += 1;
    if (process.env.LOG_EMAIL === '1') {
      console.log(`[email] confirmacao -> ${email}: ${mensagem}`);
    }
    return true;
  }

  snapshot() {
    return { enviados: this.enviados };
  }
}

module.exports = { EmailService };
