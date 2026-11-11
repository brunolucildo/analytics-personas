# Plano — Refatoração das fatias `auth`, `email` e `rate-limit` para a arquitetura em camadas

- **Status:** pronto para implementar
- **Slug:** `refactor-slices-20261111-1801`
- **Spec:** não há `.specs/<slug>.md`; este plano deriva da auditoria `01-audit.md` (skill `refactor-slices`)
- **Data:** 2026-11-11
- **Branch:** `refactor/slices-20261111-1801` (base `main`)
- **Run:** `.claude/refactor/20261111-1801/`
- **Escopo:** `apps/api/src/modules`
- **Fonte da arquitetura-alvo:** `.claude/skills/refactor-slices/references/target-architecture.md` (espelha `.docs/ARCHITECTURE.md` §4.1–4.2 e `.docs/DEVELOPMENT.md` §2.1–2.2)

## Contexto

A auditoria de 2026-11-11 encontrou 3 fatias fora do padrão (25 violações confirmadas: 11 high, 6 medium, 8 low):

- `auth` concentra 8 endpoints em um único `AuthController`, injeta 7 use cases na mesma classe, deixa a infraestrutura de hash conhecer HTTP (`ServiceBusyException`), passa funções de hash de token para os use cases e expõe internos por caminhos profundos (`bootstrap.ts`, `config/environment.ts`).
- `email` tem um controller com 2 endpoints que acessa o `CapturedEmailStore` (infraestrutura) diretamente e importa `EmailConfig` de `infrastructure/`; o barrel público exporta helpers de captura.
- `rate-limit` não tem camada nenhuma: políticas, chave, hash, guard, decorator, store e módulo convivem na raiz, e a decisão de limite + cálculo de `Retry-After` estão dentro do guard HTTP.

O comportamento observável (rotas, status, DTOs, envelope de erro, telemetria, políticas, SQL, e-mail) está correto e **não muda**. A mudança é estrutural.

## Diagnóstico (achados confirmados no código)

### `auth` — 2 high / 4 medium / 1 low

| #   | Sev.   | Evidência                                                                              | Confirmação no código                                                                                                                                                                   | Correção                                                                                                 |
| --- | ------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A1  | high   | `interface/auth.controller.ts` com 8 rotas                                             | `@Post/@Get` em `sign-up` (47), `forgot-password` (80), `reset-password` (98), `sign-in` (125), `sign-out` (161), `confirm-account` (171), `resend-confirmation` (198), `session` (211) | 8 request handlers, um por endpoint                                                                      |
| A2  | high   | `auth.controller.ts:38-45` injeta 7 use cases                                          | `@Inject(SignUp)`, `RequestPasswordReset`, `SignIn`, `SignOut`, `ConfirmAccount`, `ResendConfirmation`, `ResetPassword`                                                                 | 1 handler → 1 use case                                                                                   |
| A3  | medium | `confirm-account.ts:22`, `reset-password.ts:26` recebem `hashToken: (token) => string` | `auth.module.ts:187` e `:229` passam `hashToken` importado de `infrastructure/crypto-token-generator`                                                                                   | port `TokenHasher` + adaptador `CryptoTokenHasher`                                                       |
| A4  | medium | `infrastructure/hash-limiter.ts:2,141` importa/lança `ServiceBusyException`            | infraestrutura decide status 503                                                                                                                                                        | erro tipado `HashCapacityExceededError` + mapeamento na interface                                        |
| A5  | medium | `auth/index.ts:1-2` exporta só `AuthModule`                                            | `bootstrap.ts:10` importa middleware por caminho profundo; `config/environment.ts:2` importa `session-rules`                                                                            | barrel exporta `createAuthTelemetryMiddleware`; `MIN_JWT_SECRET_LENGTH` vai para `config/auth-secret.ts` |
| A6  | medium | `auth.controller.ts:211-214` devolve sessão sem use case                               | `getSession` só chama `presentUser`                                                                                                                                                     | use case `GetSession`                                                                                    |
| A7  | low    | specs de `application/` importam `jose`/`JoseAccessTokenSigner`                        | `session.service.spec.ts:1,7`, `sign-in.spec.ts:10`, `sign-out.spec.ts:4`                                                                                                               | **exceção justificada** (ver §11)                                                                        |

### `email` — 4 high / 1 low

| #   | Sev. | Evidência                                                                            | Confirmação no código                         | Correção                                                     |
| --- | ---- | ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| E1  | high | `interface/test-support-emails.controller.ts:15-18` importa `CapturedEmailStore`     | borda HTTP conhece o adaptador concreto       | port `CapturedEmailRepository` + store implementando         |
| E2  | high | `test-support-emails.controller.ts:19,28` importa `EmailConfig` de `infrastructure/` | `CaptureOnlyGuard` depende de detalhe interno | `EmailConfig`/`parseEmailConfig` em `domain/email-config.ts` |
| E3  | high | `test-support-emails.controller.ts:47,52` tem `@Get` e `@Delete`                     | 2 endpoints na mesma classe                   | 2 request handlers                                           |
| E4  | high | `test-support-emails.controller.ts:45-55` chama `store.list/clear`                   | handler executa a operação, sem use case      | `ListCapturedEmails` e `ClearCapturedEmails`                 |
| E5  | low  | `email/index.ts:12-17` exporta helpers de captura                                    | barrel público expõe infraestrutura           | helpers passam para `email/testing/index.ts`                 |

### `rate-limit` — 5 high / 2 medium / 6 low

| #      | Sev.   | Evidência                                                         | Confirmação no código                                                                                                                 | Correção                                                               |
| ------ | ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| R1     | high   | sem `domain/`                                                     | políticas, chave e decisão na raiz/guard                                                                                              | `domain/` com política, chave pura, decisão e erros                    |
| R2     | high   | sem `application/`                                                | guard orquestra contagem e decisão                                                                                                    | `CheckRateLimit` com um `execute`                                      |
| R3     | high   | sem `infrastructure/`                                             | store e SHA-256 na raiz                                                                                                               | `InMemoryRateLimitStore`, `NodeCryptoKeyHasher`                        |
| R4     | high   | sem `interface/`                                                  | guard/decorator na raiz                                                                                                               | `interface/guards/` e `interface/decorators/`                          |
| R5     | high   | `rate-limit.guard.ts:66-90` decide limite e calcula `Retry-After` | regra de negócio na borda                                                                                                             | decisão no domínio/use case; guard só traduz para HTTP                 |
| R6     | medium | `rate-limit.key.ts:1,28-33` usa `node:crypto`                     | composição da chave e hash na mesma função                                                                                            | `buildRateLimitKeyParts` (puro) + port `KeyHasher`                     |
| R7     | medium | `rate-limit.module.ts:23` registra `APP_GUARD`                    | ordem `RateLimitGuard` → `AuthGuard` implícita entre módulos                                                                          | **mantido no módulo, com ordem documentada** (decisão do orquestrador) |
| R8–R13 | low    | 6 arquivos na raiz do módulo                                      | `in-memory-rate-limit-store`, `rate-limit-store`, `rate-limit.decorator`, `rate-limit.guard`, `rate-limit.key`, `rate-limit.policies` | distribuídos nas camadas                                               |

> **Correções à auditoria:** nenhuma. Todas as evidências foram reconferidas no código atual. A observação da auditoria sobre `handler-multiple-injections` em `email` já estava descartada (o segundo `@Inject` é do guard) e não entra como achado.

