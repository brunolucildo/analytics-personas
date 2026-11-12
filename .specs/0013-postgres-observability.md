# 0013 — Instrumentação do Postgres (operações da API e métricas do servidor)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** em implementação (verificado ao vivo em 2026-11-10 contra o Supabase local; pendente: falha real de banco ao vivo, conferir o dashboard na interface e instrumentar um banco hospedado)
- **Slug:** 0013-postgres-observability
- **Data:** 2026-11-10
- **Atualizado em:** 2026-11-10
- **Owner:** Time de engenharia
- **Relacionados:** 0011 (observabilidade da API), 0012 (alertas), ADR 0008 (acesso a dados com `supabase-js` e RPC), ADR 0011 (instrumentação do Postgres), `.docs/ARCHITECTURE.md` §4.4. **Depende de:** 0011. **Destrava:** calibragem de alertas de banco e análise de queries lentas (backlog).

## 1. Escopo

### Dentro do escopo

- **API → banco:** um span e um ponto de histograma por operação no Postgres, nomeados por tabela ou função SQL, para toda chamada do `supabase-js`.
- **Log** `db_operation_failed` para falha de servidor (5xx) ou de rede, sem nada da query.
- **Servidor Postgres:** métricas coletadas pelo OTel Collector (receiver `postgresql`) do Supabase local e enviadas ao Mimir.
- **Privacidade dos spans:** parar de gravar a query string (e-mail, id de sessão) e o IP do cliente nos spans HTTP de entrada e de saída.
- **Buckets do histograma de auth** em segundos (o padrão do OpenTelemetry é em milissegundos).
- **Dashboard:** seção "Banco de dados: Postgres" no dashboard existente.
- Testes unitários e de integração; documentação e ADR.

### Fora do escopo

- Texto das queries, plano de execução, `pg_stat_statements` e queries lentas por texto (a query pode conter dado pessoal).
- Instrumentar um banco **hospedado** (Supabase na nuvem): a API passa a instrumentar as operações, mas as métricas do servidor continuam sendo as do banco local.
- Trocar `supabase-js` por conexão direta (`pg`): decidido na ADR 0008.
- Alertas (spec 0012 cobre as regras de banco).

## 2. Contexto

A API acessa o Postgres só por `supabase-js` com a service role (ADR 0008): cada query é uma chamada HTTP ao PostgREST (`/rest/v1/<tabela>` ou `/rest/v1/rpc/<função>`). Antes desta spec, o banco só aparecia como "chamada HTTP para `*.supabase.co`", sem tabela, função nem operação, e nada do servidor Postgres era coletado. Verificado em 2026-11-10:

- O OTel Collector em uso (`contrib` 0.164) inclui o receiver `postgresql` e alcança o banco local por `host.docker.internal:54322`.
- **Vazamento de PII encontrado:** os spans de saída do undici guardavam `url.full` e `url.query` inteiros. No PostgREST a query string é o filtro, então o Tempo tinha o **e-mail do usuário** (`email=eq.…`) e o **id de sessão** (`id=eq.<sid>`). Os spans HTTP de entrada guardavam `client.address` (IP). Isso viola o R6 da spec 0011, cujo teste só olhava os spans `auth.*`.
- O histograma `auth.operation.duration` usava os limites padrão (0, 5, 10, 25… 10000) numa unidade em segundos: toda requisição caía no primeiro bucket e o p95 não tinha significado.
- O `.env` local aponta para um projeto Supabase na nuvem, enquanto a stack local também roda. As métricas do servidor vêm do banco local.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Quem opera e depura a API (engenharia).                                                                                                        |
| Decisão ou ação que muda | Ver qual tabela ou função SQL está lenta ou falhando e como está o servidor (conexões, locks, cache), sem abrir o painel do Supabase.          |
| Resultado esperado       | Spans e métricas por operação de banco, métricas do servidor no Mimir, e nenhum dado pessoal nos spans.                                        |
| Métrica de sucesso       | Um sign-in aparece no Tempo com `select users` e `rpc auth_issue_session` dentro de `auth.sign_in`, e o e-mail não aparece em nenhum atributo. |

