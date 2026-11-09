# 0001 — Convenções de roteamento e idioma (habilitadora)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída (R1–R9 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0001-platform-routing-conventions
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), `.specs/0000-fundation.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/BUSINESS.md` §10. **Depende de:** nenhuma. **Destrava:** 0004 a 0010 (todas as specs de auth).

## 1. Escopo

### Dentro do escopo

- **API versionada:** prefixo global `/api/v1` em todas as rotas; `GET /` (hello world) é substituído por `GET /api/v1/health`.
- **CORS** para o SPA, com origem vinda da nova variável `APP_URL`.
- **Envelope de erro global** da API e convenção de JSON em camelCase (a primeira spec que toca a API define; as demais referenciam).
- **Roteador no `apps/app`** com dois grupos de rota: `/auth/*` (público) e `/app/*` (privado), cada um com layout próprio, redirecionamento de `/` e página 404.
- **Home placeholder** em `/app`, reaproveitando o "Hello World" atual.
- **Idioma en-US:** `lang="en-US"` no `apps/app` e no `apps/docs`; textos de interface e mensagens da API em inglês; documentação dessa convenção em `.docs/`.
- ADRs das decisões estruturais (roteador e convenções de URL/idioma) e atualização de testes e docs que citam `GET /` ou pt-BR.

### Fora do escopo

