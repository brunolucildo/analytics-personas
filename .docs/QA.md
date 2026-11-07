# QA

> **Público:** quem vai validar uma mudança antes de declará-la pronta.
> **Regra de ouro:** só reporte o que você executou e viu. Não existe "deve passar".

## 1. Estado atual

| Recurso                     | Estado                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Lint (OXLint)               | Configurado; passa                                                                       |
| Formatação (OXFmt)          | Configurada; idempotente                                                                 |
| Tipos                       | Configurado em `app`, `api`, `docs` e `@repo/ui`; passa                                  |
| Build                       | `apps/app/dist`, `apps/api/dist` e `apps/docs/.next`; passa                              |
| Testes unitários            | Vitest em `app` e `api`; passam                                                          |
| Testes de integração        | Vitest + Supertest em `api` (`GET /`); passa                                             |
| Testes E2E                  | Playwright (`e2e/home.spec.ts`); passa                                                   |
| Cobertura                   | `bun run test:coverage` gera `coverage/`; sem threshold                                  |
| Hooks de pre-commit         | Configurados (`lefthook.yml`); **não validados** (repo git criado, hooks não instalados) |
| CI                          | Não configurado                                                                          |
| Acessibilidade automatizada | Não configurada                                                                          |

### 1.1 Baseline verificado em 2026-11-07

| Gate                       | Resultado | Observação                                                                 |
| -------------------------- | --------- | -------------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                               |
| `bun run check-types`      | Passa     | 4 tasks                                                                    |
| `bun run build`            | Passa     | `app`, `api` e `docs`                                                      |
| `bun run test`             | Passa     | Vitest em `app` e `api`                                                    |
| `bun run test:integration` | Passa     | 1 teste (Supertest em `GET /`)                                             |
| `bun run test:e2e`         | Passa     | 1 teste (Chromium); sobe o `apps/app` sozinho                              |
| `bun run test:coverage`    | Passa     | Gera `coverage/api` e `coverage/app`                                       |
| `bun run format` (2×)      | Passa     | Segunda execução sem diff                                                  |
| `bun run code:fix`         | Passa     | OXLint `--fix` + OXFmt                                                     |
| `bun run infra:up`         | Passa     | Supabase em 54321; Grafana, Loki, Tempo, Mimir e Collector `healthy`       |
| `bun run db:migrate`       | Passa     | Sem migrations: a CLI aplica `[]` e o script informa que não há pendências |
| `bun run infra:down` (2×)  | Passa     | Idempotente; nenhum container do projeto fica                              |

Observabilidade verificada: `GET /` gera um trace consultável no Tempo (por `trace_id`) e um log no Loki com o atributo `requestId`, sem headers, IP ou query string; com o Collector parado, `GET /` continua 200.

### 1.2 Verificação manual de UI em 2026-11-07

Rota `/` de `apps/app` no browser embutido do app (Chromium), servidor `vite` em dev.

| Verificação           | Resultado                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 375 / 768 / 1280 px   | Sem scroll horizontal (`scrollWidth` = largura da viewport); `h1` de 36px no mobile e 60px a partir de 768px                                                                         |
| Estrutura             | Um único `h1` "Hello World"; `lang="pt-BR"`; título "Analytics Personas"                                                                                                             |
| Alvo de toque         | `Button` com 158×44px (mínimo 44×44)                                                                                                                                                 |
| Teclado e foco        | `Tab` foca o botão; `:focus-visible` verdadeiro; anel de 2px (offset) + 4px `#5C8001`, visível em screenshot                                                                         |
| Contraste (calculado) | Texto do botão sobre `#FB6107`: 6,42:1; `h1` sobre o fundo: 19,44:1; anel de foco sobre o fundo: 4,54:1; fundo do botão sobre a página: 3,03:1 (limite de 3:1 para componente de UI) |
| Console               | Sem erro nem warning (apenas logs do Vite e do React DevTools)                                                                                                                       |
| Network               | 22 requisições, todas 200                                                                                                                                                            |

Não verificado: leitor de tela; estados hover, active, disabled e loading do `Button`; `prefers-reduced-motion` (o `Button` tem transição de 150ms e deslocamento no `active` sem variante `motion-reduce`); build de produção (`vite preview`) visualmente. A medição do `box-shadow` logo após o `Tab` mostra o anel quase transparente porque a transição de 150ms ainda corre; meça após ~1 s.

