# O Apocalipse do Delivery — CheckoutService resiliente (EntregasJá)

Microsserviço de Checkout blindado contra o caos da Black Friday: redesenho
limpo, tolerância a falhas (timeout, retry/backoff, circuit breaker) e provas de
desempenho/caos com **k6 + Toxiproxy** (Fase 4 / SRE).

## Integrantes
* Amanda Bueno Campos Peixoto
* Filipe Faria Melo
* Izabela Cecilia Silva Barbosa
* Rafael de Paiva Gomes
* Sthel Felipe Torres
* Vinicius Xavier Ramalho

---

## Pré-requisitos

| Ferramenta | Versão | Para quê | Obrigatório? |
|---|---|---|---|
| Node.js | 18+ (testado no 22) | rodar a aplicação e os testes | Sim |
| k6 | recente | testes de carga/estresse (Fase 4) | Só p/ Fase 4 |
| Toxiproxy | recente | injeção de falhas de rede (Fase 4) | Só p/ Fase 4 |

Instalação do k6 e do Toxiproxy no Windows está detalhada na seção 4 de
[`docs/fase4-sre.md`](docs/fase4-sre.md). Para os testes unitários e a stack
local, **basta o Node**.

---

## Instalação

```powershell
npm install
```

## Início rápido

```powershell
npm test       # roda toda a suite de testes (node:test)
npm run stack  # sobe gateway-sim + cache-sim + app (porta 3000)
```

Teste rápido do endpoint (caminho feliz → HTTP 200 / PROCESSADO):

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/v1/checkout -Method Post `
  -ContentType 'application/json' `
  -Body '{"clienteEmail":"a@b.com","valor":120,"cartao":{"numero":"6011","validade":"12/29","cvv":"123"}}'
```

> O número do cartão controla o desfecho no `gateway-sim`:
> `6011…` → **APROVADO** · `4000…` → **RECUSADO** · `5000…` → **erro de infra (5xx)**.

---

## Referência de scripts npm

| Script | Comando | O que faz |
|---|---|---|
| `npm test` | `node --test` | Roda toda a suíte de testes |
| `npm start` | `node src/server.js` | Sobe **só** o app (porta 3000) |
| `npm run start:gateway` | `node infra/gateway-sim.js` | Sobe **só** o gateway simulado (:4001) |
| `npm run start:cache` | `node infra/cache-sim.js` | Sobe **só** o cache simulado (:4002) |
| `npm run stack` | `concurrently …` | Sobe os 3 serviços juntos (modo **normal**) |
| `npm run stack:chaos` | `concurrently …` | Sobe os 3 serviços com o app apontando para os **proxies do Toxiproxy** |
| `npm run chaos:setup` | `node infra/toxiproxy/setup.js` | Cria/limpa os proxies `gateway` e `cache` no Toxiproxy |
| `npm run chaos:gateway-latency` | `node infra/toxiproxy/chaos-gateway-latency.js` | Injeta +5000ms de latência no gateway |
| `npm run chaos:herd` | `node infra/toxiproxy/chaos-thundering-herd.js` | Esvazia/derruba o nó de cache (Thundering Herd) |
| `npm run chaos:reset` | `node infra/toxiproxy/reset.js` | Remove todos os tóxicos e reabilita os proxies |
| `npm run monitor` | `node scripts/record-metrics.js` | Grava a linha do tempo de `/internal/metrics` (CSV) |
| `npm run burst` | `node scripts/burst.js` | Rajada concorrente sem k6 (plano B do Thundering Herd) |
| `npm run k6:smoke` | `k6 run load/smoke.js` | Smoke test (sanidade da stack) |
| `npm run k6:bf` | `k6 run load/black-friday.js` | Carga base (ramp-up/steady/ramp-down) |
| `npm run k6:gateway-lento` | `k6 run load/gateway-lento.js` | Carga durante o caos "Gateway Lento" |
| `npm run k6:herd` | `k6 run load/thundering-herd.js` | Carga massiva para o "Thundering Herd" |

> Argumentos posicionais podem ser passados direto: `npm run chaos:gateway-latency 30`.
> Para repassar **flags** (que começam com `-`, ex: `-e` do k6), use `--`:
> `npm run k6:herd -- -e PEAK_RPS=5000`.

---

## Como rodar os testes

A suíte usa o runner nativo do Node (`node:test`) — **sem dependências extras**.
São **13 testes** em 4 arquivos cobrindo a camada de resiliência e o serviço.

### Comandos úteis

```powershell
npm test                                           # roda todos os testes
node --test test/retry.test.js                     # roda apenas um arquivo
node --test --watch                                # re-roda ao salvar (watch)
node --test --test-name-pattern="RF02"             # filtra por nome do teste
node --test --test-reporter=spec                   # saída legível (formato "spec")
```

### O que cada arquivo de teste cobre

#### `test/timeout.test.js` — RN04 (timeout rígido de 2s)
| Teste | Verifica |
|---|---|
| resolve quando a tarefa termina dentro do prazo | tarefa rápida retorna normalmente |
| rejeita com `TimeoutError` quando excede o prazo | tarefa lenta é cortada no tempo limite |
| aborta o `signal` quando estoura o timeout | o `AbortSignal` realmente dispara (fecha o socket) |

#### `test/retry.test.js` — RN05/RN06 (retry + backoff + jitter)
| Teste | Verifica |
|---|---|
| retenta falha de infra e eventualmente tem sucesso | erro transitório é reexecutado até dar certo |
| **NÃO** retenta erro de negócio (cartão recusado) | recusa de negócio não é retentada (1 tentativa só) |
| esgota as tentativas (1 + maxAttempts) e propaga o último erro | total de execuções = 1 original + 3 retries |

#### `test/circuitBreaker.test.js` — RN07 (disjuntor)
| Teste | Verifica |
|---|---|
| abre após taxa de erro de infra ultrapassar o limite | breaker vai para `OPEN` e passa a falhar rápido (`CircuitOpenError`) |
| erro de negócio **NÃO** abre o breaker | recusa de cartão não conta como falha de dependência |
| half-open recupera para `CLOSED` após sucesso | passado o `resetTimeout`, uma chamada de teste fecha o disjuntor |

#### `test/checkoutService.test.js` — fluxos de ponta a ponta (RF02–RF05)
Usa **Stubs** (estado: repositório/config) e um **Mock** (asserção: e-mail).
| Teste | Fluxo | Verifica |
|---|---|---|
| RF02: APROVADO → PROCESSADO e dispara e-mail (assíncrono) | caminho feliz | status `PROCESSADO`, pedido salvo e e-mail enviado **1x** |
| RF03: RECUSADO → FALHOU e NÃO dispara e-mail | recusa de negócio | status `FALHOU`, e-mail **não** disparado (regra crítica RN03) |
| RF05: falha de infra persistente → ERRO_GATEWAY (fallback limpo) | caos total | após 1+2 retries, vira `ERRO_GATEWAY` sem e-mail |
| RF04: gateway lento dispara timeout e vira ERRO_GATEWAY | gateway lento | a cobrança estoura o timeout e cai no fallback |

Saída esperada: `# tests 13 / # pass 13 / # fail 0`.

