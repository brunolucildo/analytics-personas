# Plano — Proteção do hash de senha

- **Status:** pronto para implementar (implementado em 2026-11-10)
- **Slug:** 0015-auth-hash-protection
- **Spec:** `.specs/0015-auth-hash-protection.md`
- **Data:** 2026-11-10

## Contexto

O teste de carga mostrou que o argon2 tem teto de ~33 hashes/s e que os hashes enchem o pool de threads compartilhado, atrasando o JWT e o banco; e que um IP que troca de e-mail não é barrado.

## Objetivo

A API recusa rápido (503 ou 429) quando o hash satura ou um IP abusa, e o resto da API não sente.

## Não-objetivos

Parâmetros do argon2, limitador compartilhado, despejo de chaves do store, JWT fora do pool, limites por IP nas outras rotas.

## Usuários e permissões

Quem entra no sistema (sign-up, sign-in, reset) e quem opera a API. Nenhum dado novo: o limitador não guarda IP, e-mail nem senha; os logs levam só o evento e o nome da política.

## Fluxos e estados

Vaga livre: o hash começa. Sem vaga: espera na fila em ordem. Fila cheia: 503 `SERVICE_BUSY` com `Retry-After`, sem hash. IP acima do limite de sign-in: 429 antes de qualquer custo. Falha do hash: libera a vaga e relança o erro.

## Requisitos

| ID  | Requisito                                          | Prioridade | Critério de aceite                                                  |
| --- | -------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| R1  | `HashLimiter` com concorrência e fila limitada     | Must       | Given 10 hashes e concorrência 3, Then no máximo 3 em execução.     |
| R2  | Fila cheia: 503 `SERVICE_BUSY`, sem log de exceção | Must       | Given fila cheia, Then 503 com `Retry-After`, nenhum hash iniciado. |
| R3  | Todo argon2 passa pelo limitador                   | Must       | Given os adaptadores, Then cada chamada ocorre no limitador.        |
| R4  | Motivo `service_busy` no conjunto fechado          | Must       | Given um 503, Then `reason="service_busy"`.                         |
| R5  | Métricas da fila                                   | Must       | Given login, Then `auth_hash_*` no Mimir.                           |
| R6  | `sign-in-ip` e `@RateLimit` com várias políticas   | Must       | Given 61 sign-ins de um IP, Then o 61º recebe 429.                  |
| R7  | Rotas sem hash rápidas sob hash saturado           | Must       | Given `browse` + login saturando, Then p95 do `session` em ms.      |
| R8  | Dashboard, alerta, docs e ADR                      | Must       | Given os artefatos, Then constam.                                   |
| R9  | Testes                                             | Must       | Given os gates, Then passam.                                        |

## Contratos de dados

Env opcionais: `AUTH_HASH_CONCURRENCY` (inteiro ≥ 1, padrão pool−1) e `AUTH_HASH_QUEUE_LIMIT` (inteiro ≥ 0, padrão 64). Erro: `{"error":{"code":"SERVICE_BUSY","message":"...","details":[{"retryAfterSeconds":n}]}}` com status 503 e `Retry-After`. Métricas: `auth.hash.queue.wait` (s), `auth.hash.active`, `auth.hash.queued`, `auth.hash.rejected`. Política: `sign-in-ip` `{limit: 60, windowSeconds: 600, keyBy: "ip"}`.

## Integrações

Biblioteca `argon2` (pool do libuv). Falha: o erro original sobe e a vaga é liberada. O store do limitador segue em memória (ADR 0005).

## Decisões e premissas

- Decisão: 503 e não 429 para a fila cheia; limitador único por processo (ADR 0013).
- Decisão: `@RateLimit(...políticas)` avalia em ordem e a primeira que estoura responde.
- Premissa: 60 por 10 min por IP; concorrência pool−1; fila 64.
- Dúvida em aberto: parâmetros do argon2 (Owner, fora do escopo).

## Abordagem

1. `ServiceBusyException`, tratamento no filtro e motivo `service_busy`.
2. `HashLimiter` com telemetria; variáveis em `config/environment.ts`; ligação nos adaptadores argon2 pelo `auth.module`.
3. `@RateLimit` com várias políticas, guard em ordem, política `sign-in-ip` no sign-in.
4. Testes, painéis, alerta e docs.
5. Gates e carga antes e depois.

## Arquivos previstos

- `apps/api/src/common/service-busy.exception.ts`, `all-exceptions.filter.ts` — 503.
- `apps/api/src/modules/auth/infrastructure/hash-limiter.ts`, `argon2-password-{hasher,verifier}.ts`, `auth/auth.module.ts` — limitador.
- `apps/api/src/config/environment.ts` — variáveis.
- `apps/api/src/observability/auth-telemetry.ts` — motivo novo.
- `apps/api/src/modules/rate-limit/{rate-limit.decorator,rate-limit.guard,rate-limit.policies}.ts`, `auth.controller.ts` — IP.
- testes, `infra/grafana/*`, docs — verificação e documentação.

## Testes

- Unitário: limitador, filtro, motivo, guard com várias políticas, adaptadores, ambiente.
- Integração: sign-in por IP (61º = 429), 503 com a fila cheia.
- E2E: não roda neste ambiente (aponta para a nuvem).
- Manual: `bun run load capacity --only=browse,invalidCredentials` antes e depois.

## Riscos e rollback

- Risco: 60 por IP barrar rede compartilhada; 503 inesperado no front. Rollback: remover `sign-in-ip` do decorator e a fila (concorrência alta).
- Reverter: tirar o limitador dos adaptadores.

## Critério de pronto

- [x] testes e gates verdes
- [x] carga: `session` rápido sob login saturado
- [x] docs, dashboard e alerta

## Perguntas abertas

| Pergunta                         | Impacto                                  | Bloqueante? | Quem decide |
| -------------------------------- | ---------------------------------------- | ----------- | ----------- |
| Parâmetros do argon2 mais leves? | Multiplica o teto de hashes por segundo. | Não         | Owner       |
