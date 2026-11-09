# 0005 — Sessões, sessão única e proteção de rotas (habilitadora)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída (R1–R10 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0005-auth-sessions-and-route-guard
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia (decisões de produto: Produto)
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0001 (grupos `/auth` e `/app`, envelope de erro), 0004 (`users`, camada de dados, `api-client`), `.docs/DEVELOPMENT.md` §5 ("Endpoints precisam de autenticação explícita, exceto health check"). **Depende de:** 0001, 0004. **Destrava:** 0006, 0007, 0008, 0010.

## 1. Escopo

### Dentro do escopo

- Tabela `sessions` e **serviço de sessão** (emitir, validar, revogar), com **sessão única por usuário**.
- **JWT** assinado (`sub`, `sid`, `iat`, `exp`) e variável `AUTH_JWT_SECRET`.
- **API fechada por padrão:** guard global que exige sessão válida, com `@Public()` para as rotas abertas.
- `GET /api/v1/auth/session` (usuário da sessão atual) e o formato de resposta de sessão `{accessToken, expiresAt, user}` usado por 0006 e 0007.
- No SPA: armazenamento do token, envio do header `Authorization`, **guard de `/app/*`** (redireciona para `/auth/sign-in`), redirecionamento de quem já está logado para fora das páginas de auth, e **home real** em `/app`.
- ADR do modelo de sessão (JWT com `sid` validado no banco).

### Fora do escopo

- Criar a sessão por confirmação de conta (0006) ou por login (0007): aqui só existe o serviço, testado com usuário semeado.
- Sign-out (0008), páginas de auth (0006 a 0010).
- Refresh token, "lembrar de mim", listagem de sessões/dispositivos (backlog).
- Papéis e permissões (backlog).

## 2. Contexto

Duas specs (confirmação e sign-in) emitem sessão, e todas as rotas privadas a validam. A decisão do solicitante é **bearer JWT**; para que a **última sessão seja a única válida**, o JWT carrega um `sid` e a API confere no banco, a cada request, se aquela sessão ainda está ativa. Na prática o JWT é um envelope assinado de um identificador de sessão do servidor: revogar é imediato.

**Decisões compartilhadas do épico de autenticação** (idênticas em todas as specs; fonte: `.plans/auth-breakdown.md` §2):

- **Identidade:** auth próprio na API (Nest + Postgres); sem Supabase Auth.
- **Sessão:** bearer JWT (`sub`, `sid`, `exp`) no header `Authorization: Bearer <token>`; a API confere o `sid` no banco a cada request. **Sessão única por usuário:** emitir uma nova sessão revoga a anterior. Validade de 7 dias, sem refresh token. O SPA guarda o token no `localStorage` (risco de XSS aceito e registrado).
- **Idioma:** UI, rotas, endpoints, código, mensagens de erro e e-mails em **en-US**; `.docs/`, specs e ADRs seguem em pt-BR.
- **URLs:** páginas públicas em `/auth/*`, privadas em `/app/*`; API em `/api/v1/*` (auth em `/api/v1/auth/*`).
- **Contratos:** JSON em camelCase, colunas em snake_case; erros no envelope `{"error":{"code","message","details"}}` com `code` em `UPPER_SNAKE_CASE`.
- **Credenciais:** senha de 8 a 128 caracteres, sem regras de composição, hash Argon2id; nome e sobrenome de 1 a 100 caracteres após trim; e-mail com trim e minúsculas, único.
- **Tokens de link:** opacos, aleatórios, de uso único, guardados só como hash SHA-256; confirmação expira em 24 h e reset em 1 h.
- **Logs:** nunca registrar senha, token, link, e-mail do destinatário nem IP.
- **Isolamento:** por usuário; clube e workspace ficam fora.

**Contrato definido aqui e reutilizado:**

