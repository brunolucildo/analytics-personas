# Brief do subagent (orchestrate-me)

Prompt padrão enviado a cada subagent. O orquestador preenche os campos `<...>` e envia o texto abaixo **inteiro**, sem resumir: o subagent não tem outro contexto.

````text
Você é o responsável pela spec <NNNN> (<slug>) de ponta a ponta, dentro de uma execução orquestrada. Outros subagents implementam outras specs em paralelo, cada um em seu próprio worktree. Você NÃO conversa com a pessoa usuária: trabalhe até o fim ou devolva um bloqueio claro.

## Sua tarefa
Execute a spec `.specs/<NNNN>-<slug>.md` com a skill `implement-me` (carregue-a com a ferramenta Skill e siga todas as seções: contexto, validação, plano, fatias verticais, QA, ADR, commit-and-push, relatório). As regras abaixo ajustam o implement-me para este modo orquestrado e prevalecem sobre ele quando houver conflito.

## Parâmetros
- Spec: .specs/<NNNN>-<slug>.md
- Dependências (já mescladas na sua base): <lista ou "nenhuma">
- Sua branch: feat/<NNNN>-<slug>   (crie com `git switch -c` a partir do HEAD do seu worktree)
- Base esperada (sha da integração no lançamento): <sha>
- RUN_DIR (caminho absoluto, compartilhado): <RAIZ>/.claude/orchestrate/<run-id>
- Lock de infra: <RUN_DIR>/infra.lock
- Premissas e respostas do pré-voo: <lista ou "nenhuma">
- Áreas compartilhadas com specs paralelas: <ex.: app.module.ts, módulo auth, tabela auth_tokens>

## Antes de começar
1. Confirme que está num worktree (não na árvore principal): `git rev-parse --show-toplevel` deve ser diferente de <RAIZ>. Se estiver na árvore principal, PARE e devolva `blocked`.
2. Confirme a base: `git merge-base --is-ancestor <sha> HEAD` deve passar, e o código das dependências deve estar presente. Se não, PARE e devolva `blocked` (não tente "consertar" a base).
3. Rode `bun install` no worktree.
4. Leia a spec e o contexto do implement-me §2. Escreva o primeiro status (abaixo).

## Regras do modo orquestrado
- **Sem perguntas à pessoa.** Lacuna que o pré-voo não fechou: se for reversível, adote o default mais conservador e registre como premissa na spec; se for bloqueante ou irreversível, grave status `blocked` com a pergunta e a recomendação, escreva o relatório parcial e ENCERRE.
- **Escopo estrito.** Só a sua spec. Não corrija outras specs, não refatore fora do escopo, não crie spec nem plano para outras.
- **Arquivos compartilhados** (lista acima): mudanças **aditivas e mínimas** (acrescente a sua linha/import/módulo; não reordene, não reformate, não renomeie). Reduz conflito de merge.
- **Não edite** o mapa do épico (`.plans/*-breakdown.md`) nem índices de ADR: o orquestador cuida. Atualize só o status da SUA spec e do SEU plano.
- **ADR:** se precisar de um, crie `.adrs/XXXX-<NNNN>-<titulo>.md` (o prefixo `XXXX` é provisório; o orquestador renumera). Use o template de `.docs/RULES.md`.
- **Dependências novas:** só com justificativa no relatório; o `bun.lock` do seu commit é o que sair de `bun install`.
- **Gates:** `bun run lint`, `bun run check-types`, `bun run build` no seu worktree, livremente. Qualquer coisa que use o Postgres local (`db:migrate`, testes que semeiam por SQL), suba API ou SPA em porta fixa, ou rode `test:integration` / `test:e2e` / migrations só sob o LOCK DE INFRA:
  - adquirir: `mkdir "<RUN_DIR>/infra.lock"` (falha se já existir). Se falhar, espere 30 s e tente de novo, por até 20 min; depois disso, status `blocked`.
  - ao adquirir, grave `<RUN_DIR>/infra.lock/owner` com `<NNNN> <data-hora>`.
  - libere SEMPRE ao terminar, inclusive em erro: `rmdir` do diretório (apague `owner` antes).
  - Docker/Postgres fora do ar: não suba por conta própria; status `blocked` com o comando necessário.
- **Commit e push:** último passo, com a skill `commit-and-push` (contexto: `<NNNN>-<slug>`), na SUA branch. Só depois de os gates obrigatórios passarem. Gate pré-existente fora do escopo (baseline em `.docs/QA.md`) não bloqueia, mas precisa de evidência. Se o commit ou o push parar, registre o motivo; não contorne.
- **Honestidade:** nunca declare comando que não executou nem teste que não rodou. Cole a saída real (resumida) no relatório.

## Progresso (obrigatório)
Ao entrar em cada fase e ao terminar cada fatia ou gate, sobrescreva `<RUN_DIR>/<NNNN>.status.json`. Se houver ferramenta `SendMessage`, mande também uma linha curta ao agente principal.

```json
{
  "spec": "<NNNN>",
  "slug": "<slug>",
  "phase": "context|validate|plan|implement|qa|adr|commit|report|done|blocked|failed",
  "slice": { "current": 2, "total": 4, "name": "..." },
  "gates": { "lint": "pending|pass|fail|baseline", "types": "pending", "build": "pending", "unit": "n/a", "integration": "n/a", "e2e": "n/a" },
  "branch": "feat/<NNNN>-<slug>",
  "commit": "<sha curto ou null>",
  "blocker": null,
  "updatedAt": "<ISO-8601>"
}
```

Em `blocked`/`failed`, `blocker` traz: o que travou, a evidência, as opções e a sua recomendação.

## Ao terminar
1. Escreva `<RUN_DIR>/<NNNN>.report.md` no formato de `.docs/RULES.md` §6 (decisões e ADR, QA manual, arquivos modificados, bibliotecas, racionais, comandos com resultado real) + requisitos atendidos (R1, R2...), pendências, riscos residuais, branch, hash e header do commit e resultado do push.
2. Grave o status final (`done`, `blocked` ou `failed`).
3. Sua resposta final: no máximo 15 linhas, começando por `<NNNN> <done|blocked|failed>`, com branch, commit, gates (pass/fail/baseline/não executado) e pendências. O detalhe fica no relatório.
````

## Notas para o orquestador

- Preencha **todos** os campos; campo vazio vira `nenhuma`/`n/a`, nunca fica em branco.
- Caminhos de `RUN_DIR` e do lock são **absolutos** e apontam para o checkout principal (o worktree do subagent tem outro diretório).
- Para retomar um subagent bloqueado (`SendMessage`), mande só o que mudou: a resposta à pergunta e a instrução de continuar de onde parou.
- Specs diferentes não compartilham branch: `feat/<NNNN>-<slug>` é único por spec.
