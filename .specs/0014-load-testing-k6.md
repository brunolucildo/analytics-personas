# 0014 — Teste de carga da API com k6

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída em 2026-11-10 (smoke, load e stress executados; relatório na §13; investigação do gargalo na §14, com uma correção aplicada e recomendações pendentes de decisão)
- **Slug:** 0014-load-testing-k6
- **Data:** 2026-11-10
- **Atualizado em:** 2026-11-10
- **Owner:** Time de engenharia
- **Relacionados:** 0011 e 0013 (observabilidade da API e do Postgres), 0003 (limite de requisições), 0004 a 0010 (casos de uso de auth), ADR 0012 (k6 contra API isolada), `.docs/QA.md` §4.2. **Depende de:** 0011 e 0013. **Destrava:** calibragem de alertas e limites com dados reais.

## 1. Escopo

### Dentro do escopo

- Cenários k6 em `load/k6/` que exercitam **todos os endpoints atuais**: `GET /api/v1/health`, os sete `POST /api/v1/auth/*`, `GET /api/v1/auth/session` e `GET|DELETE /api/v1/test-support/emails`, mais rotas inexistentes (404), preflight CORS e rotas fechadas sem sessão (401).
- Três perfis: `smoke` (verifica), `load` (carga sustentada) e `stress` (rampa além da capacidade).
- Runner `bun run load <perfil>` que sobe uma API isolada contra o Supabase local, roda o k6 e limpa as contas de teste.
- Métricas do próprio k6 enviadas ao Mimir e uma seção "Teste de carga (k6)" no dashboard.
- Documentação (`QA.md` §4.2) e ADR 0012.

### Fora do escopo

- Teste de carga na API de dev (porta 3002) ou contra um banco hospedado.
- Teste de endpoints de domínio que ainda não existem (conectores, experts, LLM).
- Execução em CI e orçamento de desempenho (SLO).
- Carga distribuída (k6 Cloud, vários geradores) e tuning de desempenho da API (apenas os achados).
- Testar o provedor de e-mail real: a carga usa `EMAIL_PROVIDER=capture`.

## 2. Contexto

O dashboard precisa de volume de dados e a API nunca recebeu carga. Verificado em 2026-11-10:

- O `.env` de desenvolvimento aponta para um projeto Supabase **hospedado**; carga na API de dev criaria milhares de contas na nuvem.
- O limitador permite 5 sign-ups por hora por IP e 10 sign-ins a cada 10 min por IP e e-mail; um único IP não gera carga. Com `TRUST_PROXY=true` o IP vem de `X-Forwarded-For`.
- O fluxo completo de auth (confirmação, reset) depende de links enviados por e-mail; com `EMAIL_PROVIDER=capture` o endpoint `GET /api/v1/test-support/emails` devolve a mensagem (buffer de 500).
- O k6 não estava instalado; foi instalado com `winget install GrafanaLabs.k6` (v2.3.0) por decisão do Owner.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Quem opera e depura a API (engenharia).                                                                                 |
| Decisão ou ação que muda | Saber quanta carga a API aguenta, onde ela degrada primeiro e com que latência, e ter dados para calibrar os alertas.   |
| Resultado esperado       | Todos os endpoints exercitados, uma massa de dados nos painéis e um relatório de capacidade.                            |
| Métrica de sucesso       | `smoke` e `load` passam com 0% de falhas inesperadas; `stress` indica o ponto de degradação com evidência no dashboard. |

## 4. Requisitos

