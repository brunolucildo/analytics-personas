---
name: orchestrate-me
description: Orchestrates the end-to-end implementation of a range or list of specs (e.g. 0001-0010) by launching one background subagent per spec, each in its own git worktree running implement-me, scheduling them by dependency, tracking progress, merging results into an integration branch and reporting. Use this skill whenever the user says "orchestrate-me", "orquestrar specs", "implementar o range", "implementa da 0001 a 0010", "rodar várias specs de uma vez", "implementar specs em paralelo", "rodar specs com subagentes", or passes a range/list of spec numbers (0001-0010, 0002,0004,0007) expecting them all to be built—even if they do not mention the skill by name. For a single spec use implement-me; this skill does not write specs or plans for them.
argument-hint: "<range|lista> [--max-parallel N] [--no-push]  ex.: 0001-0010 | 0002,0004,0008 | 0003-0006,0009"
---

# Orchestrate Me

Implementar **várias specs de uma única vez**: o agente principal vira **orquestador** e sobe **um subagent por spec**, em background e em paralelo, cada um responsável por **uma spec de ponta a ponta** (`implement-me`). O orquestador agenda, acompanha o progresso, integra o resultado e entrega um relatório único.

**Fluxo:** resolver range → pré-voo → grafo de dependências → integração → lançar subagents → acompanhar → mesclar → gates → relatório.

## Contrato da skill

- **Entrada:** range (`0001-0010`), lista (`0002,0004,0008`) ou mistura (`0003-0006,0009`) de números de spec. Opções: `--max-parallel N` (teto de subagents simultâneos; padrão = todos os prontos, no máximo 10) e `--no-push` (não publica a branch de integração).
- **Saída:** uma branch de integração (`orchestrate/<primeira>-<ultima>`) com as specs mescladas, um commit por spec (feito pelo subagent via `commit-and-push`), ADRs renumerados, mapa do épico atualizado e relatório consolidado.
- **O orquestador não codifica.** Ele não implementa spec nenhuma; só resolve, agenda, monitora, integra e reporta. Código de spec vem de subagent.
- **Não faz:** criar ou refinar specs (use `create-spec` / `refine-spec`), pular as etapas do `implement-me` dentro dos subagents, ignorar dependências entre specs, `--force`, `--amend`, `rebase`, abrir PR, mesclar na `main`, declarar gate que não viu rodar.

## Princípios

1. **Paralelismo respeita dependências.** Specs independentes rodam juntas; uma spec só começa quando **todas** as suas dependências já estão mescladas na integração. Isso é um agendador contínuo (não ondas rígidas): a spec entra assim que sua última dependência é integrada.
2. **Um worktree por subagent.** Nenhum subagent escreve na árvore principal. Evita colisão em `app.module.ts`, `bun.lock`, índices e no `git add -A` do `commit-and-push`.
3. **Subagents não conversam com a pessoa.** Toda dúvida humana é resolvida **antes** do lançamento (pré-voo). Bloqueio inesperado vira status `blocked` + relatório; quem decide é o orquestador/usuário.
4. **Recursos compartilhados são serializados.** Supabase local, portas e migrations são únicos: quem precisa deles pega o **lock de infra** (§6).
5. **Progresso é observável.** Cada subagent grava um arquivo de status a cada fase; o orquestador mostra uma tabela de progresso.

## 1. Resolver o range

Aceite:

```text
orchestrate-me 0001-0010
orchestrate-me 0002,0004,0008
orchestrate-me 0003-0006,0009 --max-parallel 3
```

1. Expanda o range em números inteiros, sem repetidos, ordenados. `0001-0010` = 10 specs. Range invertido (`0010-0001`) ou número fora do formato `NNNN`: pare e pergunte.
2. Resolva cada número para `.specs/<NNNN>-*.md` (glob). Zero ou mais de um arquivo: pare e liste. Ignore `_template.md`.
3. Leia **só o cabeçalho** de cada spec: `Status`, `Slug`, `Depende de` (linha **Relacionados/Depende de**) e `Perguntas abertas`.
4. Status `concluída` já está feita: **pule** e avise (não reimplemente sem pedido explícito). Status `em implementação` com branch existente: pare e pergunte (retomar ou recomeçar).

## 2. Carregar contexto e pré-voo

Leia uma vez (o orquestador precisa do panorama; cada subagent relê o seu): `AGENTS.md` da raiz, `.docs/AGENTS.md`, `.docs/ARCHITECTURE.md`, `.docs/QA.md`, `.docs/RULES.md`, o mapa `.plans/*-breakdown.md` que listar as specs e `.adrs/`.

### 2.1 Estado do repositório

```bash
git rev-parse --is-inside-work-tree
git status --porcelain=v1 -b
git branch --show-current
git remote get-url --push origin     # precisa ser github.com/brunolucildo/...
```

