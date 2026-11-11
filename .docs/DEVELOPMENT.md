# Desenvolvimento

> **Público:** qualquer pessoa ou agente que altere código.
> Aplique estas regras em toda mudança. Elas complementam `ARCHITECTURE.md` (estrutura) e `QA.md` (validação).

## 1. Princípios

| Princípio              | Como aplicar                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **KISS**               | A solução mais simples que atende ao requisito. Sem abstração preventiva.                                                       |
| **DRY**                | Não duplique **conhecimento**: regra de negócio, validação, contrato e configuração vivem em um só lugar.                       |
| **WET (com critério)** | Duas ocorrências concretas podem ser mantidas separadas até o conceito ficar claro. Abstração errada custa mais que duplicação. |
| **SOLID**              | Responsabilidades pequenas, dependência de interfaces (ports), sem acoplamento a detalhes.                                      |
| **Clean Code**         | Nomes que revelam intenção, funções curtas, sem comentários óbvios, sem código morto.                                           |

> **DRY e WET não se contradizem:** DRY vale para conhecimento; WET é tolerado para estrutura acidental. Só extraia quando houver um conceito estável e reutilizado.

## 2. Arquitetura de código

### 2.1 Backend (`apps/api`)

Cada domínio é uma fatia vertical com quatro camadas:

| Camada           | Contém                                                       | Não contém                |
| ---------------- | ------------------------------------------------------------ | ------------------------- |
| `domain`         | Entidades, value objects, regras, ports                      | Framework, HTTP, SQL, SDK |
| `application`    | Casos de uso, orquestração, transações                       | Detalhes de banco ou HTTP |
| `infrastructure` | Repositórios, clients, filas, storage, LLM, conectores       | Regra de negócio          |
| `interface`      | Request handlers (um por endpoint), DTOs, guards, presenters | Acesso direto ao banco    |

Dependências apontam para dentro: `interface → application → domain`; `infrastructure` implementa ports de `domain`/`application`.

Layout de cada fatia (decisão no ADR `0014`):

```text
apps/api/src/modules/<dominio>/
  <dominio>.module.ts, <dominio>.tokens.ts, index.ts   # só estes arquivos na raiz da fatia
  domain/                  # regras puras, erros tipados e ports (`<fluxo>-ports.ts`)
  application/
    use-cases/             # <fluxo>.use-case.ts: uma classe, um fluxo, um `execute`
    services/              # só capacidade reutilizável (ex.: `SessionService`), nunca um fluxo
  infrastructure/          # adaptadores dos ports
  interface/
    request-handlers/      # <fluxo>.request-handler.ts: uma classe, um endpoint, um caso de uso
    dto/  presenters/  guards/  decorators/
```

### 2.2 Vertical slices

- Organize por domínio, não por tipo global (`controllers/`, `services/` na raiz).
- **Um endpoint, um request handler, um caso de uso:** cada endpoint HTTP tem uma classe em `interface/request-handlers/` que injeta **exatamente um** caso de uso; cada caso de uso é usado por um só handler. Dois endpoints com o mesmo comportamento usam dois casos de uso ou um serviço de capacidade em `application/services/`. O módulo Nest lista todos os handlers em `controllers`.
- Compartilhamento só em `apps/api/src/modules/shared`, quando usado por 2+ módulos e estável.
- Um módulo não importa outro módulo diretamente; se precisar, exponha um caso de uso ou um port.

### 2.3 Frontend

`apps/app` é uma SPA React + Vite (ADR 0001). Estrutura (criada com a spec `0004`):

```text
apps/app/src/
  features/<dominio>/   # componentes, hooks e chamadas da fatia
  lib/                  # clients, configuração, utilitários
  App.tsx, main.tsx     # composição e providers
```

- `App.tsx` e rotas compõem; não concentram regra de negócio.
- Primitivos visuais em `packages/ui`; composições na feature.
- Não crie uma camada `services/` genérica; use clients explícitos em `lib/`.
- Chamadas HTTP à API passam por `lib/api-client.ts` (`apiClient.post`): base `${VITE_API_URL}/api/v1`, JSON, erro tipado `ApiError { status, code, message, details }` (`status` 0 e `NETWORK_ERROR` quando a rede falha). A feature expõe um hook de mutation/query e traduz o `ApiError` em mensagens (exemplo: `features/auth/describe-sign-up-failure.ts`).
- Formulários: validação por função pura na feature, só como feedback antes do envio (a API é a fonte da regra); erros em texto junto ao campo, ligados por `aria-describedby`; não mostre erro no `blur` quando ele puder deslocar o botão de envio e engolir o clique.
- `apps/docs` segue o App Router do Next.js (Server Components por padrão; `"use client"` só na folha interativa).