| ID  | Requisito                                                                                                                                                                                                                              | Prioridade | Critério de aceite                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Cada endpoint atual tem cenário com status esperado: health, sign-up, confirm-account, sign-in, sign-out, forgot-password, reset-password, resend-confirmation, session, test-support (GET e DELETE), 404, preflight e 401 sem sessão. | Must       | Given `bun run load smoke`, When termina, Then todos os checks passam e cada endpoint aparece nas métricas do k6 com a tag `endpoint`.                          |
| R2  | O teste **nunca** usa a API de dev nem um banco hospedado: o runner lê o Supabase de `supabase status`, recusa host que não seja local e recusa porta ocupada.                                                                         | Must       | Given `SUPABASE_URL` hospedada no ambiente, When rodo o runner, Then ele usa o Supabase local ou recusa; Given a porta ocupada, Then aborta sem enviar tráfego. |
| R3  | O fluxo completo de auth roda sob carga (sign-up, e-mail capturado, confirm-account, session, sign-out, sign-in, forgot-password, reset-password, senha antiga e nova).                                                                | Must       | Given o perfil `load`, When termina, Then `flow_success` ≥ 95% e nenhum e-mail perdido (`mail_missing` = 0).                                                    |
| R4  | O limitador é exercitado: um mesmo IP estoura sign-in e sign-up e recebe 429; os demais clientes (IPs sintéticos por `X-Forwarded-For`) não são bloqueados.                                                                            | Must       | Given o perfil `load`, When termina, Then há respostas 429 (`rate_limited_seen` > 0) e nenhuma falha inesperada.                                                |
| R5  | O runner apaga as contas `k6-*` e derruba a API ao fim, inclusive com Ctrl+C.                                                                                                                                                          | Must       | Given qualquer perfil, When termina, Then o banco local tem 0 contas `k6-*` e nada escuta na porta de teste.                                                    |
| R6  | Três perfis (`smoke`, `load`, `stress`) com limites por endpoint (p95), de falha inesperada e de checks; no `stress` os limites informam e não abortam.                                                                                | Must       | Given cada perfil, When executo, Then o resumo traz os limites e o código de saída reflete o resultado.                                                         |
| R7  | As métricas do k6 vão ao Mimir (`k6_*`, com `testid`, `endpoint`, `scenario`, `status`) e o dashboard tem a seção "Teste de carga (k6)" com variável **Execução k6**.                                                                  | Must       | Given uma execução, When abro o dashboard, Then a seção mostra VUs, vazão, latência por endpoint, status e a comparação cliente x servidor.                     |
| R8  | Documentar o uso, os perfis, a segurança e os limites do teste em `QA.md` §4.2 e registrar a ADR 0012.                                                                                                                                 | Must       | Given os docs, When leio, Then constam comando, perfis, runner, IPs sintéticos e limites.                                                                       |
| R9  | Relatório de capacidade: vazão, latência por endpoint e ponto de degradação do `stress`, com a evidência no dashboard.                                                                                                                 | Should     | Given o `stress`, When termina, Then a §12 registra onde e por quê a API degradou.                                                                              |

## 5. Fluxos e estados

- **Caminho feliz:** `bun run infra:up`, `bun run db:migrate`, `bun run load smoke`; o runner compila a API, sobe-a na porta 3013, roda o k6, apaga as contas e imprime onde está o resumo.
- **Vazio:** sem execução do k6 na janela, a seção do dashboard fica sem dados.
- **Erro:** Supabase não local, porta ocupada, Mimir fora (sem `--no-prom`) ou API que não sobe em 45 s abortam antes do tráfego; limites estourados no k6 dão código 99, que o runner explica.
- **Cancelamento:** Ctrl+C derruba a API e apaga as contas.
- **Retry:** o fluxo completo tenta ler o e-mail capturado até 10 vezes (200 ms); sem e-mail, conta `mail_missing`.

## 6. Acceptance Criteria

