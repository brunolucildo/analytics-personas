# Plano — Instrumentação do Postgres

- **Status:** pronto para implementar (implementado em 2026-11-10; ver spec para o que falta verificar)
- **Slug:** 0013-postgres-observability
- **Spec:** `.specs/0013-postgres-observability.md`
- **Data:** 2026-11-10

## Contexto

A API acessa o Postgres só por `supabase-js` (ADR 0008): cada query é uma chamada HTTP ao PostgREST. Antes, o banco aparecia como "chamada para `*.supabase.co`", sem tabela nem função, e o servidor Postgres não era coletado. Os spans HTTP também guardavam a query string (e-mail e sid no PostgREST) e o IP do cliente.

## Objetivo

Spans e métricas por operação de banco, métricas do servidor no Mimir, spans sem dado pessoal e uma seção de Postgres no dashboard.

## Não-objetivos

Texto de query e `pg_stat_statements`, banco hospedado, conexão direta com `pg`, alertas (spec 0012).

## Usuários e permissões

Quem opera a API. Telemetria só com operação e tabela ou função (do path). O Collector lê o banco com o usuário local; em outro ambiente, use `pg_monitor` e variáveis.

## Fluxos e estados

Caminho feliz: `fetch` instrumentado abre o span, chama o PostgREST e grava a duração. Erro: 5xx ou rede vira `ERROR`, `error.type` e log `db_operation_failed`, e o erro original é relançado. Telemetria que falha é engolida. Collector sem acesso: métricas do servidor somem e a regra de ausência dispara.

## Requisitos

| ID  | Requisito                                         | Prioridade | Critério de aceite                                                                         |
| --- | ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| R1  | Span e histograma por operação, por tabela/função | Must       | Given um sign-in, Then `select users` e `rpc auth_issue_session` dentro de `auth.sign_in`. |
| R2  | Nada da query em sinal algum                      | Must       | Given sentinelas, Then não aparecem.                                                       |
| R3  | `error.type`; `ERROR` e log só para 5xx e rede    | Must       | Given 503/rede/406/409, Then só os dois primeiros.                                         |
| R4  | Sem query string nem IP nos spans HTTP            | Must       | Given uma sentinela na query, Then 0 traces a contêm.                                      |
| R5  | Buckets de auth em segundos                       | Must       | Given tráfego, Then buckets `0.005 … 10`.                                                  |
| R6  | Collector coleta o Postgres                       | Must       | Given `infra:up`, Then `postgresql_*` no Mimir.                                            |
| R7  | Seção de Postgres no dashboard                    | Must       | Given o dashboard, Then consultas sem erro.                                                |
| R8  | Testes                                            | Must       | Given os gates, Then passam.                                                               |
| R9  | Docs e ADR                                        | Must       | Given os docs, Then constam.                                                               |

## Contratos de dados

Métrica `db.client.operation.duration` (s): `db.system.name`, `db.operation.name`, `db.collection.name` ou `db.stored_procedure.name`, `error.type` (só em falha). Span `<operação> <alvo>`. Log `db_operation_failed`: `operation`, `collection` ou `procedure`, `errorType`. Métricas `postgresql_*` com `job="rondo-postgres"`. Sem PII; retenção do backend local.

## Integrações

PostgREST (via `supabase-js`): falha 5xx ou de rede registrada e relançada. Postgres local (porta 54322) pelo Collector: falha vira ausência de métrica.

## Decisões e premissas

- Decisão: instrumentar o `fetch` do `supabase-js` (um ponto), não cada repositório (ADR 0011).
- Decisão: coletar o servidor com o receiver `postgresql` do Collector.
- Decisão: sobrescrever `url.full`, `url.query` e `client.address` por hooks da própria biblioteca.
- Premissa: 406 e 409 são fluxo normal.
- Dúvida em aberto: instrumentar o banco hospedado (spec §11).

## Abordagem

1. `duration-buckets.ts` e uso nos dois histogramas.
2. `db-telemetry.ts`: `describeDbCall`, `createInstrumentedFetch`, log de falha.
3. Ligar ao `createClient` do `auth.module`.
4. `span-redaction.ts` e hooks em `telemetry.ts`.
5. Receiver `postgresql`, processadores, `extra_hosts` e variáveis no compose.
6. Seção do dashboard e testes (unitário, integração, assets).
7. Verificar ao vivo com a API real contra o Supabase local numa porta livre.
8. Docs e ADR.

## Arquivos previstos

- `apps/api/src/observability/{duration-buckets,db-telemetry,span-redaction}.ts` e specs — núcleo.
- `apps/api/src/observability/{telemetry,auth-telemetry}.ts`, `apps/api/src/modules/auth/auth.module.ts` — ligação.
- `apps/api/test/support/telemetry.ts`, `apps/api/test/auth-observability.int-spec.ts` — testes.
- `infra/otel/otel-collector-config.yaml`, `docker-compose.yml` — coleta do servidor.
- `infra/grafana/dashboards/api-observability.json`, `apps/api/src/observability/grafana-assets.spec.ts` — dashboard.
- `.docs/*`, `.adrs/0011-*.md` — documentação.

## Testes

- Unitário: `db-telemetry.spec.ts`, `span-redaction.spec.ts`, `auth-telemetry.spec.ts`, `grafana-assets.spec.ts`.
- Integração: `auth-observability.int-spec.ts` (fluxo real, spans e métricas de banco, sem vazamento).
- E2E: n/a.
- Manual: API real com o SDK ligado contra o Supabase local numa porta livre; consultar Mimir e Tempo; procurar a sentinela.

## Riscos e rollback

- Risco: `increase()` perde o primeiro evento. Mitigação: falhas raras por log.
- Risco: servidor local x operações no banco hospedado. Mitigação: texto no painel.
- Reverter: remover `global.fetch` do `createClient`, os hooks e o receiver.

## Critério de pronto

- [x] spans e métricas de banco ao vivo
- [x] 0 traces com a sentinela
- [x] `postgresql_*` no Mimir
- [x] consultas do dashboard sem erro
- [x] gates (`lint`, `check-types`, `test`, `test:integration`)
- [ ] falha real de banco ao vivo
- [ ] dashboard visto na interface

## Perguntas abertas

| Pergunta                                  | Impacto                                | Bloqueante? | Quem decide |
| ----------------------------------------- | -------------------------------------- | ----------- | ----------- |
| Instrumentar também o Supabase hospedado? | Métricas do servidor só do banco local | Não         | Owner       |