## 3. TypeScript

- `strict: true` e `noUncheckedIndexedAccess: true` já estão no tsconfig base. Não relaxe.
- Proibido `any`. Use `unknown` e estreite o tipo.
- Prefira uniões discriminadas a flags booleanas.
- Use `import type` para tipos.
- Evite `as` e `!`; quando inevitável, comente a invariante.
- Valide dados externos na fronteira (HTTP, conector, env, storage). Não confie em payload de terceiro.
- Tipos de domínio não importam tipos de framework.

## 4. React e Next.js

**`apps/app` (React + Vite):**

- **TanStack Query** é o caminho para dados remotos (cache, mutations, estados de carregando/erro). O `QueryClientProvider` já envolve a árvore em `main.tsx`.
- Rotas vivem em `src/router.tsx` (TanStack Router, rotas em código): páginas públicas são filhas do grupo `/auth`, páginas privadas do grupo `/app` (ver §13.1). Layouts e páginas de composição ficam em `src/routes/`.
- Não use `useEffect` para carregar dado inicial; use query.
- Componentes só apresentam; regra de negócio fica na API ou em funções puras testáveis.
- Nunca coloque segredo, service role key ou token em código de cliente.
- Só variáveis `VITE_*` entram no bundle; trate-as como públicas. O `.env` é lido da raiz (`envDir`).
- Acesse o Supabase pelo cliente de `lib/supabase.ts` (só chave pública); dados sensíveis passam pela API.

**`apps/docs` (Next.js):**

- Server-first; `page.tsx` fina (composição e metadata).
- Use `next/font` para fontes e `next/image` para imagens.
- Defina `metadata` por rota e `lang="en-US"` (ver §13).
- Crie `loading.tsx` e `error.tsx` quando a rota tiver operação assíncrona relevante.

## 5. API (Nest.js)

- Request handler fino: recebe DTO, chama **um** caso de uso, devolve presenter.
- Validação de entrada com DTO/schema; rejeite payload inválido antes do caso de uso.
- Erros de domínio são mapeados para HTTP na camada de interface; não vaze stack trace.
- Nenhum acesso direto ao Supabase dentro do request handler.
- Toda integração externa tem timeout, retry limitado e erro tipado.
- **A API é fechada por padrão:** um `AuthGuard` global exige sessão em todo endpoint; só `@Public()` (`src/common/public.decorator.ts`) abre uma rota (hoje: `GET /api/v1/health`, `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/sign-in` e `/test-support/emails`, que já é 404 fora do `capture`). Endpoint novo não precisa de nada para ser protegido; para ler a pessoa logada use `@CurrentSession()` (ver §13.5). Autorização além da sessão (papéis) fica explícita no caso de uso.
- E-mail sai só por `EmailService` (`apps/api/src/modules/email`): o caso de uso chama `dispatch` **depois do commit**, para que falha do provedor não mude o resultado do request; use `send` só quando precisar do erro. Monte o corpo com `renderEmailLayout` e a tag `html` (ela escapa valores dinâmicos). Nunca importe SDK ou cliente de provedor fora do módulo `email` nem logue destinatário, assunto, corpo, link ou token.

## 6. Dados (PostgreSQL/Supabase)

- Migrations versionadas; schema não é alterado "na mão" em produção.
- Nomes de tabela/coluna em `snake_case`; tipos explícitos; FKs e índices justificados.
- Multi-tenant exige isolamento no banco (RLS) e teste cobrindo acesso cruzado.
- Service role key só no servidor.
- Acesso a dados na API: repositórios em `infrastructure` usam `@supabase/supabase-js` com a service role. O que exige transação vive em função SQL chamada por RPC (migration), com `revoke all on function ... from public, anon, authenticated` e `grant execute ... to service_role`. Tabelas com dado sensível: RLS ligada, **sem policies** e `revoke all` de `anon`/`authenticated`.
- Erro do banco vira `DataAccessError` (mensagem fixa, só operação e código): a mensagem do Postgres pode repetir valores como o e-mail. Concorrência se resolve no banco (índice único + `on conflict`), nunca com "consulta e depois insere".
- Migration nova: nome `<timestamp>_<descricao>.sql`, comentário de rollback no topo e `bun run db:migrate` para aplicar no Supabase local.
- Storage com URLs assinadas e validação de tipo/tamanho de arquivo.
- Dados pessoais: minimize coleta, não logue PII, defina retenção.