## 4. Requisitos

| ID  | Requisito                                                                                                                                                                                                                                                                                                                                                           | Prioridade | Critério de aceite                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Toda chamada ao PostgREST gera um span CLIENT `<operação> <tabela ou função>` (filho do span ativo) e um ponto de `db.client.operation.duration` (segundos) com `db.system.name`, `db.operation.name`, `db.collection.name` ou `db.stored_procedure.name` e, na falha, `error.type`. Nome fora de `[a-z_][a-z0-9_]{0,62}` vira `unknown`.                           | Must       | Given um sign-in, When abro o trace, Then há `select users` e `rpc auth_issue_session` dentro de `auth.sign_in`; e o Mimir tem `db_client_operation_duration_seconds_*` com esses labels. |
| R2  | **Nada da query** em span, label ou log: nem query string, corpo, headers nem resposta. Só operação e tabela/função, derivadas do **path**.                                                                                                                                                                                                                         | Must       | Given um valor sentinela no filtro e no corpo, When coleto spans, métricas e logs, Then o valor não aparece em nenhum deles.                                                              |
| R3  | `error.type` é o status HTTP para 4xx e 5xx e `network` quando a chamada falha. Só 5xx e `network` marcam o span como `ERROR` e emitem `event: "db_operation_failed"` (operação, tabela ou função, tipo de erro). 406 (`maybeSingle()` sem linha) e 409 são fluxo normal.                                                                                           | Must       | Given um 503 e uma falha de rede, When consulto, Then o span tem status `ERROR`, o log existe e não traz a query. Given um 406, Then não há `ERROR` nem log.                              |
| R4  | Os spans HTTP não gravam query string nem IP: `url.full` de saída sem query, `url.query` vazio, `client.address` vazio nos spans de entrada.                                                                                                                                                                                                                        | Must       | Given uma requisição com e-mail na query e um sign-in, When busco no Tempo, Then nenhum span tem a sentinela em `url.full` ou `url.query` e nenhum span de entrada tem `client.address`.  |
| R5  | O histograma `auth.operation.duration` usa limites em segundos, a mesma constante do histograma de banco.                                                                                                                                                                                                                                                           | Must       | Given tráfego de auth, When consulto os buckets no Mimir, Then existem `0.005 … 10`.                                                                                                      |
| R6  | O Collector coleta o Postgres local (`postgresql_backends`, `postgresql_connection_max`, `postgresql_commits_total`, `postgresql_rollbacks_total`, `postgresql_deadlocks_total`, `postgresql_blocks_read_total`, `postgresql_db_size_bytes`, tamanhos e linhas por tabela) com `job="rondo-postgres"`. Endpoint, usuário e senha vêm de variáveis com padrão local. | Must       | Given `bun run infra:up`, When consulto o Mimir, Then as métricas existem com `job="rondo-postgres"`.                                                                                     |
| R7  | O dashboard tem a seção "Banco de dados: Postgres" com operações, latência p95, falhas, conexões, cache, rollbacks, deadlocks, tamanho, latência por alvo, locks, linhas vivas e mortas, varreduras sequenciais e tabelas de traces de banco.                                                                                                                       | Must       | Given tráfego, When abro o dashboard, Then os painéis da seção executam sem erro e mostram dados quando há tráfego.                                                                       |
| R8  | Testes unitários (módulo de banco e redação) e integração (fluxo real de sign-in com spans e métricas de banco, sem vazamento) e teste do dashboard cobrindo as métricas novas.                                                                                                                                                                                     | Must       | Given `bun run test` e `bun run test:integration`, When executados, Then passam e falham se o span de banco sumir, o log vazar a query ou a query string voltar a um atributo.            |
| R9  | Documentação: catálogo em `ARCHITECTURE.md` §4.4, regra em `DEVELOPMENT.md` §7, roteiro em `QA.md` e a ADR 0011.                                                                                                                                                                                                                                                    | Must       | Given os docs, When leio, Then constam os nomes, labels, a regra "acesso a dados novo usa o `fetch` instrumentado" e o roteiro.                                                           |

## 5. Fluxos e estados