## 2. Pré-requisitos

| Item                   | Como obter                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| Bun 1.4.4 e Node >= 24 | Instalação local                                                            |
| Docker em execução     | Necessário para `infra:up`, `db:migrate`; os demais gates não dependem dele |
| Supabase CLI           | `devDependency` (`supabase`); roda via `bunx supabase`                      |
| Browsers do Playwright | `bunx playwright install` (uma vez)                                         |
| `.env` na raiz         | Copie `.env.example` e preencha as chaves com `bunx supabase status -o env` |

A API **não sobe** sem `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (falha com exit 1 e mensagem acionável). Os testes definem valores fictícios em `apps/api/test/setup-env.ts`.

## 3. Gates obrigatórios

Execute na raiz do repositório, na ordem abaixo:

| #   | Comando                    | O que valida                                | Critério                                                        |
| --- | -------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| 1   | `bun install`              | Dependências e lockfile                     | Sem erro; executar se `package.json`/`bun.lock` mudou           |
| 2   | `bun run lint`             | OXLint nos workspaces (`--deny-warnings`)   | Zero erro e zero warning                                        |
| 3   | `bun run check-types`      | `tsc --noEmit` (e `next typegen` em `docs`) | Zero erro de tipo (`types:check` é alias)                       |
| 4   | `bun run build`            | Build de produção dos três apps             | Concluído; dispensa justificada só para docs/config sem impacto |
| 5   | `bun run test`             | Vitest (unitário) em `app` e `api`          | Todos passam; sem modo watch                                    |
| 6   | `bun run test:integration` | Supertest contra a API                      | Todos passam                                                    |
| 7   | `bun run test:e2e`         | Playwright contra `http://localhost:5173`   | Todos passam                                                    |
| 8   | Verificação manual         | Ver seção 5                                 | Checklist aplicável à mudança                                   |

Outros comandos:

| Comando                 | Efeito                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `bun run test:coverage` | Vitest com cobertura em `coverage/` (sem threshold nesta fase)                        |
| `bun run format`        | OXFmt escreve nos arquivos; escopo limitado por `.oxfmtrc.json`                       |
| `bun run code:fix`      | `oxlint --fix` e `oxfmt --write`                                                      |
| `bun run infra:up`      | `supabase start` + `docker compose up -d --wait` (até 300 s); sai != 0 se algo falhar |
| `bun run infra:down`    | `supabase stop` + `docker compose down`; idempotente                                  |
| `bun run db:migrate`    | `supabase migration up --local`; idempotente                                          |
| `bun run hooks:install` | `lefthook install` (grava `.git/hooks`; ainda não executado)                          |

`bun run lint` cobre apenas os workspaces. `scripts/` e `e2e/` na raiz passam por `bun run code:fix` e por lint-staged, mas não pelo `lint` do Turbo.

### 3.1 Se um gate falhar

1. Leia a mensagem completa; não mascare com `@ts-ignore`, `any` ou desativação de regra.
2. Corrija a causa.
3. Rode novamente o gate que falhou.
4. Se o erro for pré-existente e fora do escopo, registre no relatório com evidência; não o esconda.

## 4. Subir o ambiente

```bash
bun install
cp .env.example .env        # preencha as chaves com `bunx supabase status -o env`
bun run infra:up
bun run db:migrate
bun run dev
```

| Serviço                    | URL                                           | Porta |
| -------------------------- | --------------------------------------------- | ----- |
| `apps/app` (produto)       | http://localhost:5173                         | 5173  |
| `apps/docs` (site de docs) | http://localhost:3001                         | 3001  |
| `apps/api`                 | http://localhost:3002                         | 3002  |
| Grafana                    | http://localhost:3000 (admin/admin, só local) | 3000  |
| Supabase API / Studio      | http://127.0.0.1:54321 / :54323               | 54321 |

Para subir um app isolado: `bun run dev --filter=app`, `--filter=api` ou `--filter=docs`.

`apps/docs` é o site Next.js; `.docs/` é a documentação Markdown canônica. Não confunda.

## 5. Checklist manual

Aplique apenas o que a mudança afeta, mas registre o que foi verificado.