## 7. Erros, logs e observabilidade

- Logs estruturados (JSON, `pino`) com `requestId`, operação, duração e resultado. A API já gera `requestId` por request (header `x-request-id`).
- Não use `console.log` em código de produto; use o logger do serviço (`StructuredLogger`/`baseLogger` em `apps/api/src/observability/logger.ts`).
- Não logue token, senha, documento, conversa, conteúdo de fonte, headers, IP ou query string.
- Falha de conector não derruba a demanda inteira: registre, isole e informe a lacuna.
- A API exporta traces, métricas e logs por OpenTelemetry para o Grafana LGTM (ver `ARCHITECTURE.md` §4.4). Exportação nunca bloqueia nem derruba o request.
- Métricas mínimas a manter: latência, taxa de erro, throughput e, quando existirem, falhas por conector.
- **Operação de auth nova** (endpoint em `modules/auth`): acrescente-a a `AUTH_OPERATIONS` e ao mapa de endpoints de `auth-telemetry.middleware.ts`, e embrulhe o caso de uso com `traceAuthOperation` no request handler. Assim ela ganha contador, histograma, span e log `auth_operation` sem tocar na camada `application`. O catálogo de nomes e labels está em `ARCHITECTURE.md` §4.4.
- **Labels e atributos só de conjuntos fechados:** `operation`, `outcome` e `reason` nunca recebem texto vindo do cliente. Código de erro novo precisa entrar em `AUTH_FAILURE_REASONS` (senão vira `request_failed`) e no dashboard.
- **Telemetria sem PII e sem revelar contas:** nenhum e-mail, nome, senha, token, link, IP, `userId` ou `sid` em label, atributo ou log; o span de falha leva só o código de erro. Endpoint que responde igual com ou sem conta (`forgot-password`, `resend-confirmation`) deve registrar o mesmo resultado nos dois casos.
- Telemetria nunca decide a resposta: erro dentro do middleware de telemetria é engolido.
- **Acesso a dados novo:** todo `createClient` do `@supabase/supabase-js` na API recebe `global: { fetch: createInstrumentedFetch() }` (`observability/db-telemetry.ts`). Assim cada query ganha span, histograma e log de falha, por tabela ou função, sem tocar no repositório. Nome de tabela e de função SQL só com letras minúsculas, dígitos e `_`; outro formato vira `unknown` na telemetria.
- **Span, métrica e log de banco nunca levam o filtro, o corpo, o texto da query nem o resultado.** Filtro por e-mail ou `sid` vai na query string do PostgREST: é por isso que `url.full` e `url.query` são sobrescritos (`span-redaction.ts`). Instrumentação nova que grave URL, IP ou query precisa passar pelo mesmo cuidado.
- **Histograma de duração novo:** passe `advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS }`; sem isso o OpenTelemetry usa limites em milissegundos e o p95 em segundos não tem significado.
- **Regra de alerta nova:** acrescente-a ao `rondo-alerts.yaml` com `uid` de até 40 caracteres, `for`, `severity` e limiar; evento raro conta logs (Loki), não `increase()` de contador. O teste `grafana-assets.spec.ts` valida o arquivo.
- **Código novo que usa `argon2`:** passe a chamada por um `HashRunner` (o `HashLimiter` injetado por `HASH_LIMITER`), como fazem `Argon2PasswordHasher` e `Argon2PasswordVerifier`. Chamar `argon2.hash` ou `argon2.verify` direto contorna o limite de hashes simultâneos e volta a enfileirar o pool de threads inteiro. A fila cheia chega ao chamador como `ServiceBusyException` (503): não a transforme em "senha errada" nem em 500. `AUTH_HASH_CONCURRENCY` e `AUTH_HASH_QUEUE_LIMIT` são opcionais.

## 8. Acessibilidade e responsividade

- WCAG 2.2 AA é o piso, não um extra.
- Todo componente interativo funciona por teclado e tem foco visível.
- Inputs com label; erros em texto; imagens com `alt`.
- Layout validado em mobile, tablet e desktop.
- `prefers-reduced-motion` respeitado.
- Siga `DESIGN.md` para contraste e identidade visual.

