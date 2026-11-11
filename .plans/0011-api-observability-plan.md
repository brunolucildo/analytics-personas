# Plano — Observabilidade da API (métricas, logs e traces de auth)

- **Status:** implementado, com verificação visual no Grafana pendente
- **Slug:** 0011-api-observability
- **Spec:** `.specs/0011-api-observability.md`
- **Data:** 2026-11-10

## Contexto

O pipeline OTLP → Collector → Mimir, Loki e Tempo já funciona. Faltam: label de rota nas métricas HTTP, contadores e spans dos fluxos de auth, o link log → trace no Grafana e dashboards úteis. Achados que guiam o plano (conferidos no código e na infra local em 2026-11-10):

- `instrumentation-http` lê `rpcMetadata.route` ao fechar a resposta (evento `close`); a instrumentação de Express 5 (`instrumentation-router`) **não** preenche esse campo, por isso a métrica não tem `http_route`.
- Validação (400), limite (429) e sessão (401) respondem em pipe e guards, antes do controller. Só um middleware no nível do app, junto com o filtro global de exceções, enxerga sucesso e todas as falhas.
- Os logs já chegam ao Loki com `trace_id` e `span_id` (instrumentação do pino).
- Testes de unidade e de integração rodam com `OTEL_SDK_DISABLED=true` e `LOG_LEVEL=silent`.

## Objetivo

Dois dashboards provisionados (API e Auth), métrica por rota, contador e histograma de auth, um span por operação de auth, log `auth_operation` e link do log para o trace, tudo sem PII.

## Não-objetivos

`/metrics`, Promtail, alertas, telemetria do browser, tracing do banco, mudar retenção (ver spec §1).

## Usuários e permissões

Quem opera a API. Sem mudança de acesso: Grafana local com `admin/admin` (só local).

## Fluxos e estados

Ver spec §5. Falha de telemetria nunca afeta o request (R12).

## Requisitos

R1 a R14 (Must), R15 e R16 (Should), R17 e R18 (Could): ver spec §4.

## Contratos de dados

- Contador `auth.operations` (`operation`, `outcome`, `reason`) e histograma `auth.operation.duration` em segundos (`operation`, `outcome`).
- Span `auth.<operation>` com `auth.operation`, `auth.outcome`, `auth.error_code`.
- Log `event: "auth_operation"` com `operation`, `outcome`, `reason`, `requestId`.
- PII: nenhuma (R6). Retenção: a dos backends locais (Loki 24 h).

## Integrações

Collector OTLP HTTP (já existente, timeout `OTEL_EXPORTER_OTLP_TIMEOUT`). Falha: a API segue respondendo.

## Decisões e premissas

- **Decisão:** um middleware de app (`auth-telemetry.middleware.ts`) conta cada tentativa uma vez, no `finish` da resposta, usando o status e o `code` que o filtro global guarda em `res.locals.errorCode`. Evita contar em dois lugares.
- **Decisão:** spans nascem no controller (`traceAuthOperation`), em volta do caso de uso e do mapeamento de erro; os casos de uso (camada `application`) não mudam.
- **Decisão:** `http_route` vem de um middleware que, no `finish`, grava `req.baseUrl + req.route.path` (ou `unmatched`) em `rpcMetadata.route`; o `instrumentation-http` lê isso no `close`.
- **Decisão:** dependências diretas novas, todas já no lockfile na mesma versão: `@opentelemetry/core@3.1.0` (runtime, para `getRPCMetadata`) e, em devDependencies, `@opentelemetry/sdk-trace@3.1.0` e `@opentelemetry/context-async-hooks@3.1.0` (exportadores e provider em memória para os testes). O `bun` isola pacotes, então transitivas não resolvem.
- **Premissa:** nome do contador no Mimir `auth_operations_total` (confirmar na QA).
- ADR 0010 registra a escolha por push OTLP e a regra de contagem única.

## Abordagem

1. Plano e dependências.
2. `http-route` (R1): `routeOf`, middleware e testes.
3. `auth-telemetry` (R2, R3, R5, R15): razões, instrumentos, `traceAuthOperation` e testes.
4. Middleware de auth (R2 a R4, R7, R16), filtro com `errorCode`, controller com spans e `bootstrap` (testes unitários e integração com sentinelas de PII, R6 e R13).
5. Grafana: derived field, trace to logs, `api.json` e `auth.json`; teste de JSON (R8 a R11, R18).
6. Docs e ADR 0010 (R14).
7. Gates, QA manual no Grafana e commit.

## Arquivos previstos

- `apps/api/src/observability/http-route.ts` (+ spec) — rota nas métricas HTTP.
- `apps/api/src/observability/auth-telemetry.ts` (+ spec) — razões, instrumentos e spans.
- `apps/api/src/modules/auth/interface/auth-telemetry.middleware.ts` (+ spec) — contagem por tentativa.
- `apps/api/src/common/all-exceptions.filter.ts` — guarda o `code` em `res.locals`.
- `apps/api/src/modules/auth/interface/auth.controller.ts` — spans por operação.
- `apps/api/src/bootstrap.ts` — registra os middlewares.
- `apps/api/test/auth-observability.int-spec.ts` — fluxos reais com exportadores em memória.
- `apps/api/package.json`, `bun.lock` — dependências.
- `infra/grafana/provisioning/datasources/datasources.yaml`, `infra/grafana/dashboards/api.json`, `infra/grafana/dashboards/auth.json`, `infra/grafana/dashboards/dashboards.spec.ts` (ou equivalente) — Grafana.
- `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/QA.md`, `.adrs/0010-metricas-por-push-otlp.md`.

## Testes

- Unitário: `routeOf` e middleware de rota; `reasonOf`; `traceAuthOperation` (sucesso, falha, sem mensagem de exceção); middleware de auth (sucesso, cada `reason`, operação desconhecida ignorada, sem PII).
- Integração (Supabase local real): fluxo completo de auth com sentinelas; contadores e spans em memória; refusal 400, 429 e 413; anti-enumeração de `forgot_password`.
- Dashboards: JSON válido, `uid` único e datasources conhecidos.
- Manual: Grafana com `infra:up` e uma API com `EMAIL_PROVIDER=capture`.

## Riscos e rollback

- `http_route` depende de um detalhe interno (`rpcMetadata`) do `instrumentation-http`: coberto por teste de unidade e validado no Mimir na QA.
- Derived field pode não casar com metadado estruturado do Loki: validar na QA.
- Rollback: reverter o commit; nenhum dado persistente é alterado.

## Critério de pronto

- [x] R1 a R7 e R13 a R16 atendidos e verificados; R8 a R11 provisionados com as consultas validadas, falta a conferência visual no Grafana.
- [x] `lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e` verdes (2026-11-10).
- [ ] QA manual na interface do Grafana (login recusado: senha local trocada); o resto da QA com o SDK ligado foi feito (`QA.md` §1.13).
- [x] `.docs` e ADR atualizados (`.adrs/0010-metricas-por-push-otlp.md`).

## Perguntas abertas

Nenhuma bloqueante.