## Objetivo

Deixar `auth`, `email` e `rate-limit` no layout-alvo (domain + application + infrastructure + interface), com **um request handler por endpoint** e **um use case por fluxo**, sem alterar nenhum contrato observável: rotas, métodos, status, DTOs, validações, códigos/mensagens de erro, telemetria, políticas e chave de rate limit, SQL/RPC, templates de e-mail e dependências externas.

## Não-objetivos

- Não alterar `apps/api/src/common/`, `observability/`, `config/` (exceto os imports e o novo `config/auth-secret.ts`), `health/` ou `app.module.ts`.
- Não alterar migrations, RPCs, tabelas, RLS ou permissões.
- Não alterar comportamento de negócio, mensagens, códigos de erro, templates, assuntos ou destinatários de e-mail.
- Não trocar o store em memória por Redis, nem mudar números/janelas de política.
- Não adicionar dependência.
- Não mudar a estratégia de observabilidade (nomes de métrica, labels, operações e motivos).
- Não refatorar os adaptadores `Supabase*`, `Argon2*`, `Jose*`, `CryptoTokenGenerator`, `mailtrap`, `resend`, `capture` além do necessário para os ports citados.
- Não dividir `SessionService`, `EmailService` e `renderEmailLayout` (capacidades/helpers reutilizáveis, não fluxos).

## Usuários e permissões

Nenhum papel novo. `@Public()` continua exatamente nas mesmas rotas (`sign-up`, `forgot-password`, `reset-password`, `sign-in`, `confirm-account`, `resend-confirmation`, `test-support/emails`); `sign-out` e `GET /auth/session` continuam fechadas pelo `AuthGuard` global. `CaptureOnlyGuard` continua respondendo `404 NOT_FOUND` fora do provider `capture`.

## Fluxos e estados

Os fluxos HTTP não mudam (feliz, validação 400, 401/403, 404, 429, 503 e 500). O que muda é a composição interna:

- `rate-limit`: `CheckRateLimit.execute` devolve `allowed | limited(retryAfterSeconds, policyName) | unavailable(policyName)`; o guard traduz `limited` em `429 + Retry-After + RATE_LIMITED` e `unavailable` em log `rate_limit_store_error` + request liberado (fail-open).
- `auth`: cada handler traduz os erros de domínio do **seu** fluxo; `HashCapacityExceededError` é traduzido em `ServiceBusyException` (503 + `Retry-After`) nos 3 handlers que executam hash/verificação (`sign-up`, `sign-in`, `reset-password`).

## Requisitos

| ID  | Requisito                                                                                                  | Prioridade | Critério de aceite                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Cada endpoint de `auth` e `email` tem uma classe de request handler com exatamente 1 `@Inject` de use case | Must       | `audit-slices.mjs` não reporta `controller-multiple-endpoints` nem `handler-multiple-injections`; 10 handlers listados no módulo                         |
| R2  | Cada handler injeta exatamente 1 use case e cada use case é usado por 1 handler                            | Must       | revisão do mapa 1:1 (§8) e do `*.module.ts`                                                                                                              |
| R3  | `interface` não importa `infrastructure` em `auth`/`email`/`rate-limit`                                    | Must       | `audit-slices.mjs` sem `layer-direction`                                                                                                                 |
| R4  | `domain` não importa framework, HTTP, banco, SDK nem `node:crypto`                                         | Must       | `audit-slices.mjs` sem `external-in-inner-layer` em `domain`                                                                                             |
| R5  | `rate-limit` tem as 4 camadas e um use case de avaliação                                                   | Must       | `missing-layer` zerado; `CheckRateLimit` com um `execute`                                                                                                |
| R6  | `HashLimiter` não conhece HTTP                                                                             | Must       | nenhum import de `common/` em `hash-limiter.ts`; 503 coberto por `auth-hash-protection.int-spec.ts`                                                      |
| R7  | Contratos HTTP preservados                                                                                 | Must       | suítes `auth-*.int-spec.ts`, `email.int-spec.ts`, `rate-limit.int-spec.ts`, `api-conventions.int-spec.ts` passam sem alteração de asserção               |
| R8  | Documentação e ADR atualizados                                                                             | Must       | `.adrs/0014-request-handler-por-endpoint.md` criado; `.docs/DEVELOPMENT.md` §2.1/§2.2/§5/§13.4/§13.5 e `.docs/ARCHITECTURE.md` §4.2/§4.4–4.7 atualizados |
| R9  | Nenhuma dependência nova                                                                                   | Must       | `package.json`/`bun.lock` inalterados                                                                                                                    |
| R10 | Gates de `QA.md` §3 passam                                                                                 | Must       | lint, check-types, build, test, test:integration, test:e2e verdes                                                                                        |

## Contratos de dados

Nenhuma mudança de schema, migration, RPC ou payload. `CapturedEmail` (read model de teste) passa a ser declarado em `email/domain` e continua com os mesmos campos (`EmailMessage` + `from` + `capturedAt`), o mesmo teto de 500 e a mesma cópia defensiva no `list`. Nenhum dado novo é persistido ou logado.

## Integrações

- **Supabase/PostgREST:** inalterado; os repositórios continuam os mesmos e o `createClient` continua com `createInstrumentedFetch`.
- **E-mail:** inalterado; `EmailService` continua sendo o único ponto de saída e os mailers continuam chamando `dispatch` depois do commit.
- **OpenTelemetry:** inalterado; `traceAuthOperation` continua em cada handler com as mesmas operações; o middleware de telemetria continua lendo o path (não a classe), então dividir controllers não muda operações, labels nem motivos.
- **Caminho de falha:** store de rate limit lançando → fail-open + log `rate_limit_store_error`; hash saturado → `HashCapacityExceededError` → `503 SERVICE_BUSY` + `Retry-After`; e-mail falhando → log e resposta inalterada.

## Decisões e premissas

Decisões já tomadas pelo orquestrador (não reabrir):

1. `GET /auth/session` ganha o use case `GetSession` (regra 1:1).
2. O `APP_GUARD` do rate limit permanece em `RateLimitModule` porque a ordem `RateLimitGuard` → `AuthGuard` é garantida pela ordem de `imports` em `AppModule` (`RateLimitModule` antes de `AuthModule`). `app.module.ts` não é tocado.
3. `apps/api/src/common/` não é alterado. O erro tipado `HashCapacityExceededError` nasce em `auth/domain/auth-errors.ts` e é mapeado na interface para `ServiceBusyException` (mesmo envelope `ApiException(503, "SERVICE_BUSY", ...)` e mesmo header `Retry-After` via `AllExceptionsFilter`).
4. `test-support/emails` **não** é exceção: 2 request handlers + 2 use cases, preservando 404/200/204, `@Public()`, `CaptureOnlyGuard` e o filtro `?to=`.
5. As políticas de auth permanecem em `AUTH_RATE_LIMIT_POLICIES` no registry do rate limit, com os mesmos números e a mesma ordem.
6. `rate-limit` é fatia real: domain + application + infrastructure + interface.

Decisões técnicas deste plano:

- **Mapeamento do 503:** `ServiceBusyException` (de `common/`) na interface. Alternativa descartada: criar `ApiException(503, ...)` + `@Res()` no handler — maior superfície e perderia o header automático do filtro.
- **`TokenHasher`:** interface em `domain/auth-ports.ts` com `hash(token: string): string`; `CryptoTokenHasher` (infrastructure) delega para o `hashToken` já existente (mesmo SHA-256 hex). Os use cases passam a receber o port; os specs passam um objeto `{ hash }` (mudança de DI, não de asserção).
- **`EmailConfig`:** mover `EmailConfig`/`parseEmailConfig`/`parseEmailFrom` para `email/domain/email-config.ts`. Configuração de provedor é contrato do módulo, e o guard de borda deixa de depender de `infrastructure/`.
- **Barrel de teste de e-mail:** `email/testing/index.ts` (nome `index.ts` evita `file-at-module-root`; o script ignora specs e a regra de camadas não se aplica à raiz). `email-boundaries.spec.ts` continua válido porque `testing/` não está na regex proibida.
- **`MIN_JWT_SECRET_LENGTH`:** mover para `apps/api/src/config/auth-secret.ts` e consumir em `environment.ts` e `jose-access-token-signer.ts`. Isso evita `config → barrel de auth` (ciclo) e mantém `domain/session-rules.ts` sem regra de configuração. Valor continua 32.
- **Nomes de arquivo:** use cases em `application/use-cases/<fluxo>.use-case.ts` (nomes de classe atuais preservados: `SignUp`, `SignIn`, `SignOut`, `ConfirmAccount`, `ResendConfirmation`, `ResetPassword`, `RequestPasswordReset`, novo `GetSession`); `SessionService` em `application/services/`.
- **Rate limit:** `CheckRateLimit` recebe `RateLimitStore`, `RateLimitPolicies`, `KeyHasher` e `RateLimitClock`; `UnknownRateLimitPolicyError` (domain) preserva a falha fechada atual (500 `INTERNAL_ERROR` + log `unhandled_exception`).
- **Namespace da chave de rate limit:** a rota da chave deixa de ser `AuthController.<metodo>` e passa a ser `<NomeDoRequestHandler>.handle`. O escopo por endpoint é preservado (cada classe é única), mas contadores em memória reiniciam no deploy. Nenhum teste asserta o namespace de produção (`rate-limit.key.spec.ts` usa fixture `"AuthController.signUp"`).
- **Testes de aplicação de auth:** continuam usando o `JoseAccessTokenSigner` real (exceção A7), porque assertam o contrato do JWT; trocar por fake exigiria mudar asserções, o que a skill proíbe.

## Arquitetura-alvo

```text
apps/api/src/modules/<dominio>/
  <dominio>.module.ts
  <dominio>.tokens.ts
  index.ts
  domain/
    <regras>.ts
    <erros>.ts
    <fluxo>-ports.ts
  application/
    use-cases/<fluxo>.use-case.ts
    services/<capacidade>.service.ts
  infrastructure/
    <adaptador>.ts
  interface/
    request-handlers/<fluxo>.request-handler.ts
    dto/<fluxo>.dto.ts
    presenters/<fluxo>.presenter.ts
    guards/<dominio>.guard.ts
    decorators/<decorator>.ts
```

Direção: `interface → application → domain`; `infrastructure` implementa ports e é ligada no módulo Nest. O módulo é o único lugar que conhece implementações.

## Ordem de execução

1. **Batch 1 — `email`** (menor, prova o padrão 1:1 com 2 endpoints e um guard).
2. **Batch 2 — `rate-limit`** (sem endpoints; prova o padrão de use case + port fora da borda HTTP).
3. **Batch 3 — `auth`** (maior; aplica o padrão já validado em 8 endpoints e no erro de hash).
4. **Batch 4 — docs/ADR** (fecha R8 e o gate de arquitetura).

Dependências: 2 depende de 1 apenas no padrão (não no código); 3 depende de 1 e 2 (usa o barrel de `email/testing`, o `RateLimit` do barrel e o padrão de handler). Se um batch falhar, os seguintes que dependem dele não começam (§14).

## Mapeamento 1:1

### `auth` (8 endpoints)

| #   | Rota                                    | Request handler (novo)             | Use case (1:1)         | Ports (domain)                                                                          | Adaptadores (infrastructure)                                                                                                                     | Teste de contrato                  |
| --- | --------------------------------------- | ---------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 1   | `POST /api/v1/auth/sign-up`             | `SignUpRequestHandler`             | `SignUp`               | `UserRepository`, `PasswordHasher`, `TokenGenerator`, `ConfirmationMailer`              | `SupabaseUserRepository`, `Argon2PasswordHasher`, `CryptoTokenGenerator`, `EmailServiceConfirmationMailer`                                       | `auth-sign-up.int-spec.ts`         |
| 2   | `POST /api/v1/auth/forgot-password`     | `ForgotPasswordRequestHandler`     | `RequestPasswordReset` | `PasswordResetRepository`, `TokenGenerator`, `PasswordResetMailer`                      | `SupabasePasswordResetRepository`, `CryptoTokenGenerator`, `EmailServicePasswordResetMailer`                                                     | `auth-forgot-password.int-spec.ts` |
| 3   | `POST /api/v1/auth/reset-password`      | `ResetPasswordRequestHandler`      | `ResetPassword`        | `PasswordResetRepository`, `PasswordHasher`, `PasswordChangedMailer`, `TokenHasher`     | `SupabasePasswordResetRepository`, `Argon2PasswordHasher`, `EmailServicePasswordChangedMailer`, `CryptoTokenHasher`                              | `auth-reset-password.int-spec.ts`  |
| 4   | `POST /api/v1/auth/sign-in`             | `SignInRequestHandler`             | `SignIn`               | `CredentialsRepository`, `PasswordVerifier`, `SessionService.issue`, `NewSessionMailer` | `SupabaseCredentialsRepository`, `Argon2PasswordVerifier`, `JoseAccessTokenSigner` + `SupabaseSessionRepository`, `EmailServiceNewSessionMailer` | `auth-sign-in.int-spec.ts`         |
| 5   | `POST /api/v1/auth/sign-out`            | `SignOutRequestHandler`            | `SignOut`              | `SessionService.revoke`                                                                 | `SupabaseSessionRepository`                                                                                                                      | `auth-sign-out.int-spec.ts`        |
| 6   | `POST /api/v1/auth/confirm-account`     | `ConfirmAccountRequestHandler`     | `ConfirmAccount`       | `ConfirmationRepository`, `SessionService.issue`, `TokenHasher`                         | `SupabaseConfirmationRepository`, `JoseAccessTokenSigner` + `SupabaseSessionRepository`, `CryptoTokenHasher`                                     | `auth-confirm-account.int-spec.ts` |
| 7   | `POST /api/v1/auth/resend-confirmation` | `ResendConfirmationRequestHandler` | `ResendConfirmation`   | `ConfirmationRepository`, `TokenGenerator`, `ConfirmationMailer`                        | `SupabaseConfirmationRepository`, `CryptoTokenGenerator`, `EmailServiceConfirmationMailer`                                                       | `auth-confirm-account.int-spec.ts` |
| 8   | `GET /api/v1/auth/session`              | `GetSessionRequestHandler`         | `GetSession`           | nenhum (recebe `ActiveSession` já validada pelo `AuthGuard`)                            | —                                                                                                                                                | `auth-sessions.int-spec.ts`        |

Decorators de borda preservados por handler:

| Handler                            | Rota/método                    | `@Public` | `@HttpCode` | `@RateLimit`                | Sessão            | Telemetria                              |
| ---------------------------------- | ------------------------------ | --------- | ----------- | --------------------------- | ----------------- | --------------------------------------- |
| `SignUpRequestHandler`             | `@Post("sign-up")`             | sim       | 201         | `("sign-up")`               | —                 | `sign_up`                               |
| `ForgotPasswordRequestHandler`     | `@Post("forgot-password")`     | sim       | 202         | `("forgot-password")`       | —                 | `forgot_password`                       |
| `ResetPasswordRequestHandler`      | `@Post("reset-password")`      | sim       | 204         | `("reset-password")`        | —                 | `reset_password`                        |
| `SignInRequestHandler`             | `@Post("sign-in")`             | sim       | 200         | `("sign-in-ip", "sign-in")` | —                 | `sign_in`                               |
| `SignOutRequestHandler`            | `@Post("sign-out")`            | não       | 204         | —                           | `@CurrentSession` | `sign_out`                              |
| `ConfirmAccountRequestHandler`     | `@Post("confirm-account")`     | sim       | 200         | `("confirm-account")`       | —                 | `confirm_account`                       |
| `ResendConfirmationRequestHandler` | `@Post("resend-confirmation")` | sim       | 202         | `("resend-confirmation")`   | —                 | `resend_confirmation`                   |
| `GetSessionRequestHandler`         | `@Get("session")`              | não       | —           | —                           | `@CurrentSession` | — (GET não entra na telemetria de auth) |

### `email` (2 endpoints)

| #   | Rota                                  | Request handler (novo)              | Use case (1:1)        | Port (domain)                   | Adaptador (infrastructure) | Teste de contrato   |
| --- | ------------------------------------- | ----------------------------------- | --------------------- | ------------------------------- | -------------------------- | ------------------- |
| 1   | `GET /api/v1/test-support/emails?to=` | `ListCapturedEmailsRequestHandler`  | `ListCapturedEmails`  | `CapturedEmailRepository.list`  | `CapturedEmailStore`       | `email.int-spec.ts` |
| 2   | `DELETE /api/v1/test-support/emails`  | `ClearCapturedEmailsRequestHandler` | `ClearCapturedEmails` | `CapturedEmailRepository.clear` | `CapturedEmailStore`       | `email.int-spec.ts` |

Ambos mantêm `@Public()` + `@UseGuards(CaptureOnlyGuard)` no controller; `GET` devolve `200 { emails }`; `DELETE` devolve `204`.

### `rate-limit` (sem endpoints próprios)

| Elemento                                                                             | Camada         | Contrato                                                    |
| ------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------- |
| `RateLimitPolicy`, `AUTH_RATE_LIMIT_POLICIES`, `RateLimitKeyBy`, `RateLimitPolicies` | domain         | mesmos nomes, números, janelas e `keyBy`                    |
| `buildRateLimitKeyParts`, `normalizeEmail`, `RateLimitKeyParts`                      | domain         | chave crua `JSON.stringify([route, policyName, ip, email])` |
| `evaluateRateLimit`, `RateLimitDecision`                                             | domain         | comparação `count <= limit` e `retryAfterSeconds`           |
| `RateLimitStore`, `RateLimitHit`, `KeyHasher`                                        | domain (ports) | mesmos métodos                                              |
| `UnknownRateLimitPolicyError`                                                        | domain         | erro de configuração, falha fechada                         |
| `CheckRateLimit`                                                                     | application    | um `execute` para N políticas, na ordem dada                |
| `InMemoryRateLimitStore`                                                             | infrastructure | mesmo teto, sweeps e eviction                               |
| `NodeCryptoKeyHasher`                                                                | infrastructure | SHA-256 hex de 64 caracteres                                |
| `RateLimitGuard`, `RateLimit`, `RATE_LIMIT_METADATA`                                 | interface      | mesmo 429, `Retry-After`, envelope e logs                   |

## Batches

### Batch 1 — `email`

**Objetivo:** dar ao módulo `email` o layout de camadas, tirar a infraestrutura da borda HTTP e separar os 2 endpoints, sem mudar 404/200/204, o filtro `?to=` nem o teto de 500 e-mails.

**Arquivos**

Criar (9):

- `apps/api/src/modules/email/domain/captured-emails-ports.ts` — `CapturedEmail` (read model) e `CapturedEmailRepository { list(filter): CapturedEmail[]; clear(): void }`.
- `apps/api/src/modules/email/application/use-cases/list-captured-emails.use-case.ts` — `ListCapturedEmails.execute({ to?: string }): CapturedEmail[]`.
- `apps/api/src/modules/email/application/use-cases/list-captured-emails.use-case.spec.ts` — filtra por `to` normalizado e devolve cópia.
- `apps/api/src/modules/email/application/use-cases/clear-captured-emails.use-case.ts` — `ClearCapturedEmails.execute(): void`.
- `apps/api/src/modules/email/application/use-cases/clear-captured-emails.use-case.spec.ts` — limpa o store.
- `apps/api/src/modules/email/interface/guards/capture-only.guard.ts` — `CaptureOnlyGuard` injetando `EMAIL_CONFIG` tipado por `domain/email-config`.
- `apps/api/src/modules/email/interface/request-handlers/list-captured-emails.request-handler.ts` — `@Controller("test-support/emails")`, `@Get()`, `@Public()`, `@UseGuards(CaptureOnlyGuard)`, `@Query("to")`, 1 `@Inject(ListCapturedEmails)`.
- `apps/api/src/modules/email/interface/request-handlers/clear-captured-emails.request-handler.ts` — `@Delete()`, `@HttpCode(204)`, `@Public()`, `@UseGuards(CaptureOnlyGuard)`, 1 `@Inject(ClearCapturedEmails)`.
- `apps/api/src/modules/email/testing/index.ts` — superfície de teste: `CapturedEmail`, `capturedEmailStore` (se necessário), `getCapturedEmails`, `clearCapturedEmails`, `EMAIL_PROVIDER`, `EMAIL_CONFIG`.

Mover (2):

- `infrastructure/email-config.ts` → `domain/email-config.ts` (mesmo conteúdo; importa `EmailAddress` de `./email-message`).
- `infrastructure/email-config.spec.ts` → `domain/email-config.spec.ts` (import `./email-config` inalterado).

Apagar (1):

- `interface/test-support-emails.controller.ts` (substituído pelos 2 handlers + guard).

Editar (5 src):

- `email.tokens.ts` — adicionar `CAPTURED_EMAIL_REPOSITORY`.
- `email.module.ts` — `controllers: [ListCapturedEmailsRequestHandler, ClearCapturedEmailsRequestHandler]`; providers: `CaptureOnlyGuard`, `{ provide: CAPTURED_EMAIL_REPOSITORY, useValue: capturedEmailStore }`, `ListCapturedEmails` e `ClearCapturedEmails` (factory com o port), manter `CapturedEmailStore`, `EMAIL_CONFIG`, `EMAIL_PROVIDER` e `EmailService`.
- `index.ts` — exportar só `EmailModule`, `EmailService`, `renderEmailLayout`/tipos, `EmailDeliveryError`, `EmailMessage`, `SafeHtml`/`html`/`escapeHtml`, `EmailConfig`/`parseEmailConfig` (agora de `domain/`). Remover helpers de captura.
- `infrastructure/capture/captured-email-store.ts` — importar `CapturedEmail` de `domain/captured-emails-ports` e implementar `CapturedEmailRepository` (`list`/`clear` já existem); manter `add`, teto de 500, cópia defensiva e o singleton.
- `infrastructure/create-email-provider.ts` — importar `EmailConfig` de `../domain/email-config`.

