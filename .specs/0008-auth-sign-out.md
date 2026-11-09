# 0008 — Encerrar sessão (sign-out)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** rascunho
- **Slug:** 0008-auth-sign-out
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), 0005 (`SessionService.revoke`, guard e home). **Depende de:** 0005 (e, para o E2E de ponta a ponta, 0007). **Destrava:** nenhuma.

## 1. Escopo

### Dentro do escopo

- `POST /api/v1/auth/sign-out`: revoga a sessão atual.
- Botão `Sign out` na home (`/app`) que chama o endpoint, limpa o token local e leva a `/auth/sign-in`.

### Fora do escopo

- Sair de "todos os dispositivos" ou listar sessões (a sessão já é única; backlog).
- Expiração automática, "lembrar de mim", aviso de sessão a expirar.
- Menu de usuário completo, perfil ou configurações (a home só ganha o botão).

## 2. Contexto

Sem sign-out, a única forma de sair é a sessão expirar (7 dias) ou outro login derrubá-la. O 0005 já tem `SessionService.revoke`; esta spec o expõe ao usuário. É pequena, mas tem permissão e efeito próprios (revoga uma sessão) e critério de aceite independente.

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

| Item                     | Descrição                                                  |
| ------------------------ | ---------------------------------------------------------- |
| Usuário/papel afetado    | Pessoa logada, principalmente em computador compartilhado. |
| Decisão ou ação que muda | A pessoa encerra a própria sessão quando quiser.           |
| Resultado esperado       | Token deixa de valer no servidor e some do browser.        |
| Métrica de sucesso       | Token usado após o sign-out recebe 401 em 100% dos casos.  |

## 4. Requisitos

| ID  | Requisito                                           | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `POST /api/v1/auth/sign-out` revoga a sessão atual. | Must       | Given token válido, When `POST /api/v1/auth/sign-out`, Then 204 sem corpo e `revoked_at` da sessão preenchido; Given o mesmo token, When `GET /api/v1/auth/session`, Then 401 `UNAUTHENTICATED`.                                                                                                                      |
| R2  | Exige sessão.                                       | Must       | Given nenhum token ou token inválido, When `POST`, Then 401 `UNAUTHENTICATED` (rota fechada por padrão, sem `@Public()`); outras sessões de outros usuários não são afetadas.                                                                                                                                         |
| R3  | Botão `Sign out` na home.                           | Must       | Given sessão válida em `/app`, When ativar `Sign out` (clique, `Enter` ou `Space`), Then o SPA chama o endpoint, remove o token do `localStorage`, limpa o cache de consultas e a URL final é `/auth/sign-in`; o botão tem nome acessível, foco visível, área de toque ≥ 44×44 px e fica desabilitado enquanto envia. |
| R4  | Sair deve funcionar mesmo se a API falhar.          | Must       | Given erro de rede, 5xx ou 401 na chamada, When ativar `Sign out`, Then o token local é removido e a URL final é `/auth/sign-in` do mesmo jeito (o servidor revogará a sessão por expiração se a chamada não chegou).                                                                                                 |
| R5  | Depois de sair, `/app` volta a ser privado.         | Must       | Given o E2E (login real), When `Sign out` e depois abrir `/app` ou usar o botão "voltar", Then a URL final é `/auth/sign-in` e a home não é exibida.                                                                                                                                                                  |

## 5. Fluxos e estados

- **Caminho feliz:** `Sign out` → chamada à API (204) → token removido → `/auth/sign-in`.
- **Vazio:** não se aplica.
- **Carregando:** botão desabilitado com indicador por instantes.
- **Erro:** qualquer falha da chamada não impede a saída local (R4); não há mensagem de erro para a pessoa.
- **Sucesso parcial:** servidor inalcançável → sessão local encerrada, sessão do servidor ainda válida até expirar; aceito e registrado.
- **Cancelamento/retry:** sair de novo com token já revogado → 401 no servidor, tratado como saída local normal.
- **Permissões e dados:** exige sessão; revoga só a sessão do token enviado. Nenhum dado pessoal em log.

## 6. Acceptance Criteria

- [ ] Given token válido, When `POST /api/v1/auth/sign-out`, Then 204 e o token passa a dar 401. (R1)
- [ ] Given sem token, When `POST`, Then 401. (R2)
- [ ] Given `/app` logado, When ativar `Sign out` por mouse e por teclado, Then token removido e URL `/auth/sign-in`. (R3)
- [ ] Given a API parada, When `Sign out`, Then o token local é removido e a URL é `/auth/sign-in`. (R4)
- [ ] Given E2E com login real, When `Sign out` e abrir `/app`, Then vai para `/auth/sign-in`. (R5)
- [ ] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then passam.

## 7. O que fazer

1. Criar o caso de uso `SignOut` e o endpoint (fechado por padrão), usando `SessionService.revoke` com o `sid` do request.
2. Adicionar o botão `Sign out` e a mutation em `features/auth`, com limpeza de token e de cache e redirecionamento.
3. Escrever testes de integração (R1, R2), unitário (R3, R4) e E2E (R5).
4. Atualizar `.docs/` e executar os gates e o checklist manual (teclado, foco, toque).

## 8. O que não fazer

- Não revogar sessões de outros usuários nem "todas" as sessões.
- Não deixar o token no browser se a chamada falhar.
- Não criar menu de usuário, perfil ou página de configurações.
- Não logar token nem `sid` completo.

## 9. Riscos e dependências

| Tipo        | Descrição                                                    | Mitigação                                                             |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Risco       | Falha de rede deixa a sessão ativa no servidor até expirar.  | Aceito (R4); a sessão única e o limite de 7 dias reduzem a janela.    |
| Dependência | 0005 (`revoke`, guard, home). Para o E2E real, 0007 (login). | Ordem do mapa; se necessário, o E2E semeia o token pela API de teste. |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`.
- **Evidência esperada:** gates com código 0; teste de integração mostrando 401 após o sign-out.
- **Comportamento observável:** clicar em `Sign out` na home leva a `/auth/sign-in`; reabrir `/app` não mostra a home.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                    | Impacto                                             | Bloqueante? | Quem decide |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------- | ----------- |
| Premissa: o botão fica na própria home (sem cabeçalho/menu), porque não há shell de navegação ainda. | Posição pode mudar quando houver layout do produto. | Não         | Produto     |
| Premissa: não há confirmação antes de sair.                                                          | Ação reversível (basta logar de novo).              | Não         | Produto     |

## 12. Refinamento

| Data       | O que mudou                                                       | Motivo                                               |
| ---------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação). | Lacuna do pedido aceita pelo solicitante (sign-out). |
