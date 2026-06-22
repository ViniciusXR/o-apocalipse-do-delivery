# DOCUMENTO DE ESPECIFICAÇÃO DE REQUISITOS (DER)
**Componente:** Sistema de Checkout e Liquidação de Pedidos (Microsserviço de Pagamentos)  
**Contexto de Operação:** Ambiente de Alta Disponibilidade — Operação Black Friday  
**Organização:** EntregasJá S.A.  
**Versão:** 2026.1  

---

## 1. Visão Geral do Sistema e Escopo
O objetivo deste documento é delimitar as regras de negócio, os requisitos funcionais e as restrições arquiteturais do componente `CheckoutService` da plataforma *EntregasJá*. O componente é responsável por receber as intenções de compra de refeições e entregas, validar a integridade dos dados, consumir gateways de pagamento parceiros para transações de crédito, persistir os estados de transição da compra e disparar notificações assíncronas aos clientes finais. 

Em cenários de alto tráfego (como a Black Friday), este componente atua como um gargalo crítico de I/O-Bound. Por este motivo, sua especificação exige tolerância a falhas, limites estritos de latência e mecanismos para evitar o esgotamento do pool de threads do servidor.

---

## 2. Atores e Interfaces de Integração
* **Cliente App/Web:** Inicia a requisição enviando o payload com os dados de cobrança.
* **Gateway de Pagamento (API Externa):** Interface de terceiros responsável por processar a transação financeira de crédito e retornar a autorização ou recusa.
* **Serviço de E-mail (SMTP Externo):** Provedor de entrega de mensagens utilizado para enviar o comprovante de pagamento ao cliente.
* **PedidoRepository (Banco de Dados Local):** Mecanismo de persistência que registra o histórico e o estado atual dos pedidos (`PENDENTE`, `PROCESSADO`, `FALHOU`, `ERRO_GATEWAY`).

---

## 3. Requisitos Funcionais e Regras de Negócio (RN)

### RF01 – Validação de Entrada de Dados (Sanitização)
* **RN01:** O sistema deve verificar a presença e a validade de três parâmetros obrigatórios no payload antes de iniciar qualquer processamento interno:
  1. `clienteEmail`: Deve ser uma string contendo um padrão de e-mail válido (presença de `@` e domínio válido).
  2. `valor`: Deve ser um valor numérico estritamente maior que zero (`valor > 0`).
  3. `cartao`: Deve ser um objeto contendo número do cartão, data de validade e código de verificação (CVV).
* **Comportamento:** Caso qualquer um desses campos falhe na validação, o sistema deve abortar a operação imediatamente, retornar o HTTP Status `400 Bad Request` e **não deve** interagir com o banco de dados ou com o gateway de pagamento.

### RF02 – Processamento de Pagamento Autorizado (Caminho Feliz)
* **RN02:** Quando o Gateway de Pagamento externo responder de forma bem-sucedida com o status `APROVADO`, o sistema deverá cumprir as seguintes etapas consecutivas:
  1. Alterar a propriedade `status` do pedido para `PROCESSADO`.
  2. Persistir o estado atualizado do pedido no banco de dados através do `PedidoRepository`.
  3. Disparar uma mensagem de confirmação ("Pagamento Aprovado") utilizando o `emailService`.
* **Restrição Arquitetural:** O disparo do e-mail é uma chamada de rede externa e **deve ser executado de forma assíncrona** (Non-blocking I/O). O sucesso ou falha no envio do e-mail não pode reter ou atrasar o tempo de resposta do HTTP da rota de checkout para o cliente final.

### RF03 – Tratamento de Pagamento Recusado (Falha de Negócio)
* **RN03:** Se o Gateway de Pagamento processar a requisição e retornar um status que indique insucesso financeiro (ex: `RECUSADO`, `SALDO_INSUFICIENTE` ou `CARTAO_EXPIRADO`), o sistema deverá:
  1. Atualizar a propriedade `status` do pedido para `FALHOU`.
  2. Persistir o registro atualizado no banco de dados através do `PedidoRepository`.
  3. Retornar a sinalização de erro ao cliente.
* **Regra Crítica:** Sob hipótese alguma o sistema deverá disparar o e-mail de confirmação de pagamento para pedidos cujo status financeiro seja `FALHOU`.

