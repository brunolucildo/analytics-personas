# XXXX — Modelo de sessão: bearer JWT com `sid` validado no banco

- **Status:** aceito
- **Data:** 2026-11-09

> O prefixo `XXXX` é provisório (spec `0005`); o número definitivo é atribuído na integração.

## Contexto

A autenticação é própria da API (ADR 0007). Duas specs emitem sessão (confirmação de conta e sign-in), e toda rota privada a valida. O solicitante decidiu por **bearer JWT** no header `Authorization` e exige que **a última sessão de cada pessoa seja a única válida** (entrar em outra máquina derruba a anterior). A SPA (ADR 0001) fala com a API em outra origem, e o token precisa sobreviver a recarregamentos da página.

## Decisão

- A sessão é uma linha em `sessions` (`id` = `sid`, `user_id`, `expires_at`, `revoked_at`). O token é um **JWT HS256** com só `sub` (id do usuário), `sid`, `iat` e `exp`, assinado com `AUTH_JWT_SECRET` (mínimo de 32 caracteres, só no servidor), com validade de 7 dias e sem refresh token.
- A assinatura **nunca basta**: a cada request autenticado a API lê a sessão pelo `sid` (uma consulta por chave primária, junto com o usuário) e exige que ela exista, não esteja revogada nem expirada e pertença ao `sub`. Na prática o JWT é um envelope assinado de um identificador de sessão do servidor, e revogar é imediato.
- **Sessão única no banco:** índice único parcial `sessions_user_id_active_key` (`user_id where revoked_at is null`). Emitir uma sessão é a função SQL `auth_issue_session`, chamada por RPC (ADR 0008): ela trava a linha do usuário, revoga a sessão ativa e insere a nova na mesma transação.
- **API fechada por padrão:** um `AuthGuard` global (`APP_GUARD`) exige sessão em toda rota; `@Public()` (em `src/common/public.decorator.ts`) é a única forma de abrir uma rota. O guard é registrado depois do guard de limite de requisições, que continua rodando antes da autenticação. Todo defeito do token (ausente, malformado, assinatura, algoritmo, expirado, sem `sid`, sessão revogada, expirada ou inexistente) responde o mesmo `401 UNAUTHENTICATED`, sem distinguir o motivo; falha do banco é 500, nunca 401.
- A biblioteca de JWT é `jose` (HS256 explícito: `algorithms: ["HS256"]` recusa `none` e troca de algoritmo; `sub` e `sid` precisam ser UUIDs antes de chegar ao banco).
- No SPA, o token fica em `localStorage` sob a chave `access_token` (com `try/catch` e cópia em memória quando o storage falha). `api-client` envia `Authorization: Bearer`; um `401 UNAUTHENTICATED` limpa o token e leva a `/auth/sign-in`. O guard de `/app/*` é o `beforeLoad` da rota (sem token, redireciona sem chamar a API) mais o `AppLayout` (consulta `GET /api/v1/auth/session`, com carregando e erro).

## Alternativas consideradas

| Alternativa                                       | Prós                                                                        | Contras                                                                                                                 | Por que não                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| JWT stateless (só assinatura e `exp`)             | Sem leitura no banco por request                                            | Não revoga: sessão única e sign-out ficam impossíveis até o `exp`                                                       | O requisito é que o token antigo caia na hora                                                |
| Sessão opaca em cookie `HttpOnly`                 | Token fora do alcance de JS (XSS não o lê); revogação trivial               | SPA e API em origens diferentes exigem `SameSite`/CORS com credenciais e proteção de CSRF; decisão do solicitante foi bearer | O solicitante escolheu bearer JWT; cookie fica como evolução se o risco de XSS pesar mais    |
| Refresh token + access token curto               | Janela de exposição menor                                                   | Mais tabelas, rotação e estados; fora do escopo                                                                         | Backlog; 7 dias sem refresh foi decisão do solicitante                                       |
| Revogar a anterior em duas chamadas (código)      | SQL mais simples                                                            | Corrida: dois logins simultâneos podem deixar duas ativas                                                               | A função SQL transacional mais o índice parcial garantem uma ativa mesmo sob concorrência     |
| `@nestjs/jwt` em vez de `jose`                    | Integração com o Nest                                                       | Camada sobre `jsonwebtoken`; mais superfície; `jose` é pequeno, sem dependências e com algoritmos explícitos            | `jose` atende com menos código e menos dependências transitivas                              |
| Cache em memória da sessão para evitar a consulta | Menos carga no banco                                                        | Revogação deixa de ser imediata e o cache não é compartilhado entre instâncias                                          | Uma leitura por chave primária é barata; cache só se a medição exigir (fora de escopo)       |

## Consequências

- Positivas: revogação imediata; sessão única garantida pelo banco (inclusive sob concorrência); nenhum dado pessoal no token; toda rota nova nasce protegida (esquecer o decorator fecha a rota, não a abre); o serviço de sessão é testável com fakes e contra o banco real.
- Negativas: uma leitura em `sessions` por request autenticado; o token em `localStorage` é legível por XSS (risco aceito pelo solicitante: backlog de CSP e revisão de dependências de front); segredo único sem rotação nesta fase (rotação invalida todas as sessões); sessões expiradas ou revogadas não são apagadas (job de limpeza no backlog); o 401 não explica o motivo.
- Impacto: `apps/api/src/modules/auth/` (`SessionService`, `AuthGuard`, `JoseAccessTokenSigner`, `SupabaseSessionRepository`), migration `20261109210000_create_sessions.sql`, dependência `jose` em `apps/api`, variável `AUTH_JWT_SECRET` (obrigatória: a API não sobe sem ela), `@Public()` em `health`, `sign-up` e na rota de teste de e-mail, e no SPA `lib/access-token.ts`, `api-client`, `features/auth/` e os layouts de `/app` e `/auth`. Documentado em `ARCHITECTURE.md` §4.7 e `DEVELOPMENT.md` §13.5.