---

## Como rodar cada script

### Servidores (aplicação + simuladores)

```powershell
npm run stack          # sobe gateway-sim (:4001) + cache-sim (:4002) + app (:3000)
npm start              # sobe SÓ o app (precisa do gateway e cache já no ar)
npm run start:gateway  # sobe SÓ o gateway simulado
npm run start:cache    # sobe SÓ o cache simulado
```

Para **encerrar**: `Ctrl + C` no terminal da stack.

### Caos com Toxiproxy (Fase 4)

Pré-requisito: ter o `toxiproxy-server` rodando em outro terminal.

```powershell
# 1) suba o Toxiproxy
toxiproxy-server

# 2) suba a stack em modo caos (app -> proxies 21001/21002)
npm run stack:chaos

# 3) crie os proxies (uma vez)
npm run chaos:setup

# 4) injete os desastres:
npm run chaos:gateway-latency on     # liga +5000ms e mantém
npm run chaos:gateway-latency off    # desliga
npm run chaos:gateway-latency 30     # liga, segura 30s, desliga (marca o MTTR)

npm run chaos:herd flush             # só esvazia o cache (fica "cold")
npm run chaos:herd down 15           # derruba o nó de cache por 15s
npm run chaos:herd                   # flush + derruba por 15s (default)

# 5) limpe tudo entre experimentos:
npm run chaos:reset
```

### Observabilidade

```powershell
# Grava a linha do tempo das métricas internas (para evidenciar MTTR).
npm run monitor          # a cada 1s, até Ctrl+C
node scripts/record-metrics.js 0.5 90   # a cada 0,5s por 90s -> CSV em load/results/
```

```powershell
# Rajada concorrente sem k6 (plano B do Thundering Herd):
#   node scripts/burst.js [qtd] [simultaneas] [numeroCartao]
node scripts/burst.js                 # 300 req, 100 simultâneas
node scripts/burst.js 2000 200        # 2000 req, 200 simultâneas
node scripts/burst.js 500 100 5000111 # força cartão de infra (testa o breaker)
```

### Testes de carga k6 (Fase 4)