Editar (8 testes, só import):

- `apps/api/test/email.int-spec.ts` — `clearCapturedEmails`/`getCapturedEmails` de `../src/modules/email/testing`.
- `apps/api/test/auth-confirm-account.int-spec.ts`, `auth-forgot-password.int-spec.ts`, `auth-hash-protection.int-spec.ts`, `auth-observability.int-spec.ts`, `auth-reset-password.int-spec.ts`, `auth-sign-in.int-spec.ts`, `auth-sign-up.int-spec.ts` — helpers de captura e `EMAIL_PROVIDER` de `../src/modules/email/testing`.

**Mapeamento:** tabela de `email` em §8.

**Módulo Nest:** 2 controllers, 2 use cases, 1 token novo; nenhum `APP_GUARD` novo; `EmailModule` continua `OnApplicationShutdown` e exporta só `EmailService`.

**Testes:** unit `src/modules/email` (inclui os 2 specs novos e os movidos); integração `test/email.int-spec.ts` e os 7 `auth-*.int-spec.ts` (só para provar que os imports de teste continuam válidos). Nenhuma asserção muda.

**Riscos e rollback**

- Risco: `email-boundaries.spec.ts` falhar se algum arquivo fora do módulo importar `modules/email/testing` por caminho errado — mitigado por `testing/index.ts` na raiz e imports relativos corretos.
- Risco: o singleton `capturedEmailStore` deixar de ser o mesmo objeto do provider — mitigado por `useValue: capturedEmailStore` e pelo `email.int-spec.ts`.
- Rollback: `git restore --source=HEAD -- apps/api/src/modules/email apps/api/test` e apagar os 9 arquivos novos.

**Critério de aceite**

- [ ] `cd apps/api && bunx vitest run src/modules/email` verde.
- [ ] `cd apps/api && bunx vitest run --config vitest.integration.config.mts test/email.int-spec.ts` verde.
- [ ] `cd apps/api && bunx tsc --noEmit` sem erro.
- [ ] `GET`/`DELETE /api/v1/test-support/emails` mantêm 404 fora do `capture`, 200 `{ emails }` e 204.
- [ ] `audit-slices.mjs` não reporta mais E1–E5.

### Batch 2 — `rate-limit`

**Objetivo:** transformar `rate-limit` em fatia completa, mover a decisão de limite e o cálculo de `Retry-After` para domínio/application e deixar o guard apenas adaptando HTTP.

**Arquivos**

Criar (6):

- `apps/api/src/modules/rate-limit/domain/rate-limit-errors.ts` — `UnknownRateLimitPolicyError` (mensagem `Unknown rate limit policy "<nome>".`).
- `apps/api/src/modules/rate-limit/domain/rate-limit-decision.ts` — `RateLimitDecision` (união `allowed | limited | unavailable`) e `evaluateRateLimit(policy, hit, nowMs)` puro (`max(1, ceil((resetAt - now)/1000))`).
- `apps/api/src/modules/rate-limit/domain/rate-limit-decision.spec.ts` — under/over limit, retry mínimo 1, janela expirada.
- `apps/api/src/modules/rate-limit/application/use-cases/check-rate-limit.use-case.ts` — `CheckRateLimit.execute({ policyNames, route, ip, email })`: resolve a política (ou lança `UnknownRateLimitPolicyError`), monta a chave, chama o store, decide e para na primeira política estourada; erro do store → `unavailable`.
- `apps/api/src/modules/rate-limit/application/use-cases/check-rate-limit.use-case.spec.ts` — ordem das políticas, short-circuit, `unavailable` e política desconhecida.
- `apps/api/src/modules/rate-limit/infrastructure/node-crypto-key-hasher.ts` — `NodeCryptoKeyHasher implements KeyHasher` com `createHash("sha256").update(raw).digest("hex")`.

Mover (9):

- `rate-limit.policies.ts` → `domain/rate-limit-policy.ts` (mesmos nomes e números).
- `rate-limit.policies.spec.ts` → `domain/rate-limit-policy.spec.ts` (import `./rate-limit-policy`).
- `rate-limit-store.ts` → `domain/rate-limit-ports.ts` (`RateLimitStore`, `RateLimitHit` + novo `KeyHasher`).
- `rate-limit.key.ts` → `domain/rate-limit-key.ts` — separar `buildRateLimitKeyParts` (JSON puro) de `buildRateLimitKey(policy, parts, hasher)` (composição com o port); `normalizeEmail` inalterado.
- `rate-limit.key.spec.ts` → `domain/rate-limit-key.spec.ts` — **mesmas asserções**; só o import muda e o spec cria `const hasher = new NodeCryptoKeyHasher()` e um alias local `key(policy, parts)` para injetar o hasher (DI, não asserção).
- `in-memory-rate-limit-store.ts` → `infrastructure/in-memory-rate-limit-store.ts` (mesmo conteúdo; import do port em `../domain/rate-limit-ports`).
- `in-memory-rate-limit-store.spec.ts` → `infrastructure/in-memory-rate-limit-store.spec.ts` (import `./in-memory-rate-limit-store`).
- `rate-limit.guard.ts` → `interface/guards/rate-limit.guard.ts` — só lê metadata, monta `route`/`ip`/`email`, chama `CheckRateLimit`, traduz `limited` em header + log `rate_limited` + `ApiException(429, "RATE_LIMITED", ...)` e `unavailable` em log `rate_limit_store_error` + `true`.
- `rate-limit.decorator.ts` → `interface/decorators/rate-limit.decorator.ts` (`RATE_LIMIT_METADATA` e assinatura inalterados).

Editar (3 src):

- `rate-limit.tokens.ts` — manter `RATE_LIMIT_STORE`, `RATE_LIMIT_POLICIES`, `RATE_LIMIT_CLOCK` e `RateLimitClock`; adicionar `RATE_LIMIT_KEY_HASHER`.
- `rate-limit.module.ts` — providers: `CheckRateLimit` (factory com store, políticas, key hasher e clock), `NodeCryptoKeyHasher`; manter `APP_GUARD` com comentário atualizado (ordem garantida por `AppModule`); exports inalterados.
- `index.ts` — manter a superfície atual (`RateLimit`, `RateLimitModule`, `AUTH_RATE_LIMIT_POLICIES`, tipos, tokens, `RateLimitStore`) e apontar para os novos caminhos.

Editar (1 fora dos gates):

- `load/diagnostics/rate-limit-store-cost.cjs` — `require` de `apps/api/dist/modules/rate-limit/infrastructure/in-memory-rate-limit-store.js`.

**Mapeamento:** tabela de `rate-limit` em §8.

**Módulo Nest:** `APP_GUARD` permanece em `RateLimitModule` (decisão 2). `RateLimitGuard` passa a injetar `CheckRateLimit` (e `Reflector`), não mais store/políticas/clock diretamente. Overrides de teste (`RATE_LIMIT_POLICIES`, `RATE_LIMIT_CLOCK`, `RATE_LIMIT_STORE`) continuam funcionando porque os providers mantêm os mesmos tokens.

