---
name: refactor-slices
description: Audita e refatora vertical slices para a arquitetura em camadas do projeto (domain, application, infrastructure, interface), com um use case por fluxo e um request handler por endpoint (1:1 handler ↔ use case). Executa um pipeline de seis subagents em sequência — auditoria, plano, implementação, gates de qualidade, commit-and-push e abertura de PR. Use esta skill sempre que o usuário disser "refatorar slices", "refatorar vertical slices", "slices fora do padrão", "aplicar arquitetura em camadas", "arquitetura hexagonal", "request handler pattern", "use case por fluxo", "auditar slices", "corrigir arquitetura dos módulos", "refactor slices", "refactor vertical slices", "layered architecture", ou pedir para encontrar e corrigir módulos que não seguem a arquitetura do projeto — mesmo que não mencione a skill pelo nome.
argument-hint: "[--scope <path>] [--slice <nome>] [--base <branch>] [--dry-run]"
---

# Refactor Slices

Refatorar as fatias verticais da API para o padrão de camadas do projeto, sem mudar comportamento: **auditoria → plano → implementação → gates → commit/push → PR**, cada etapa em um **subagent separado**.

A skill existe para transformar uma arquitetura inconsistente em um padrão repetível: `domain` puro, `application` com um use case por fluxo, `infrastructure` como adaptador e `interface` com um request handler por endpoint. O vínculo é **1:1**: cada endpoint tem um handler; cada handler injeta exatamente um use case.

## Contrato da skill

- **Entrada:** nenhuma obrigatória. Opções:
  - `--scope <path>` — diretório das fatias; padrão `apps/api/src/modules`.
  - `--slice <nome>` — limita o plano/implementação a uma fatia (a auditoria continua lendo o escopo inteiro para contexto).
  - `--base <branch>` — branch de destino do PR; padrão `main`.
  - `--dry-run` — para depois do plano (Agentes 1 e 2); não altera código, não commita, não abre PR.
- **Saída:** código refatorado, plano em `.plans/refactor-slices-<run-id>-plan.md`, docs/ADR atualizados, commit, push, PR aberto e relatório consolidado. Artefatos de execução em `.claude/refactor/<run-id>/`.
- **Pipeline:** seis subagents, **em sequência**, no mesmo checkout e na mesma branch. O orquestrador não codifica: ele lança, verifica artefatos e decide se avança.
- **Não faz:** mudar comportamento, inventar requisitos, adicionar dependência, relaxar gate, commitar na `main`, fazer force push/amend/rebase, mesclar PR, criar worktree ou editar artefatos gerados.
- **Quando parar:** árvore suja, baseline quebrado, dúvida bloqueante, gate falhando por comportamento, infra de integração/E2E indisponível ou `gh` sem autenticação. Pare e explique; não contorne.

## Princípios

1. **Refatoração é estrutural.** Rotas, status, DTOs, erros, telemetria, rate limit, auth, SQL e e-mail continuam idênticos. Se um teste precisar mudar de asserção, o comportamento mudou: pare.
2. **Um fluxo, uma classe.** Use case não agrega fluxos. Serviço de aplicação só existe para capacidade reutilizável (ex.: emissão de sessão), nunca para disfarçar um fluxo.
3. **Um endpoint, um handler.** Controller com vários endpoints é o principal sintoma a corrigir. Cada handler injeta um único use case.
4. **Agentes sequenciais, mesma árvore.** Cada agente depende do artefato e das mudanças do anterior. Não use worktree: o valor está no encadeamento.
5. **Evidência vence relato.** O orquestrador lê o artefato, o `git status`, o `git log` e a saída real dos gates. “O subagent disse que passou” não é prova.
6. **Gate não se negocia.** Falha de lint, tipo, build, teste, integração, E2E ou arquitetura bloqueia commit e PR. Exceção pré-existente só vale com evidência e registro.
7. **Documentação acompanha o código.** Ao aplicar o padrão pela primeira vez, atualize `.docs/DEVELOPMENT.md`, `.docs/ARCHITECTURE.md` e crie o ADR do request handler 1:1.

## 0. Pré-voo (orquestrador)

Leia, nesta ordem: `AGENTS.md` da raiz, `.docs/AGENTS.md`, `.docs/ARCHITECTURE.md` §4.1–4.2, `.docs/DEVELOPMENT.md` §2.1–2.2 e §5, `.docs/QA.md` §3, `.docs/RULES.md` §4 e §7. Leia também [`references/target-architecture.md`](references/target-architecture.md) e [`references/agent-briefs.md`](references/agent-briefs.md).

1. **Resolva as opções.** `--scope` existe e é diretório? `--slice` corresponde a uma pasta? `--base` existe no remoto? Em dúvida, pare e pergunte.
2. **Estado do repositório:**
   ```bash
   git rev-parse --is-inside-work-tree
   git status --porcelain=v1 -b
   git branch --show-current
   git remote get-url --push origin
   gh auth status
   ```
   - Árvore suja, conflito ou operação git em andamento: **pare**. O pipeline parte de um HEAD limpo.
   - `origin` precisa ser `github.com/brunolucildo/...`. Outro destino: pare.
   - `gh` sem autenticação: o pipeline pode seguir até o commit, mas o PR fica pendente; avise no pré-voo.
