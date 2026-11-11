# Briefs dos 6 agentes

> O orquestrador lê este arquivo e envia **um brief por vez** ao subagent, em sequência.
> Todos os agentes trabalham no **mesmo checkout e na mesma branch**. Não crie worktree.
> Substitua os placeholders antes de enviar. O subagent começa sem contexto: o brief precisa ser autossuficiente.

## Placeholders

| Placeholder | Valor |
| --- | --- |
| `<RUN_ID>` | `YYYYMMDD-HHmm` da execução |
| `<RUN_DIR>` | Caminho absoluto de `.claude/refactor/<RUN_ID>` |
| `<SCOPE>` | Escopo da auditoria; padrão `apps/api/src/modules` |
| `<BASE_BRANCH>` | Branch de destino do PR; padrão `main` |
| `<BRANCH>` | `refactor/slices-<RUN_ID>` |
| `<PLAN_PATH>` | `.plans/refactor-slices-<RUN_ID>-plan.md` |
| `<AUDIT_PATH>` | `<RUN_DIR>/01-audit.md` |
| `<TARGET_ARCH_PATH>` | `.claude/skills/refactor-slices/references/target-architecture.md` |
| `<AUDIT_CHECKLIST_PATH>` | `.claude/skills/refactor-slices/references/audit-checklist.md` |
| `<REPORT_TEMPLATES_PATH>` | `.claude/skills/refactor-slices/references/report-templates.md` |

## Contexto comum (inclua em todos os briefs)

```text
Você é um subagent da skill refactor-slices. O objetivo é refatorar vertical slices
para o padrão de camadas do projeto (domain, application, infrastructure, interface),
com um use case por fluxo e um request handler por endpoint (1:1 handler ↔ use case).

Regras que valem para todos os agentes:
- Trabalhe no checkout atual, na branch <BRANCH>. Não crie worktree, não troque de branch,
  não faça merge, rebase, reset, amend, force push ou commit (exceto o Agente 5).
- Leia os documentos do projeto antes de agir: AGENTS.md da raiz, .docs/AGENTS.md,
  .docs/ARCHITECTURE.md, .docs/DEVELOPMENT.md, .docs/QA.md, .docs/RULES.md.
- A fonte de verdade da arquitetura-alvo é <TARGET_ARCH_PATH>.
- Não invente comandos, dependências, rotas ou comportamento.
- Não mascare falha com any, @ts-ignore, eslint-disable, teste relaxado ou gate pulado.
- Não edite artefatos gerados (.turbo/, dist/, coverage/, node_modules/, .next/).
- Registre o que realmente executou e viu. Relato sem evidência não conta.
- Ao terminar, escreva seu artefato no run directory e atualize state.json.
```

---

## Agente 1 — Auditor

**Missão:** encontrar, com evidência, todas as fatias que não seguem o padrão e classificar cada uma. É somente leitura: não altera código.

**Leia:**
- Contexto comum.
- `<AUDIT_CHECKLIST_PATH>`.
- `<TARGET_ARCH_PATH>`.
- Código de `<SCOPE>` (todas as fatias, módulos e testes).

**Faça:**
1. Rode o script e salve a saída bruta:
   ```bash
   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --scope <SCOPE> --json > <RUN_DIR>/01-audit.raw.json
   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --scope <SCOPE>
   ```
2. Leia cada fatia listada. Confirme ou descarte cada achado do script com leitura do código.
3. Procure violações semânticas que o script não vê: regra de negócio em controller/presenter, use case que orquestra dois fluxos, port implementado em `domain`, adaptador com regra, DTO virando entidade, dependência circular via barrel.
4. Classifique cada fatia: `conforming`, `non-conforming`, `exception` ou `out-of-scope`.
5. Para cada violação, registre: arquivo:linha, evidência, regra, por que importa, mudança-alvo e risco.
6. Liste as fatias que já estão conformes (para o planner não mexer nelas).
7. Liste dúvidas bloqueantes, se houver. Não invente resposta.

**Saída:** `<RUN_DIR>/01-audit.md` no template de `<REPORT_TEMPLATES_PATH>` (seção 01). Inclua a tabela de resumo, os achados por fatia e as exceções justificadas.

