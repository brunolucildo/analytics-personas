# 0003 — Limite de requisições (habilitadora)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** rascunho
- **Slug:** 0003-auth-rate-limiting
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), `.specs/0001-platform-routing-conventions.md` (envelope de erro), `.docs/ARCHITECTURE.md` §4.4 (logs sem IP). **Depende de:** 0001 (envelope de erro e prefixo `/api/v1`). **Destrava:** 0004, 0006, 0007, 0009 e 0010.

## 1. Escopo

### Dentro do escopo

- Mecanismo de **limite de requisições por rota**, ativado por decorator (`opt-in`), com resposta `429`.
- **Registro de políticas nomeadas** com os valores padrão para as rotas de auth.
- Armazenamento **em memória** (instância única), com limite de tamanho e expiração das entradas.
- Ajuste `TRUST_PROXY` para descobrir o IP real atrás de proxy.
- Auxiliar de teste para zerar o armazenamento entre testes.

### Fora do escopo

- Aplicar as políticas nas rotas de auth: cada spec aplica a sua (0004 `sign-up`, 0006 `confirm-account` e `resend-confirmation`, 0007 `sign-in`, 0009 `forgot-password`, 0010 `reset-password`).
- Armazenamento distribuído (Redis) e bloqueio de conta por tentativas falhas (backlog).
- Limite global para todas as rotas, WAF, proteção contra DDoS.

## 2. Contexto

Sem limite, sign-in aceita força bruta, e sign-up, forgot-password e reenvio de confirmação viram origem de spam por e-mail. A API roda hoje em uma única instância, então um contador em memória atende a esta fase; ele precisa ficar atrás de uma interface para trocar o armazenamento depois.

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

| Item                     | Descrição                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Qualquer cliente das rotas públicas de auth; time de engenharia.                               |
| Decisão ou ação que muda | Rotas públicas passam a recusar excesso de tentativas por origem.                              |
| Resultado esperado       | Limite verificável por rota, com resposta padronizada e sem dado pessoal em log.               |
| Métrica de sucesso       | Teste de integração mostra a N+1ª requisição recebendo 429 e a janela seguinte voltando a 200. |

## 4. Requisitos

| ID  | Requisito                                                                                               | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Decorator `@RateLimit('<policy>')` aplicado por rota (opt-in).                                          | Must       | Given uma rota de teste com a política `{limit: 3, windowSeconds: 60}`, When 3 requisições do mesmo IP, Then 200; When a 4ª, Then 429. Rotas sem decorator nunca são limitadas.                                                                                                                                       |
| R2  | Resposta 429 padronizada.                                                                               | Must       | Given o limite excedido, When a requisição chega, Then 429, header `Retry-After` (segundos, inteiro ≥ 1) e envelope `{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again later.","details":[{"retryAfterSeconds":<n>}]}}`.                                                                        |
| R3  | A chave combina rota, IP e, quando a política pede, o `email` do corpo normalizado (trim + minúsculas). | Must       | Given a política `sign-in` (por IP + e-mail), When o mesmo IP tenta e-mails diferentes, Then cada e-mail tem a sua cota; When o mesmo e-mail vem de IPs diferentes, Then cada IP tem a sua cota. E-mails com caixa ou espaços diferentes caem na mesma chave.                                                         |
| R4  | A janela expira e o limite volta.                                                                       | Must       | Given uma chave bloqueada, When a janela termina (relógio simulado no teste), Then a próxima requisição passa e a contagem reinicia.                                                                                                                                                                                  |
| R5  | Registro de políticas padrão para auth.                                                                 | Must       | Given o registro, When inspecionar, Then existem: `sign-up` 5/60 min por IP; `sign-in` 10/10 min por IP + e-mail; `confirm-account` 10/10 min por IP; `resend-confirmation` 3/10 min por IP + e-mail; `forgot-password` 3/10 min por IP + e-mail; `reset-password` 10/10 min por IP. Os valores ficam em um só lugar. |
| R6  | Sem PII em log e memória limitada.                                                                      | Must       | Given bloqueios, When inspecionar os logs, Then há só `event: "rate_limited"` com o nome da política (nunca IP, e-mail ou chave); o armazenamento descarta entradas expiradas e tem teto de entradas (evicção da mais antiga) para não crescer sem limite.                                                            |
| R7  | IP real atrás de proxy por configuração.                                                                | Should     | Given `TRUST_PROXY=false` (padrão), When a requisição traz `X-Forwarded-For`, Then o cabeçalho é ignorado; Given `TRUST_PROXY=true`, Then o primeiro IP do cabeçalho é usado. `.env.example` documenta a variável.                                                                                                    |
| R8  | Auxiliar para testes das outras specs.                                                                  | Should     | Given um `resetRateLimitStore()` de teste, When chamado entre testes, Then nenhum teste herda cota de outro.                                                                                                                                                                                                          |

## 5. Fluxos e estados

