# Templates dos artefatos da execução

> O run directory é `.claude/refactor/<run-id>/` (ignorado pelo git).
> O plano também é salvo em `.plans/refactor-slices-<run-id>-plan.md` (versionado).
> Use estes templates literalmente; o orquestrador valida a presença das seções.

## `state.json`

O orquestrador cria e mantém este arquivo. Cada agente só atualiza `phase` e `status` da sua fase.

```json
{
  "runId": "YYYYMMDD-HHmm",
  "scope": "apps/api/src/modules",
  "baseBranch": "main",
  "branch": "refactor/slices-YYYYMMDD-HHmm",
  "planPath": ".plans/refactor-slices-YYYYMMDD-HHmm-plan.md",
  "startedAt": "ISO-8601",
  "phases": {
    "audit": { "status": "pending", "artifact": "01-audit.md" },
    "plan": { "status": "pending", "artifact": "02-plan.md" },
    "implement": { "status": "pending", "artifact": "03-execution.md" },
    "qa": { "status": "pending", "artifact": "04-gates.md" },
    "commit": { "status": "pending", "artifact": "05-commit.md" },
    "pr": { "status": "pending", "artifact": "06-pr.md" }
  }
}
```

Status por fase: `pending`, `running`, `done`, `blocked`, `failed`.

## `01-audit.md` — Auditor

```markdown
# Auditoria de slices — <run-id>

- **Escopo:** `<scope>`
- **Data:** aaaa-mm-dd
- **Método:** script `audit-slices.mjs` + leitura semântica
- **Saída bruta:** `01-audit.raw.json`

## Resumo

| Fatia | Camadas | Endpoints | Classificação | Violações high/medium/low |
| --- | --- | --- | --- | --- |

**Total:** N fatias · N conformes · N não conformes · N exceções · N fora do escopo.

## Achados por fatia

### <fatia> — `non-conforming`

| # | Severidade | Arquivo:linha | Regra | Evidência | Por que importa | Mudança-alvo | Risco |
| --- | --- | --- | --- | --- | --- | --- | --- |

#### Observações semânticas

- ...

### <fatia> — `conforming`

- Nenhum achado. Não mexer.

### <fatia> — `exception`

- **Motivo:** ...
- **Por que o padrão não se aplica:** ...

## Fora do escopo

- ...

## Dúvidas bloqueantes

| Pergunta | Impacto | Bloqueante? | Quem decide |
| --- | --- | --- | --- |
```

## `02-plan.md` / `.plans/refactor-slices-<run-id>-plan.md` — Planner

Use o template de `.docs/RULES.md` §4 e acrescente:

```markdown
## Diagnóstico

(resumo da auditoria; link para 01-audit.md)

## Arquitetura-alvo

(resumo do padrão: camadas, use case 1:1, request handler 1:1; link para a referência)

## Ordem de execução

| Ordem | Fatia | Motivo da ordem | Depende de | Risco |
| --- | --- | --- | --- | --- |

## Mapeamento 1:1

| Endpoint | Request handler | Use case | Ports | Adaptadores | Testes |
| --- | --- | --- | --- | --- | --- |

## Batches

### Batch 1 — <fatia>

- **Objetivo:**
- **Arquivos a criar:**
- **Arquivos a mover:**
- **Arquivos a dividir:**
- **Arquivos a apagar:**
- **Módulo Nest (controllers/providers/tokens):**
- **Testes (só import/caminho/DI):**
- **Riscos:**
- **Rollback:**
- **Critério de aceite:**

## Comportamento preservado

- [ ] Rotas, métodos e status codes
- [ ] DTOs, validações e mensagens
- [ ] Códigos e mensagens de erro
- [ ] Telemetria (operação, labels, motivos)
- [ ] Rate limit (políticas e chaves)
- [ ] Auth (`@Public`, guard, sessão)
- [ ] SQL, RPC, migrations e permissões
- [ ] E-mail (template, assunto, conteúdo)
- [ ] Dependências externas

## Exceções

| Fatia | Motivo | Aprovado por |
| --- | --- | --- |

## Documentação e ADR

- `.docs/DEVELOPMENT.md` §2.1/§5
- `.docs/ARCHITECTURE.md` §4.2
- `.adrs/NNNN-request-handler-por-endpoint.md`

## Critério de pronto

- [ ] ...
```