## 9. Testes

Abordagem TDD: escreva o teste do comportamento antes ou junto da implementação.

| Nível      | Ferramenta         | Comando                    | Onde vive                                                 |
| ---------- | ------------------ | -------------------------- | --------------------------------------------------------- |
| Unitário   | Vitest             | `bun run test`             | `apps/app/src/**/*.test.tsx`, `apps/api/src/**/*.spec.ts` |
| Integração | Vitest + Supertest | `bun run test:integration` | `apps/api/test/*.int-spec.ts`                             |
| E2E        | Playwright         | `bun run test:e2e`         | `e2e/*.spec.ts`                                           |

Regras:

- Teste comportamento observável, não implementação.
- Use nomes que descrevam cenário e resultado.
- Não faça teste depender de dado real, rede externa ou ordem de execução.
- Bug corrigido ganha teste de regressão.
- Ao adicionar um novo tipo de teste ou workspace, crie o script real, adicione a task no `turbo.json` e atualize `QA.md`. Não invente comandos.
- Testes da API definem env fictícia em `apps/api/test/setup-env.ts`; não use chave real nem a service role.
- Teste que envolve e-mail roda com `EMAIL_PROVIDER=capture` (já definido em `setup-env.ts`) e lê as mensagens com `getCapturedEmails({ to })`; um processo separado (E2E) usa `GET /api/v1/test-support/emails?to=<endereço>` e `DELETE` no mesmo caminho para limpar. Nenhum teste envia e-mail real nem chama Mailtrap ou Resend.
- Teste de integração roda contra o **Supabase local** (`bun run infra:up` e `bun run db:migrate` antes): a `globalSetup` (`apps/api/test/support/global-setup.ts`) lê as chaves de `supabase status -o env` quando não estão no ambiente e falha com a instrução se o banco não estiver no ar. Use e-mails únicos (`uniqueEmail` de `test/support/supabase.ts`) e apague o que criou (`deleteUsersByEmail`); o banco é compartilhado. Teste unitário usa os fakes de `test/support/in-memory-auth.ts`.
- Testes de `AppModule` que sobrescrevem o `ConfigService` com um objeto fake precisam incluir `email`, `supabaseUrl`, `supabaseServiceRoleKey`, `authJwtSecret`, `authHashConcurrency` e `authHashQueueLimit` (exemplo em `apps/api/test/rate-limit.int-spec.ts`). `AUTH_JWT_SECRET` fictícia vem de `apps/api/test/setup-env.ts`.
- Rota de teste declarada num módulo de teste (`controllers: [Probe]`) é fechada como qualquer outra: marque com `@Public()` quando o teste não for de autenticação, ou use um token de `SessionService.issue` (ver `apps/api/test/auth-sessions.int-spec.ts`). Para semear um usuário confirmado sem passar por sign-up/sign-in use `seedConfirmedUser` de `apps/api/test/support/sessions.ts`; no E2E, `seedSignedInUser` de `e2e/support/session.ts` (usuários `e2e-session-*`, apagados no `globalTeardown`). Quando o teste precisa **entrar de verdade** (sign-in), a senha precisa ter hash Argon2id real: no integration, `argon2.hash` no `beforeAll` (ver `apps/api/test/auth-sign-in.int-spec.ts`); no E2E, `seedUserWithPassword` de `e2e/support/credentials.ts` (hash fixo da senha de teste `SEEDED_PASSWORD`, conta confirmada ou não). Cuidado com a cota de `POST /auth/sign-up` (5 por hora por IP, compartilhada por todos os specs de uma execução do Playwright): semeie a conta em vez de cadastrar. O e-mail de teste tem de caber no limite de 64 caracteres da parte local do `IsEmail` (rótulo curto).
- No SPA, `renderApp` de `apps/app/src/test/render-app.tsx` monta router e `QueryClient` como o `main.tsx`; use `stubSessionFetch` para responder `GET /auth/session` e grave o token em `localStorage` (`access_token`).

## 10. Dependências

- Instale no workspace consumidor, não na raiz, salvo ferramenta global do monorepo.
- Justifique a dependência no relatório final: problema, alternativa considerada e custo.
- Prefira a biblioteca já presente no stack antes de adicionar outra.
- Verifique licença e manutenção antes de adotar.
- Não atualize versões fora do escopo da tarefa.

