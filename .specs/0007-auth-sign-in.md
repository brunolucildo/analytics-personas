# 0007 — Login com e-mail e senha (sign-in)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** rascunho
- **Slug:** 0007-auth-sign-in
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia (decisões de produto: Produto)
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0002 (e-mail), 0003 (limite), 0005 (sessão e guard), 0006 (conta confirmada e página de reenvio), `.docs/QA.md`. **Depende de:** 0002, 0003, 0005, 0006. **Destrava:** nenhuma spec diretamente (0008 depende do 0005).

## 1. Escopo

### Dentro do escopo

- `POST /api/v1/auth/sign-in` com e-mail e senha, a página `/auth/sign-in` e a navegação para `/app`.
- Abertura de sessão **única** (a anterior do mesmo usuário é derrubada) e envio do **e-mail de nova sessão** a cada login.
- Recusa de credenciais inválidas e de conta não confirmada, com a mensagem e o atalho certos.
- Política de limite `sign-in` (definida no 0003).
- E2E do fluxo completo de ponta a ponta (cadastro → confirmação → logout manual por limpeza do token → login) e do cenário de duas máquinas.

### Fora do escopo

- Cadastro (0004), confirmação e reenvio (0006), sessão e guard (0005).
- Sign-out (0008), esqueci a senha (0009), reset (0010).
- Bloqueio de conta após N falhas, captcha, MFA, login social, "lembrar de mim" (backlog).
- Listar ou encerrar outras sessões (não existe: a sessão é única).
- Informar IP, dispositivo ou localização no e-mail (o sistema não coleta nem registra IP).

## 2. Contexto

Com a conta confirmada (0006), a pessoa entra com e-mail e senha. Pelo pedido: cada login envia um e-mail de nova sessão, e **só a última sessão de cada pessoa vale**: logar em outra máquina derruba a anterior (a regra fica no `SessionService` do 0005; aqui ela é exercitada por um fluxo real).

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

| Item                     | Descrição                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Pessoa com conta confirmada.                                                                               |
| Decisão ou ação que muda | A pessoa acessa a plataforma com suas credenciais e é avisada de cada nova sessão.                         |
| Resultado esperado       | Login com credenciais válidas leva a `/app`; credenciais ruins são recusadas sem vazar informação.         |
| Métrica de sucesso       | Taxa de login bem-sucedido; 0 sessões simultâneas por usuário; e-mail de nova sessão para 100% dos logins. |

## 4. Requisitos

