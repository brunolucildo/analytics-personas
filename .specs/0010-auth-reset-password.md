# 0010 — Redefinir a senha (reset password)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** rascunho
- **Slug:** 0010-auth-reset-password
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia (decisões de produto: Produto)
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0002 (e-mail), 0003 (limite), 0005 (`SessionService`, revogação), 0009 (token de reset e link), `.docs/DEVELOPMENT.md` §6. **Depende de:** 0002, 0003, 0005, 0007 (login para provar que a senha nova vale), 0009. **Destrava:** nenhuma.

## 1. Escopo

### Dentro do escopo

- `POST /api/v1/auth/reset-password` e a página `/auth/reset-password?token=<token>` (token, nova senha, confirmação).
- Troca da senha (Argon2id), consumo do token, **revogação de todas as sessões do usuário** e **e-mail de sucesso**.
- Navegação para `/auth/sign-in` com aviso de sucesso.
- Política de limite `reset-password` (definida no 0003).

### Fora do escopo

- Pedir o link de reset: 0009.
- Entrar automaticamente depois do reset (a pessoa segue para o sign-in, como pedido).
- Trocar senha estando logado, política de histórico de senhas, verificação de senha vazada (backlog).
- Confirmar a conta por meio do reset (a conta já é confirmada; ver 0009).

## 2. Contexto

O link recebido no 0009 abre `/auth/reset-password?token=...`. A pessoa define a nova senha duas vezes (devem coincidir). Como a senha mudou, qualquer sessão existente pode estar nas mãos de quem a descobriu; por isso as sessões são revogadas. O e-mail de sucesso avisa a pessoa de que a senha mudou (e serve de alerta se não foi ela).

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

| Item                     | Descrição                                                                         |
| ------------------------ | --------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Pessoa que pediu a redefinição (0009).                                            |
| Decisão ou ação que muda | A pessoa define uma nova senha e volta a entrar.                                  |
| Resultado esperado       | Senha trocada, sessões antigas encerradas, aviso por e-mail e retorno ao sign-in. |
| Métrica de sucesso       | Resets concluídos / pedidos (0009); nenhuma sessão antiga sobrevive a um reset.   |

## 4. Requisitos