- `sessions`: `id` (uuid, é o `sid`), `user_id` (FK), `created_at`, `expires_at` (criação + 7 dias), `revoked_at` (nulo = ativa). Índice único parcial em `user_id` onde `revoked_at is null` (no máximo uma sessão ativa por usuário, garantido pelo banco).
- Resposta de sessão: `{"accessToken":"<jwt>","expiresAt":"<ISO 8601 UTC>","user":{"id","firstName","lastName","email"}}`.
- Chave do `localStorage` no SPA: `access_token`.
- Código de erro: `401 UNAUTHENTICATED` (mensagem "Authentication required.") para token ausente, malformado, de assinatura inválida, expirado, de sessão revogada ou inexistente.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Qualquer pessoa com conta; time de engenharia (toda rota nova nasce protegida).                          |
| Decisão ou ação que muda | Páginas `/app/*` e endpoints passam a exigir sessão; só a última sessão de cada pessoa vale.             |
| Resultado esperado       | Rotas privadas realmente privadas, e login em duas máquinas derruba a anterior.                          |
| Métrica de sucesso       | Teste mostra token antigo recebendo 401 após uma nova sessão; `/app` sem login vai para `/auth/sign-in`. |

## 4. Requisitos

| ID  | Requisito                                                           | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Tabela `sessions` com regra de sessão ativa única no banco.         | Must       | Given `db:migrate`, When inspecionar, Then `sessions` existe com RLS ligada e sem policies e o índice único parcial; Given a chave `anon`, When ler `sessions` pela API do Supabase, Then nada é devolvido. Duas linhas ativas do mesmo usuário são rejeitadas pelo banco; as funções RPC desta spec não são executáveis pela chave `anon`.                                              |
| R2  | Serviço de sessão: `issue(userId)`, `validate(sid)`, `revoke(sid)`. | Must       | Given um usuário confirmado semeado, When `issue`, Then devolve a resposta de sessão com JWT (`sub` = id do usuário, `sid`, `exp` = +7 dias) e uma linha ativa; When `issue` de novo, Then a anterior fica com `revoked_at` preenchido na mesma transação (uma função SQL chamada por RPC) e só a nova é ativa (sob concorrência, nunca duas ativas); When `revoke`, Then fica inválida. |
| R3  | `AUTH_JWT_SECRET` validada e documentada.                           | Must       | Given `AUTH_JWT_SECRET` com ≥ 32 caracteres, When subir a API, Then ok; When ausente ou curta, Then a API não sobe e cita a variável; `.env.example` e `setup-env.ts` (valor fictício) a definem. O segredo nunca é logado.                                                                                                                                                              |
| R4  | A API é fechada por padrão.                                         | Must       | Given uma rota nova sem decorator, When chamada sem token, Then 401 `UNAUTHENTICATED`; `@Public()` libera `GET /api/v1/health` e as rotas de auth abertas das specs seguintes; Given token com assinatura errada, expirado, sem `sid`, de sessão revogada ou de sessão inexistente, When chamada, Then 401 `UNAUTHENTICATED` sem distinguir o motivo.                                    |
| R5  | `GET /api/v1/auth/session`.                                         | Must       | Given token válido, When `GET`, Then 200 `{"user":{"id","firstName","lastName","email"}}` (sem `passwordHash` nem campos internos); sem token, 401.                                                                                                                                                                                                                                      |
| R6  | Sessão única comprovada ponta a ponta na API.                       | Must       | Given o token A e depois o token B emitidos para o mesmo usuário, When `GET /api/v1/auth/session` com A, Then 401; com B, Then 200.                                                                                                                                                                                                                                                      |
| R7  | O SPA guarda o token e o envia.                                     | Must       | Given um token no `localStorage` (`access_token`), When o SPA chama a API, Then `api-client` envia `Authorization: Bearer <token>`; acesso ao `localStorage` falho (modo privado) não quebra a página (try/catch, sem persistência). Respostas 401 limpam o token e levam a `/auth/sign-in`.                                                                                             |
| R8  | `/app/*` exige sessão.                                              | Must       | Given nenhum token, When abrir `/app`, Then a URL final é `/auth/sign-in`; Given token inválido, When abrir `/app`, Then o token é removido e a URL final é `/auth/sign-in`; Given token válido, When abrir `/app`, Then a home aparece, com um estado de carregamento enquanto a sessão é verificada.                                                                                   |
| R9  | Quem está logado sai das páginas de auth.                           | Must       | Given sessão válida, When abrir `/auth/sign-in`, `/auth/sign-up` ou `/auth/forgot-password`, Then a URL final é `/app`; `/auth/confirm-account` e `/auth/reset-password` continuam acessíveis (a lógica é uma função pura testada por unidade; as páginas chegam nas specs seguintes).                                                                                                   |
| R10 | Home real em `/app`.                                                | Must       | Given sessão válida, When abrir `/app`, Then há um único `h1` `Welcome, <firstName>` e o texto "You are signed in."; o "Hello World" provisório do 0001 é removido e o E2E e os testes são migrados.                                                                                                                                                                                     |

