# 0009 — Esqueci a senha (solicitar redefinição)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída (R1–R7 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0009-auth-forgot-password
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia (decisões de produto: Produto)
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0002 (e-mail), 0003 (limite), 0004 (`users`, `auth_tokens`), 0007 (link `Forgot your password?` e o e-mail de nova sessão apontam para esta página). **Depende de:** 0002, 0003, 0004. **Destrava:** 0010.

## 1. Escopo

### Dentro do escopo

- `POST /api/v1/auth/forgot-password` e a página `/auth/forgot-password`.
- Criação de um token de redefinição (`password_reset`, 1 h) e envio do e-mail com o link `${APP_URL}/auth/reset-password?token=<token>`, **só** quando a conta existir e estiver confirmada.
- Resposta idêntica em qualquer caso (conta existente, inexistente, não confirmada).
- Política de limite `forgot-password` (definida no 0003).

### Fora do escopo

- A página de reset, a troca da senha, o e-mail de sucesso e a revogação das sessões: 0010.
- Reenviar confirmação para conta não confirmada: 0006 (esta spec não envia nada a conta não confirmada).
- Recuperação por SMS, perguntas de segurança, suporte humano (backlog).

## 2. Contexto

A pessoa que esqueceu a senha informa o e-mail; se houver conta, recebe um link. Para não revelar quais e-mails têm conta (ao contrário do sign-up, que responde 409 por decisão do solicitante), a resposta desta rota é sempre a mesma. Contas não confirmadas não recebem e-mail de reset: o caminho delas é o reenvio da confirmação (0006).

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

| Item                     | Descrição                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Pessoa que perdeu a senha.                                                                      |
| Decisão ou ação que muda | A pessoa recupera o acesso sozinha, sem suporte.                                                |
| Resultado esperado       | Quem tem conta confirmada recebe o link; ninguém descobre por esta rota se um e-mail tem conta. |
| Métrica de sucesso       | Pedidos de reset que terminam em senha trocada (0010); 0 diferenças observáveis entre os casos. |

## 4. Requisitos