- [x] Given `bun run load smoke`, When termina, Then 55 de 55 checks passam e todo endpoint responde como esperado. (R1)
- [x] Given o runner, When o Supabase não é local ou a porta está ocupada, Then recusa. (R2, verificado por leitura do código e pela execução com a porta livre; a recusa não foi exercitada com um host hospedado)
- [x] Given `bun run load load`, When termina, Then `flow_success` é 100%, `mail_missing` é 0 e 0% de falhas inesperadas. (R3)
- [x] Given `bun run load load`, When termina, Then há 24 respostas 429 e nenhuma falha inesperada. (R4)
- [x] Given os dois perfis, When terminam, Then o banco local tem 0 contas `k6-*` (652 removidas no `load`). (R5)
- [x] Given cada perfil, When executo, Then o resumo traz os limites e o código de saída. (R6)
- [x] Given uma execução, When consulto o Mimir e o dashboard, Then as métricas `k6_*` existem e os painéis da seção executam sem erro. (R7)
- [x] Given os docs, When leio `QA.md` §4.2, Then constam comando, perfis, runner e limites. (R8)
- [x] Given o `stress`, When termina, Then a §13 registra o ponto de degradação com a evidência. (R9)

## 7. O que fazer

1. Escrever `load/k6/lib/client.js` (chamadas com tag de endpoint, IP sintético, leitura do token no e-mail capturado).
2. Escrever `load/k6/lib/scenarios.js` e `load/k6/main.js` (cenários, perfis, limites).
3. Escrever `scripts/load-test.ts` (isolamento, build, API, k6, limpeza) e o script `load` no `package.json`.
4. Acrescentar a seção k6 ao dashboard e ao teste de assets.
5. Executar `smoke`, `load` e `stress`; conferir os dados no dashboard.
6. Documentar (`QA.md` §4.2, ADR 0012) e registrar o relatório.

## 8. O que não fazer

- Não rodar o k6 contra a API de dev nem contra um banco hospedado.
- Não afrouxar nem desligar o limitador para o teste; usar IPs sintéticos.
- Não usar domínio real nos e-mails de teste (sempre `@example.test`) nem credenciais reais.
- Não deixar contas de teste no banco: o runner limpa sempre.
- Não colocar valores vindos do cliente em labels de métrica (a tag `endpoint` tem valores fixos).

## 9. Riscos e dependências

| Tipo        | Descrição                                                                                     | Mitigação                                                                   |
| ----------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Risco       | Carga no banco hospedado do `.env`.                                                           | O runner ignora o `.env`, usa só o Supabase local e recusa outro host (R2). |
| Risco       | API e k6 dividem a máquina (e o `argon2` é CPU): a saturação mistura os dois.                 | Documentado; o painel "Cliente x servidor" separa rede e fila do cliente.   |
| Risco       | Métricas sem label `instance`: a API de dev e a de teste escrevem nas mesmas séries do Mimir. | Dívida registrada (spec 0013); conferir os números contra o resumo do k6.   |
| Risco       | O buffer de 500 e-mails limita a concorrência do fluxo completo.                              | `mail_missing` no resumo; o `load` terminou com 0.                          |
| Risco       | O Loki local limita a taxa de ingestão e pode descartar logs sob carga.                       | Conferir os logs do Collector depois do `stress`.                           |
| Dependência | k6 instalado no host (`winget install GrafanaLabs.k6`), `infra:up` e `db:migrate`.            | O runner explica o que falta.                                               |

## 10. Resultado