## 5. Fluxos e estados

- **Caminho feliz:** token válido no `localStorage` → SPA chama `GET /auth/session` → home exibe o nome.
- **Vazio:** sem token → redireciona para `/auth/sign-in` sem chamar a API.
- **Carregando:** enquanto `GET /auth/session` roda, `/app` mostra um indicador acessível (`role="status"`) e não a home nem o redirecionamento.
- **Erro:** 401 → remover token e ir para `/auth/sign-in`; falha de rede/5xx → mensagem "We couldn't verify your session." com botão `Try again` (não apaga o token).
- **Sucesso parcial:** não se aplica.
- **Cancelamento/retry:** sessão revogada por login em outro lugar → o próximo request cai em 401 e a pessoa volta ao sign-in.
- **Permissões e dados:** JWT contém só `sub`, `sid`, `iat`, `exp` (sem PII). Acesso às tabelas só pelo servidor. Cada request autenticado faz uma leitura em `sessions`; o índice por `id` a mantém barata.

## 6. Acceptance Criteria

- [x] Given `db:migrate`, When inspecionar `sessions`, Then RLS ligada, índice único parcial e nada acessível pela chave `anon`. (R1)
- [x] Given um usuário semeado, When `issue` duas vezes, Then só a última sessão está ativa, inclusive sob concorrência. (R2)
- [x] Given `AUTH_JWT_SECRET` ausente ou curta, When iniciar, Then a API falha citando a variável. (R3)
- [x] Given rota sem `@Public()`, When chamada sem token ou com token inválido/expirado/revogado, Then 401 `UNAUTHENTICATED`; `health` continua público. (R4)
- [x] Given token válido, When `GET /api/v1/auth/session`, Then 200 com o usuário e sem campos internos. (R5)
- [x] Given tokens A e B do mesmo usuário (B depois de A), When usar A, Then 401; When usar B, Then 200. (R6)
- [x] Given o SPA sem token / com token inválido / com token válido, When abrir `/app`, Then redireciona para `/auth/sign-in` / limpa o token e redireciona / mostra a home. (R7, R8, R10)
- [x] Given a função de redirecionamento, When sessão válida em cada caminho de `/auth/*`, Then só `confirm-account` e `reset-password` ficam acessíveis. (R9)
- [x] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam.

## 7. O que fazer

1. Criar a migration de `sessions` (RLS ligada, índice único parcial, revogação de acesso de `anon`/`authenticated`) e o repositório.
2. Criar o `SessionService` (função SQL chamada por RPC que, em uma transação, revoga as ativas e insere a nova) e a assinatura/verificação do JWT; registrar `AUTH_JWT_SECRET` no ambiente.
3. Criar o `AuthGuard` global com o decorator `@Public()`; marcar `GET /api/v1/health` como público; criar `GET /api/v1/auth/session` e o presenter da resposta de sessão.
4. No SPA: módulo de token (`access_token`), `api-client` com `Authorization` e tratamento de 401, query da sessão (TanStack Query), guard do grupo `/app`, função de redirecionamento do grupo `/auth` e a home real.
5. Para testes sem sign-in: helper de teste que semeia um usuário confirmado e chama `issue`; E2E só cobre o caminho "sem token" (o feliz completo vem no 0007).
6. Criar o ADR do modelo de sessão; atualizar `ARCHITECTURE.md` (estado atual), `DEVELOPMENT.md` (todo endpoint novo é fechado por padrão) e `QA.md`.
7. Executar os gates e o checklist manual de UI e acessibilidade (estado de carregamento anunciado).

## 8. O que não fazer