- **Caminho feliz:** a requisição passa pelo guard, a contagem sobe e a rota executa.
- **Vazio:** primeira requisição de uma chave cria a entrada.
- **Carregando:** não se aplica.
- **Erro:** limite excedido → 429 (R2). Falha interna do armazenamento → a requisição **passa** (fail-open) e registra `rate_limit_store_error`, para o limite não derrubar o login.
- **Sucesso parcial:** não se aplica.
- **Cancelamento/retry:** reiniciar a API zera as contagens (aceito nesta fase). Clientes devem respeitar `Retry-After`.
- **Permissões e dados:** o guard lê o corpo só para extrair `email` (string) para a chave; a chave nunca é gravada em log. IP e e-mail ficam só em memória.

## 6. Acceptance Criteria

- [ ] Given a política de teste 3/60 s, When 4 requisições, Then as três primeiras 200 e a quarta 429 com `Retry-After`. (R1, R2)
- [ ] Given a política por IP + e-mail, When e-mails e IPs variam, Then as cotas são independentes e e-mails equivalentes compartilham a chave. (R3)
- [ ] Given o relógio avançado além da janela, When nova requisição, Then 200. (R4)
- [ ] Given o registro, When inspecionar, Then as seis políticas existem com os valores do R5. (R5)
- [ ] Given bloqueios, When inspecionar os logs, Then só `rate_limited` com o nome da política; Given muitas chaves, Then o número de entradas não passa do teto. (R6)
- [ ] Given `TRUST_PROXY` falso/verdadeiro, When `X-Forwarded-For`, Then ignorado/usado. (R7)

## 7. O que fazer

1. Criar o módulo de limite de requisições em `apps/api/src/modules/rate-limit/` com decorator, guard, interface de armazenamento e armazenamento em memória.
2. Definir o registro de políticas (R5) e a regra de chave (R3).
3. Mapear a resposta 429 pelo envelope do 0001.
4. Adicionar `TRUST_PROXY` ao ambiente (`.env.example`, `setup-env.ts`).
5. Escrever testes de integração com uma rota de teste registrada só no módulo de teste e relógio simulado.
6. Documentar em `DEVELOPMENT.md` como aplicar uma política a uma rota e a limitação (instância única).
7. Executar os gates de `QA.md`.

## 8. O que não fazer

- Não aplicar limite a rotas de auth que ainda não existem.
- Não registrar IP, e-mail, chave ou corpo em log.
- Não instalar Redis nem criar tabela para contadores.
- Não bloquear contas nem criar "captcha" nesta spec.
- Não limitar `GET /api/v1/health`.

## 9. Riscos e dependências

| Tipo        | Descrição                                                       | Mitigação                                                                      |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Risco       | Contagem em memória não funciona com mais de uma instância.     | Interface de armazenamento + backlog de Redis; registrar no `ARCHITECTURE.md`. |
| Risco       | IP errado atrás de proxy faz todos compartilharem a mesma cota. | `TRUST_PROXY` configurável (R7); documentar antes do deploy.                   |
| Risco       | Ler `email` do corpo antes da validação.                        | Só usa a chave se for string; senão cai para a chave por IP.                   |
| Dependência | Envelope de erro do 0001.                                       | Implementar depois do 0001 (ordem do mapa).                                    |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run test`; `bun run test:integration`; `bun run lint`; `bun run check-types`.
- **Evidência esperada:** testes verdes cobrindo R1 a R8.
- **Comportamento observável:** a rota de teste devolve 429 com `Retry-After` na requisição acima do limite e volta a 200 depois da janela.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                 | Impacto                                                   | Bloqueante?     | Quem decide        |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------- | ------------------ |
| **Decisão (2026-11-09):** valores padrão do R5 mantidos (ex.: sign-in 10/10 min).                 | Ajuste futuro é em um só lugar (registro de políticas).   | Não (resolvida) | Solicitante        |
| Premissa: janela fixa por chave (não deslizante).                                                 | Pequeno "rajadão" na virada da janela; aceito.            | Não             | Time de engenharia |
| Premissa: fail-open em erro do armazenamento.                                                     | Disponibilidade do login acima da proteção em falha rara. | Não             | Time de engenharia |
| Premissa: biblioteca própria mínima ou `@nestjs/throttler` (decidir no plano, com justificativa). | Dependência nova.                                         | Não             | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                       | Motivo                                                                                                                |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação). | Habilitadora usada por 0004, 0006, 0007, 0009 e 0010; o pedido de "limite de tentativas" foi aceito pelo solicitante. |
| 2026-11-09 | Dependência de 0001 declarada (antes "nenhuma").                  | Verificação de consistência do `breakdown-specs`: a spec usa o envelope de erro do 0001.                              |
| 2026-11-09 | Valores padrão das políticas passaram de premissa a decisão.      | Resposta do quiz de perguntas abertas.                                                                                |
