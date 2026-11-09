# 0004 — Cadastro de conta (sign-up)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** rascunho
- **Slug:** 0004-auth-sign-up
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia (decisões de produto: Produto)
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0001 (prefixo, envelope de erro, roteador), 0002 (e-mail), 0003 (limite de requisições), `.docs/DEVELOPMENT.md` §5 e §6, `.docs/BUSINESS.md` §9 (autenticação e multi-tenant em aberto). **Depende de:** 0001, 0002, 0003. **Destrava:** 0005 (tabela `users`), 0006, 0009.

## 1. Escopo

### Dentro do escopo

- **Endpoint** `POST /api/v1/auth/sign-up` e a **página** `/auth/sign-up`.
- Migration das tabelas `users` e `auth_tokens` (esta serve também ao reset de senha, 0009), com RLS ligada e sem policies.
- Validação de nome, sobrenome, e-mail, senha e confirmação de senha (API e formulário).
- Hash de senha com Argon2id; usuário criado como **não confirmado**.
- Token de confirmação de e-mail (24 h), e-mail de confirmação com link `${APP_URL}/auth/confirm-account?token=<token>`.
- Resposta `409` explícita quando o e-mail já tem conta; aplicação da política de limite `sign-up`.
- Camada de acesso a dados do auth (repositórios) e cliente HTTP do SPA (`lib/api-client.ts`) com a estrutura `features/auth`.
- ADR da decisão "auth próprio na API" e da camada de acesso a dados.

### Fora do escopo

- Confirmar a conta ao clicar no link, abrir sessão e reenviar a confirmação: 0006.
- Sessão, JWT e proteção de rotas: 0005. Sign-in: 0007.
- Esqueci a senha e reset: 0009 e 0010.
- Login social, convite de usuário, papéis, clube/workspace (backlog).
- Captcha e verificação de senha vazada (backlog).

## 2. Contexto

A plataforma não tem usuários nem banco de domínio (`supabase/migrations/` só tem `.gitkeep`). Este é o **esqueleto ambulante** do épico: atravessa UI, API, banco e e-mail e prova a arquitetura em camadas (`apps/api/src/modules/auth/` com `domain`, `application`, `infrastructure`, `interface`).

Atenção de segurança: tabelas do schema `public` do Supabase são alcançáveis pelo PostgREST com a chave `anon`. `users` guarda `password_hash`; portanto RLS ligada **sem policies** e sem grants para `anon`/`authenticated` é requisito, não detalhe. O mesmo vale para as funções SQL chamadas por RPC (o PostgREST também as expõe): sem `execute` para `public`, `anon` e `authenticated`.

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

**Contrato de dados definido aqui e reutilizado pelas specs seguintes:**

- `users`: `id` (uuid), `first_name`, `last_name`, `email` (único, minúsculas), `password_hash`, `email_confirmed_at` (nulo = não confirmada), `created_at`, `updated_at`.
- `auth_tokens`: `id`, `user_id` (FK com `on delete cascade`), `type` (`email_confirmation` | `password_reset`), `token_hash` (SHA-256, único), `expires_at`, `used_at` (nulo = ainda válido), `created_at`.
- `POST /api/v1/auth/sign-up` recebe `{firstName, lastName, email, password, confirmPassword}`.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Pessoa nova que quer usar a plataforma (papel único: usuário).                                 |
| Decisão ou ação que muda | A pessoa passa a poder criar a própria conta e provar a posse do e-mail.                       |
| Resultado esperado       | Conta criada como não confirmada e e-mail de confirmação enviado.                              |
| Métrica de sucesso       | % de cadastros que chegam ao e-mail de confirmação; contas duplicadas rejeitadas sem erro 500. |

## 4. Requisitos