**Critério de saída:**
- [ ] Script executado e saída bruta salva.
- [ ] Toda fatia de `<SCOPE>` classificada.
- [ ] Toda violação com evidência e mudança-alvo.
- [ ] Exceções justificadas.
- [ ] Nenhum arquivo de código modificado (`git status` só mostra o run directory, que é ignorado).
- [ ] `state.json` com `phase: "audit"`, `status: "done"`.

**Pare se:** o escopo não existir, o repositório estiver sujo antes de começar ou houver dúvida bloqueante. Nesse caso, escreva o motivo no artefato e marque `status: "blocked"`.

---

## Agente 2 — Planner

**Missão:** transformar a auditoria em um plano de refatoração executável, ordenado, com mudanças por arquivo e critérios de aceite. Não altera código.

**Leia:**
- Contexto comum.
- `<AUDIT_PATH>` e `<RUN_DIR>/01-audit.raw.json`.
- `<TARGET_ARCH_PATH>`.
- `.docs/RULES.md` §4 (template de plano) e `.docs/QA.md`.
- Código das fatias `non-conforming`.

**Faça:**
1. Confirme cada achado no código; se a auditoria estiver errada, registre a correção no plano (não altere o artefato do auditor).
2. Ordene as fatias por risco/dependência. Recomendação: comece pela fatia menor que prova o padrão; deixe a maior (`auth`) para quando o padrão já estiver validado. Se houver dependência entre fatias, respeite.
3. Para cada fatia, escreva um **batch** com:
   - objetivo do batch;
   - arquivos a criar/mover/dividir/apagar;
   - mapeamento endpoint → handler → use case → ports → adaptadores → testes;
   - mudanças no módulo Nest (controllers/providers/tokens);
   - mudanças em testes (só import/caminho/DI; asserção não muda);
   - riscos e rollback;
   - critério de aceite verificável.
4. Inclua uma seção de **comportamento preservado** com a lista de contratos intocáveis (rotas, status, DTOs, erros, telemetria, rate limit, auth, SQL, e-mail, dependências).
5. Inclua uma seção de **exceções** (fatias `exception` e por quê).
6. Inclua a estratégia de testes por batch: teste focado durante a implementação, gates completos no Agente 4.
7. Inclua a atualização de docs/ADR: `.docs/DEVELOPMENT.md`, `.docs/ARCHITECTURE.md` e `.adrs/NNNN-request-handler-por-endpoint.md`.
8. Inclua a ordem de execução e o que fazer se um batch falhar.

**Saída:** `<PLAN_PATH>` no template de `.docs/RULES.md` §4 **mais** as seções específicas acima. Salve uma cópia em `<RUN_DIR>/02-plan.md`.

**Critério de saída:**
- [ ] Todo achado `high`/`medium` tem batch ou justificativa.
- [ ] Todo batch tem arquivos, mapeamento 1:1 e critério de aceite.
- [ ] Nenhuma mudança de comportamento está no plano.
- [ ] Ordem e rollback definidos.
- [ ] Nenhum código alterado.
- [ ] `state.json` com `phase: "plan"`, `status: "done"`.

**Pare se:** a auditoria não permitir um plano seguro (achado ambíguo, decisão de produto, dependência externa). Escreva as perguntas bloqueantes e marque `status: "blocked"`.

---

## Agente 3 — Implementer

**Missão:** executar o plano batch a batch, preservando comportamento, e deixar a árvore pronta para QA. Não commita.

**Leia:**
- Contexto comum.
- `<PLAN_PATH>` e `<RUN_DIR>/02-plan.md`.
- `<TARGET_ARCH_PATH>`.
- Código, testes e módulo das fatias do batch.

**Faça:**
1. Antes de cada batch, releia o batch e os testes que o cobrem.
2. Execute na ordem do plano. Para cada fluxo:
   - mova/crie `application/use-cases/<fluxo>.use-case.ts` com uma classe e um `execute`;
   - mova/crie `interface/request-handlers/<fluxo>.request-handler.ts` com uma classe, um endpoint e **uma** injeção de use case;
   - mova DTOs para `interface/dto/`, presenters para `interface/presenters/`;
   - mantenha ports em `domain/` e adaptadores em `infrastructure/`;
   - atualize o módulo Nest (`controllers`, `providers`, tokens) para a nova composição;
   - atualize imports/caminhos dos testes; **não mude asserções** para acomodar comportamento novo.
