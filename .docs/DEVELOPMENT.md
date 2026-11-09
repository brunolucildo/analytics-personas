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

| Camada           | Contém                                                 | Não contém                |
| ---------------- | ------------------------------------------------------ | ------------------------- |
| `domain`         | Entidades, value objects, regras, ports                | Framework, HTTP, SQL, SDK |
| `application`    | Casos de uso, orquestração, transações                 | Detalhes de banco ou HTTP |
| `infrastructure` | Repositórios, clients, filas, storage, LLM, conectores | Regra de negócio          |
| `interface`      | Controllers, DTOs, guards, presenters                  | Acesso direto ao banco    |

Dependências apontam para dentro: `interface → application → domain`; `infrastructure` implementa ports de `domain`/`application`.

### 2.2 Vertical slices

- Organize por domínio, não por tipo global (`controllers/`, `services/` na raiz).
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

- Controller fino: recebe DTO, chama caso de uso, devolve presenter.
- Validação de entrada com DTO/schema; rejeite payload inválido antes do caso de uso.
- Erros de domínio são mapeados para HTTP na camada de interface; não vaze stack trace.
- Nenhum acesso direto ao Supabase dentro do controller.
- Toda integração externa tem timeout, retry limitado e erro tipado.
- Endpoints precisam de autenticação/autorização explícitas, exceto health check.
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
- Testes de `AppModule` que sobrescrevem o `ConfigService` com um objeto fake precisam incluir `email`, `supabaseUrl` e `supabaseServiceRoleKey` (exemplo em `apps/api/test/rate-limit.int-spec.ts`).

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
- Regra de negócio em componente, controller ou página.
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

| Zona                    | Prefixo     | Acesso                                                                   | Onde vive                                                               |
| ----------------------- | ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Páginas de autenticação | `/auth/*`   | Públicas                                                                 | Grupo `/auth` em `apps/app/src/router.tsx` (`AuthLayout`)               |
| Páginas do produto      | `/app/*`    | Privadas (o guard chega com a spec `0005`; até lá `/app` está acessível) | Grupo `/app` em `apps/app/src/router.tsx` (`AppLayout`)                 |
| API                     | `/api/v1/*` | Autenticação explícita, exceto `GET /api/v1/health`                      | `apps/api`; o prefixo é aplicado em `configureApp` (`src/bootstrap.ts`) |

- `/` redireciona para `/app`; qualquer caminho sem rota mostra a página "Page not found".
- Página nova entra como filha de `authRoute` ou de `appRoute`; nunca direto na raiz.
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
signIn(@Body() body: SignInDto) { /* ... */ }
```

- **Políticas:** `AUTH_RATE_LIMIT_POLICIES` em `rate-limit.policies.ts` é o único lugar com os números (`sign-up` 5/60 min por IP; `sign-in` 10/10 min por IP + e-mail; `confirm-account` 10/10 min por IP; `resend-confirmation` 3/10 min por IP + e-mail; `forgot-password` 3/10 min por IP + e-mail; `reset-password` 10/10 min por IP). Política nova entra nesse registro; nome inexistente no decorator faz a rota responder 500 (erro de programação, nunca rota sem proteção em silêncio).
- **Chave:** rota (`Classe.metodo`) + política + IP + (se a política é `ip-and-email`) o `email` string do corpo com trim e minúsculas, tudo em hash SHA-256 na memória. Sem `email` string, cai para a chave só por IP.
- **Resposta ao exceder:** 429, header `Retry-After` (segundos, inteiro >= 1) e envelope `RATE_LIMITED` com `details: [{ "retryAfterSeconds": n }]`. Janela fixa por chave.
- **Logs:** só `event: "rate_limited"` com o nome da política (e `rate_limit_store_error` quando o armazenamento falha). Nunca IP, e-mail ou chave.
- **Fail-open:** se o armazenamento lançar erro, a requisição passa.
- **Ordem de guards:** o `RateLimitModule` é importado logo após o `ConfigModule` no `AppModule`; guards globais futuros (ex.: sessão) devem ser registrados depois, para o limite rodar antes da autenticação.
- **`TRUST_PROXY`** (`false` por padrão): com `true`, o IP vem do primeiro endereço de `X-Forwarded-For` (use só atrás de um proxy confiável; do contrário qualquer cliente forja o IP). Com `false`, o cabeçalho é ignorado e atrás de um proxy todos compartilham a cota do IP do proxy: configure antes do deploy.
- **Limitação:** contadores em memória, **instância única**. Reiniciar a API zera as contagens e com mais de uma instância cada uma conta sozinha. O armazenamento fica atrás da interface `RateLimitStore`; Redis é backlog. Teto de 10 000 entradas, com evicção da mais antiga e descarte das expiradas.
- **Testes:** use `resetRateLimitStore(app)` de `apps/api/test/support/rate-limit.ts` em `beforeEach`, e `createFakeClock()` com o provider `RATE_LIMIT_CLOCK` para avançar o tempo. Para uma política de teste, sobrescreva `RATE_LIMIT_POLICIES` (exemplo em `apps/api/test/rate-limit.int-spec.ts`).