```powershell
npm run k6:smoke         # valida que a stack responde 200 no caminho feliz
npm run k6:bf            # carga base: ramp-up -> steady -> ramp-down (mede SLOs)
npm run k6:gateway-lento # carga constante (rode junto com chaos:gateway-latency)
npm run k6:herd          # carga massiva (rode junto com chaos:herd)

# Sobrescrevendo parâmetros (note o "--" antes das flags do k6):
npm run k6:bf -- -e STEADY_VUS=100 -e STEADY_DURATION=2m
npm run k6:herd -- -e PEAK_RPS=5000 -e MAX_VUS=10000
```

> O roteiro completo (qual terminal roda o quê, o que observar e como calcular o
> MTTR) está em [`docs/fase4-sre.md`](docs/fase4-sre.md).

---

## Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/v1/checkout` | Processa o pedido. `200`=PROCESSADO, `400`=inválido, `500`=FALHOU/ERRO_GATEWAY |
| `GET` | `/health` | Healthcheck (`{ status: "ok" }`) |
| `GET` | `/internal/metrics` | Estado interno (breaker, pool do banco, single-flight, cache, contadores) |
| `POST` | `/api/v1/cache/flush` | Invalida o cache (atalho do Thundering Herd) |

---

## Estrutura do projeto

```
src/
  config.js                  # configuracao via env (timeout, retry, breaker, pool)
  app.js                     # composition root + rotas Express
  server.js                  # bootstrap do servidor
  domain/validarPedido.js    # RF01 - validacao de entrada
  services/
    CheckoutService.js       # orquestracao resiliente (RF02..RF05)
    CheckoutService.legacy.js# versao legada (comparacao antes/depois)
    ConfigProvider.js        # read-through cache->DB (protege Thundering Herd)
  resilience/
    timeout.js               # RN04 - timeout 2s (AbortSignal)
    retry.js                 # RN05/RN06 - retry + backoff + jitter
    CircuitBreaker.js        # RN07 - disjuntor (abre > 50% erro)
    Semaphore.js             # pool de conexoes do banco
    singleflight.js          # coalescencia de requisicoes
  adapters/
    HttpPaymentGateway.js    # gateway via HTTP (interceptavel pelo Toxiproxy)
    HttpCache.js             # cache via HTTP (tolerante a falha)
    InMemoryPedidoRepository.js
    EmailService.js          # e-mail assincrono (RF02)
infra/
  gateway-sim.js             # gateway de pagamento simulado (:4001)
  cache-sim.js               # no de cache simulado (:4002)
  toxiproxy/                 # setup dos proxies + scripts de caos
load/                        # scripts k6 (smoke, black-friday, gateway-lento, herd)
scripts/
  record-metrics.js          # gravador da linha do tempo (MTTR)
  burst.js                   # rajada concorrente (plano B do Thundering Herd, sem k6)
test/                        # testes node:test da camada de resiliencia
docs/
  especificacao.md           # DER (requisitos)
  fase4-sre.md               # RELATORIO DA FASE 4 (ler isto)
```

---

## Configuração (variáveis de ambiente)

Todos os limites são configuráveis por env (com defaults seguros). Veja
[`.env.example`](.env.example) para a lista completa. Principais:

| Variável | Default | Significado |
|---|---|---|
| `PORT` | `3000` | porta do app |
| `GATEWAY_URL` / `CACHE_URL` | `…:4001` / `…:4002` | dependências (troque para `21001/21002` no modo caos) |
| `GATEWAY_TIMEOUT_MS` | `2000` | timeout por tentativa (RN04) |
| `RETRY_MAX_ATTEMPTS` / `RETRY_BACKOFF_MS` | `3` / `500` | retry e backoff (RN05/RN06) |
| `BREAKER_ERROR_THRESHOLD` / `BREAKER_RESET_TIMEOUT_MS` | `0.5` / `3000` | disjuntor (RN07) e MTTR |
| `DB_MAX_CONCURRENCY` | `20` | tamanho do pool do banco |

---

## Como as Fases se Conectam a este Código

**Fase 1 (Análise & Métricas)** — Complexidade ciclomática do `processar(pedido)`
e estimativa de esforço (`estimativa_simples.pdf`).

**Fase 2 (Refatoração & Patterns)** — O e-mail síncrono acoplado foi extraído e
tornado assíncrono; dependências isoladas por adapters (Stubs/Mocks nos testes).

**Fase 3 (Mutação)** — Suíte de testes (`test/`) cobrindo os caminhos e regras
para sustentar o Mutation Score.

**Fase 4 (Caos & SRE)** — O `gateway-sim` é interceptado pelo Toxiproxy para
injetar 5000ms de latência e quedas de cache; o k6 dispara a carga da Black
Friday e medimos se o circuit breaker/timeouts protegem o servidor.
Detalhes em [`docs/fase4-sre.md`](docs/fase4-sre.md).