- Qualquer endpoint ou página de autenticação: 0004 (sign-up), 0006, 0007, 0008, 0009 e 0010.
- Proteção real das rotas `/app/*` e da API (guard, sessão, redirecionamento para sign-in): 0005. Nesta spec `/app` é acessível sem login.
- Cliente HTTP do SPA (`lib/api-client.ts`): 0004.
- Rate limit: 0003. E-mail: 0002.
- Framework de i18n ou múltiplos idiomas (Won't); estratégia para uma futura `v2` da API.

## 2. Contexto

O `apps/api` expõe só `GET /` → `{"message":"Hello World"}` e o `apps/app` só a rota `/` (sem roteador). Toda a autenticação precisa de um espaço de URLs estável: páginas públicas em `/auth/*`, privadas em `/app/*` e API em `/api/v1/*`. Também precisa de um formato de erro único, porque todos os fluxos de auth devolvem erros que o SPA precisa interpretar.

`.docs/BUSINESS.md` §10 e `.docs/DEVELOPMENT.md` §4 hoje mandam interface em pt-BR e `lang="pt-BR"`. A decisão do solicitante (en-US em páginas, endpoints e código) substitui essas regras, e esta spec as atualiza.

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

| Item                     | Descrição                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Usuário/papel afetado    | Time de engenharia (e, indiretamente, toda pessoa que usará o produto).                          |
| Decisão ou ação que muda | Fixa o espaço de URLs, o formato de erro e o idioma antes de qualquer fluxo de auth ser escrito. |
| Resultado esperado       | API sob `/api/v1`, SPA com grupos `/auth` e `/app`, convenções documentadas e testes verdes.     |
| Métrica de sucesso       | Gates de `QA.md` passam e nenhuma doc normativa fala em `GET /` nem em UI pt-BR.                 |

## 4. Requisitos

| ID  | Requisito                                                                                                                | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Prefixo global `/api/v1` e `GET /api/v1/health` no lugar de `GET /`.                                                     | Must       | Given a API rodando, When `GET /api/v1/health`, Then 200, `application/json`, body `{"status":"ok"}` e header `x-request-id`; When `GET /`, Then 404 no envelope de erro do R2.                                                                                                                                                                                                                                       |
| R2  | Envelope de erro global: `{"error":{"code":"<UPPER_SNAKE_CASE>","message":"<en-US>","details":[...]}}`; sem stack trace. | Must       | Given uma rota de teste com DTO, When o payload é inválido, Then 400 com `code` `VALIDATION_FAILED` e `details` listando `{field, message}`; When a rota não existe, Then 404 `NOT_FOUND`; When um erro inesperado ocorre, Then 500 `INTERNAL_ERROR` sem detalhe interno. Exceções HTTP com `code` próprio passam inalteradas.                                                                                        |
| R3  | CORS restrito à origem `APP_URL`; `APP_URL` validada e documentada.                                                      | Must       | Given `APP_URL=http://localhost:5173`, When preflight `OPTIONS /api/v1/health` com `Origin` igual e `Access-Control-Request-Headers: authorization,content-type`, Then 204 com `Access-Control-Allow-Origin` igual à origem; When a origem é outra, Then não há `Access-Control-Allow-Origin`. Sem `APP_URL` válida (URL http/https), a API não sobe e informa a variável. `.env.example` e `setup-env.ts` a definem. |
| R4  | Roteador no `apps/app` com os grupos `/auth` (público) e `/app` (privado), cada um com layout próprio.                   | Must       | Given o roteador, When uma rota de teste é registrada em cada grupo, Then renderiza dentro do layout correspondente (teste unitário por `data-testid` do layout); `/app` renderiza a home placeholder com um único `h1` `Hello World`.                                                                                                                                                                                |
| R5  | `/` redireciona para `/app`; qualquer caminho desconhecido mostra uma página 404.                                        | Must       | Given o app, When abrir `/`, Then a URL final é `/app`; When abrir `/qualquer-coisa` ou `/auth/qualquer-coisa`, Then aparece um único `h1` `Page not found` com link para `/` e status de rota não encontrada (teste unitário + E2E).                                                                                                                                                                                 |
| R6  | Idioma en-US no `apps/app` e no `apps/docs`.                                                                             | Must       | Given os dois `index.html`/layout, When inspecionar, Then `lang="en-US"`; não restam textos de interface em pt-BR nesses apps.                                                                                                                                                                                                                                                                                        |
| R7  | Documentar as convenções e remover o que ficou obsoleto.                                                                 | Must       | Given `.docs/`, When revisar, Then `DEVELOPMENT.md` tem a seção "Convenções de API e idioma" (prefixo `/api/v1`, camelCase, envelope de erro, en-US em código/UI/API, docs em pt-BR); `BUSINESS.md` §10 e `DEVELOPMENT.md` §4 não mandam mais pt-BR; `ARCHITECTURE.md`, `QA.md` e `AGENTS.md` citam `/api/v1/health`, as rotas `/auth` e `/app`, `APP_URL` e o roteador; `QA.md` §5.1 pede en-US.                     |
| R8  | Registrar as decisões em ADRs.                                                                                           | Must       | Given `.adrs/`, When listar, Then existem dois ADRs aceitos novos (próximo número sequencial): roteador do SPA e convenções de URL/idioma.                                                                                                                                                                                                                                                                            |
| R9  | Manter os gates e a observabilidade funcionando.                                                                         | Should     | Given infra e API no ar, When `GET /api/v1/health`, Then há trace no Tempo e log no Loki com `requestId`, sem query string, IP ou headers. Testes de integração, unitário e E2E existentes foram migrados para as novas rotas e passam.                                                                                                                                                                               |

## 5. Fluxos e estados

- **Caminho feliz:** `GET /api/v1/health` responde 200; o SPA abre `/`, redireciona para `/app` e mostra a home placeholder; um preflight vindo de `APP_URL` é aceito.
- **Vazio:** o grupo `/auth` ainda não tem páginas; qualquer URL dele cai na 404 (as páginas chegam nas specs 0004 a 0010).
- **Carregando:** não se aplica; as rotas são estáticas.
- **Erro:** payload inválido → 400 `VALIDATION_FAILED`; rota inexistente na API → 404 `NOT_FOUND`; falha inesperada → 500 `INTERNAL_ERROR`; `APP_URL` ausente ou inválida → a API falha no boot com mensagem acionável.
- **Sucesso parcial:** não se aplica.
- **Cancelamento/retry:** não se aplica; as operações são idempotentes.
- **Permissões e dados:** não há dado pessoal. `GET /api/v1/health` é público. `/app` ainda é público nesta spec (a proteção é do 0005); isso é temporário e não deve ir a produção antes do 0005.

## 6. Acceptance Criteria

- [ ] Given a API, When `GET /api/v1/health`, Then 200 `{"status":"ok"}` com `x-request-id`; When `GET /`, Then 404 `NOT_FOUND`. (R1)
- [ ] Given uma rota de teste com DTO, When o payload é inválido, Then 400 `VALIDATION_FAILED` com `details`; rota inexistente → 404 `NOT_FOUND`; erro inesperado → 500 `INTERNAL_ERROR` sem stack. (R2)
- [ ] Given `APP_URL`, When preflight da origem permitida e de outra origem, Then só a permitida recebe `Access-Control-Allow-Origin`; sem `APP_URL` válida a API não sobe. (R3)
- [ ] Given o roteador, When rotas de teste nos grupos `/auth` e `/app`, Then cada uma usa o layout do seu grupo. (R4)
- [ ] Given o app, When abrir `/`, Then vai para `/app`; When abrir um caminho desconhecido, Then `h1` `Page not found` com link para `/`. (R5)
- [ ] Given `apps/app` e `apps/docs`, When inspecionar, Then `lang="en-US"` e textos em inglês. (R6)
- [ ] Given `.docs/`, When revisar, Then convenções documentadas e nenhuma regra normativa de UI em pt-BR. (R7)
- [ ] Given `.adrs/`, When listar, Then há os dois ADRs novos. (R8)
- [ ] Given `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e`, Then todos passam. (R9)

## 7. O que fazer

1. Ler `node_modules/turbo/docs/README.md` só se algum comando do Turborepo precisar mudar (provavelmente não precisa).
2. Registrar `setGlobalPrefix("api/v1")` na API; criar `HealthController` (`GET /health`) e remover o `AppController` de hello world, migrando `app.controller.spec.ts` e `test/app.int-spec.ts`.
3. Criar o filtro de exceção global que produz o envelope do R2 e adaptar a `ValidationPipe` para gerar `VALIDATION_FAILED` com `details`.
4. Adicionar `APP_URL` ao esquema de ambiente (`config/environment.ts`), `.env.example` e `test/setup-env.ts`; habilitar CORS com essa origem.
5. Instalar o roteador no `apps/app` (decisão e justificativa no ADR; ver §11), criar `routes/` com o layout `/auth`, o layout `/app`, o redirecionamento de `/` e a página 404; mover o hello world para a home de `/app`.
6. Ajustar `lang` e textos em `apps/app` e `apps/docs`.
7. Migrar o E2E (`e2e/home.spec.ts`) e o teste de `App` para as novas rotas.
8. Atualizar `.docs/` (R7) e criar os dois ADRs (R8).
9. Executar os gates de `QA.md` e a verificação de observabilidade do R9.

## 8. O que não fazer

- Não criar endpoints, páginas, guard, sessão ou tabelas de auth.
- Não criar o cliente HTTP do SPA, rate limit ou mailer.
- Não adicionar biblioteca de i18n nem traduzir `.docs/`, specs e ADRs.
- Não manter `GET /` como rota paralela "por compatibilidade".
- Não registrar headers, IP, query string ou corpo nos logs (mantém `ARCHITECTURE.md` §4.4).
- Não permitir CORS com `*`.
- Não alterar `turbo.json` sem ler os docs do Turborepo instalado.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                                                 | Mitigação                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Risco       | `/app` fica público até o 0005.                                                                           | Registrado no §5; a ordem do mapa coloca o 0005 logo após o 0004.                                                                               |
| Risco       | Trocar `GET /` quebra consumidores (testes, docs, dashboard do Grafana e verificação de observabilidade). | Buscar todas as referências a `GET /` e ao path `/` em `.docs/`, `infra/grafana/dashboards/api.json`, `e2e/` e testes; migrar na mesma mudança. |
| Risco       | O envelope de erro é um contrato que todas as specs seguintes assumem.                                    | Documentar em `DEVELOPMENT.md` e cobrir por teste de integração.                                                                                |
| Dependência | Nova biblioteca de roteamento.                                                                            | Justificar no ADR (problema, alternativa, custo); preferir a que combina com o stack TanStack.                                                  |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`; `curl -i http://localhost:3002/api/v1/health`; preflight com `curl -i -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: GET" http://localhost:3002/api/v1/health`.
- **Evidência esperada:** gates com código 0; 200 com `{"status":"ok"}`; 404 em `GET /`; cabeçalho CORS só para a origem permitida; dois ADRs novos.
- **Comportamento observável:** `http://localhost:5173/` termina em `/app` com `Hello World`; `/auth/x` mostra `Page not found`; `<html lang="en-US">`.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                                                             | Impacto                                                 | Bloqueante?     | Quem decide        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------- | ------------------ |
| **Decisão (2026-11-09):** roteador = TanStack Router (combina com o stack TanStack e tipa os parâmetros de busca como `token`); a justificativa entra no ADR. | Define a dependência e o formato das rotas.             | Não (resolvida) | Solicitante        |
| **Decisão (2026-11-09):** `apps/docs` também vai para en-US (`lang="en-US"` e textos em inglês).                                                              | Pequeno ajuste de `lang` e texto.                       | Não (resolvida) | Solicitante        |
| Premissa: `GET /api/v1/health` devolve `{"status":"ok"}` e não checa dependências (banco, provedor de e-mail).                                                | Health simples; uma checagem profunda fica para depois. | Não             | Time de engenharia |
| Premissa: `.docs/`, specs e ADRs continuam em pt-BR.                                                                                                          | Evita retraduzir a documentação.                        | Não             | Produto            |
| Premissa: `APP_URL` padrão `http://localhost:5173`; será usada também para montar links de e-mail (0004, 0006, 0007, 0009).                                   | Um só nome de variável para CORS e links.               | Não             | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                                     | Motivo                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                                                                                                               | Primeira fatia do corte aprovado.       |
| 2026-11-09 | Roteador (TanStack Router) e idioma do `apps/docs` (en-US) passaram de premissa a decisão.                                                                                                                      | Respostas do quiz de perguntas abertas. |
| 2026-11-09 | Status passou para "concluída" após a execução de `implement-me`; requisitos e critérios não foram alterados. Detalhes e evidências em `.plans/0001-platform-routing-conventions-plan.md` e `.docs/QA.md` §1.3. | Execução da spec.                       |
