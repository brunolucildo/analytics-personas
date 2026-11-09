# 0006 — Confirmar conta por e-mail e reenviar confirmação

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída (R1–R8 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0006-auth-confirm-account
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia (decisões de produto: Produto)
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0004 (`users`, `auth_tokens`, e-mail de confirmação), 0005 (`SessionService`, resposta de sessão, guard), 0002, 0003. **Depende de:** 0002, 0003, 0004, 0005. **Destrava:** 0007.

## 1. Escopo

### Dentro do escopo

- `POST /api/v1/auth/confirm-account`: valida o token do link, confirma o e-mail, **abre a sessão** e devolve a resposta de sessão.
- Página `/auth/confirm-account?token=<token>`: confirma ao abrir, guarda o token de sessão e leva a `/app`.
- `POST /api/v1/auth/resend-confirmation` e a página `/auth/resend-confirmation`: pedir um novo link de confirmação.
- Políticas de limite `confirm-account` e `resend-confirmation` (definidas no 0003).

### Fora do escopo

- Criar a conta e o primeiro e-mail de confirmação: 0004 (o gerador do token e o template do e-mail são reaproveitados aqui).
- Emitir e validar sessões: 0005 (aqui só se chama `issue`).
- Login com e-mail e senha, e-mail de nova sessão: 0007 (a confirmação **não** envia "novo login").
- Sign-out, forgot e reset de senha: 0008, 0009 e 0010.
- Mudança de e-mail e reenvio por outros canais (backlog).

## 2. Contexto

O link do e-mail de cadastro (0004) aponta para `/auth/confirm-account?token=...`. Quem clica prova a posse do e-mail e, pelo pedido, já entra logado na home. Se o link expirar ou se perder, sem reenvio a conta ficaria presa (o sign-up responde 409 para o mesmo e-mail), por isso o reenvio entra nesta spec, aceito pelo solicitante.

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

## 3. Necessidade de negócio

| Item                     | Descrição                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Pessoa que acabou de se cadastrar (conta não confirmada).                               |
| Decisão ou ação que muda | Conta passa a ativa e a pessoa entra na plataforma sem digitar a senha de novo.         |
| Resultado esperado       | Link válido confirma a conta, cria a sessão e leva a `/app`; link ruim tem saída clara. |
| Métrica de sucesso       | % de cadastros confirmados; contas presas sem caminho de recuperação = 0.               |

## 4. Requisitos

| ID  | Requisito                                                                              | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `POST /api/v1/auth/confirm-account` com token válido confirma a conta e abre a sessão. | Must       | Given um token `email_confirmation` válido (não usado, não expirado), When `POST {token}`, Then 200 com a resposta de sessão do 0005; `users.email_confirmed_at` fica preenchido, o token ganha `used_at`, e existe uma sessão ativa do usuário; tudo na mesma transação (função SQL chamada por RPC).                                                                                                                                                                                                                                                                  |
| R2  | Token inválido, expirado, já usado ou de outro tipo é recusado com um único código.    | Must       | Given um token desconhecido, expirado, usado ou do tipo `password_reset`, When `POST`, Then 400 `TOKEN_INVALID_OR_EXPIRED` ("This link is invalid or has expired.") sem distinguir o motivo e sem alterar nenhuma linha; corpo sem `token` ou vazio → 400 `VALIDATION_FAILED`.                                                                                                                                                                                                                                                                                          |
| R3  | Uso único sob concorrência.                                                            | Must       | Given duas requisições simultâneas com o mesmo token válido, When ambas chegam, Then exatamente uma devolve 200 e a outra 400 `TOKEN_INVALID_OR_EXPIRED`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| R4  | A nova sessão derruba a anterior.                                                      | Must       | Given o usuário já tinha uma sessão ativa A, When confirmar a conta (sessão B), Then A passa a dar 401 em `GET /api/v1/auth/session` e B dá 200.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R5  | `POST /api/v1/auth/resend-confirmation` com resposta genérica.                         | Must       | Given `{email}` de conta **existente e não confirmada**, When `POST`, Then 202 `{}`, os tokens `email_confirmation` ainda válidos daquele usuário são invalidados (`used_at`), um novo (24 h) é criado e um e-mail igual ao do 0004 é despachado com o novo link; Given e-mail inexistente ou de conta já confirmada, Then a **mesma resposta 202 `{}`** e nenhum e-mail; e-mail inválido → 400 `VALIDATION_FAILED`.                                                                                                                                                    |
| R6  | Limites de requisição.                                                                 | Must       | Given as políticas do 0003, When excesso em `confirm-account` (10/10 min por IP) ou `resend-confirmation` (3/10 min por IP + e-mail), Then 429 `RATE_LIMITED`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| R7  | Página `/auth/confirm-account`.                                                        | Must       | Given o link, When abrir `/auth/confirm-account?token=<válido>`, Then aparece "Confirming your account…" (`role="status"`), em seguida o token de sessão é guardado e a URL final é `/app` com a home; a chamada à API acontece **uma única vez** mesmo em React StrictMode; Given token inválido/expirado/usado ou ausente na URL, Then um `h1` `This link is invalid or has expired` e o link `Request a new confirmation email` para `/auth/resend-confirmation`; falha de rede/5xx mostra `Try again`. A página é acessível mesmo com sessão ativa (regra do 0005). |
| R8  | Página `/auth/resend-confirmation`.                                                    | Must       | Given a página, When enviar um e-mail válido, Then a mensagem "If an account exists for that email and is not confirmed, we sent a new link." aparece, **igual** para qualquer e-mail; campo com `label`, erro de validação em texto, botão desabilitado durante o envio, 429 como mensagem geral; link `Back to sign in` para `/auth/sign-in`.                                                                                                                                                                                                                         |

## 5. Fluxos e estados

- **Caminho feliz:** link no e-mail → `/auth/confirm-account?token=…` → carregando → conta confirmada → sessão guardada → `/app`.
- **Vazio:** link sem `token` → estado de link inválido.
- **Carregando:** `role="status"` com texto; sem flash da tela de erro.
- **Erro:** token ruim (400) → tela de link inválido com saída para o reenvio; 429 → "Too many attempts. Try again in a few minutes."; rede/5xx → `Try again`.
- **Sucesso parcial:** reenvio com e-mail que falha em segundo plano → a pessoa vê a mensagem genérica; erro só no log (sem PII); pode pedir de novo respeitando o limite.
- **Cancelamento/retry:** clicar de novo num link já usado → 400 (a pessoa pode entrar pelo sign-in do 0007). Um novo reenvio invalida o link anterior.
- **Permissões e dados:** rotas públicas. O token do link é segredo: só em hash no banco e fora dos logs; a resposta de reenvio não revela se o e-mail existe. A API não devolve o motivo exato da recusa.

## 6. Acceptance Criteria

- [x] Given token válido, When `POST /api/v1/auth/confirm-account`, Then 200 com sessão, usuário confirmado e token usado. (R1)
- [x] Given token desconhecido, expirado, usado ou do tipo errado, When `POST`, Then 400 `TOKEN_INVALID_OR_EXPIRED` sem mudar dados. (R2)
- [x] Given duas requisições simultâneas, When mesmo token, Then uma 200 e outra 400. (R3)
- [x] Given sessão anterior A, When confirmar (sessão B), Then A → 401 e B → 200. (R4)
- [x] Given e-mails de conta não confirmada, confirmada e inexistente, When `POST resend-confirmation`, Then 202 `{}` idêntico nos três; e-mail enviado só no primeiro caso, com o link antigo invalidado. (R5)
- [x] Given excesso de requisições, When as políticas estouram, Then 429. (R6)
- [x] Given o E2E completo (sign-up → ler o e-mail capturado → abrir o link), When confirmar, Then a URL final é `/app` e a home mostra o nome; Given o mesmo link de novo, Then a tela de link inválido. (R7) _(E2E: a conta não confirmada é semeada no banco e o e-mail vem do reenvio; ver §11)_
- [x] Given a página de reenvio, When enviar e-mails diferentes, Then a mensagem é idêntica. (R8)
- [x] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam.

## 7. O que fazer

1. Criar os casos de uso `ConfirmAccount` e `ResendConfirmation` no módulo `auth`, reutilizando o gerador/hash de token e o template de e-mail do 0004 (se ele estiver embutido no caso de uso do sign-up, extrair para um componente compartilhado dentro do módulo).
2. Implementar a transação de R1/R3 como função SQL chamada por RPC (consumo atômico do token, por exemplo `update ... where used_at is null and expires_at > now() returning`) e chamar `SessionService.issue`.
3. Criar os endpoints com `@Public()` e as políticas de limite do 0003.
4. No SPA: páginas `/auth/confirm-account` e `/auth/resend-confirmation` em `features/auth`, mutation com TanStack Query, guarda para chamar uma única vez e gravação do token de sessão via módulo do 0005.
5. Escrever testes: unitário (estados das páginas), integração (R1 a R6), E2E (cadastro → e-mail → confirmação → `/app`; link reutilizado; reenvio).
6. Atualizar `.docs/` (rotas e endpoints) e executar os gates.

## 8. O que não fazer

- Não enviar o e-mail de "nova sessão" na confirmação.
- Não distinguir "expirado" de "inválido" na resposta.
- Não revelar se o e-mail existe no reenvio; não enviar e-mail para conta confirmada.
- Não confirmar conta por `GET` (efeito colateral em GET; prefetchers de e-mail abririam o link): a confirmação é `POST` disparado pela página.
- Não logar token, link ou e-mail.
- Não criar sessão sem consumir o token na mesma transação.

## 9. Riscos e dependências

| Tipo        | Descrição                                                               | Mitigação                                                                                              |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Risco       | Scanners de e-mail pré-abrem links.                                     | A página só confirma por `POST` ao carregar no browser; um bot que não executa JS não consome o token. |
| Risco       | React StrictMode dispara o efeito duas vezes e a segunda chamada falha. | Chamada única garantida (R7) e teste.                                                                  |
| Risco       | Sessão aberta por quem tem acesso ao e-mail (token no link).            | Aceito pelo pedido; token de uso único, 24 h, hash no banco.                                           |
| Dependência | 0005 (`issue`) e 0004 (token/template).                                 | Ordem do mapa.                                                                                         |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run infra:up`; `bun run db:migrate`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`.
- **Evidência esperada:** gates com código 0; E2E do fluxo cadastro → confirmação.
- **Comportamento observável:** clicar no link do e-mail local leva a `/app` com o nome da pessoa; o mesmo link de novo mostra "This link is invalid or has expired".

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                   | Impacto                                                           | Bloqueante?     | Quem decide        |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------- | ------------------ |
| **Decisão (2026-11-09):** confirmar conta não envia e-mail de "nova sessão" (o e-mail de confirmação já é o aviso). | Pedido de e-mail por sessão vale para o sign-in (0007).           | Não (resolvida) | Solicitante        |
| Premissa: resposta de reenvio é a mesma para conta confirmada, não confirmada e inexistente.                        | Evita enumeração (o 409 do sign-up já revela existência: aceito). | Não             | Produto            |
| Premissa: o tempo de resposta do reenvio não é equalizado, porque o e-mail é despachado em segundo plano.           | Diferença de tempo mínima.                                        | Não             | Time de engenharia |
| Pergunta: o reenvio tem texto próprio ou usa o e-mail do 0004? Premissa: o mesmo template.                          | Conteúdo do e-mail.                                               | Não             | Produto            |
| Premissa (implementação): a função SQL consome o token e confirma o e-mail numa transação; a sessão é aberta logo depois por `SessionService.issue`. Se isso falhar (banco fora do ar), a conta já está confirmada e a pessoa entra pelo sign-in (0007). | Nunca existe sessão sem token consumido; o inverso é possível e inofensivo. | Não | Time de engenharia |
| Premissa (implementação): token de link ausente, vazio ou que não seja texto na URL cai no estado de link inválido, sem chamar a API. | Evita requisição inútil.                      | Não             | Time de engenharia |
| Premissa (implementação): os E2E semeiam a conta não confirmada direto no banco, porque a política `sign-up` (5/hora por IP) já é consumida pelos outros specs; o e-mail do link vem do reenvio. | Cobertura de sign-up fica no E2E do 0004. | Não | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                | Motivo                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                                                          | Capacidade "confirmar conta"; reenvio incluído por escolha do solicitante. |
| 2026-11-09 | Transação do R1/R3 passa a ser função SQL chamada por RPC; e-mail do E2E lido pelo provider `capture`; ausência de e-mail de nova sessão passou a decisão. | Respostas do quiz de perguntas abertas.                                    |
| 2026-11-09 | Implementada (`implement-me`): migration `20261109230000`, casos de uso, endpoints, páginas, testes e docs; premissas de implementação registradas em §11. | Execução da spec. |