### 5.1 Geral

- [ ] A aplicação sobe sem erro no terminal.
- [ ] Console do browser sem erro ou warning novo.
- [ ] Nenhuma chamada de rede falhando (aba Network).
- [ ] Links internos e externos não retornam 404.
- [ ] Textos em pt-BR e sem `lorem ipsum`/placeholder de template.
- [ ] A mudança não expõe token, chave ou dado pessoal; `service_role` não aparece em `apps/app/dist`.

### 5.2 UI e responsividade

- [ ] 375px (mobile), 768px (tablet) e 1280px (desktop).
- [ ] Sem scroll horizontal inesperado.
- [ ] Conteúdo não cortado, sobreposto ou ilegível.
- [ ] Estados de hover, focus, active, disabled, loading e erro revisados.
- [ ] Áreas de toque com pelo menos 44×44px.

### 5.3 Acessibilidade

- [ ] Navegação completa por teclado (Tab/Shift+Tab/Enter/Space/Esc).
- [ ] Foco visível e em ordem lógica.
- [ ] Todo input tem label; erros são descritos em texto.
- [ ] Contraste de texto e ícones validado (mínimo AA).
- [ ] Imagens com `alt`; decorativas com `alt=""`.
- [ ] Um único `h1` por página e headings em ordem.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Leitor de tela anuncia nome, estado e erro dos controles principais.

### 5.4 Dados, integrações e observabilidade

- [ ] Estado vazio, carregando e erro implementados.
- [ ] Timeout e falha de integração tratados.
- [ ] Nenhuma chamada externa em loop ou sem limite.
- [ ] Permissões verificadas (um usuário não acessa dado de outro clube).
- [ ] Migration/rollback documentados.
- [ ] Com `infra:up` e a API rodando, `GET /` gera trace no Tempo e log no Loki com `requestId` e sem PII.
- [ ] Com o Collector parado (`docker compose stop otel-collector`), a API continua respondendo.

## 6. Dívidas de QA conhecidas

| #   | Problema                                                                          | Impacto                                                 |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Sem CI                                                                            | Gates dependem de execução manual                       |
| 2   | Hooks de pre-commit não instalados nem validados                                  | `lefthook`/`lint-staged` não comprovados                |
| 3   | `lint` do Turbo não cobre `scripts/` e `e2e/`                                     | Erros nesses arquivos passam no gate                    |
| 4   | Sem verificação de acessibilidade automatizada                                    | Regressões de a11y só aparecem na revisão manual        |
| 5   | Leitor de tela, hover/disabled/loading e `prefers-reduced-motion` não verificados | Cobertura parcial de a11y (ver §1.2)                    |
| 6   | `Button` usa `text-sm` (14px) e transições sem variante `motion-reduce`           | Fora de `DESIGN.md` §3 e §6 para o rótulo e o movimento |
| 7   | Cobertura sem threshold; `lib/supabase.ts` com 0%                                 | Código sem teste não é sinalizado                       |
| 8   | Imagens LGTM em `:latest`                                                         | Reprodutibilidade da infra local                        |

## 7. Template de evidência

Copie para o relatório final da tarefa:

```markdown
## QA executado

| Verificação | Comando                    | Resultado       |
| ----------- | -------------------------- | --------------- |
| Lint        | `bun run lint`             | Passou / Falhou |
| Tipos       | `bun run check-types`      | Passou / Falhou |
| Build       | `bun run build`            | Passou / Falhou |
| Unitários   | `bun run test`             | Passou / Falhou |
| Integração  | `bun run test:integration` | Passou / Falhou |
| E2E         | `bun run test:e2e`         | Passou / Falhou |
| Manual      | 375 / 768 / 1280           | OK / Pendência  |

### Verificações manuais

- [ ] Teclado e foco
- [ ] Contraste
- [ ] Console/Network
- [ ] pt-BR e conteúdo final

### Não verificado

- Motivo e risco.
```

## 8. Template de bug

```markdown
**Título:** [área] comportamento observado
**Ambiente:** app, navegador, viewport, commit

**Passos:**

1.
2.

**Esperado:**
**Obtido:**
**Evidência:** print/log/URL
**Impacto:** bloqueante / alto / médio / baixo
```