## 11. Definição de pronto

Uma mudança só está pronta quando:

- [ ] O comportamento solicitado funciona e o escopo não foi extrapolado.
- [ ] `bun run lint` passa.
- [ ] `bun run check-types` passa.
- [ ] `bun run build` passa (quando a mudança afeta build).
- [ ] `bun run test` e, conforme o escopo, `test:integration` e `test:e2e` passam.
- [ ] Testes foram adicionados/atualizados quando há comportamento novo.
- [ ] Acessibilidade e responsividade foram verificadas em UI.
- [ ] Nenhum segredo, PII ou artefato gerado foi commitado.
- [ ] Plano e ADR foram registrados quando aplicável.
- [ ] `.docs` foi atualizado se a realidade mudou.
- [ ] O relatório final lista comandos realmente executados.

## 12. Anti-padrões proibidos

- `any`, `@ts-ignore` e `eslint-disable` sem justificativa.
- Regra de negócio em componente, request handler ou página.
- Chamada direta ao banco a partir do browser.
- `useEffect` para busca inicial de dados.
- Texto hardcoded de produto em primitivo de UI.
- Hex de cor espalhado em componentes.
- Copiar componente para "mudar só uma coisinha".
- Deixar `console.log`, código morto ou template demo em produção.
- Afirmar que um teste passou sem executá-lo.

## 13. Convenções de API e idioma

Definidas pela spec `0001-platform-routing-conventions` (ADRs `0003` e `0004`). Valem para todo código novo.

### 13.1 Espaço de URLs

| Zona                    | Prefixo     | Acesso                                                    | Onde vive                                                               |
| ----------------------- | ----------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Páginas de autenticação | `/auth/*`   | Públicas                                                  | Grupo `/auth` em `apps/app/src/router.tsx` (`AuthLayout`)               |
| Páginas do produto      | `/app/*`    | Privadas: exigem sessão (guard da spec `0005`, ver §13.5) | Grupo `/app` em `apps/app/src/router.tsx` (`AppLayout`)                 |
| API                     | `/api/v1/*` | Autenticação explícita, exceto `GET /api/v1/health`       | `apps/api`; o prefixo é aplicado em `configureApp` (`src/bootstrap.ts`) |

- `/` redireciona para `/app` (e, sem sessão, `/app` para `/auth/sign-in`); qualquer caminho sem rota mostra a página "Page not found".
- Página nova entra como filha de `authRoute` ou de `appRoute`; nunca direto na raiz.
- Páginas de autenticação existentes: `/auth/sign-in` (0007), `/auth/sign-up` (0004), `/auth/forgot-password` (0009), `/auth/confirm-account` e `/auth/resend-confirmation` (0006) e `/auth/reset-password` (0010). A confirmação é um `POST` disparado pela página (nunca um `GET`), uma única vez por visita. A página de reset tira o token do endereço ao carregar (`router.navigate` com `replace`) e o guarda só em memória; o aviso de sucesso do sign-in vem de `?reset=success` (`validateSearch` da rota `sign-in`).
- A API só serve `/api/v1/*`; fora dele responde 404 no envelope de erro. Uma `v2` exige ADR.

### 13.2 Contratos da API