- **Caminho feliz:** a API faz uma operação no banco, o `fetch` instrumentado abre o span, chama o PostgREST e grava a duração; o Collector coleta o servidor a cada 15 s.
- **Vazio:** sem tráfego, os painéis de API → banco ficam sem dados; os do servidor continuam, porque o Collector coleta sempre.
- **Erro do banco:** 5xx ou rede vira span `ERROR`, ponto com `error.type` e log `db_operation_failed`; a exceção original é relançada sem alteração (a resposta ao cliente não muda).
- **Telemetria falha:** erro ao gravar a métrica ou o log é engolido; nunca altera a resposta.
- **Collector sem acesso ao banco:** as métricas do servidor somem e a regra "Postgres sem métricas" dispara; a API segue normal.
- **Banco hospedado:** a API instrumenta as operações; o servidor monitorado continua local (ver §11).

## 6. Acceptance Criteria

- [x] Given um sign-in real, When abro o trace, Then há `select users` e `rpc auth_issue_session` dentro de `auth.sign_in`. (R1, teste de integração)
- [x] Given a API real contra o Supabase local, When consulto Mimir e Tempo, Then existem `db_client_operation_duration_seconds_*` e spans `select users`, `rpc auth_sign_up` e `rpc auth_request_password_reset`. (R1)
- [x] Given uma sentinela na query string e no filtro, When busco no Tempo, Then 0 traces a contêm em `url.full` ou `url.query`, 0 têm `url.query` preenchido e 0 spans de entrada têm `client.address`. (R2, R4)
- [x] Given um 503, uma falha de rede, um 406 e um 409, When os testes rodam, Then só 503 e a falha de rede viram `ERROR` e log. (R3, teste unitário)
- [x] Given tráfego, When consulto os buckets, Then o histograma de banco e o de auth têm `0.005 … 10`. (R5)
- [x] Given `infra:up`, When consulto o Mimir, Then `postgresql_*` existe com `job="rondo-postgres"`. (R6)
- [x] Given o dashboard provisionado, When executo as consultas de cada painel, Then nenhuma volta com erro (68 com dados, 11 vazios por falta de eventos, 0 erros). (R7)
- [x] Given `bun run test` e `bun run test:integration`, When executo, Then passam (403 e 217). (R8)
- [x] Given os docs, When leio, Then constam catálogo, regra e roteiro. (R9)
- [ ] Given uma falha real de banco, When ocorre, Then o log `db_operation_failed` chega ao Loki. (R3, ao vivo)
- [ ] Given o dashboard aberto no navegador, When olho a seção de Postgres, Then os painéis estão legíveis. (R7, visual)

## 7. O que fazer

1. Criar `duration-buckets.ts` e usar nos dois histogramas (R5).
2. Criar `db-telemetry.ts` (descrição da chamada pelo path, span, histograma, log de falha) e ligá-lo ao `createClient` do `auth.module` (R1 a R3).
3. Criar `span-redaction.ts` e ligar `startSpanHook` (undici) e `requestHook` (http) em `telemetry.ts` (R4).
4. Configurar o receiver `postgresql` no Collector, com processadores para `job` e labels, e o `extra_hosts` e as variáveis no `docker-compose.yml` (R6).
5. Ampliar o dashboard (R7) e escrever os testes (R8).
6. Atualizar docs e ADR (R9).

## 8. O que não fazer