- Não emitir sessão em nenhum fluxo de usuário (confirmação e sign-in são 0006 e 0007).
- Não colocar PII, e-mail ou papéis no JWT.
- Não confiar só na assinatura: sempre checar `sid` no banco.
- Não criar refresh token, cookie nem lista de sessões.
- Não logar o token, o `sid` completo ou `AUTH_JWT_SECRET`.
- Não deixar rota nova sem proteção; exceções só com `@Public()` explícito.

## 9. Riscos e dependências

| Tipo        | Descrição                                             | Mitigação                                                                                   |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Risco       | Token no `localStorage` é legível por XSS.            | Aceito pelo solicitante; registrar no ADR; backlog: CSP e revisão de dependências de front. |
| Risco       | Uma leitura de banco por request.                     | Índice por `id`; medir; cache curto só se necessário (fora de escopo).                      |
| Risco       | Corrida entre dois logins: duas sessões ativas.       | Índice único parcial + transação (R1, R2).                                                  |
| Risco       | Segredo JWT fraco ou vazado.                          | Mínimo de 32 caracteres; nunca no bundle nem em log; rotação fica no backlog.               |
| Dependência | Biblioteca de JWT (ex.: `jose` ou `@nestjs/jwt`).     | Justificar no relatório.                                                                    |
| Dependência | 0004: tabela `users`, camada de dados e `api-client`. | Ordem do mapa.                                                                              |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run db:migrate`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`; abrir `http://localhost:5173/app` sem token.
- **Evidência esperada:** gates com código 0; teste de sessão única (A → 401, B → 200); E2E de redirecionamento.
- **Comportamento observável:** `/app` sem login vai para `/auth/sign-in`; com um token semeado mostra "Welcome, <nome>".

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                 | Impacto                                              | Bloqueante? | Quem decide        |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- | ------------------ |
| Premissa: JWT HS256 com segredo único (`AUTH_JWT_SECRET`); sem rotação nesta fase.                                | Segurança do segredo.                                | Não         | Time de engenharia |
| Premissa: `/auth/sign-in` ainda não tem página (0007): o redirecionamento termina na 404 do grupo `/auth` até lá. | O E2E verifica só a URL final.                       | Não         | Time de engenharia |
| Premissa (implementação): `issue` não verifica `email_confirmed_at`; quem chama (0006 e 0007) decide se a pessoa pode entrar. | Sessão para conta não confirmada se o chamador esquecer. | Não | Time de engenharia |
| Premissa (implementação): só 401 com `code` `UNAUTHENTICATED` limpa o token no SPA; um 401 de credencial inválida (0007) deve usar outro código. | Sign-in errado não pode derrubar a sessão da página. | Não | Time de engenharia |
| Premissa (implementação): `GET /auth/session` devolve só `{user}` (sem `accessToken`, conforme R5); falha do banco na validação é 500, nunca 401. | Indisponibilidade não parece "deslogado". | Não | Time de engenharia |
| Premissa (implementação): numa página `/auth/*` um token inválido apenas é limpo (a pessoa fica na página); falha de rede/5xx na verificação deixa a página abrir e mantém o token. | UX de páginas de auth com token velho. | Não | Produto |
| Premissa: uma sessão revogada por outro login mostra só o redirecionamento, sem aviso específico.                 | UX de "você entrou em outro lugar" fica para depois. | Não         | Produto            |
| Premissa: sem `?redirect=` na volta ao sign-in.                                                                   | Após login, sempre `/app`.                           | Não         | Produto            |
| Premissa: sessões expiradas ou revogadas não são apagadas (job de limpeza no backlog).                            | Crescimento lento da tabela.                         | Não         | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                                                    | Motivo                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                              | Habilitadora usada por 0006, 0007, 0008 e 0010; entrega "rotas privadas em /app" e "sessão única". |
| 2026-11-09 | Spec implementada (`implement-me`): premissas de implementação registradas em §11, status `concluída`, critérios marcados. | Execução da spec 0005. |
| 2026-11-09 | A emissão de sessão passa a ser uma função SQL chamada por RPC; RPC sem `execute` para `anon`. | Decisão de acesso a dados (supabase-js + RPC) no quiz de perguntas abertas.                        |