## `03-execution.md` — Implementer

```markdown
# Execução da refatoração — <run-id>

- **Plano:** `<plan-path>`
- **Branch:** `<branch>`
- **Status geral:** done | blocked

## Batches

| Batch | Fatia | Status | Arquivos | Verificação focada | Desvios |
| --- | --- | --- | --- | --- | --- |

### Batch N — <fatia>

- **Status:** done | blocked
- **Criados:**
- **Movidos:**
- **Divididos:**
- **Apagados:**
- **Módulo atualizado:**
- **Testes atualizados (import/caminho/DI):**
- **Comandos executados:**
  | Comando | Resultado |
  | --- | --- |
- **Desvios do plano:**
- **Bloqueios:**

## Docs e ADR

- ...

## `git status` esperado

- ...
```

## `04-gates.md` — QA

```markdown
# Gates de qualidade — <run-id>

- **Branch:** `<branch>`
- **Commit base:** `<sha>`
- **Status:** done | blocked | failed

## Gate de arquitetura

| Verificação | Comando | Resultado | Evidência |
| --- | --- | --- | --- |
| Slices em camadas | `node .../audit-slices.mjs --strict` | Passou/Falhou | ... |
| Handler ↔ use case 1:1 | leitura + script | Passou/Falhou | ... |

## Gate de contrato

| Contrato | Mudou? | Evidência |
| --- | --- | --- |
| Rotas/métodos/status | Não | `git diff` |
| DTOs/validações | Não | ... |
| Erros | Não | ... |
| Telemetria | Não | ... |
| Rate limit | Não | ... |
| Auth | Não | ... |
| SQL/RPC | Não | ... |
| E-mail | Não | ... |

## Gates de QA

| # | Comando | Exit code | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| 1 | `bun run lint` | 0 | Passou | ... |
| 2 | `bun run check-types` | 0 | Passou | ... |
| 3 | `bun run build` | 0 | Passou | ... |
| 4 | `bun run test` | 0 | Passou | ... |
| 5 | `bun run test:integration` | 0 | Passou | ... |
| 6 | `bun run test:e2e` | 0 | Passou | ... |

## Não executado

| Gate | Motivo | Risco |
| --- | --- | --- |

## Falhas e correções

- ...
```

## `05-commit.md` — Commit & Push

````markdown
# Commit e push — <run-id>

- **Branch:** `<branch>`
- **Hash:** `<sha-curto>`
- **Header:** `<type>(<scope>): <descrição>`
- **Arquivos:** N
- **Push:** ok | pendente: <motivo>

## Mensagem

```text
<mensagem completa>
```

## Verificação

- [ ] `git log -1` confere o commit
- [ ] `git status` limpo (fora do run directory)
- [ ] Nenhum segredo/artefato gerado
- [ ] Push para `origin/<branch>`
````

## `06-pr.md` — PR

```markdown
# Pull Request — <run-id>

- **URL:** <url> | pendente
- **Base:** `<base-branch>`
- **Head:** `<branch>`
- **Título:** ...
- **Estado:** aberto | pendente

## Corpo do PR

(resumo ou link para `06-pr-body.md`)

## Pendências

- ...
```

## Relatório final do orquestrador

```markdown
## Refatoração de slices — <run-id>

- **Branch:** `<branch>`
- **Commit:** `<sha>` — `<header>`
- **Push:** ok | pendente
- **PR:** <url> | pendente
- **Plano:** `<plan-path>`
- **Run directory:** `<run-dir>`

### Fatias refatoradas

| Fatia | Antes | Depois | Endpoints | Handlers | Use cases |
| --- | --- | --- | --- | --- | --- |

### Gates

| Gate | Resultado | Evidência |
| --- | --- | --- |

### Desvios, exceções e pendências

- ...

### Próximos passos

- ...
```