- Árvore **suja**, conflito ou operação git em andamento: **pare**. Os worktrees partem do `HEAD`; trabalho solto geraria base inconsistente.
- Sem `.git`: pare. Sem `origin` válido: continue, mas marque o push como pendência (`--no-push` implícito).
- Garanta que `.claude/orchestrate/` está no `.gitignore` (adicione se faltar, em commit próprio fora das specs, antes de lançar).

### 2.2 Prontidão de cada spec (todas as perguntas, uma vez)

Para cada spec do range aplique a checagem de lacunas do `implement-me` §3 **sem implementar nada**:

- seção `TODO` ou vazia, requisito sem critério de aceite, não-objetivo ausente;
- perguntas abertas **bloqueantes** sem resposta;
- conflito com `.docs/ARCHITECTURE.md` ou `.docs/BUSINESS.md`;
- dependência **fora do range** que não esteja `concluída` (ex.: pediu `0005-0010` e `0004` ainda é rascunho): é bloqueio.

Consolide **todas** as dúvidas em **uma única rodada** de perguntas ao usuário (agrupadas por spec, até 5 por spec, cada uma com o impacto). Registre as respostas nas specs (seção de perguntas/premissas) **antes** de lançar. Se a pessoa não estiver disponível e a lacuna for reversível, adote o default conservador e registre como premissa; se for irreversível (auth, dados, dinheiro, permissões), **não lance aquela spec** (nem as que dependem dela).

Specs em `rascunho` sem lacuna bloqueante podem seguir: o subagent as valida de novo e atualiza o status.

## 3. Grafo e agenda

1. Monte o grafo a partir de **`Depende de`** na spec (fonte da verdade) e confira com a tabela do mapa do épico. Divergência: vale a spec; registre no relatório.
2. Dependência apontando para número **maior** ou ciclo: o corte está errado; **pare** e mostre (volte ao `breakdown-specs`).
3. Calcule o **nível** de cada spec (0 = sem dependência no range) e o conjunto de **prontas** (todas as dependências já integradas ou `concluída`).
4. Detecte **risco de conflito** entre specs que podem rodar juntas: arquivos/áreas que a spec cita em "O que fazer" (ex.: `app.module.ts`, módulo `auth`, mesma tabela, roteador). Não impede o paralelo; serve para o brief (arquivos compartilhados = mudança **aditiva e mínima**) e para a revisão de merge.
5. Aplique `--max-parallel`: com mais prontas que o teto, lance as de **menor número** primeiro.

Mostre o plano de execução (não peça confirmação, salvo se o pré-voo falhou):

```markdown
## Plano de orquestração — 0001-0010

| Spec | Slug | Depende de | Nível | Pode iniciar |
| ---- | ---- | ---------- | ----- | ------------ |
| 0001 | platform-routing-conventions | — | 0 | já |
| 0002 | auth-email-delivery | — | 0 | já |

Agenda: 0001 ‖ 0002 → 0003 → 0004 → 0005 → (0006 ‖ 0008 ‖ 0009) → 0007 → 0010
Máx. paralelo: N · Integração: orchestrate/0001-0010 (base <sha>)
Áreas com risco de conflito: app.module.ts (0002, 0003), tabela auth_tokens (0006, 0009)
```

## 4. Branch de integração e estado da execução

```bash
git switch -c orchestrate/<primeira>-<ultima>     # a partir do HEAD atual
```

Se a branch já existir, pare e pergunte (retomar ou usar outro nome). Crie o diretório da execução **no checkout principal** (caminho absoluto, compartilhado com os worktrees):

```text
<RAIZ>/.claude/orchestrate/<run-id>/
  state.json            # specs, status, branch, sha, deps (só o orquestador escreve)
  <NNNN>.status.json    # progresso (só o subagent daquela spec escreve)
  <NNNN>.report.md      # relatório final do subagent
  infra.lock/           # lock de infra (diretório criado atomicamente)
```

`<RAIZ>` = diretório pai de `git rev-parse --git-common-dir` (o checkout principal, mesmo dentro de um worktree). `<run-id>` = `YYYYMMDD-HHmm-<primeira>-<ultima>`. Status possíveis por spec: `queued`, `ready`, `running`, `blocked`, `failed`, `done`, `merged`, `held` (dependência falhou), `skipped`.

## 5. Lançar os subagents

Para **todas as specs prontas**, dispare as chamadas à ferramenta `Agent` **na mesma mensagem** (assim rodam em paralelo), todas em background:

- `subagent_type`: `general-purpose` (precisa de `Skill`, edição, shell).
- `isolation`: `"worktree"` — cada um no seu worktree, partindo do `HEAD` da integração.
- `description`: `Spec <NNNN> <slug>`.
- `prompt`: o **brief** de [`references/subagent-brief.md`](references/subagent-brief.md), preenchido (spec, slug, dependências, caminhos absolutos de `RUN_DIR` e do lock, base sha, áreas compartilhadas, premissas do pré-voo).