- **Comando/verificação:** `bun run infra:up`, `bun run db:migrate`, `bun run load smoke`, `bun run load load`, `bun run load stress`; abrir o dashboard e escolher a execução em **Execução k6**.
- **Evidência esperada:** resumos em `load/results/`, métricas `k6_*` no Mimir e a seção "Teste de carga (k6)" com dados.
- **Comportamento observável:** a seção mostra a rampa de VUs, a vazão, a latência por endpoint e a comparação cliente x servidor.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                           | Impacto                                              | Bloqueante? | Quem decide |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- | ----------- |
| **Premissa:** os limites de p95 (health 300 ms, session 1 s, sign-in e sign-up 2,5 s) são ponto de partida. | Calibrar com dados e com a máquina de CI, se houver. | Não         | Engenharia  |
| **Premissa:** `TRUST_PROXY=true` só no processo de teste; o padrão da API continua `false`.                 | Em produção sem proxy o cabeçalho é ignorado.        | Não         | Engenharia  |
| Rodar o teste de carga em CI?                                                                               | Exige Supabase local e Collector no pipeline.        | Não         | Owner       |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                                                                                                                                                                                                          | Motivo                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 2026-11-10 | O primeiro `stress` (627 mil requisições, até 2.889 VUs) tombou a pilha de rede (494 mil `connection refused`, erro 1212) e as métricas do servidor vieram contaminadas: a API de dev e a de teste escreviam nas mesmas séries (sem `instance`). Corrigido: `service.instance.id` por processo em `telemetry.ts` e tetos de VUs no perfil `stress` (até 50 jornadas e 200 leitores). | O primeiro resultado media o limite do gerador e do sistema operacional, e o servidor, em parte, a API de dev. |
| 2026-11-10 | Spec criada e implementada. `smoke` (55 checks, 100%) e `load` (35.913 requisições, 170 req/s, 0% de falhas inesperadas, fluxo completo 100%) verdes; `stress` executado (resultado abaixo).                                                                                                                                                                                         | Gerar massa de dados e medir a capacidade da API.                                                              |

## 13. Relatório de capacidade (2026-11-10)

Ambiente: máquina de desenvolvimento com 28 núcleos e 16 GB; API e k6 no mesmo host; Supabase local; `EMAIL_PROVIDER=capture`; Collector, Loki, Tempo e Mimir locais. Números do dashboard e dos resumos em `load/results/`.