| ID  | Requisito                                                      | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Resposta genérica idêntica.                                    | Must       | Given `{email}` de conta confirmada, de conta não confirmada e de e-mail inexistente, When `POST /api/v1/auth/forgot-password`, Then os três recebem **o mesmo status 202, os mesmos cabeçalhos relevantes e o mesmo corpo `{}`**. E-mail ausente ou malformado → 400 `VALIDATION_FAILED`.                                                                                                                                                                                                                                                                                                 |
| R2  | Conta confirmada recebe token e e-mail.                        | Must       | Given conta confirmada, When `POST`, Then existe um `auth_tokens` `password_reset` com `expires_at` = agora + 1 h, `used_at` nulo e só o hash SHA-256; uma mensagem é entregue ao `EmailService` (no teste, capturada), em inglês, assunto "Reset your Analytics Personas password", com o primeiro nome, o aviso de validade de 1 hora, "If you didn't request this, you can ignore this email" e o link `${APP_URL}/auth/reset-password?token=<token>` cujo hash é o `token_hash`; o texto puro traz o mesmo link.                                                                       |
| R3  | Conta inexistente ou não confirmada não gera token nem e-mail. | Must       | Given e-mail inexistente ou de conta não confirmada, When `POST`, Then nenhuma linha em `auth_tokens` e nenhuma mensagem enviada ao `EmailService`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R4  | Pedido novo invalida o anterior.                               | Must       | Given um token de reset ainda válido do usuário, When novo `POST`, Then o anterior recebe `used_at` e só o novo é utilizável; o usuário nunca tem dois tokens `password_reset` válidos ao mesmo tempo.                                                                                                                                                                                                                                                                                                                                                                                     |
| R5  | E-mail em segundo plano; falha não muda a resposta.            | Must       | Given o provedor de e-mail indisponível, When `POST` de conta confirmada, Then 202 `{}` igual ao caso normal e o erro só no log (sem PII); o envio não bloqueia a resposta (para não vazar existência por tempo).                                                                                                                                                                                                                                                                                                                                                                          |
| R6  | Limite de requisições.                                         | Must       | Given a política `forgot-password` do 0003, When a 4ª requisição em 10 min para o mesmo IP + e-mail, Then 429 `RATE_LIMITED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R7  | Página `/auth/forgot-password`.                                | Must       | Given o app, When abrir `/auth/forgot-password`, Then há um `h1` `Forgot your password?`, texto explicativo, campo `Email` com `label`, botão `Send reset link` e link `Back to sign in`; erro de validação em texto junto ao campo; durante o envio o botão fica desabilitado; sucesso mostra, para **qualquer** e-mail, "If an account exists for that email, we sent instructions to reset your password." (`role="status"`) e esconde o formulário; 429 e rede/5xx como mensagem geral; teclado, foco visível, 375/768/1280 px. Quem já está logado é levado a `/app` (regra do 0005). |

## 5. Fluxos e estados

- **Caminho feliz:** pessoa informa o e-mail → API responde 202 → SPA mostra a mensagem genérica → (conta confirmada) e-mail chega com o link.
- **Vazio:** formulário inicial sem erro.
- **Carregando:** botão desabilitado com indicador.
- **Erro:** 400 por campo; 429 com espera; rede/5xx com `Try again`, preservando o e-mail digitado.
- **Sucesso parcial:** e-mail falha em segundo plano → a pessoa vê a mensagem normal e pode pedir de novo (respeitando o limite).
- **Cancelamento/retry:** pedir de novo é seguro: o novo link invalida o anterior.
- **Permissões e dados:** rota pública. O e-mail informado é PII e não vai para log; o token só existe em hash no banco. A resposta e o tempo não revelam a existência da conta.

## 6. Acceptance Criteria

- [ ] Given conta confirmada, não confirmada e inexistente, When `POST /api/v1/auth/forgot-password`, Then respostas idênticas 202 `{}`. (R1)
- [ ] Given conta confirmada, When `POST`, Then token `password_reset` de 1 h (hash) e e-mail com o link correto. (R2)
- [ ] Given conta inexistente ou não confirmada, When `POST`, Then nenhum token e nenhum e-mail. (R3)
- [ ] Given dois pedidos seguidos, When o segundo conclui, Then só o último token vale. (R4)
- [ ] Given o provedor de e-mail indisponível, When `POST` de conta confirmada, Then 202 `{}` e erro só no log. (R5)
- [ ] Given 4 pedidos em 10 min (mesmo IP + e-mail), When o 4º, Then 429. (R6)
- [ ] Given a página, When enviar um e-mail existente e outro inexistente, Then a mensagem é idêntica; When e-mail inválido, Then erro no campo. (R7)
- [ ] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam.

## 7. O que fazer

1. Criar o caso de uso `RequestPasswordReset` no módulo `auth`: busca por e-mail normalizado, ramo "confirmada" (invalida tokens `password_reset` anteriores, cria o novo, despacha o e-mail depois do commit) e ramo "sem ação"; ambos terminam em `202 {}`.
2. Montar o e-mail de reset com o layout do 0002.
3. Criar o endpoint com `@Public()` e `@RateLimit('forgot-password')`.
4. Criar a página `/auth/forgot-password` em `features/auth`.
5. Escrever testes de integração (R1 a R6, inclusive a comparação byte a byte de corpo e status), unitário (página) e E2E (pedido → mensagem → e-mail capturado, com a API em `EMAIL_PROVIDER=capture`).
6. Atualizar `.docs/` e executar os gates e o checklist manual.

## 8. O que não fazer

- Não revelar, por status, corpo, mensagem ou tempo, se o e-mail tem conta.
- Não enviar e-mail de reset a conta não confirmada.
- Não aceitar token de reset como confirmação de conta nem o contrário (tipos separados).
- Não logar e-mail, token ou link.
- Não criar a página de reset nem alterar senha aqui.

## 9. Riscos e dependências

| Tipo        | Descrição                                               | Mitigação                                                                                                     |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Risco       | Enumeração por tempo de resposta.                       | E-mail despachado em segundo plano (R5); diferença residual de consulta ao banco aceita.                      |
| Risco       | Spam de e-mail para um endereço alvo.                   | Limite por IP + e-mail do 0003.                                                                               |
| Risco       | Pessoa não confirmada fica sem e-mail e sem explicação. | Mensagem genérica por decisão; o caminho dela é o reenvio de confirmação (0006), que o sign-in (0007) indica. |
| Dependência | 0002, 0003 e 0004 (`auth_tokens`).                      | Ordem do mapa.                                                                                                |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run infra:up`; `bun run db:migrate`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`.
- **Evidência esperada:** gates com código 0; e-mail "Reset your Analytics Personas password" capturado no teste (e, com `EMAIL_PROVIDER=mailtrap`, visível na caixa do Mailtrap) só para conta confirmada.
- **Comportamento observável:** a página mostra a mesma mensagem para e-mails existentes e inexistentes.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                            | Impacto                                                           | Bloqueante? | Quem decide        |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------- | ------------------ |
| Premissa: conta não confirmada não recebe e-mail de reset (resposta genérica) e deve usar o reenvio do 0006. | Se o produto preferir que o reset confirme o e-mail, muda o 0010. | Não         | Produto            |
| Premissa: o 202 não devolve nenhum dado no corpo (`{}`).                                                     | Contrato do SPA.                                                  | Não         | Time de engenharia |
| Premissa: o link de reset não derruba as sessões ao ser pedido; só a troca de senha (0010) revoga sessões.   | Segurança vs. conveniência.                                       | Não         | Produto            |
| Premissa (implementação): sem `@Public()` nesta spec, porque o guard global é da 0005; a rota já é pública hoje. | A 0005 deve marcar `forgot-password` como pública ao instalar o guard. | Não         | Time de engenharia |
| Premissa (implementação): o redirecionamento de quem já está logado para `/app` (R7) é regra da 0005; a página não consulta sessão. | A 0005 acrescenta o redirecionamento na rota. | Não         | Time de engenharia |
| Premissa (implementação): `Back to sign in` aponta para `/auth/sign-in` (0007, ainda sem página: cai na 404 até lá); o E2E verifica só o `href`. | Link temporariamente quebrado. | Não         | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                                                                                 | Motivo                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                           | Capacidade "esqueci a senha".                                    |
| 2026-11-09 | Verificação do e-mail passa a usar o provider `capture` (testes) e Mailtrap (manual), no lugar do servidor local de e-mail. | Decisão sobre provedores de e-mail no quiz de perguntas abertas. |
| 2026-11-09 | Implementada (`implement-me`, modo orquestrado): premissas sobre `@Public()`, redirecionamento de logado e a rota `/auth/sign-in` registradas em §11; status `concluída`. | Execução da spec. |