**Testes:** unit `src/modules/rate-limit`; integração `test/rate-limit.int-spec.ts` e `test/auth-hash-protection.int-spec.ts` (ordem das políticas e 429). Nenhuma asserção muda; `rate-limit.key.spec.ts` só ganha o hasher por DI.

**Riscos e rollback**

- Risco: mudar a ordem de avaliação das políticas (deve ser a ordem do decorator, com short-circuit). Mitigado por spec do `CheckRateLimit` e por `rate-limit.int-spec.ts`.
- Risco: fail-open virar fail-closed se o catch envolver a decisão. Mitigado por teste de store lançando.
- Risco: `dist` mudar de caminho e quebrar o diagnóstico de carga. Mitigado pelo ajuste do script e por `bun run build` no QA.
- Rollback: `git restore --source=HEAD -- apps/api/src/modules/rate-limit load/diagnostics/rate-limit-store-cost.cjs` e apagar os 6 arquivos novos.

**Critério de aceite**

- [ ] `cd apps/api && bunx vitest run src/modules/rate-limit` verde.
- [ ] `cd apps/api && bunx vitest run --config vitest.integration.config.mts test/rate-limit.int-spec.ts` verde.
- [ ] `429` com `Retry-After >= 1`, envelope `RATE_LIMITED` e `details: [{ retryAfterSeconds }]` inalterados.
- [ ] Store lançando → request passa e log `rate_limit_store_error` (sem IP/e-mail/chave).
- [ ] `audit-slices.mjs` não reporta mais R1–R6 nem R8–R13; R7 documentado como decisão.

### Batch 3 — `auth`

**Objetivo:** dividir os 8 endpoints em 8 request handlers 1:1, criar `GetSession`, mover `SessionService` para `application/services/`, introduzir `TokenHasher`, remover HTTP do `HashLimiter` e fechar a superfície pública do módulo.

**Arquivos**

Criar (12):

- `apps/api/src/modules/auth/interface/request-handlers/sign-up.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/forgot-password.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/reset-password.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/sign-in.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/sign-out.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/confirm-account.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/resend-confirmation.request-handler.ts`
- `apps/api/src/modules/auth/interface/request-handlers/get-session.request-handler.ts`
- `apps/api/src/modules/auth/application/use-cases/get-session.use-case.ts` — `GetSession.execute(session: ActiveSession): SessionUser`.
- `apps/api/src/modules/auth/application/use-cases/get-session.use-case.spec.ts`
- `apps/api/src/modules/auth/infrastructure/crypto-token-hasher.ts` — `CryptoTokenHasher implements TokenHasher`, delegando para `hashToken`.
- `apps/api/src/config/auth-secret.ts` — `MIN_JWT_SECRET_LENGTH = 32` (mesmo comentário de 256 bits).

Mover (30):

- `application/{sign-up,sign-in,sign-out,confirm-account,resend-confirmation,reset-password,request-password-reset}.ts` → `application/use-cases/<fluxo>.use-case.ts` (7).
- Os 7 specs correspondentes → `application/use-cases/<fluxo>.use-case.spec.ts` (7).
- `application/session.service.ts` + `.spec.ts` → `application/services/` (2).
- `interface/auth.guard.ts` + `.spec.ts` → `interface/guards/` (2).
- `interface/session.presenter.ts` → `interface/presenters/session.presenter.ts` (1).
- `interface/{sign-up,sign-in,forgot-password,reset-password,confirm-account,resend-confirmation}.dto.ts` → `interface/dto/` (6).
- Os 5 specs de DTO existentes → `interface/dto/` (5).

Apagar (1):

- `interface/auth.controller.ts`.

Editar (10 src):

- `domain/auth-errors.ts` — adicionar `HashCapacityExceededError` com `retryAfterSeconds` (nome, mensagem fixa e sem PII).
- `domain/auth-ports.ts` — adicionar `TokenHasher { hash(token: string): string }`.
- `domain/session-rules.ts` — remover `MIN_JWT_SECRET_LENGTH` (vai para `config/auth-secret.ts`).
- `infrastructure/hash-limiter.ts` — importar e lançar `HashCapacityExceededError(this.retryAfterSeconds())`; remover import de `common/`.
- `infrastructure/jose-access-token-signer.ts` — importar `MIN_JWT_SECRET_LENGTH` de `../../../config/auth-secret`.
- `auth.tokens.ts` — adicionar `TOKEN_HASHER`.
- `auth.module.ts` — `controllers` com os 8 handlers; providers com `TOKEN_HASHER`/`CryptoTokenHasher`, `GetSession`, e factories de `ConfirmAccount`/`ResetPassword` recebendo o port; manter `APP_GUARD` do `AuthGuard` no fim da lista.
- `index.ts` — exportar `AuthModule` e `createAuthTelemetryMiddleware`.
- `config/environment.ts` — importar `MIN_JWT_SECRET_LENGTH` de `./auth-secret`.
- `bootstrap.ts` — importar `createAuthTelemetryMiddleware` de `./modules/auth`.

Editar (4 testes):

- `apps/api/test/auth-hash-protection.int-spec.ts` — `HashCapacityExceededError` no fake runner (import de `../src/modules/auth/domain/auth-errors`); asserções 503/`Retry-After`/`SERVICE_BUSY` intactas.
- `apps/api/test/auth-sessions.int-spec.ts` e `auth-sign-out.int-spec.ts` — caminho de `SessionService` para `application/services/session.service` (import apenas).
- `apps/api/src/modules/auth/infrastructure/hash-limiter.spec.ts` — tipo asserido passa a `HashCapacityExceededError`; `getStatus()`/`code` saem (o adaptador não conhece HTTP); `retryAfterSeconds >= 1` permanece. **Única mudança de asserção do plano**, justificada em §11.

Ajustes de DI nos specs movidos (sem mudar asserção):

- `confirm-account.use-case.spec.ts` e `reset-password.use-case.spec.ts` — passar `{ hash: (token) => \`hash:${token}\` }` no lugar da função.
- `session.service.spec.ts`, `sign-in.use-case.spec.ts`, `sign-out.use-case.spec.ts` — ajustar caminhos relativos (`../../domain/...`, `../../infrastructure/...`, `../services/session.service`).

**Mapeamento:** tabelas de `auth` em §8.

**Módulo Nest:** `controllers` com 8 handlers; `providers` com os 7 use cases existentes + `GetSession`, `SessionService`, `TOKEN_HASHER` e os adaptadores atuais. `AuthGuard` continua global via `APP_GUARD`; a ordem `RateLimitGuard` → `AuthGuard` não muda (nenhum toque em `app.module.ts`).

**Testes:** unit `src/modules/auth` (use cases, domínio, infra, guard, middleware, DTOs); integração `test/auth-*.int-spec.ts`. Nenhuma asserção de contrato HTTP muda.

**Riscos e rollback**

- Risco: perder um decorator na divisão (status, `@Public`, `@RateLimit`, `@HttpCode`, `@CurrentSession`). Mitigado pela tabela de decorators em §8 e pelos int specs.
- Risco: `503` virar `500` se um dos 3 handlers não mapear `HashCapacityExceededError`. Mitigado por `auth-hash-protection.int-spec.ts`.
- Risco: `HashLimiter` saturar em `confirm-account` (não há hash de senha) — não se aplica.
- Risco: ciclo de import `config → auth` — evitado por `config/auth-secret.ts`.
- Rollback: `git restore --source=HEAD -- apps/api/src apps/api/test` e apagar os 12 arquivos novos; o `auth.controller.ts` volta com o restore.