3. **Baseline antes de tocar em nada.** Rode e registre:
   ```bash
   bun run lint
   bun run check-types
   bun run test
   ```
   Se o baseline já falhar, pare: não atribua a falha à refatoração. Se a refatoração tocar a API (caso padrão), a integração e o E2E também são obrigatórios; verifique Docker/Supabase:
   ```bash
   docker info
   bun run infra:up
   bun run db:migrate
   ```
   Sem infra, o pipeline para no Agente 4 e não commita. Avise isso no pré-voo.
4. **Crie a branch e o run directory:**
   ```bash
   git switch -c refactor/slices-<run-id>
   mkdir -p .claude/refactor/<run-id>
   ```
   `<run-id>` = `YYYYMMDD-HHmm`. A branch parte do `HEAD` atual. Se já existir, pare e pergunte.
5. **Crie `state.json`** no formato de [`references/report-templates.md`](references/report-templates.md). O run directory é ignorado pelo git (`.claude/refactor/`).
6. **Confirme o escopo.** Mostre em 5–10 linhas: branch, escopo, fatias que o script já aponta, gates de baseline, infra disponível, se o PR será aberto. Só peça confirmação se houver decisão irreversível, dependência nova, exceção de fatia ou infra ausente.

## 1. Arquitetura-alvo (resumo)

| Camada | Contém | Não contém |
| --- | --- | --- |
| `domain` | Entidades, value objects, regras, erros, ports | Framework, HTTP, banco, SDK, camadas externas |
| `application` | Um use case por fluxo, com um `execute`; serviços de capacidade reutilizáveis | HTTP, Nest, banco, `infrastructure`, `interface` |
| `infrastructure` | Adaptadores dos ports (Supabase, Argon2, e-mail, HTTP) | Regra de negócio, `interface` |
| `interface` | Um request handler por endpoint, DTOs, presenters, guards | Acesso a banco, `infrastructure` direto, regra de negócio |

Layout, exemplo de handler/use case, regras de 1:1, comportamento preservado e exigências de ADR estão em [`references/target-architecture.md`](references/target-architecture.md). O auditor e o planner leem esse arquivo; o implementer também.

## 2. Pipeline de 6 agentes

| # | Agente | Missão | Artefato | Escreve código? |
| --- | --- | --- | --- | --- |
| 1 | Auditor | Encontrar fatias fora do padrão, com evidência | `01-audit.md` + `01-audit.raw.json` | Não |
| 2 | Planner | Transformar achados em plano executável e ordenado | `02-plan.md` + `.plans/refactor-slices-<run-id>-plan.md` | Não |
| 3 | Implementer | Executar o plano batch a batch, preservando comportamento | `03-execution.md` | Sim |
| 4 | QA | Rodar gate de arquitetura, contrato e gates de QA | `04-gates.md` | Só correção mecânica |
| 5 | Commit & Push | Commitar e publicar pela skill `commit-and-push` | `05-commit.md` | Não |
| 6 | PR | Abrir o Pull Request com resumo e evidências | `06-pr.md` + `06-pr-body.md` | Não |

Os briefs completos, com placeholders e critérios de saída, estão em [`references/agent-briefs.md`](references/agent-briefs.md). **Use-os literalmente**, preenchendo os placeholders; não improvise um brief mais curto.

### 2.1 Como lançar

Use a ferramenta de subagent do harness (`subagent` no OpenCode; `Agent`/`Task` no Claude Code) com:

- `agent`/`subagent_type`: `general-purpose` (Claude Code) ou `general` (OpenCode) — precisa de leitura, edição e shell.
- `description`: `refactor-slices — Agente N (<fase>)`.
- `prompt`: o brief do agente, preenchido com `<RUN_ID>`, `<RUN_DIR>`, `<SCOPE>`, `<BASE_BRANCH>`, `<BRANCH>`, `<PLAN_PATH>`, `<AUDIT_PATH>` e caminhos absolutos das referências.
- `background`: `false` (foreground). O próximo agente depende do anterior; não há paralelismo.
- **Sem** `isolation: worktree`. Todos trabalham no mesmo checkout e na mesma branch.

Depois de cada agente:

1. Leia o artefato e confirme que as seções obrigatórias existem e não estão vazias.
2. Leia `state.json`; a fase deve estar `done` (ou `blocked`/`failed`, que interrompem o pipeline).
3. Verifique o efeito real: `git status` para Agente 3, `git log -1` para Agente 5, `gh pr view` para Agente 6.
4. Atualize `state.json` e emita uma linha de progresso:
   ```text
   [refactor-slices] audit done · plan done · implement running · qa pending · commit pending · pr pending
   ```
5. Só então lance o próximo agente. Se o artefato estiver incompleto, retome o **mesmo** subagent com a correção; não pule etapa.

### 2.2 Sequência