| Perfil   | Resultado                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke`  | 74 requisições, 55 de 55 checks, jornada completa e limitador (429) verificados.                                                                                                                                              |
| `load`   | 35.913 requisições a 171 req/s (até 104 VUs), 0% de falhas inesperadas, jornadas 100%, 24 respostas 429 do limitador, nenhum e-mail perdido. p95: health 91 ms, session 461 ms, sign-in 673 ms, sign-up 690 ms, geral 471 ms. |
| `stress` | Duas execuções reproduziram: ~94 mil requisições, ~195 req/s, p95 geral ~10 s, falhas inesperadas 0,23% e 0,55%, jornadas completas ~97%. Cerca de 50 mil iterações foram descartadas pelo teto de VUs.                       |

**Ponto de degradação (execução 2, métricas do servidor com `instance` por processo):** a ocupação do event loop foi 0,50 com 158 req/s, **0,83 com 173 req/s (p95 do servidor 0,53 s)**, 0,94 com 175 req/s (p95 1,27 s) e **1,00 contínuo a partir de ~3 min**, com p95 de 5 a 9 s. A vazão estacionou em 160 a 240 req/s enquanto a oferta seguia subindo. O "joelho" desta mistura de cenários fica em **cerca de 170 req/s**.

**Falhas:** ~190 respostas 500 (0,2% a 0,5%), todas nos minutos finais da saturação e todas **erro de rede na chamada da API ao PostgREST** (`error_type="network"`; log `db_operation_failed`). Nenhum erro de SQL: 0 deadlocks, 0 rollbacks.

**O banco não foi o gargalo:** 25 de 100 conexões, ~119 commits/s. Os containers do Supabase e da observabilidade ficaram baixos (Tempo teve um pico de ~2 núcleos); o host ficou em 62% de média e 88% de pico dos 28 núcleos, com ~10 núcleos em processos Node.

**Causa do gargalo:** investigada e explicada na §14 (hash argon2, pool de threads compartilhado e um defeito no limitador de requisições, este corrigido).

**Primeira execução do `stress` (descartada como medida da API):** 627 mil requisições com até 2.889 VUs; 80% de falhas, quase todas `connection refused` (erro 1212 do k6). Media o limite do gerador e da pilha de rede do Windows. As métricas do servidor dessa execução estavam misturadas com as da API de dev (sem `instance`).

## 14. Investigação do gargalo (2026-11-10)

**Pergunta:** por que a API satura perto de 170 req/s se o banco, o Docker e o host (28 núcleos) estão folgados? **Método:** experimentos de uma variável por vez com o perfil `capacity` (`bun run load capacity --only=… --label=… --api-env=…`), perfis de CPU da thread principal (`load/profiler-preload.cjs`) e sondas isoladas fora da API (`load/diagnostics/`).

| Experimento                                                    | Resultado                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edges` (404, preflight, 401, health: sem argon2 e sem banco)  | Acompanhou a rampa inteira: **1.633 req/s**, ~1 ms, event loop 0,56, nada descartado. Mesma vazão com a telemetria desligada.                                             |
| `invalidCredentials` (um argon2 e uma consulta por requisição) | Trava em **~32 req/s**: VUs no teto, latência média ~12 s (Lei de Little), event loop **baixo** (0,3 a 0,56).                                                             |
| idem com `UV_THREADPOOL_SIZE=16`                               | Os mesmos 31 a 32 req/s; o host foi a 100% de CPU.                                                                                                                        |
| argon2 isolado, fora da API                                    | Teto de **33 a 34 hashes/s** com 4, 8 ou 32 em paralelo e com pool de 4 ou 16. Sozinho: 41 ms de relógio e 126 ms de CPU; com concorrência, 350 a 550 ms de CPU por hash. |
| `browse` sozinho                                               | 547 req/s; `health` p95 2 ms, `session` p95 12 ms.                                                                                                                        |
| `browse` junto com `invalidCredentials`                        | `session` p95 **12,8 s**, `health` p95 15 ms.                                                                                                                             |
| idem com o pool em 2 threads                                   | CPU do host cai de ~70% para ~33%, e o `session` continua em p95 14,7 s: **não é contenção de CPU, é fila**.                                                              |
| um IP real, e-mails sempre diferentes (`TRUST_PROXY=false`)    | 4.040 tentativas de sign-in e **0 respostas 429**.                                                                                                                        |
| `validation` sozinho (cliente novo a cada requisição)          | 1.200 req/s com p95 de 1 ms.                                                                                                                                              |
| `validation` + `invalidCredentials`, antes do conserto         | Event loop **1,00**, ~195 req/s sustentados, 30.113 requisições na rampa, p95 10,0 s.                                                                                     |
| idem depois do conserto do limitador                           | 50.699 requisições (**+68%**), p95 4,2 s.                                                                                                                                 |
| idem depois do conserto e com a telemetria desligada           | 65.180 requisições (mais **+29%**), p95 1,2 s. Ainda satura.                                                                                                              |

**Causas, da mais para a menos importante:**

1. **O argon2id é o teto.** Com os parâmetros atuais (64 MiB, 3 passes, 4 lanes) a máquina faz no máximo ~33 hashes/s, limitada por largura de banda de memória: mais núcleos e mais threads só aumentam a disputa. Todo sign-in (inclusive de e-mail inexistente, de propósito, contra enumeração), sign-up e reset consome um hash.
2. **O pool de threads do libuv é compartilhado e a fila é FIFO.** Com 48 hashes em voo, medidos no mesmo processo: `jose jwtVerify` de 0,3 ms para **1.252 ms**, `crypto.randomBytes` de 0,05 para 1.282 ms, `fetch` local (o caminho API para PostgREST) de 16 para 1.330 ms, `fs.readFile` de 0,3 para 2.614 ms. O event loop (`setImmediate`) e o HMAC síncrono ficam abaixo de 1 ms. Por isso o `health` (não usa o pool) continua rápido enquanto o `session` (JWT e banco) e as chamadas ao banco chegam a 5 a 13 s, **com o event loop saudável**. Aumentar o pool não resolve: a fila só muda de tamanho.
3. **Defeito no limitador em memória (corrigido).** Com o mapa no teto de 10.000 chaves, cada cliente novo varria as 10.000 entradas (`sweep`) e logo despejava a mais antiga: 50 µs contra 0,29 µs abaixo do teto (171 vezes), e cerca de 1 ms por requisição sob a disputa de memória do argon2. No perfil do stress, a função `count` do guard foi **27% do tempo ocupado da thread principal** (a segunda era 5,5%).
4. **Telemetria e framework.** Depois do conserto o perfil é plano; o OpenTelemetry soma ~55% do tempo inclusivo, e tirá-lo rende mais 29% de capacidade no cenário saturado. Sem saturação ele quase não aparece (o `edges` fica em 0,34 ms por requisição).