**Critério de aceite**

- [ ] `cd apps/api && bunx vitest run src/modules/auth` verde.
- [ ] `cd apps/api && bunx vitest run --config vitest.integration.config.mts test/auth-sign-up.int-spec.ts test/auth-sign-in.int-spec.ts test/auth-sign-out.int-spec.ts test/auth-confirm-account.int-spec.ts test/auth-forgot-password.int-spec.ts test/auth-reset-password.int-spec.ts test/auth-sessions.int-spec.ts test/auth-hash-protection.int-spec.ts test/auth-observability.int-spec.ts` verde.
- [ ] `cd apps/api && bunx tsc --noEmit` sem erro.
- [ ] 8 handlers com 1 rota e 1 `@Inject` cada; `auth.controller.ts` não existe.
- [ ] `503 SERVICE_BUSY` com `Retry-After` preservado nos 3 endpoints que hasheiam.
- [ ] `bootstrap.ts` e `config/environment.ts` não importam caminho profundo de `modules/auth`.

### Batch 4 — documentação e ADR

**Objetivo:** registrar a decisão estrutural e alinhar `.docs` ao código, fechando o gate de documentação da skill.

**Arquivos**

Criar (1):

- `.adrs/0014-request-handler-por-endpoint.md` — contexto, decisão (1 endpoint = 1 request handler = 1 use case), alternativas (controller por domínio; controller + service orquestrador), consequências (mais arquivos, DI explícita, testes por fluxo) e impacto em `auth`/`email`/`rate-limit`. Segue `.docs/RULES.md` §5.

Editar (2):

- `.docs/DEVELOPMENT.md`
  - §2.1: trocar “Controllers” por “Request handlers (um por endpoint)” na linha de `interface`; acrescentar o layout `application/use-cases/`, `application/services/`, `interface/request-handlers/`, `interface/dto/`, `interface/presenters/`, `interface/guards/`.
  - §2.2: bullet “cada endpoint tem um request handler; cada handler injeta exatamente um use case; serviço de aplicação só para capacidade reutilizável”.
  - §5: “Request handler fino: recebe DTO, chama **um** caso de uso, devolve presenter.”
  - §13.4: atualizar caminhos (`domain/rate-limit-policy.ts`, `domain/rate-limit-key.ts`, `infrastructure/in-memory-rate-limit-store.ts`, `interface/guards/rate-limit.guard.ts`), citar `CheckRateLimit` e manter números/ordem.
  - §13.5: citar os 8 handlers, `GetSession` para `GET /auth/session` e `MIN_JWT_SECRET_LENGTH` em `config/auth-secret.ts`.
- `.docs/ARCHITECTURE.md`
  - §4.2: exemplos com `SignInRequestHandler`/`SignIn` e o layout de subpastas.
  - §4.4: trocar “chamado pelo `AuthController`” por “chamado pelo request handler do fluxo”.
  - §4.5: `parseEmailConfig` em `domain`; `interface` com 2 handlers; port `CapturedEmailRepository`.
  - §4.6/§4.7: `application` com 8 use cases + `SessionService` em `services/`; `interface` com 8 handlers; `TokenHasher`/`HashCapacityExceededError`; `MIN_JWT_SECRET_LENGTH` em `config/auth-secret.ts`.

**Critério de aceite**

- [ ] ADR 0014 existe, segue o template e está em pt-BR.
- [ ] Nenhuma referência a `auth.controller.ts` ou aos caminhos antigos de `rate-limit` sobra em `.docs/`.
- [ ] `node .claude/skills/refactor-slices/scripts/audit-slices.mjs` reporta 0 violações além das 3 exceções conhecidas (§11).

## Comportamento preservado

Contratos que **não** podem mudar (verificação obrigatória no QA):

- **Rotas e métodos:** as 8 de `auth` e as 2 de `test-support/emails`, com prefixo `api/v1`.
- **Status:** 201 sign-up; 202 forgot/resend; 204 reset/sign-out/delete; 200 sign-in/confirm/session/get emails; 400 validação e token inválido; 401 credenciais/`UNAUTHENTICATED`; 403 `EMAIL_NOT_CONFIRMED`; 404 fora do `capture`; 429 `RATE_LIMITED`; 503 `SERVICE_BUSY`; 500 `INTERNAL_ERROR`.
- **DTOs e validações:** mesmos campos, `whitelist`/`forbidNonWhitelisted`, `@SameAs`, limites de `AUTH_LIMITS`, normalização de e-mail/nome.
- **Envelope de erro:** `{ error: { code, message, details } }`, mesmos códigos e mensagens (`EMAIL_ALREADY_REGISTERED`, `INVALID_CREDENTIALS`, `EMAIL_NOT_CONFIRMED`, `TOKEN_INVALID_OR_EXPIRED`, `SERVICE_BUSY`, `RATE_LIMITED`).
- **Telemetria:** `AUTH_OPERATIONS` e `AUTH_FAILURE_REASONS` iguais; `traceAuthOperation` em cada handler; middleware por segmento de URL; sem PII.
- **Rate limit:** 7 políticas com os mesmos números/janelas/`keyBy`; ordem do decorator; `RATE_LIMIT_METADATA`; chave `[route, policyName, ip, email]` com e-mail normalizado e SHA-256 hex; fail-open; logs sem IP/e-mail/chave; `APP_GUARD` do rate limit antes do `AuthGuard`.
- **Auth:** `@Public()` nas mesmas rotas; `AuthGuard` global; `@CurrentSession()`; JWT com `sub`/`sid`; sessão única por usuário; revogação idempotente; `AUTH_JWT_SECRET >= 32`.
- **SQL/RPC/migrations:** nenhuma alteração.
- **E-mail:** mesmos templates, assuntos, remetentes, `dispatch` depois do commit, timeout/retry, `drain`.
- **Dependências:** nenhuma nova.
- **Contadores em memória:** reiniciam no deploy por causa do novo namespace de rota da chave (documentado; não é contrato de teste).

## Exceções

| Exceção                                                                     | Tipo                                                 | Justificativa                                                                                                                                                                                                                             | Verificação                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `auth/application/services/session.service.ts`                              | `application-service-class` (medium, falso positivo) | Capacidade reutilizável (`issue`/`validate`/`authenticate`/`revoke`) usada por `SignIn`, `ConfirmAccount`, `SignOut` e `AuthGuard`; não é fluxo de endpoint                                                                               | `audit-slices.mjs --strict` continua apontando; registrado no QA |
| `email/application/email.service.ts`                                        | `application-service-class` (medium, falso positivo) | Capacidade de entrega (timeout, retry, `dispatch`, `drain`) usada por 4 mailers e pelo shutdown                                                                                                                                           | idem                                                             |
| `email/application/render-email-layout.ts`                                  | `application-without-execute` (low, falso positivo)  | Helper puro de renderização, sem orquestração                                                                                                                                                                                             | idem                                                             |
| Specs de `auth/application/` importando `jose`/`JoseAccessTokenSigner` (A7) | low, teste                                           | Os specs assertam o contrato do JWT (`decodeJwt`, 3 segmentos, `sid`); trocar por fake exigiria mudar asserções, o que a skill proíbe. O script ignora `.spec.ts`                                                                         | registrado no plano e no QA                                      |
| `interface/hash-limiter.spec.ts` com asserções de tipo                      | mudança de asserção justificada                      | O contrato do `HashLimiter` deixou de ser HTTP (era o defeito A4). As asserções HTTP (`getStatus` 503, `code SERVICE_BUSY`) saem do unit spec e o contrato HTTP continua coberto **sem alteração** por `auth-hash-protection.int-spec.ts` | rodar ambos os specs                                             |