- Não gravar query string, corpo, headers, texto de query ou `url.full` com filtro em span, label ou log.
- Não usar valor vindo do cliente como label: tabela e função saem do path que o nosso código monta e passam por `[a-z_][a-z0-9_]{0,62}`.
- Não marcar 4xx do PostgREST como erro do span: 406 e 409 são fluxo de negócio.
- Não colocar a senha do banco monitorado no repositório além do padrão local documentado; em outro banco, use variáveis e um usuário com `pg_monitor`.
- Não criar um segundo cliente do Supabase sem o `fetch` instrumentado.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                                                                                 | Mitigação                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Risco       | `increase()` perde o primeiro evento de uma série nova; no começo, painéis de contagem mostram 0 ou NaN.                                  | Falhas raras vêm dos logs (exatos); séries contínuas ficam corretas depois do segundo ciclo. Documentado.                  |
| Risco       | Métricas do servidor vêm do banco local; se a API usa o Supabase na nuvem, painéis de servidor e de operação descrevem bancos diferentes. | Texto do painel e da spec explicam; instrumentar o hospedado é backlog (endpoint de métricas do Supabase ou `pg_monitor`). |
| Risco       | Métricas sem label `instance`: duas instâncias da API escrevem nas mesmas séries (contadores colidem).                                    | Resolvido na spec 0014: `service.instance.id` (UUID por processo) em `telemetry.ts`, achado no teste de carga.             |
| Risco       | Tráfego antigo no Tempo ainda tem e-mail e sid em `url.full`.                                                                             | Os spans novos já saem limpos; o dado antigo expira com a retenção local. Em ambiente compartilhado, limpar o backend.     |
| Risco       | Medição vai até os headers da resposta, não até o corpo.                                                                                  | Respostas do PostgREST são pequenas; documentado no nome e na descrição da métrica.                                        |
| Dependência | `host.docker.internal` e a porta 54322 do Supabase local.                                                                                 | `extra_hosts` no compose para Linux; endpoint sobrescrevível por `POSTGRES_ENDPOINT`.                                      |

## 10. Resultado

- **Comando/verificação:** `bun run infra:up`, `bun run build`, subir a API com o SDK ligado contra o Supabase local numa porta livre, fazer sign-up, sign-in (certo e errado) e forgot-password, esperar ~40 s e consultar Mimir (`db_client_operation_duration_seconds_count`), Tempo (`{ span.db.system.name = "postgresql" }`) e a busca da sentinela em `url.full` e `url.query`. Rodar `bun run lint`, `bun run check-types`, `bun run test` e `bun run test:integration`.
- **Evidência esperada:** spans e métricas de banco por tabela e função; 0 traces com a sentinela; `postgresql_*` no Mimir; gates verdes.
- **Comportamento observável:** a seção "Banco de dados: Postgres" do dashboard responde a "qual tabela ou função está lenta, e como está o banco".

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                                        | Impacto                                                       | Bloqueante? | Quem decide |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------- | ----------- |
| A API deve instrumentar o Supabase hospedado também (métricas do servidor via endpoint de métricas do Supabase ou usuário `pg_monitor`)? | Sem isso, as métricas do servidor descrevem só o banco local. | Não         | Owner       |
| **Premissa:** operação = método HTTP do PostgREST (GET select, POST insert, PATCH update, DELETE delete, `rpc` para funções).            | `upsert` aparece como `insert`.                               | Não         | Engenharia  |
| **Premissa:** 406 e 409 não são falha de banco.                                                                                          | Contam em `error.type` mas não alertam nem marcam o span.     | Não         | Engenharia  |
| **Premissa:** o usuário `postgres` local basta para o Collector (padrão do Supabase local); em outro ambiente, use `pg_monitor`.         | Credencial por variável de ambiente.                          | Não         | Engenharia  |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                                                        | Motivo                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2026-11-10 | Spec criada e implementada. Achados e corrigidos na verificação: PII (e-mail e sid) em `url.full` e `url.query` dos spans de saída, IP em `client.address` dos spans de entrada, e buckets do histograma de auth em milissegundos. | Instrumentar o Postgres sem repetir, nos spans de banco, o vazamento que a verificação encontrou nos spans HTTP. |
| 2026-11-12 | Nota de refinamento: a instrumentação pelo `fetch` do `supabase-js` (ADR `0011`) e o painel e os alertas de dependência HTTP do banco foram **substituídos** pela spec `0016`: o Postgres é nativo, a telemetria vem de um wrapper do Pool `pg` (ADR `0016`) e o receiver `postgresql` aponta para o serviço `postgres` do Compose. Nomes de métrica, span e atributos de banco se mantêm; `error.type` passa a ser o SQLSTATE. O texto acima fica como registro histórico. | Troca do Supabase local por Postgres nativo (spec `0016`, ADR `0015`). |