3. Rode a verificação mais barata após cada fluxo: teste focado (`bunx vitest run <arquivo>` ou o comando real do workspace), `bun run check-types` do workspace e lint do arquivo.
4. Atualize docs/ADR quando o padrão for aplicado pela primeira vez: `.docs/DEVELOPMENT.md` §2.1/§5, `.docs/ARCHITECTURE.md` §4.2, `.adrs/NNNN-request-handler-por-endpoint.md`.
5. Se um teste falhar por comportamento (não por import/DI), **pare o batch**, registre a divergência e não force o teste a passar.
6. Se um batch não puder ser concluído, registre `blocked` com o motivo e não avance para o próximo que dependa dele.
7. Não commite, não faça push, não abra PR.

**Saída:** `<RUN_DIR>/03-execution.md` no template de `<REPORT_TEMPLATES_PATH>` (seção 03): status por batch, arquivos criados/movidos/apagados, comandos executados, desvios do plano, bloqueios.

**Critério de saída:**
- [ ] Todos os batches `done` ou `blocked` com motivo.
- [ ] Nenhum endpoint sem handler 1:1.
- [ ] Nenhum use case com mais de um fluxo.
- [ ] Testes atualizados só em import/caminho/DI.
- [ ] Docs/ADR atualizados.
- [ ] `git status` lista apenas mudanças esperadas.
- [ ] `state.json` com `phase: "implement"`, `status: "done"` ou `"blocked"`.

**Pare se:** o plano estiver errado, um comportamento precisar mudar, faltar decisão de produto ou a mudança exigir dependência nova. Não improvise arquitetura fora do plano.

---

## Agente 4 — QA / Gatekeeper

**Missão:** provar que a refatoração preservou comportamento e que a arquitetura-alvo foi atingida. Pode corrigir falhas mecânicas causadas pela refatoração; não pode relaxar gates.

**Leia:**
- Contexto comum.
- `<RUN_DIR>/03-execution.md`, `<PLAN_PATH>`.
- `.docs/QA.md` (gates e baseline).
- `<AUDIT_CHECKLIST_PATH>` (para o gate de arquitetura).

**Faça:**
1. **Gate de arquitetura:** rode o script em modo estrito:
   ```bash
   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --scope <SCOPE> --strict
   ```
   Zero violação é o esperado. Exceções documentadas no plano não contam; registre cada uma.
2. **Gate de contrato:** revise `git diff` procurando mudança em rota, método, status, DTO, código/mensagem de erro, telemetria, rate limit, auth, SQL/RPC, e-mail ou dependência. Se houver, é falha.
3. **Gates de QA**, na ordem de `.docs/QA.md` §3:
   ```bash
   bun run lint
   bun run check-types
   bun run build
   bun run test
   bun run test:integration
   bun run test:e2e
   ```
   - `test:integration` e `test:e2e` são obrigatórios quando a refatoração toca a API (é o caso padrão). Exigem Docker, `bun run infra:up` e `bun run db:migrate`.
   - Se a infra não estiver disponível, **não declare sucesso**: marque `blocked` com o comando que falta e pare antes do commit.
   - Se um gate falhar por causa mecânica da refatoração (import, DI, caminho de teste), corrija e rode de novo.
   - Se falhar por comportamento, **pare** e reporte; não altere asserção para passar.
4. Rode também `bun run format` ou `bun run code:fix` se o lint acusar formatação, e rode o gate de novo.
5. Verifique se não há segredo, `.env` ou artefato gerado em `git status`.

**Saída:** `<RUN_DIR>/04-gates.md` no template de `<REPORT_TEMPLATES_PATH>` (seção 04): tabela com comando, exit code, resultado, evidência; gate de arquitetura; gate de contrato; o que não rodou e por quê.

**Critério de saída:**
- [ ] Gate de arquitetura sem violação (ou exceções documentadas).
- [ ] Lint, tipos, build e unitários passando.
- [ ] Integração e E2E passando (ou `blocked` explícito, sem commit).
- [ ] Nenhuma mudança de contrato.
- [ ] `state.json` com `phase: "qa"`, `status: "done"` ou `"blocked"`.