**Descartado com evidência:** o Postgres (25 de 100 conexões, 0 deadlocks), a CPU do host (28 núcleos, e o teste com pool de 2 threads), o endpoint `test-support` (8 ms por chamada com 500 e-mails) e o tamanho do pool de threads.

**Corrigido nesta investigação:** `InMemoryRateLimitStore` faz a varredura completa no máximo uma vez por segundo no teto (a ordem de despejo e o teto não mudam), com um teste que falha no código antigo (500 varreduras para 500 chaves novas). Também: o label `instance` por processo, o `url` do k6 fora das séries (o Mimir recusava escritas por passar de 150.000 séries) e o limite de séries do Mimir local em 1.000.000.

**Achados que dependem de decisão do Owner (nada disso foi alterado):**

- **Um único cliente satura a API.** O limite de sign-in é por IP **e** e-mail; um IP que troca de e-mail a cada tentativa nunca é barrado (4.040 tentativas sem 429), e cada uma custa um hash. Efeito: ~33 requisições por segundo bastam para travar o hash e atrasar o login legítimo em ~13 s.
- **Pelo código, não testado:** com o teto de 10.000 chaves, o store despeja a mais antiga; quem gerar 10.000 chaves distintas pode zerar o contador de outra pessoa e reabrir tentativas de força bruta.

**Seguimento:** as recomendações 1 e 2 foram implementadas na spec 0015 (limite de hashes simultâneos com fila limitada e 503, e limite de sign-in por IP); com a mesma carga, o `session` foi de p95 12.796 ms para 196 ms.

**Recomendações, em ordem de custo e benefício:**

1. Limitar os hashes simultâneos a tamanho do pool menos 1, com fila limitada e 429 ou 503 quando cheia. Medido: `jwtVerify` de 530 ms para 1 ms e `randomBytes` de 814 para 0,1 ms, perdendo 4% da vazão de hash (33,4 contra 34,8 por segundo). Não muda a segurança do hash.
2. Limite de sign-in por IP independente do e-mail, mais um limite global de hashes por segundo.
3. Rever os parâmetros do argon2 (decisão de segurança). Medido na máquina: 64 MiB, t=3, p=1 faz 26 hashes/s (150 ms de CPU); 46 MiB, t=1, p=1 faz 90/s (43 ms de CPU); 19 MiB, t=2, p=1 faz 133/s (26 ms de CPU). Os dois últimos são os mínimos recomendados pela OWASP.
4. Reduzir o custo da telemetria (spans por camada do Express, amostragem) e o custo de criar exceções de validação (`HttpException` aparece com 3,8% do tempo próprio).
5. Produção: mais de uma réplica e limitador compartilhado (Redis), como a ADR 0005 já prevê.

**Ferramentas deixadas no repositório:** `bun run load capacity` com `--only`, `--label` e `--api-env`; `load/profiler-preload.cjs` (perfil de CPU sem sinais, que o Windows não entrega); `load/diagnostics/threadpool-probe.mjs`, `hash-capacity.mjs` e `rate-limit-store-cost.cjs`.
