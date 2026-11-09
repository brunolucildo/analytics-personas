# Plano — 0003 Limite de requisições (habilitadora)

- **Status:** concluída (R1–R8 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0003-auth-rate-limiting
- **Spec:** `.specs/0003-auth-rate-limiting.md`
- **Data:** 2026-11-09

## Contexto

A API tem o prefixo `/api/v1`, o envelope de erro (`ApiException` + `AllExceptionsFilter`, que já mapeia 429 para `RATE_LIMITED`) e `Retry-After` exposto no CORS (spec 0001). Não há nenhum limite de requisições: as rotas públicas de auth (0004, 0006, 0007, 0009, 0010) ficariam expostas a força bruta e a spam de e-mail.

## Objetivo

Módulo `rate-limit` com decorator `@RateLimit('<policy>')` (opt-in), guard global que só age em rota decorada, armazenamento em memória atrás de uma interface, registro das seis políticas de auth, resposta 429 padronizada, `TRUST_PROXY` e auxiliar de teste.

## Não-objetivos

Aplicar políticas às rotas de auth; Redis ou tabela de contadores; bloqueio de conta; captcha; limite global; limitar `GET /api/v1/health`.

## Usuários e permissões

Sem usuário nem permissão. IP e e-mail do corpo viram a chave só em memória (hash SHA-256, nunca em log).

## Fluxos e estados

- Feliz: guard conta a requisição e a rota executa.
- Primeira requisição de uma chave: cria a entrada.
- Excesso: 429 + `Retry-After` + envelope `RATE_LIMITED` com `details[0].retryAfterSeconds`.
- Janela termina: a próxima requisição reinicia a contagem.
- Falha do armazenamento: a requisição passa (fail-open) e registra `rate_limit_store_error`.
- Reiniciar a API zera as contagens (aceito).

## Requisitos

| ID  | Requisito                                         | Prioridade | Critério de aceite (resumo)                                          |
| --- | ------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| R1  | `@RateLimit('<policy>')` por rota (opt-in)        | Must       | 3 passam, a 4ª dá 429; rota sem decorator nunca é limitada           |
| R2  | 429 padronizado                                   | Must       | `Retry-After` inteiro >= 1 e envelope `RATE_LIMITED` com `details`   |
| R3  | Chave = rota + IP (+ `email` normalizado)         | Must       | Cotas independentes por e-mail e por IP; e-mails equivalentes juntos |
| R4  | Janela expira e o limite volta                    | Must       | Relógio simulado além da janela: 200 e contagem reinicia             |
| R5  | Registro das seis políticas padrão em um só lugar | Must       | Valores exatos do R5 da spec                                         |
| R6  | Sem PII em log; memória limitada                  | Must       | Só `rate_limited` + nome da política; teto de entradas com evicção   |
| R7  | `TRUST_PROXY` (padrão falso)                      | Should     | `X-Forwarded-For` ignorado/usado; `.env.example` documenta           |
| R8  | `resetRateLimitStore()` para testes               | Should     | Nenhum teste herda cota de outro                                     |

## Contratos de dados

Entrada da chave: handler (classe + método), nome da política, IP, `email` string do corpo (trim + minúsculas). Chave guardada como hash SHA-256 hex. Entrada do armazenamento: `{count, resetAt}`. Sem retenção além da janela; teto de 10 000 entradas.

## Integrações

Nenhuma externa. O armazenamento fica atrás da interface `RateLimitStore` (porta) para trocar por Redis depois; falha dele é fail-open.

## Decisões e premissas

- **Decisão: biblioteca própria mínima em vez de `@nestjs/throttler`.** Precisamos de chave por rota + IP + e-mail do corpo, janela fixa com `Retry-After` e envelope próprio, relógio injetável e teto de entradas com evicção. O throttler cobriria só o contador e exigiria `getTracker`/`generateKey` customizados, tratamento de exceção para o envelope e um storage próprio para o teto; seria uma dependência nova (e a compatibilidade com Nest 12 teria de ser verificada) para menos código do que se economiza. Cerca de 150 linhas próprias, sem dependência nova. Ver ADR.
- **Decisão: guard global (`APP_GUARD`) que só age em rota com metadado.** Assim o decorator é a única coisa que as specs de auth precisam usar; não é preciso importar o módulo nem `@UseGuards`. Rotas sem decorator ficam intocadas.
- **Decisão: políticas e relógio injetáveis** (`RATE_LIMIT_POLICIES`, `RATE_LIMIT_CLOCK`), para o teste registrar a política 3/60 s e simular o tempo sem fake timers.
- **Decisão: IP via `request.ip` do Express com `trust proxy` = `TRUST_PROXY`.** Com `true` o Express usa o primeiro IP de `X-Forwarded-For`; com `false` ignora o cabeçalho.
- **Premissa (spec §11):** janela fixa; fail-open; valores do R5 mantidos.
- **Premissa:** nome de política desconhecido é erro de programação: o guard lança erro (500) em vez de deixar a rota sem proteção silenciosamente.
- **Premissa:** a chave "rota" é a identidade do handler (`Classe.metodo`), estável e sem depender do Express.
- **Premissa:** sem `email` string no corpo, política "IP + e-mail" cai para a chave só por IP (spec §9).

## Abordagem (fatias verticais)

1. **Núcleo do limite (R1–R5, R8):** interface + armazenamento em memória com teto, registro de políticas, regra de chave, decorator, guard com 429, módulo no `AppModule`, auxiliar de teste. Testes unitários do armazenamento/políticas/chave; integração com rota de teste e relógio simulado.
2. **IP real atrás de proxy (R7):** `TRUST_PROXY` em `environment.ts`, `setup-env.ts`, `.env.example`; `trust proxy` em `configureApp`. Testes de ambiente e integração com `X-Forwarded-For`.
3. **Sem PII e fail-open (R6):** logs só com `event` e política; `rate_limit_store_error` e passagem em falha do armazenamento. Testes com spy no logger e armazenamento que falha.
4. **Documentação e fechamento:** `DEVELOPMENT.md` (como aplicar uma política, limitação de instância única), `ARCHITECTURE.md` (módulo, dívida de Redis), `QA.md`, ADR, status da spec e do plano; gates.

## Arquivos previstos

- `apps/api/src/modules/rate-limit/` — `rate-limit.module.ts`, `rate-limit.decorator.ts`, `rate-limit.guard.ts`, `rate-limit.policies.ts`, `rate-limit.key.ts`, `rate-limit-store.ts`, `in-memory-rate-limit-store.ts`, `rate-limit.tokens.ts` e specs.
- `apps/api/src/app.module.ts` — importa `RateLimitModule` (aditivo).
- `apps/api/src/bootstrap.ts` — `trust proxy` (aditivo).
- `apps/api/src/config/environment.ts` (+ spec) — `TRUST_PROXY`.
- `apps/api/test/setup-env.ts`, `apps/api/test/support/rate-limit.ts`, `apps/api/test/rate-limit.int-spec.ts`.
- `.env.example`, `.docs/DEVELOPMENT.md`, `.docs/ARCHITECTURE.md`, `.docs/QA.md`.
- `.adrs/XXXX-0003-rate-limit-em-memoria-com-guard-proprio.md`.

## Testes

- Unitário: armazenamento (contagem, janela, expiração, teto), registro de políticas (R5), chave (R3), `TRUST_PROXY` no ambiente.
- Integração (Supertest): 3/60 s e 4ª = 429 com `Retry-After`; rota sem decorator; e-mails/IPs independentes; relógio avançado; `X-Forwarded-For` com `TRUST_PROXY` falso/verdadeiro; logs sem PII; fail-open; `resetRateLimitStore`.
- E2E: não se aplica (sem UI).
- Manual: não há UI; verificação é por testes de integração.

## Riscos e rollback

- Contagem em memória não vale com mais de uma instância (interface pronta para Redis; registrado no `ARCHITECTURE.md`).
- IP errado atrás de proxy (R7; documentado).
- Rollback: remover `RateLimitModule` do `AppModule` desativa tudo; nenhuma rota usa o decorator nesta spec.

## Critério de pronto

- [x] R1 a R8 com teste verde
- [x] `bun run lint`, `check-types`, `build`, `test`, `test:integration`
- [x] Docs, ADR e status atualizados
- [x] Commit e push

## Perguntas abertas

Nenhuma bloqueante.