Fatias `exception`: nenhuma. `rate-limit` é fatia real e foi refatorada; `test-support/emails` também não é exceção.

## Estratégia de testes

- **Durante cada batch (foco):** `cd apps/api && bunx vitest run <pasta-do-batch>` e `cd apps/api && bunx tsc --noEmit`. Para integração: `cd apps/api && bunx vitest run --config vitest.integration.config.mts test/<arquivo>.int-spec.ts`.
- **Após o batch 3 (regressão de contrato):** todos os `test/auth-*.int-spec.ts`, `test/email.int-spec.ts`, `test/rate-limit.int-spec.ts`, `test/api-conventions.int-spec.ts`.
- **No Agente 4 (gates completos):** `bun run lint`, `bun run check-types`, `bun run build`, `bun run test`, `bun run test:integration`, `bun run test:e2e` e o `audit-slices.mjs` (sem `--strict` = 0 violações novas; com `--strict` = apenas as 3 exceções conhecidas).
- **Regra:** teste só muda em import/caminho/DI. A única exceção é `hash-limiter.spec.ts` (§11). Se qualquer outro teste falhar por comportamento, o batch para e a divergência é registrada — não se ajusta a asserção.

## Documentação e ADR

Ver Batch 4. Resumo: ADR `0014-request-handler-por-endpoint.md`; `.docs/DEVELOPMENT.md` §2.1/§2.2/§5/§13.4/§13.5; `.docs/ARCHITECTURE.md` §4.2/§4.4/§4.5/§4.6/§4.7. `.docs/RULES.md` §9 e `AGENTS.md` já citam a skill; não precisam mudar.

## Arquivos previstos (resumo)

| Batch            | Criar  | Mover  | Apagar | Editar                 | Total   |
| ---------------- | ------ | ------ | ------ | ---------------------- | ------- |
| 1 — `email`      | 9      | 2      | 1      | 13 (5 src + 8 testes)  | 25      |
| 2 — `rate-limit` | 6      | 9      | 0      | 4 (3 src + 1 script)   | 19      |
| 3 — `auth`       | 12     | 30     | 1      | 14 (10 src + 4 testes) | 57      |
| 4 — docs/ADR     | 1      | 0      | 0      | 2                      | 3       |
| **Total**        | **28** | **41** | **2**  | **33**                 | **104** |

## Riscos e rollback (global)

- **Risco:** regressão silenciosa de status/decorator na divisão do `auth` → mitigação: tabela de decorators + int specs inalterados; rollback do batch 3 isolado.
- **Risco:** `503` deixar de ser `SERVICE_BUSY` → mitigação: mapeamento em 3 handlers + `auth-hash-protection.int-spec.ts`; rollback do batch 3.
- **Risco:** rate limit mudar ordem/fail-open → mitigação: `CheckRateLimit` com specs + `rate-limit.int-spec.ts`; rollback do batch 2.
- **Risco:** import de teste quebrado após mover arquivos → mitigação: rodar os int specs afetados no próprio batch; rollback do batch.
- **Risco:** `dist` do store mudar e quebrar `load/diagnostics` → mitigação: script ajustado e `bun run build` no QA.
- **Como reverter:** nada é commitado durante a implementação. Para um batch: `git restore --source=HEAD -- <caminhos do batch>` e apagar os arquivos criados listados no batch. Para o run inteiro: `git restore --source=HEAD -- apps/api .docs .adrs load` e remover os arquivos não rastreados criados pelo plano. Nunca usar `reset --hard`, `rebase` ou `amend`.

## Se um batch falhar

1. Parar o batch no primeiro teste que falhar por comportamento (não por import/DI).
2. Registrar em `03-execution.md` o comando, a saída e a divergência.
3. Não relaxar teste, não usar `any`/`@ts-ignore`/`eslint-disable`, não pular gate.
4. Reverter o batch (§14) e marcar `blocked`; batches seguintes que dependem dele não começam.
5. Se a falha for de import/DI esperada, corrigir o caminho e rodar o teste focado de novo.

## Critério de pronto

- [ ] `email`, `rate-limit` e `auth` têm as 4 camadas e nenhum arquivo proibido na raiz (só `index.ts`, `*.module.ts`, `*.tokens.ts`, `*.spec.ts`).
- [ ] 10 endpoints com 10 request handlers, cada um com exatamente 1 `@Inject` de use case.
- [ ] Nenhum use case com mais de um `execute`; nenhum handler acessa `infrastructure` ou banco.
- [ ] `HashLimiter` não importa `common/`; `HashCapacityExceededError` mapeado para 503 nos 3 handlers.
- [ ] `rate-limit` com `CheckRateLimit`, `RateLimitStore`/`KeyHasher` em domain e adaptadores em infrastructure.
- [ ] `email/testing/index.ts` é a única superfície de teste de captura; barrel principal sem helpers de infraestrutura.
- [ ] `audit-slices.mjs` sem violações novas; `--strict` apenas com as 3 exceções de §11.
- [ ] Gates de `QA.md` §3 verdes: `bun run lint`, `bun run check-types`, `bun run build`, `bun run test`, `bun run test:integration`, `bun run test:e2e`.
- [ ] `.adrs/0014-request-handler-por-endpoint.md` criado; `.docs/DEVELOPMENT.md` e `.docs/ARCHITECTURE.md` atualizados.
- [ ] `package.json`/`bun.lock` inalterados.
- [ ] `git status` limpo além de `.plans/` (versionado) e do run directory (ignorado).

## Perguntas abertas

| Pergunta                                                                                                                                        | Impacto                                                              | Bloqueante?                                                   | Quem decide              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| O namespace da chave de rate limit pode mudar de `AuthController.<metodo>` para `<Handler>.handle` (contadores em memória reiniciam no deploy)? | Nenhum contrato HTTP; só o namespace interno da chave                | Não — decisão tomada e documentada                            | Planner + revisor humano |
| O `APP_GUARD` do rate limit fica em `RateLimitModule` (ordem documentada) ou migra para `AppModule`?                                            | Ordem `RateLimitGuard` → `AuthGuard`; `app.module.ts` fora do escopo | Não — decisão tomada: fica no módulo                          | Orquestrador             |
| `MIN_JWT_SECRET_LENGTH` vive em `config/auth-secret.ts` (proposto) ou continua em `auth/domain/session-rules.ts`?                               | Ciclo `config → auth` e pureza do domínio                            | Não — decisão tomada: `config/auth-secret.ts`                 | Planner + revisor humano |
| As 3 exceções de `--strict` e a exceção A7 continuam aceitas?                                                                                   | Gate de arquitetura                                                  | Não — já aceitas pela auditoria/checklist; registradas em §11 | QA / revisor humano      |