### RF04 – Resiliência de Rede e Políticas de Tolerância a Falhas
* **RN04 (Timeout Operacional):** O microsserviço não pode permitir que instabilidades na API externa do gateway de pagamento retenham recursos locais do servidor Express. Fica estabelecido um tempo limite rígido (Timeout) de **2000 milissegundos (2 segundos)** para a resposta do método `cobrar`. Se a API externa ultrapassar esse tempo sem responder, a conexão deve ser encerrada por timeout.
* **RN05 (Mecanismo de Retentativas - Retry):** Diante de falhas puras de infraestrutura (como conexões recusadas, erros internos do servidor do gateway `HTTP 5xx` ou ocorrência do Timeout definido na RN04), o sistema deve acionar uma política automática de retentativas. O sistema tentará executar a cobrança por **até 3 vezes** adicionais.
* **RN06 (Intervalo de Backoff):** Cada tentativa de reexecução (Retry) deve aguardar um intervalo fixo de **500 milissegundos** antes de ser submetida, dando tempo para a estabilização da rede de destino.

### RF05 – Degradação Graciosa e Fallback (Circuit Breaker)
* **RN07 (Status de Erro Crítico):** Se o limite de 3 retentativas automáticas for esgotado sem sucesso, ou se o disjuntor do padrão *Circuit Breaker* estiver aberto (taxa de erro de rede acumulada superior a 50%), o sistema deverá executar o plano de contingência (*Fallback*):
  1. Atualizar a propriedade `status` do pedido local para `ERRO_GATEWAY`.
  2. Persistir o pedido com o status de erro no banco de dados.
  3. Responder ao cliente final com o HTTP Status `500 Internal Server Error`, contendo uma mensagem amigável instruindo o usuário a efetuar uma nova tentativa de compra mais tarde.
* **Comportamento:** O sistema deve falhar de forma limpa e controlada, evitando o lançamento de exceções não capturadas (*Uncaught Exceptions*) que possam derrubar o processo do Node.js.

---

## 4. Matriz de Rastreabilidade e Caminhos Lógicos para Testes
Para fins de garantia da qualidade, cálculo da complexidade ciclomática e escrita dos cenários BDD, o comportamento do software fica mapeado nas seguintes combinações de caminhos independentes:

| Identificador do Fluxo | Condição da Entrada | Resposta do Gateway Externo | Comportamento Interno do Sistema | Status Final do Pedido | Resposta HTTP |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Fluxo 1 (Base)** | Dados Completos/Válidos | Resposta Imediata: `APROVADO` | Salva no banco e envia e-mail assíncrono. | `PROCESSADO` | `200 OK` |
| **Fluxo 2 (Negócio)** | Dados Completos/Válidos | Resposta Imediata: `RECUSADO` | Salva no banco e bloqueia envio de e-mail. | `FALHOU` | `500 Error` |
| **Fluxo 3 (Resiliência)**| Dados Completos/Válidos | 1ª Tentativa: Erro / 2ª Tentativa: `APROVADO` | Executa 1 retry, recupera-se, salva no banco e envia e-mail. | `PROCESSADO` | `200 OK` |
| **Fluxo 4 (Caos Total)** | Dados Completos/Válidos | Instabilidade Persistente ou Queda total | Executa 3 retentativas, esgota o limite, aciona fallback e salva erro. | `ERRO_GATEWAY` | `500 Error` |
| **Fluxo 5 (Contrato)** | Payload Incompleto | Não aplicável (Não consome a API) | Aborta execução na camada de controle imediatamente. | Não gerado | `400 Bad Request` |

---

## 5. Requisitos Não-Funcionais Críticos (Thresholds de SLO)
* **Concorrência e Escala:** O sistema deve aceitar e processar requisições em regime de concorrência massiva simulada durante os testes k6, apresentando uma taxa global de sucesso de requisições de ponta a ponta superior a 95%.
* **Latência (SLO de Tempo de Resposta):** O percentil 95 das requisições bem-sucedidas (`p95`) no endpoint de checkout deve se manter **abaixo de 2500ms**, mesmo quando sob estresse de rede controlado (injeção de falhas via Toxiproxy dentro dos limites do SLA do gateway).