- JSON em `camelCase`; colunas SQL em `snake_case`; datas em ISO 8601 UTC.
- Todo erro segue o envelope abaixo, sem stack trace (a stack vai só para o log estruturado):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is invalid.",
    "details": [{ "field": "email", "message": "email must be an email" }]
  }
}
```

| `code`              | HTTP | Quando                                                                    |
| ------------------- | ---- | ------------------------------------------------------------------------- |
| `VALIDATION_FAILED` | 400  | Payload inválido (DTO, campo extra, JSON malformado); `details` por campo |
| `UNAUTHENTICATED`   | 401  | Sem sessão válida                                                         |
| `FORBIDDEN`         | 403  | Sem permissão                                                             |
| `NOT_FOUND`         | 404  | Rota ou recurso inexistente                                               |
| `RATE_LIMITED`      | 429  | Limite de requisições excedido                                            |
| `REQUEST_FAILED`    | 4xx  | Outro erro de cliente sem código próprio                                  |
| `INTERNAL_ERROR`    | 500  | Falha inesperada                                                          |

- Erros de domínio lançam `ApiException(status, code, message, details)` (`src/common/api-exception.ts`); o `AllExceptionsFilter` global os serializa. Cada spec acrescenta seus códigos (ex.: `EMAIL_ALREADY_REGISTERED`) em `UPPER_SNAKE_CASE`.
- CORS: só a origem de `APP_URL` (obrigatória; a API não sobe sem uma URL `http(s)` válida). Métodos `GET/POST/PUT/PATCH/DELETE/OPTIONS`, headers `Authorization`, `Content-Type` e `X-Request-Id`; `X-Request-Id` e `Retry-After` são expostos ao browser. Origem diferente não recebe nenhum header CORS.

### 13.3 Idioma

- **en-US:** textos de interface, mensagens e códigos de erro da API, e-mails, rotas, identificadores, comentários e mensagens de log e de erro no código novo.
- **pt-BR:** `.docs/`, specs, planos, ADRs e mensagens de commit.
- Strings em pt-BR de código antigo migram quando o arquivo for alterado (hoje: `apps/app/src/lib/supabase.ts` e `apps/api/src/observability/telemetry.ts`).
- Não há biblioteca de i18n; adotar uma (vários idiomas) exige decisão e ADR.

### 13.4 Limite de requisições

Módulo `apps/api/src/modules/rate-limit/` (spec `0003`, ADR `0005`). O limite é **opt-in por rota**: o guard é global, mas só age em rota com `@RateLimit('<policy>')`; rota sem o decorator nunca é limitada (inclusive `GET /api/v1/health`).

Aplicar uma política a uma rota:

```ts
import { RateLimit } from "../rate-limit"; // ou o caminho relativo do módulo