1. **Auditor** → `01-audit.md`. Se todas as fatias forem `conforming`/`exception`, pare e reporte: não há o que refatorar.
2. **Planner** → `02-plan.md` + plano versionado. Se o plano tiver dúvida bloqueante, pare e pergunte antes de implementar.
3. **Implementer** → `03-execution.md`. Se um batch ficar `blocked`, pare; não rode QA em cima de implementação incompleta.
4. **QA** → `04-gates.md`. Se `blocked`/`failed`, pare; não commite. Correção mecânica é permitida; mudança de comportamento não.
5. **Commit & Push** → `05-commit.md`. Só com QA `done`. Se o push falhar, pare e reporte.
6. **PR** → `06-pr.md`. Se `gh` não estiver autenticado, deixe o corpo em `06-pr-body.md` e reporte a pendência com o comando exato.

`--dry-run`: rode apenas 1 e 2, entregue o relatório e pare.

## 3. Run directory e estado

```text
.claude/refactor/<run-id>/
  state.json
  01-audit.md
  01-audit.raw.json
  02-plan.md
  03-execution.md
  04-gates.md
  05-commit.md
  06-pr.md
  06-pr-body.md
  final-report.md
```

- `.claude/refactor/` é ignorado pelo git; não commite esses arquivos.
- O plano **também** vive em `.plans/refactor-slices-<run-id>-plan.md` e é commitado.
- O ADR e as atualizações de `.docs/` são commitados pelo Agente 5.
- O orquestrador é o único que escreve `state.json`; cada agente pode atualizar a própria fase, mas o orquestrador reconcilia.

## 4. Gates

O Agente 4 roda, nesta ordem:

1. **Arquitetura:**
   ```bash
   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --scope <scope> --strict
   ```
   Zero violação (ou só exceções documentadas no plano).
2. **Contrato:** revisão de `git diff` para rotas, métodos, status, DTOs, erros, telemetria, rate limit, auth, SQL/RPC, e-mail e dependências. Nada pode mudar.
3. **QA:**
   ```bash
   bun run lint
   bun run check-types
   bun run build
   bun run test
   bun run test:integration
   bun run test:e2e
   ```
   Integração e E2E são obrigatórios para refatoração de API. Sem infra, `blocked`; sem commit.
4. **Higiene:** nenhum segredo, `.env` ou artefato gerado em `git status`.

Regras:
- Falha mecânica (import, DI, caminho de teste) pode ser corrigida pelo Agente 4 e o gate rodado de novo.
- Falha de comportamento, asserção ou contrato: **pare** e reporte. Não relaxe teste, não use `any`/`@ts-ignore`/`eslint-disable`.
- Falha pré-existente fora do escopo: registre com evidência; não mascare.

## 5. Commit, push e PR

- **Agente 5** carrega a skill `commit-and-push` e segue o contrato dela. Branch `<branch>`, Conventional Commits (`refactor(api): ...`), descrição em pt-BR, corpo com o porquê e as fatias, `Refs: <plan-path>` e `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Push explícito para `origin`. Nunca `--force`, `--amend`, `--no-verify`.
- **Agente 6** usa `gh pr create --base <base> --head <branch> --title ... --body-file <run-dir>/06-pr-body.md`. O corpo inclui resumo, fatias, padrão aplicado, tabela de gates real, link do plano, riscos/exceções e checklist de comportamento preservado. Se o PR já existir, reutilize. Não faça merge.
- Se `gh` não estiver autenticado, o PR fica pendente com o comando exato; o commit/push continua válido.

## 6. Relatório final

Preencha o template de [`references/report-templates.md`](references/report-templates.md) (seção “Relatório final do orquestrador”) com evidência real:

- branch, commit, push e PR;
- fatias antes/depois, endpoints, handlers e use cases;
- tabela de gates com resultado e evidência;
- exceções, desvios e o que não rodou;
- riscos residuais e próximo passo.

Se o pipeline parou, diga exatamente em qual agente, com qual artefato e qual decisão é necessária. Não declare sucesso sem ter lido o artefato, o `git log` e a saída dos gates.

## Guardrails

- Não refatore comportamento: rotas, status, DTOs, erros, telemetria, rate limit, auth, SQL e e-mail são intocáveis.
- Não crie, compartilhe ou reutilize um use case entre dois handlers; 1:1 é regra, não sugestão.
- Não deixe controller com mais de um endpoint nem handler com mais de uma injeção de use case.
- Não adicione dependência, `any`, `@ts-ignore`, `eslint-disable` ou teste relaxado.
- Não commite na `main`, não faça force push/amend/rebase/reset, não mescle PR.
- Não crie worktree: os agentes são sequenciais e compartilham a árvore.
- Não edite `.turbo/`, `dist/`, `coverage/`, `node_modules/`, `.next/` nem o bloco `turborepo-agent-rules` do `AGENTS.md`.
- Não altere `turbo.json` sem ler `node_modules/turbo/docs/README.md` da versão instalada.
- Não declare gate, commit, push ou PR sem ter visto a saída real.
- Sem `.git`, árvore suja, baseline quebrado, infra ausente ou gate falhando: **pare e explique**.