Registre `running` em `state.json` e anuncie em uma linha: `Lançados: 0001, 0002 (em paralelo). Em espera: 0003 (0001, 0002) …`.

Quando uma spec for integrada (§7) e liberar dependentes, lance os novos subagents **na hora**, também em lote e a partir do **novo `HEAD`** da integração. Nunca lance dependente antes de a dependência estar mesclada.

## 6. Recursos compartilhados

Só há **um** Supabase local, uma faixa de portas e um banco. Regras que o brief impõe aos subagents:

| Gate / ação | Onde roda | Concorrência |
| --- | --- | --- |
| `bun install`, `lint`, `check-types`, `build`, testes unitários | no worktree do subagent | livre |
| `supabase db reset`/`migration up`, `test:integration`, `test:e2e`, qualquer coisa que suba API/SPA em porta fixa | worktree do subagent, **sob o lock de infra** | **uma por vez** |

Lock: `mkdir "<RUN_DIR>/infra.lock"` (atômico; falha se já existir). Se falhar, aguarda 30 s e tenta de novo, até 20 min; ao terminar (inclusive em erro) faz `rmdir`. Dentro do lock grava `owner` (spec) e hora. Lock mais antigo que 30 min sem status recente do dono é considerado **órfão**: o orquestador investiga e remove. Se Docker/Supabase não estiver no ar, o subagent **não** o sobe sozinho fora do lock; registra `blocked` com o comando necessário.

Outros recursos que o orquestador trata, não os subagents:

- **ADRs:** o subagent cria `.adrs/XXXX-<NNNN>-<titulo>.md` (número provisório). O orquestador renumera ao mesclar (§7).
- **Mapa do épico** (`.plans/*-breakdown.md`) e índices: só o orquestador edita.
- **`bun.lock`:** conflito se resolve regenerando com `bun install`, nunca à mão.

## 7. Acompanhar e integrar

### 7.1 Progresso

Cada subagent atualiza `<NNNN>.status.json` ao fim de cada fase (formato no brief) e, quando houver `SendMessage` para o agente principal, avisa também. O orquestador:

- ao receber **qualquer notificação** de subagent (conclusão, falha, mensagem), lê todos os `*.status.json` e **reemite a tabela de progresso**;
- reemite a tabela também quando a pessoa perguntar "como está";
- com a ferramenta `Monitor` disponível, pode observar o diretório da execução em vez de depender só de notificações;
- **não** faz polling em laço nem `sleep` para esperar subagents (a conclusão chega sozinha).

```markdown
## Progresso — 0001-0010 (t+12 min)

| Spec | Fase | Slice | Gates | Estado |
| ---- | ---- | ----- | ----- | ------ |
| 0001 | QA | — | lint ✔ types ✔ build ⏳ | running |
| 0002 | implement | 2/4 | — | running |
| 0003 | — | — | — | queued (aguarda 0001, 0002) |
```

Fases: `context` → `validate` → `plan` → `implement` → `qa` → `adr` → `commit` → `report`.

### 7.2 Mesclar o que terminou

Ao chegar um subagent `done` (relatório presente, commit feito):

1. **Confira antes de confiar** (a nota do subagent é relato, não prova): leia `<NNNN>.report.md`, `git log <branch> -1 --stat`, e confirme que os gates declarados estão com saída real no relatório. Gate obrigatório falhando (não pré-existente): trate como falha (§8).
2. **Mescle, uma de cada vez**, na ordem de número, com `git merge --no-ff <branch-da-spec>` na branch de integração (na árvore principal). Mensagem de merge em Conventional Commits (`chore(specs): integra 0004-auth-sign-up`) com o co-author do `commit-and-push`.
3. **Conflito mecânico** (imports, listas de módulos, linhas de tabela/índice, `bun.lock`): resolva mantendo **os dois lados**, rode `bun install` se o lock mudou, e conclua o merge. **Conflito semântico** (duas implementações do mesmo comportamento, assinatura divergente): `git merge --abort`, marque a spec `blocked` e reporte com as duas versões; não adivinhe.
4. **Renumere o ADR** provisório para o próximo número livre em `.adrs/` (`git mv`, ajuste do título e das referências na spec/plano e no índice), em commit `docs(adrs): ...`.
5. **Verificação rápida pós-merge** na integração: `bun run check-types` e `bun run lint` (baseline conhecido do `@repo/ui` não conta como falha nova; ver `.docs/QA.md`). Falhou por interação entre specs: abra uma correção na integração (pequena, do orquestador) ou devolva à spec dona via `SendMessage`; registre.
6. Marque `merged` em `state.json`, atualize a coluna **Status** do mapa do épico e recalcule as **prontas** (§5).