| ID  | Requisito                                                          | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `POST /api/v1/auth/sign-in` com credenciais válidas abre a sessão. | Must       | Given usuário confirmado, When `POST {email, password}` (e-mail com caixa e espaços diferentes), Then 200 com a resposta de sessão do 0005 e uma sessão ativa do usuário.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R2  | Credenciais inválidas dão resposta única.                          | Must       | Given e-mail inexistente ou senha errada, When `POST`, Then 401 `INVALID_CREDENTIALS` ("Invalid email or password.") com status, código, mensagem e corpo **idênticos** nos dois casos; o servidor executa a verificação de hash também quando o e-mail não existe (tempo comparável) e não cria sessão. Corpo inválido (campo ausente, e-mail malformado) → 400 `VALIDATION_FAILED`.                                                                                                                                                                                                                                                                                                    |
| R3  | Conta não confirmada só é revelada com a senha correta.            | Must       | Given usuário não confirmado, When `POST` com a senha **correta**, Then 403 `EMAIL_NOT_CONFIRMED` e nenhuma sessão; com a senha **errada**, Then 401 `INVALID_CREDENTIALS` (igual ao R2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R4  | Sessão única comprovada por fluxo real.                            | Must       | Given dois logins seguidos do mesmo usuário (tokens A e B), When `GET /api/v1/auth/session` com A, Then 401 `UNAUTHENTICATED`; com B, Then 200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R5  | E-mail de nova sessão a cada login bem-sucedido.                   | Must       | Given um login bem-sucedido, When concluído, Then uma mensagem é entregue ao `EmailService` (no teste, capturada pelo provider `capture`) para o endereço, em inglês, com assunto "New sign-in to Analytics Personas", primeiro nome, data e hora em UTC, aviso "If this wasn't you, reset your password" com link `${APP_URL}/auth/forgot-password` e a informação de que a sessão anterior foi encerrada; sem IP, dispositivo, token ou senha. Login com falha **não** envia e-mail.                                                                                                                                                                                                   |
| R6  | Falha no e-mail não falha o login.                                 | Must       | Given o provedor de e-mail indisponível, When login válido, Then 200 com a sessão e o erro é registrado sem PII.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R7  | Limite de requisições.                                             | Must       | Given a política `sign-in` do 0003, When a 11ª tentativa em 10 min para o mesmo IP + e-mail, Then 429 `RATE_LIMITED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R8  | Página `/auth/sign-in`.                                            | Must       | Given o app, When abrir `/auth/sign-in`, Then há um `h1` `Sign in`, campos `Email` e `Password` com `label` (senha mascarada), botão `Sign in`, links `Forgot your password?` (`/auth/forgot-password`) e `Create an account` (`/auth/sign-up`); sucesso guarda o token (módulo do 0005) e leva a `/app`; `401` mostra "Invalid email or password." como mensagem geral (`role="alert"`) sem apontar o campo; `403` mostra "Confirm your email to sign in." com o link `Resend confirmation email` para `/auth/resend-confirmation`; `429` e rede/5xx como mensagem geral; botão desabilitado durante o envio; o campo de senha é limpo em erro; teclado, foco visível, 375/768/1280 px. |
| R9  | Fluxo completo comprovado em E2E.                                  | Should     | Given API (com `EMAIL_PROVIDER=capture`), Supabase e app locais, When sign-up → ler o e-mail capturado → confirmar → limpar o token do browser → `/auth/sign-in` com as credenciais, Then termina em `/app`; Given um segundo contexto de browser que também faz login, When o primeiro contexto navega, Then é levado a `/auth/sign-in`.                                                                                                                                                                                                                                                                                                                                                |

## 5. Fluxos e estados

- **Caminho feliz:** pessoa informa e-mail e senha → API valida, abre sessão (derrubando a anterior), despacha o e-mail de nova sessão → SPA guarda o token → `/app`.
- **Vazio:** formulário inicial sem erro.
- **Carregando:** botão desabilitado com indicador.
- **Erro:** 400 por campo; 401 genérico; 403 com atalho para reenviar a confirmação; 429 com mensagem de espera; rede/5xx com opção de tentar de novo; campos preservados exceto a senha.
- **Sucesso parcial:** login ok e e-mail de aviso falho → a pessoa entra normalmente; erro só no log (sem PII).
- **Cancelamento/retry:** repetir o login a qualquer momento é seguro: gera uma nova sessão e invalida a anterior (inclusive a própria sessão antiga do mesmo browser).
- **Permissões e dados:** rota pública. A senha trafega só no corpo HTTPS e nunca é logada; a resposta nunca devolve hash nem campos internos. O aviso por e-mail serve de sinal de uso indevido para a pessoa dona da conta.

## 6. Acceptance Criteria

- [ ] Given usuário confirmado, When `POST /api/v1/auth/sign-in` (com e-mail em caixa diferente), Then 200 com sessão ativa. (R1)
- [ ] Given e-mail inexistente e senha errada, When `POST`, Then respostas idênticas 401 `INVALID_CREDENTIALS`. (R2)
- [ ] Given conta não confirmada, When senha correta, Then 403 `EMAIL_NOT_CONFIRMED`; When senha errada, Then 401. (R3)
- [ ] Given dois logins, When usar o primeiro token, Then 401; o segundo, 200. (R4)
- [ ] Given login válido, When ler a mensagem capturada, Then e-mail "New sign-in to Analytics Personas" sem PII extra; login falho não envia. (R5)
- [ ] Given o provedor de e-mail indisponível, When login válido, Then 200. (R6)
- [ ] Given 11 tentativas em 10 min (mesmo IP + e-mail), When a 11ª, Then 429. (R7)
- [ ] Given a página, When credenciais válidas / inválidas / conta não confirmada, Then `/app` / mensagem geral / mensagem com link de reenvio. (R8)
- [ ] Given o E2E completo e o segundo contexto de browser, When o segundo loga, Then o primeiro é redirecionado a `/auth/sign-in`. (R9)
- [ ] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam.

## 7. O que fazer

1. Criar o caso de uso `SignIn` no módulo `auth` (busca por e-mail normalizado, verificação Argon2id com hash "fantasma" quando o usuário não existe, checagem de confirmação depois da senha, `SessionService.issue`).
2. Montar o e-mail de nova sessão com o layout do 0002 e despachá-lo depois do commit da sessão.
3. Criar o endpoint com `@Public()` e `@RateLimit('sign-in')`.
4. Criar a página `/auth/sign-in` em `features/auth` e ligar o grupo `/auth` ao redirecionamento do 0005 (quem já está logado vai para `/app`).
5. Ajustar o `playwright.config.ts` para subir API e dependências necessárias aos E2E de auth (documentar em `QA.md` que o E2E de auth exige `infra:up` e a API); escrever o E2E do R9.
6. Escrever testes de unidade (formulário e estados), integração (R1 a R7) e E2E.
7. Atualizar `.docs/` e executar os gates e o checklist manual de UI e acessibilidade.

## 8. O que não fazer

- Não diferenciar "e-mail não existe" de "senha errada".
- Não criar sessão para conta não confirmada.
- Não enviar IP, user agent ou localização no e-mail; não coletá-los.
- Não manter a sessão antiga ativa "por compatibilidade".
- Não logar senha, token, e-mail do usuário nem IP.
- Não implementar bloqueio por contagem de falhas além do limite do 0003.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                            | Mitigação                                                                               |
| ----------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Risco       | Enumeração de contas por tempo de resposta.                                          | Verificação de hash também quando o e-mail não existe (R2).                             |
| Risco       | Força bruta de senhas.                                                               | Limite do 0003; senha de 8+ caracteres; bloqueio de conta fica no backlog.              |
| Risco       | Um atacante com a senha derruba a sessão legítima.                                   | Efeito da regra de sessão única (pedido do solicitante); mitigado pelo e-mail de aviso. |
| Risco       | E2E de auth depende de API e Supabase local no ar e do provider `capture` de e-mail. | Documentado em `QA.md`; falha com mensagem acionável.                                   |
| Dependência | 0002, 0003, 0005 e 0006.                                                             | Ordem do mapa.                                                                          |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run infra:up`; `bun run db:migrate`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`.
- **Evidência esperada:** gates com código 0; e-mail "New sign-in to Analytics Personas" capturado no teste (e, com `EMAIL_PROVIDER=mailtrap`, visível na caixa do Mailtrap em verificação manual).
- **Comportamento observável:** login leva a `/app` com o nome; logar numa segunda janela derruba a primeira.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                         | Impacto                                            | Bloqueante? | Quem decide |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------- | ----------- |
| Premissa: o e-mail de nova sessão traz só data/hora UTC, sem IP nem dispositivo (regra "sem IP em log" e nenhuma coleta). | Menos útil para investigar acesso indevido.        | Não         | Produto     |
| Premissa: a pessoa derrubada não vê aviso específico, só volta ao sign-in.                                                | UX de "você entrou em outro lugar" no backlog.     | Não         | Produto     |
| Premissa: não há bloqueio de conta, só o limite por IP + e-mail do 0003.                                                  | Proteção contra força bruta distribuída é parcial. | Não         | Produto     |

## 12. Refinamento

| Data       | O que mudou                                                                                                                 | Motivo                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                           | Capacidade "sign-in" com sessão única e e-mail de nova sessão.   |
| 2026-11-09 | Verificação do e-mail passa a usar o provider `capture` (testes) e Mailtrap (manual), no lugar do servidor local de e-mail. | Decisão sobre provedores de e-mail no quiz de perguntas abertas. |