| ID  | Requisito                                                                        | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `POST /api/v1/auth/reset-password` troca a senha com token válido.               | Must       | Given um token `password_reset` válido (não usado, não expirado), When `POST {token, password, confirmPassword}` válidos, Then 204 sem corpo; `password_hash` é substituído por um novo hash Argon2id; o token ganha `used_at`; os demais tokens `password_reset` do usuário também são invalidados; tudo na mesma transação (função SQL chamada por RPC). A senha antiga deixa de funcionar e a nova funciona no `POST /api/v1/auth/sign-in` (0007).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R2  | Validação antes de consumir o token.                                             | Must       | Given `password` fora de 8 a 128 caracteres, `confirmPassword` diferente (mensagem "Passwords do not match") ou campos ausentes/extras, When `POST`, Then 400 `VALIDATION_FAILED` com `details` por campo e o token **não** é consumido (pode tentar de novo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R3  | Token inválido, expirado, usado ou de outro tipo é recusado com um único código. | Must       | Given token desconhecido, expirado, usado ou do tipo `email_confirmation`, When `POST` com senhas válidas, Then 400 `TOKEN_INVALID_OR_EXPIRED` ("This link is invalid or has expired.") sem alterar senha, tokens ou sessões.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R4  | Uso único sob concorrência.                                                      | Must       | Given duas requisições simultâneas com o mesmo token e senhas diferentes, When ambas chegam, Then exatamente uma devolve 204 e a outra 400 `TOKEN_INVALID_OR_EXPIRED`; vale a senha da que teve sucesso.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R5  | Todas as sessões do usuário são revogadas.                                       | Must       | Given o usuário tinha uma sessão ativa A, When o reset conclui, Then `GET /api/v1/auth/session` com A devolve 401 e nenhuma sessão ativa do usuário resta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R6  | E-mail de sucesso.                                                               | Must       | Given reset concluído, When ler a mensagem capturada, Then é entregue ao `EmailService` uma mensagem em inglês, assunto "Your Analytics Personas password was changed", com o primeiro nome, data e hora em UTC e o aviso "If you didn't do this, reset your password again" com link `${APP_URL}/auth/forgot-password`; sem senha, token ou IP; falha do provedor de e-mail não muda o 204 e só gera log sem PII. Reset recusado (R2, R3) não envia e-mail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R7  | Limite de requisições.                                                           | Must       | Given a política `reset-password` do 0003, When a 11ª requisição em 10 min do mesmo IP, Then 429 `RATE_LIMITED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R8  | Página `/auth/reset-password`.                                                   | Must       | Given o link, When abrir `/auth/reset-password?token=<token>`, Then o token é lido, mantido em memória e **removido da URL** (`history.replaceState`) logo ao carregar, e há um `h1` `Choose a new password`, campos `New password` e `Confirm new password` com `label` e senha mascarada, botão `Reset password`; senhas diferentes e tamanho inválido aparecem em texto junto ao campo antes do envio; durante o envio o botão fica desabilitado; sucesso remove o token de sessão local (se houver), e a URL final é `/auth/sign-in` com o aviso "Your password was updated. Sign in with your new password." (`role="status"`); token recusado (400) mostra `This link is invalid or has expired` com o link `Request a new reset link` para `/auth/forgot-password`; sem `token` na URL (inclusive ao recarregar depois da remoção) mostra o mesmo estado de link inválido; 429 e rede/5xx como mensagem geral; a página é acessível mesmo com sessão ativa (regra do 0005); teclado, foco visível, 375/768/1280 px. |

## 5. Fluxos e estados

- **Caminho feliz:** link → página → nova senha duas vezes → `204` → sessão local limpa → `/auth/sign-in` com aviso → login com a nova senha.
- **Vazio:** link sem token → estado de link inválido.
- **Carregando:** botão desabilitado com indicador; campos preservados.
- **Erro:** validação (400) por campo, sem gastar o token; link inválido/expirado/usado (400) com saída para pedir outro; 429; rede/5xx com `Try again`.
- **Sucesso parcial:** senha trocada e e-mail de sucesso com falha → 204 normal; erro só no log.
- **Cancelamento/retry:** reabrir um link já usado mostra o estado de link inválido; pedir novo link no 0009.
- **Permissões e dados:** rota pública; o token do link é o único segredo de autorização e é de uso único, 1 h, só em hash no banco. A senha nunca é logada nem devolvida. Revogar as sessões é obrigatório: impede que uma sessão pré-existente sobreviva à troca.

## 6. Acceptance Criteria

- [ ] Given token válido e senhas válidas, When `POST /api/v1/auth/reset-password`, Then 204; senha nova no sign-in funciona e a antiga não. (R1)
- [ ] Given senhas inválidas ou diferentes, When `POST`, Then 400 `VALIDATION_FAILED` e o mesmo token ainda serve depois. (R2)
- [ ] Given token desconhecido, expirado, usado ou do tipo errado, When `POST`, Then 400 `TOKEN_INVALID_OR_EXPIRED`. (R3)
- [ ] Given duas requisições simultâneas, When mesmo token, Then uma 204 e outra 400. (R4)
- [ ] Given sessão ativa A, When reset conclui, Then A → 401. (R5)
- [ ] Given reset concluído e reset recusado, When ler as mensagens capturadas, Then só o primeiro gera e-mail "Your Analytics Personas password was changed". (R6)
- [ ] Given 11 requisições em 10 min do mesmo IP, When a 11ª, Then 429. (R7)
- [ ] Given o E2E (sign-up → confirmar → forgot → ler o e-mail → abrir o link → nova senha), When concluir, Then a URL final é `/auth/sign-in` com o aviso e o login com a nova senha leva a `/app`; Given o mesmo link de novo, Then estado de link inválido. (R8)
- [ ] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam.

## 7. O que fazer

1. Criar o caso de uso `ResetPassword` no módulo `auth`: validar DTO primeiro; depois, em uma função SQL chamada por RPC (transação), consumir o token de forma atômica (`update ... where used_at is null and expires_at > now() returning`), gravar o novo hash, invalidar os demais tokens `password_reset` do usuário e revogar as sessões (via `SessionService`).
2. Montar o e-mail de sucesso com o layout do 0002 e despachá-lo depois do commit.
3. Criar o endpoint com `@Public()` e `@RateLimit('reset-password')`.
4. Criar a página `/auth/reset-password` e o aviso de sucesso do sign-in (parâmetro de busca `reset=success` ou estado de navegação) em `features/auth`; limpar o token local no sucesso.
5. Escrever testes de integração (R1 a R7), unitário (página e aviso) e E2E (R8).
6. Atualizar `.docs/` com a lista final de rotas e endpoints de auth e executar os gates e o checklist manual.

## 8. O que não fazer

- Não abrir sessão automaticamente depois do reset.
- Não gastar o token quando a validação da senha falha.
- Não distinguir "expirado", "usado" e "inexistente" na resposta.
- Não deixar sessões antigas ativas.
- Não logar senha, token, link ou e-mail.
- Não reutilizar o token de confirmação como token de reset (tipos separados).

## 9. Riscos e dependências

| Tipo        | Descrição                                            | Mitigação                                                                                                                                 |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Risco       | Quem controla a caixa de e-mail controla a conta.    | Inerente ao fluxo; token curto (1 h), uso único, e-mail de aviso e revogação de sessões.                                                  |
| Risco       | Corrida entre dois resets com o mesmo token.         | Consumo atômico do token (R4).                                                                                                            |
| Risco       | Token do link vazar por `Referer` ou histórico.      | A página não carrega recursos de terceiros; o token é removido da URL ao carregar (R8); considerar também `Referrer-Policy: no-referrer`. |
| Dependência | 0005 (revogação de sessões) e 0009 (token de reset). | Ordem do mapa.                                                                                                                            |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run infra:up`; `bun run db:migrate`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`.
- **Evidência esperada:** gates com código 0; e-mail "Your Analytics Personas password was changed" capturado no teste (e, com `EMAIL_PROVIDER=mailtrap`, visível na caixa do Mailtrap); sessão antiga com 401.
- **Comportamento observável:** o link do e-mail de reset leva à página de nova senha; ao concluir, a pessoa vai ao sign-in e entra com a nova senha; o mesmo link de novo mostra "This link is invalid or has expired".

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                                    | Impacto                            | Bloqueante?     | Quem decide        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------- | ------------------ |
| Premissa: o reset não confirma a conta nem abre sessão; só troca a senha e segue para o sign-in.                                     | Pedido do solicitante.             | Não             | Produto            |
| Premissa: o aviso de sucesso no sign-in vem por parâmetro de busca `reset=success` (reaproveitável e testável).                      | Detalhe de implementação do aviso. | Não             | Time de engenharia |
| **Decisão (2026-11-09):** o token é removido da URL logo ao carregar a página (R8); recarregar exige abrir o link do e-mail de novo. | Segurança acima da conveniência.   | Não (resolvida) | Solicitante        |
| Premissa: não há checagem de "nova senha igual à antiga".                                                                            | Segurança marginal.                | Não             | Produto            |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                           | Motivo                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                                                     | Capacidade "resetar senha".                                                                |
| 2026-11-09 | Dependência de 0007 declarada.                                                                                                                        | Verificação de consistência do `breakdown-specs`: R1 e o E2E do R8 usam o sign-in do 0007. |
| 2026-11-09 | Token removido da URL ao carregar a página (R8); transação do R1 vira função SQL chamada por RPC; e-mail verificado pelo provider `capture`/Mailtrap. | Respostas do quiz de perguntas abertas.                                                    |