@Post("sign-in")
@RateLimit("sign-in")
handle(@Body() body: SignInDto) { /* ... */ } // em SignInRequestHandler
```

- **Políticas:** `AUTH_RATE_LIMIT_POLICIES` em `domain/rate-limit-policy.ts` é o único lugar com os números (`sign-up` 5/60 min por IP; `sign-in-ip` 60/10 min por IP; `sign-in` 10/10 min por IP + e-mail; `confirm-account` 10/10 min por IP; `resend-confirmation` 3/10 min por IP + e-mail; `forgot-password` 3/10 min por IP + e-mail; `reset-password` 10/10 min por IP). Política nova entra nesse registro; nome inexistente no decorator faz a rota responder 500 (erro de programação, nunca rota sem proteção em silêncio).
- **Várias políticas:** `@RateLimit("sign-in-ip", "sign-in")` avalia na ordem dada e a primeira que estoura responde 429 (as seguintes nem são contadas); liste a mais ampla e barata primeiro.
- **Chave:** rota (`RequestHandler.handle`, montada pelo guard) + política + IP + (se a política é `ip-and-email`) o `email` string do corpo com trim e minúsculas, tudo em hash SHA-256 na memória. Sem `email` string, cai para a chave só por IP.
- **Resposta ao exceder:** 429, header `Retry-After` (segundos, inteiro >= 1) e envelope `RATE_LIMITED` com `details: [{ "retryAfterSeconds": n }]`. Janela fixa por chave.
- **Logs:** só `event: "rate_limited"` com o nome da política (e `rate_limit_store_error` quando o armazenamento falha). Nunca IP, e-mail ou chave.
- **Fail-open:** se o armazenamento lançar erro, a requisição passa.
- **Camadas:** `domain/` (`rate-limit-policy.ts`, `rate-limit-key.ts` com `buildRateLimitKeyParts` puro, `rate-limit-decision.ts` com `evaluateRateLimit` e o `Retry-After`, ports `RateLimitStore` e `KeyHasher` em `rate-limit-ports.ts`, `UnknownRateLimitPolicyError`); `application/use-cases/check-rate-limit.use-case.ts` (`CheckRateLimit.execute`: políticas na ordem do decorator, para na primeira que estoura, falha do armazenamento vira política indisponível); `infrastructure/` (`in-memory-rate-limit-store.ts`, `node-crypto-key-hasher.ts`, SHA-256 em hex); `interface/` (`guards/rate-limit.guard.ts` só traduz a decisão em 429 + `Retry-After` + log, `decorators/rate-limit.decorator.ts`).
- **Ordem de guards:** o `APP_GUARD` do limite fica no `RateLimitModule`, que é importado logo após o `ConfigModule` no `AppModule` (antes do `AuthModule`); guards globais futuros (ex.: sessão) devem ser registrados depois, para o limite rodar antes da autenticação.
- **`TRUST_PROXY`** (`false` por padrão): com `true`, o IP vem do primeiro endereço de `X-Forwarded-For` (use só atrás de um proxy confiável; do contrário qualquer cliente forja o IP). Com `false`, o cabeçalho é ignorado e atrás de um proxy todos compartilham a cota do IP do proxy: configure antes do deploy.
- **Limitação:** contadores em memória, **instância única**. Reiniciar a API zera as contagens e com mais de uma instância cada uma conta sozinha. O armazenamento fica atrás da interface `RateLimitStore`; Redis é backlog. Teto de 10 000 entradas, com evicção da mais antiga e descarte das expiradas.
- **Testes:** use `resetRateLimitStore(app)` de `apps/api/test/support/rate-limit.ts` em `beforeEach`, e `createFakeClock()` com o provider `RATE_LIMIT_CLOCK` para avançar o tempo. Para uma política de teste, sobrescreva `RATE_LIMIT_POLICIES` (exemplo em `apps/api/test/rate-limit.int-spec.ts`).

### 13.5 Sessão e proteção de rotas

Módulo `apps/api/src/modules/auth/` (spec `0005`; modelo no ADR 0009, resumo em `ARCHITECTURE.md` §4.7).

- **Handlers e casos de uso:** 8 request handlers em `interface/request-handlers/` (`SignUp`, `ForgotPassword`, `ResetPassword`, `SignIn`, `SignOut`, `ConfirmAccount`, `ResendConfirmation`, `GetSession`), cada um com o seu caso de uso; `GET /api/v1/auth/session` usa `GetSession`. O `HashLimiter` (infraestrutura) lança `HashCapacityExceededError` e os 3 handlers que fazem hash (`sign-up`, `sign-in`, `reset-password`) o traduzem em `ServiceBusyException` (503 `SERVICE_BUSY` com `Retry-After`). `MIN_JWT_SECRET_LENGTH` vive em `apps/api/src/config/auth-secret.ts`.
- **Header:** `Authorization: Bearer <jwt>`. O JWT só carrega `sub`, `sid`, `iat` e `exp`; a validade vem da linha em `sessions` (a API a lê a cada request). Emitir uma sessão revoga a anterior do mesmo usuário (uma ativa por usuário, garantido pelo banco).
- **Resposta de sessão** (para os endpoints que emitem sessão): `presentSession(await sessions.issue(userId))` devolve `{accessToken, expiresAt, user:{id, firstName, lastName, email}}`. `GET /api/v1/auth/session` devolve só `{user}`.
- **Rota aberta:** `@Public()` no método ou na classe do request handler; sem ele, 401 `UNAUTHENTICATED` ("Authentication required.") para token ausente, malformado, de assinatura inválida, expirado, sem `sid` ou de sessão revogada/inexistente, sem dizer qual. Rota inexistente continua 404.
- **Rota fechada:** `@CurrentSession() session: ActiveSession` dá `session.userId`, `session.sessionId` e `session.user`.
- **Ordem dos guards:** o de limite de requisições roda antes do de sessão (ver §13.4), então tentativas anônimas também contam.
- **Segredo:** `AUTH_JWT_SECRET` (>= 32 caracteres) só no servidor, nunca em log nem em `VITE_*`. Falha do banco ao validar é 500, não 401.
- **SPA:** o token fica em `localStorage` (`access_token`) via `lib/access-token.ts` (`getAccessToken`, `setAccessToken`, `clearAccessToken`; nunca lance, caem para memória). `lib/api-client.ts` envia o header e, num 401 `UNAUTHENTICATED`, limpa o token. Telas privadas entram como filhas de `appRoute` (o guard já cobre); páginas de `/auth/*` entram em `authRoute` (quem tem sessão é mandado para `/app`, exceto `confirm-account` e `reset-password`; a regra é `features/auth/auth-redirect.ts`). Leia a pessoa logada com `useSession()` (`GET /auth/session`). Sair: `useSignOut()` (`features/auth/use-sign-out.ts`) chama `POST /auth/sign-out` e, em `onSettled` (sucesso ou falha), faz `clearAccessToken()`, `queryClient.clear()` e navega para `/auth/sign-in`; no servidor, `SignOut` revoga só o `sid` da sessão atual.