**Pare se:** qualquer gate obrigatório falhar por comportamento ou a infra necessária não estiver disponível. O Agente 5 não pode rodar com `status` diferente de `done`.

---

## Agente 5 — Commit & Push

**Missão:** commitar e publicar a refatoração **somente** depois de o QA aprovar, usando a skill `commit-and-push`.

**Leia:**
- Contexto comum.
- `<RUN_DIR>/04-gates.md` (precisa estar `done` e com gates verdes).
- `.claude/skills/commit-and-push/SKILL.md`.

**Faça:**
1. Confirme que `<RUN_DIR>/04-gates.md` existe e não tem gate obrigatório falhando. Se houver, pare.
2. Carregue a skill `commit-and-push` e siga o contrato dela (status → análise → segurança → mensagem → add → commit → push).
3. A branch deve ser `<BRANCH>`. Se a skill for criar outra branch, ajuste para usar a branch da execução.
4. Use Conventional Commits: `refactor(api): ...` (ou o tipo/scope que o diff justificar), descrição em pt-BR, corpo com o porquê e as fatias refatoradas, footer `Refs: <PLAN_PATH>` e `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
5. Faça push explícito para `origin` na branch `<BRANCH>`. Nunca `--force`, `--amend`, `--no-verify`.
6. Não abra PR; isso é o Agente 6.

**Saída:** `<RUN_DIR>/05-commit.md` no template de `<REPORT_TEMPLATES_PATH>` (seção 05): branch, hash curto, header, arquivos, resultado do push, pendências.

**Critério de saída:**
- [ ] Commit existe (`git log -1`).
- [ ] Push feito para `origin/<BRANCH>` (ou pendência explícita).
- [ ] Nenhum segredo/artefato no commit.
- [ ] `state.json` com `phase: "commit"`, `status: "done"`.

**Pare se:** QA não estiver `done`, a árvore estiver em conflito, o remoto não for `github.com/brunolucildo/` ou o push for rejeitado. Registre o motivo; não contorne.

---

## Agente 6 — PR

**Missão:** abrir o Pull Request da branch `<BRANCH>` para `<BASE_BRANCH>` com o resumo da refatoração e as evidências de QA. Não faz merge.

**Leia:**
- Contexto comum.
- `<RUN_DIR>/05-commit.md`, `<RUN_DIR>/04-gates.md`, `<PLAN_PATH>`.
- `.claude/skills/commit-and-push/SKILL.md` (destino e branch).

**Faça:**
1. Confirme que o commit e o push existem. Se não, pare.
2. Verifique `gh auth status` e o remoto. Se `gh` não estiver autenticado, escreva o corpo do PR em `<RUN_DIR>/06-pr-body.md` e registre a pendência com o comando exato para a pessoa abrir.
3. Verifique se já existe PR para a branch:
   ```bash
   gh pr view <BRANCH> --json url,state,title
   ```
   Se existir, reutilize e reporte a URL; não crie duplicado.
4. Monte o corpo do PR com:
   - resumo do problema e da solução;
   - fatias refatoradas e o padrão aplicado (camadas, use case 1:1, request handler 1:1);
   - tabela de gates com resultado real;
   - link do plano `<PLAN_PATH>`;
   - riscos, exceções e o que não rodou;
   - checklist de comportamento preservado.
5. Abra o PR:
   ```bash
   gh pr create --base <BASE_BRANCH> --head <BRANCH> --title "refactor(api): ..." --body-file <RUN_DIR>/06-pr-body.md
   ```
6. Não faça merge, não altere a base, não force push, não feche PR.

**Saída:** `<RUN_DIR>/06-pr.md` no template de `<REPORT_TEMPLATES_PATH>` (seção 06): URL, base/head, título, estado, pendências.

**Critério de saída:**
- [ ] PR aberto ou pendência explícita com comando.
- [ ] Corpo do PR contém gates reais e link do plano.
- [ ] Nenhum merge/force.
- [ ] `state.json` com `phase: "pr"`, `status: "done"`.

**Pare se:** não houver commit/push, `gh` não estiver autenticado ou a branch base não existir. Registre a pendência; não invente URL.