Merges são **sequenciais** na árvore principal, mesmo que vários subagents terminem juntos.

## 8. Falhas e bloqueios

| Situação | Ação |
| --- | --- |
| Subagent devolve `blocked` (lacuna, decisão, serviço fora do ar) | Resolva com a pessoa se for decisão; retome o **mesmo** subagent com `SendMessage` (mantém contexto). Dependentes ficam `held`; independentes **continuam**. |
| Gate falhou e o subagent não conseguiu corrigir | Uma retomada via `SendMessage` com a saída do erro. Persistindo: `failed`, dependentes `held`, relate. |
| Subagent encerrou sem relatório ou sem commit | Trate como `failed`; não presuma sucesso. |
| Conflito semântico de merge | `blocked` na spec que chegou por último; mostre as duas implementações e recomende. |
| Pré-existente fora do escopo (baseline) | Não é falha; aparece no relatório com evidência. |
| Pedido de parar | Não lance novos; deixe os em curso terminarem ou os interrompa só se a pessoa pedir; relate o estado de cada worktree. |

**Nunca** relaxe um gate, pule o `commit-and-push` ou force a integração para "fechar" o range. Uma spec `held` com motivo claro é melhor do que uma integração quebrada.

## 9. Gates finais na integração

Com todas as specs `merged` (ou o máximo possível), na branch de integração, na ordem de `.docs/QA.md`:

```bash
bun run lint
bun run check-types
bun run build
```

Depois, os gates de infra (testes de integração e E2E) **sob o mesmo lock**, apenas se existirem e a infra estiver no ar. Rode, leia a saída e registre o resultado real; o que não rodou é declarado, com o motivo.

Se a integração falhar por interação entre specs, corrija na integração com a menor mudança, em commit `fix(...)` próprio, e rode de novo.

## 10. Publicar e limpar

Sem `--no-push` e com `origin` válido (`github.com/brunolucildo/`): `git push -u origin orchestrate/<primeira>-<ultima>` (nunca `--force`). Falha de push: relate e pare. **Não** abra PR nem mescle na `main`: sugira o PR.

Limpeza: remova worktrees de subagents **concluídos e mesclados** (`git worktree remove`), mantenha os `blocked`/`failed` para inspeção e diga onde estão. As branches das specs ficam (histórico e rastreio). Mantenha `.claude/orchestrate/<run-id>/` (relatórios) e apague só `infra.lock` se sobrar.

## 11. Relatório consolidado

```markdown
## Orquestração 0001-0010

- Integração: `orchestrate/0001-0010` @ <sha> (push: ok | pendente: <motivo>)
- Specs: <n> mescladas · <n> bloqueadas · <n> falhas · <n> retidas · <n> puladas
- Duração e paralelismo máximo atingido: ...

| Spec | Slug | Estado | Branch | Commit | Gates | ADR | Pendências |
| ---- | ---- | ------ | ------ | ------ | ----- | --- | ---------- |

## Gates da integração
(comando · resultado real · o que não rodou)

## Decisões arquiteturais
(ADRs criados e renumerados)

## Arquivos modificados · Bibliotecas instaladas · Comandos executados
(consolidados dos relatórios; formato de .docs/RULES.md §6)

## Conflitos de merge e correções de integração

## Fora do escopo, riscos residuais e próximos passos
```

O relatório por spec, no formato de `.docs/RULES.md` §6, fica em `.claude/orchestrate/<run-id>/<NNNN>.report.md`; o consolidado o resume, sem inventar nada que os subagents não tenham evidenciado.

## Guardrails

- O orquestador **não implementa** spec; só orquestra. Correção de integração é mínima e registrada.
- Todo subagent roda em **worktree próprio** e termina com `commit-and-push` na sua branch; nada vai para `main`.
- Nenhuma spec inicia antes de suas dependências estarem **mescladas**; o paralelismo vem de specs independentes.
- Dúvidas humanas vão **todas no pré-voo**; subagent nunca interroga a pessoa.
- Gates de infra (Supabase, portas, migrations) só sob o **lock**.
- Não declare spec concluída sem ter lido o relatório, o commit e a saída real dos gates; relato de subagent não é prova.
- Não altere o mapa do épico, ADRs numerados nem índices fora do orquestrador.
- Não use `--force`, `--amend`, `rebase`, `reset --hard` em branches de trabalho; não abra PR nem mescle na `main`.
- Não remova o bloco `turborepo-agent-rules` do `AGENTS.md` da raiz; não altere `turbo.json` sem ler a doc da versão instalada.
- Sem `.git`, árvore suja, ciclo de dependência ou dependência fora do range não concluída: **pare e explique**.
