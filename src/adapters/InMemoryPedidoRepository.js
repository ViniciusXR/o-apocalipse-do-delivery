'use strict';

const { Semaphore } = require('../resilience/Semaphore');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repositorio em memoria que simula um banco relacional com POOL DE CONEXOES
 * limitado (via Semaphore). Toda operacao consome uma "conexao"; se o pool
 * esgota, a operacao espera na fila e pode falhar por timeout.
 *
 * E o componente que precisa "sobreviver" ao Thundering Herd: graças ao
 * single-flight + backoff/jitter na camada de servico, ele nunca recebe mais
 * que `maxConcurrency` chamadas simultaneas.
 */
class InMemoryPedidoRepository {
  constructor({ maxConcurrency = 20, queueTimeoutMs = 3000 } = {}) {
    this.semaphore = new Semaphore(maxConcurrency, queueTimeoutMs);
    this.pedidos = new Map();
    this.seq = 0;
    this.queries = 0;
  }

  async salvar(pedido) {
    return this.semaphore.run(async () => {
      this.queries += 1;
      await sleep(5 + Math.random() * 10); // latencia de escrita ~5-15ms
      const id = pedido.id || ++this.seq;
      const registro = { ...pedido, id };
      this.pedidos.set(id, registro);
      return registro;
    });
  }

  /**
   * Leitura "cara" usada como fallback quando o cache cai. E aqui que a manada
   * bateria sem o single-flight na frente.
   */
  async carregarConfig(chave) {
    return this.semaphore.run(async () => {
      this.queries += 1;
      await sleep(20 + Math.random() * 20); // leitura ~20-40ms
      return { chave, taxaAntifraude: 0.015, fonte: 'DB', carregadoEm: Date.now() };
    });
  }

  snapshot() {
    return {
      queries: this.queries,
      registros: this.pedidos.size,
      pool: this.semaphore.snapshot(),
    };
  }
}

module.exports = { InMemoryPedidoRepository };