| ID  | Requisito                                                                | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Migration de `users` e `auth_tokens` com RLS e sem acesso público.       | Must       | Given `bun run db:migrate`, When inspecionar, Then as tabelas existem com índice único em `lower(email)` (ou coluna já normalizada) e `token_hash`; RLS está ligada e sem policies; Given a chave `anon` do Supabase, When `select` em `users` ou `auth_tokens` pela API REST do Supabase, Then nenhuma linha é devolvida e nenhum dado é escrito; Given a chave `anon`, When chamar qualquer função RPC de auth, Then a chamada é negada (testes de integração).                                                                                                                                                                                                            |
| R2  | `POST /api/v1/auth/sign-up` cria o usuário não confirmado.               | Must       | Given payload válido, When `POST`, Then 201 com `{"email":"<normalizado>"}`; a linha em `users` tem `email_confirmed_at` nulo, nome e sobrenome com trim, e-mail em minúsculas e `password_hash` Argon2id (começa com `$argon2id$`); a senha em texto nunca é persistida nem devolvida.                                                                                                                                                                                                                                                                                                                                                                                      |
| R3  | Validação de entrada.                                                    | Must       | Given nome/sobrenome vazios ou > 100, e-mail inválido ou > 254, senha < 8 ou > 128 ou `confirmPassword` diferente, When `POST`, Then 400 `VALIDATION_FAILED` com `details` por campo (`confirmPassword` recebe a mensagem "Passwords do not match") e nenhuma linha é criada; campos extras são rejeitados.                                                                                                                                                                                                                                                                                                                                                                  |
| R4  | E-mail repetido recebe 409.                                              | Must       | Given um usuário com `Ana@Example.com`, When `POST` com `ana@example.com`, Then 409 `EMAIL_ALREADY_REGISTERED` e nenhum e-mail é enviado; Given duas requisições simultâneas com o mesmo e-mail, Then uma retorna 201 e a outra 409 (sem erro 500).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R5  | Token e e-mail de confirmação.                                           | Must       | Given um cadastro válido, When concluído, Then existe um `auth_tokens` do tipo `email_confirmation` com `expires_at` = criação + 24 h, `used_at` nulo e só o hash SHA-256 guardado; uma mensagem é entregue ao `EmailService` (no teste, capturada pelo provider `capture`) para o endereço, com assunto em inglês, o primeiro nome e um link `${APP_URL}/auth/confirm-account?token=<token>` cujo token, ao ser hasheado, é o `token_hash`; o texto puro tem o mesmo link.                                                                                                                                                                                                  |
| R6  | Falha no e-mail não falha o cadastro.                                    | Must       | Given o provedor de e-mail indisponível, When `POST` válido, Then 201, o usuário e o token existem e o erro é registrado sem PII; a pessoa recupera o fluxo pelo reenvio do 0006.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R7  | Limite de requisições.                                                   | Must       | Given a política `sign-up` do 0003, When a 6ª requisição do mesmo IP na hora, Then 429 `RATE_LIMITED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R8  | Página `/auth/sign-up`.                                                  | Must       | Given o app, When abrir `/auth/sign-up`, Then há um `h1` `Create your account`, campos com `label` (`First name`, `Last name`, `Email`, `Password`, `Confirm password`), botão `Create account` e link `Sign in` para `/auth/sign-in`; erros de validação e de senhas diferentes aparecem em texto junto ao campo, associados por `aria-describedby`, antes do envio; durante o envio o botão fica desabilitado e indica carregamento; `409` aparece no campo de e-mail; `429` e erro de rede aparecem como mensagem geral; sucesso troca o formulário por uma mensagem "Check your email" com o endereço usado. Funciona por teclado, com foco visível, em 375/768/1280 px. |
| R9  | Camada de acesso a dados e cliente HTTP definidos de forma reutilizável. | Should     | Given o código, When inspecionar, Then o módulo `auth` segue as camadas (`domain` sem framework/SQL; repositórios em `infrastructure`; controller fino); o SPA tem `lib/api-client.ts` (base `${VITE_API_URL}/api/v1`, JSON, erro tipado `ApiError {status, code, message, details}`) e `features/auth/` com a página, o hook de mutation (TanStack Query) e testes.                                                                                                                                                                                                                                                                                                         |

## 5. Fluxos e estados

- **Caminho feliz:** pessoa abre `/auth/sign-up` → preenche → envia → API valida, grava, gera token e despacha o e-mail → SPA mostra "Check your email".
- **Vazio:** formulário inicial vazio, sem erro.
- **Carregando:** botão desabilitado com indicador; campos preservados.
- **Erro:** validação (400) por campo; e-mail já cadastrado (409) no campo e-mail, com link `Sign in`; excesso de tentativas (429) mensagem geral com o tempo de espera; falha de rede/5xx mensagem geral e permite reenviar sem perder o que foi digitado.
- **Sucesso parcial:** conta criada com falha no envio do e-mail → a pessoa vê "Check your email" e pode pedir reenvio no 0006 (aceito, ver R6).
- **Cancelamento/retry:** reenviar o formulário com o mesmo e-mail após sucesso resulta em 409 (a conta existe e ainda não confirmou: o reenvio é do 0006).
- **Permissões e dados:** rota pública. PII: nome, sobrenome e e-mail, retidos enquanto a conta existir; senha só como hash; nada disso vai para log. Acesso às tabelas só pelo servidor (conexão da API), nunca pelo browser.

## 6. Acceptance Criteria

- [ ] Given `db:migrate`, When consultar `users`/`auth_tokens` com a chave `anon`, Then nada é lido nem escrito; os índices únicos existem. (R1)
- [ ] Given payload válido, When `POST /api/v1/auth/sign-up`, Then 201 e usuário não confirmado com hash Argon2id. (R2)
- [ ] Given payloads inválidos (um por regra), When `POST`, Then 400 `VALIDATION_FAILED` com o campo correto e sem linha criada. (R3)
- [ ] Given e-mail repetido (com caixa/espaços diferentes) e requisições concorrentes, When `POST`, Then 409 `EMAIL_ALREADY_REGISTERED` e nunca 500. (R4)
- [ ] Given um cadastro válido, When ler a mensagem capturada para o destinatário, Then o e-mail traz o link com o token cujo hash está em `auth_tokens` (24 h). (R5)
- [ ] Given o provedor de e-mail indisponível, When cadastro válido, Then 201 e erro registrado sem PII. (R6)
- [ ] Given 6 requisições seguidas do mesmo IP, When a 6ª, Then 429. (R7)
- [ ] Given o formulário (E2E com a API em `EMAIL_PROVIDER=capture`), When preencher com senhas diferentes, Then o erro aparece sem chamar a API; When preencher corretamente, Then a tela "Check your email" e a mensagem capturada. (R8)
- [ ] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam. (R9)

## 7. O que fazer

1. Registrar o ADR do acesso a dados (decisão do solicitante: `supabase-js` com service role + funções SQL chamadas por RPC; ver §11) e o ADR "auth próprio na API".
2. Criar a migration (`supabase/migrations/<timestamp>_create_users_and_auth_tokens.sql`) com tabelas, índices, RLS ligada, revogação de acesso de `anon`/`authenticated` e as funções SQL (RPC) transacionais deste fluxo (ex.: criar usuário + token de confirmação em uma só chamada), com `execute` revogado de `public`, `anon` e `authenticated`; documentar o rollback.
3. Criar o módulo `auth` com `domain` (usuário, regras de senha e e-mail), `application` (caso de uso `SignUp`), `infrastructure` (repositórios, hash Argon2id, geração e hash do token) e `interface` (controller, DTO).
4. Montar o e-mail de confirmação com o layout do 0002 e despachá-lo depois do commit.
5. Aplicar `@RateLimit('sign-up')`.
6. Criar `lib/api-client.ts`, `features/auth/` e a rota `/auth/sign-up` no roteador do 0001, usando `@repo/ui` para os primitivos.
7. Escrever testes: unitário (regras de senha, nome e e-mail; formulário), integração (R1 a R7 com o Supabase local e o provider `capture` de e-mail), E2E (R8).
8. Atualizar `QA.md` (`test:integration` passa a exigir `infra:up` e migrations aplicadas), `ARCHITECTURE.md` (estado atual, tabelas) e `.env.example` se surgir variável (o acesso a dados usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, que já existem).
9. Executar os gates de `QA.md` e o checklist manual de UI (§5.2 e §5.3).

## 8. O que não fazer

- Não confirmar a conta, criar sessão nem emitir JWT aqui.
- Não guardar senha em texto, token em texto ou logar qualquer um deles, nem o e-mail do usuário.
- Não expor `users` ou `auth_tokens` por policy RLS para `anon`/`authenticated`.
- Não usar a service role no browser; não acessar o banco dentro do controller.
- Não criar tabelas de clube, papel ou permissão.
- Não validar só no cliente: a API é a fonte da regra.
- Não implementar `useEffect` para buscar dado inicial; a página só tem mutation.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                                                                                                                    | Mitigação                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Risco       | Operações que exigem transação (criar usuário + token; depois, sessão e consumo de token) vivem em funções SQL chamadas por RPC, o que espalha regra entre TypeScript e SQL. | Deixar nas funções só o atômico necessário; validação fica no `domain`; teste de integração por função; `execute` revogado de `anon`/`authenticated`. |
| Risco       | `test:integration` passa a depender de Docker e Supabase local.                                                                                                              | Documentar em `QA.md`; teste falha com mensagem acionável se o banco não estiver no ar.                                                               |
| Risco       | Enumeração de e-mails pelo 409 (decisão do solicitante).                                                                                                                     | Limite do 0003; forgot-password segue genérico (0009).                                                                                                |
| Risco       | Corrida em cadastros simultâneos do mesmo e-mail.                                                                                                                            | Índice único e tratamento do erro de violação como 409 (R4).                                                                                          |
| Risco       | Link para `/auth/sign-in` e `/auth/confirm-account` ainda sem página.                                                                                                        | As páginas chegam em 0007 e 0006; o link não faz parte da verificação desta spec.                                                                     |
| Dependência | `argon2` (hash) e (se aplicável) biblioteca de formulário; o acesso a dados usa o `@supabase/supabase-js` já instalado.                                                      | Justificar no relatório; instalar só em `apps/api` e `apps/app`.                                                                                      |
| Dependência | 0001 (roteador, envelope), 0002 (e-mail), 0003 (limite).                                                                                                                     | Ordem do mapa.                                                                                                                                        |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run infra:up`; `bun run db:migrate`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`; abrir `http://localhost:5173/auth/sign-up`.
- **Evidência esperada:** gates com código 0; linha de usuário não confirmado; e-mail capturado no teste com o link de confirmação (e, com `EMAIL_PROVIDER=mailtrap`, visível na caixa do Mailtrap em verificação manual).
- **Comportamento observável:** cadastro pelo formulário termina em "Check your email"; repetir o e-mail mostra o erro no campo.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                                                                                                                                                                | Impacto                                                                                                                                                         | Bloqueante?     | Quem decide        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ |
| **Decisão (2026-11-09, solicitante):** a API acessa o Postgres por `supabase-js` com a service role (só no servidor) e **funções SQL chamadas por RPC** para o que exige transação. A recomendação do assistente era conexão direta; o solicitante escolheu RPC. | Vale para todo o épico: repositórios em `infrastructure` chamam tabelas e RPC; as migrations trazem as funções; `execute` revogado para `anon`/`authenticated`. | Não (resolvida) | Solicitante        |
| Premissa: `email` é guardado já normalizado (trim + minúsculas) com índice único; não usa `citext`.                                                                                                                                                              | Schema da migration.                                                                                                                                            | Não             | Time de engenharia |
| Premissa: o 409 vale também para conta existente não confirmada.                                                                                                                                                                                                 | Pessoa presa sem link precisa do reenvio do 0006.                                                                                                               | Não             | Produto            |
| Premissa: não há captcha; a proteção é o limite do 0003.                                                                                                                                                                                                         | Spam de cadastro possível em escala.                                                                                                                            | Não             | Produto            |
| Premissa: resposta 201 só com `{email}` (não devolve `id`).                                                                                                                                                                                                      | Contrato do SPA.                                                                                                                                                | Não             | Time de engenharia |
| **Decisão (2026-11-09):** a integração roda contra o Supabase local (`infra:up`); repositórios têm fake em memória para teste unitário; `QA.md` registra o pré-requisito de Docker.                                                                              | Gate de integração passa a exigir infra.                                                                                                                        | Não (resolvida) | Solicitante        |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                            | Motivo                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                                                                                                      | Esqueleto ambulante do épico.           |
| 2026-11-09 | Acesso a dados definido como `supabase-js` + funções RPC (antes pergunta bloqueante); e-mail passa a usar `EmailService`/provider `capture` nos testes; RPC sem `execute` para `anon`/`authenticated`. | Respostas do quiz de perguntas abertas. |
