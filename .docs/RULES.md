# Regras de trabalho

> **Público:** agentes de código e pessoas que vão executar tarefas no repositório.
> Estas regras são obrigatórias. Em caso de conflito, siga a ordem de precedência da seção 1.

## 1. Precedência de informação

1. **Código executável:** `package.json`, `turbo.json`, configs e o que realmente roda.
2. **`.docs/`:** contexto, intenção e convenções do projeto.
3. **`README.md` da raiz:** resumo de entrada; **não** é fonte de verdade.

Se o código divergir da documentação, o código vence. Atualize o `.docs` na mesma mudança — não deixe a divergência para depois.

## 2. Fluxo obrigatório

Toda tarefa de desenvolvimento segue esta ordem:

1. **Entender:** leia os documentos relevantes (`AGENTS.md` → `BUSINESS.md`/`ARCHITECTURE.md` → `DEVELOPMENT.md`/`QA.md`).
2. **Especificar:** use `breakdown-specs` quando o pedido juntar várias capacidades (ela quebra em várias specs e chama `create-spec` para cada uma); use `create-spec` para transformar um pedido de uma só capacidade em `.specs/<slug>.md`; use `refine-spec` para auditar uma spec existente; use `feature-concept` quando também for necessário planejar.
3. **Planejar:** com `feature-concept`, gere `.plans/<slug>-plan.md` a partir da spec.
4. **Implementar:** use `implement-me <slug>` para executar a spec em fatias pequenas e verificáveis, respeitando o escopo do plano.
5. **Validar:** execute os gates de `QA.md` e a verificação manual aplicável.
6. **Registrar ADR:** crie `./.adrs/NNNN-titulo.md` para decisões estruturais.
7. **Commit e push:** ao final de cada spec, execute a skill `commit-and-push` (ver seção 7). Só com os gates obrigatórios passando.
8. **Reportar:** entregue o relatório final da seção 6, incluindo branch, hash e resultado do push.

Tarefas triviais (typo, formatação, ajuste de texto) podem usar um plano de 3 linhas, mas **não pulam** o registro. Se a tarefa não for de código, o plano/ADR pode ser dispensado; o relatório continua. Se a spec já existir e estiver completa, `implement-me` pode ser usada diretamente, sem repetir o interrogatório.

## 3. Antes de planejar

Se o pedido tiver mais de uma capacidade, use `breakdown-specs` para cortá-lo em specs pequenas (uma feature por spec, em ordem de dependência) antes de especificar cada uma. Use `create-spec` para escrever a spec a partir de um prompt ou `refine-spec` para corrigir uma spec existente. Use `feature-concept` quando a ideia ainda estiver vaga e for necessário um interrogatório profundo seguido de plano.

A spec segue `.specs/_template.md`. Ela só está pronta quando:

- o escopo dentro/fora está fechado;
- todo requisito `Must` tem critério de aceite verificável;
- fluxos e estados (vazio, carregando, erro) estão descritos;
- permissões, dados sensíveis e integrações têm regras e caminhos de falha;
- perguntas abertas estão marcadas como bloqueantes ou não.

O plano detalhado fica em `.plans/<slug>-plan.md` (template na seção 4).

Se as skills não estiverem disponíveis, responda explicitamente a estas perguntas no plano:

1. Qual problema do usuário/negócio esta tarefa resolve?
2. Qual é o comportamento esperado, em passos observáveis?
3. O que está **fora** do escopo?
4. Quais dados entram e saem? Quem pode acessá-los?
5. Quais erros e estados vazios precisam existir?
6. Como saberemos que ficou pronto? Quais testes provam isso?
7. Que decisão arquitetural isso força? Há alternativa mais simples?

Se alguma resposta crítica estiver ambígua, **pare e pergunte** antes de implementar.

## 4. Template de plano

Arquivo: `.plans/<slug>-plan.md`. A spec correspondente fica em `.specs/<slug>.md` e segue `.specs/_template.md`.

```markdown
# Plano — <título>

- **Status:** rascunho | pronto para implementar
- **Slug:** <slug>
- **Spec:** `.specs/<slug>.md`
- **Data:** aaaa-mm-dd

## Contexto

Problema, usuário afetado e estado atual.

## Objetivo

Resultado observável esperado.

## Não-objetivos

O que não será feito nesta tarefa.

## Usuários e permissões

Papéis, isolamento (clube/workspace/usuário) e regras de acesso.

## Fluxos e estados

Caminho feliz, vazio, carregando, erro, cancelamento e retry.

## Requisitos

| ID  | Requisito | Prioridade (Must/Should/Could/Won't) | Critério de aceite       |
| --- | --------- | ------------------------------------ | ------------------------ |
| R1  | ...       | Must                                 | Given... When... Then... |

## Contratos de dados

Entidades, campos, fonte de verdade, retenção e PII.

## Integrações

Sistemas, autenticação, timeout, retry, idempotência e caminho de falha.

## Decisões e premissas

- Decisão:
- Premissa:
- Dúvida em aberto:

## Abordagem

1. Passo
2. Passo

## Arquivos previstos

- `caminho` — motivo

## Testes

- Unitário:
- Integração:
- E2E:
- Manual:

## Riscos e rollback

- Risco:
- Como reverter:

## Critério de pronto

- [ ] ...

## Perguntas abertas

| Pergunta | Impacto | Bloqueante? | Quem decide |
| -------- | ------- | ----------- | ----------- |
| ...      | ...     | Sim/Não     | ...         |
```

Regras de qualidade:

- Todo item `Must` tem critério de aceite verificável.
- Toda integração tem caminho de falha.
- Todo dado sensível tem regra de acesso e retenção.
- Toda premissa tem impacto declarado.
- Nenhuma pergunta aberta pode bloquear a implementação sem estar marcada como bloqueante.
- Nada de “implementar a feature” como passo; os passos precisam ser ações concretas.

## 5. Template de ADR

Arquivo: `./.adrs/NNNN-titulo.md` (numeração sequencial, `kebab-case`)

```markdown
# NNNN — <título>

- **Status:** proposto | aceito | substituído por NNNN
- **Data:** aaaa-mm-dd

## Contexto

Situação, forças e restrições que exigem uma decisão.

## Decisão

O que foi decidido, em uma frase clara.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
| ----------- | ---- | ------- | ----------- |

## Consequências

- Positivas:
- Negativas:
- Impacto em código, operação e time:
```

Crie ADR quando a decisão: muda estrutura de pastas, adiciona dependência relevante, define contrato entre partes, escolhe tecnologia, altera modelo de dados, autenticação, multi-tenancy ou estratégia de testes/observabilidade.

## 6. Relatório final

Ao final de cada tarefa de desenvolvimento, entregue **nesta ordem**:

1. **Decisões arquiteturais:** resumo das decisões e link para o ADR criado.
2. **QA manual:** passos para uma pessoa reproduzir a validação.
3. **Arquivos modificados:** lista de caminhos.
4. **Bibliotecas instaladas:** nome, versão, workspace e motivo. Se nenhuma, diga "nenhuma".
5. **Racionais:** por que a solução escolhida é a correta e o que foi descartado.
6. **Comandos executados:** copie os comandos e o resultado real. Se algo não foi executado, diga explicitamente.

Modelo:

```markdown
## Decisões

- ...

## QA manual

1. ...
2. ...

## Arquivos modificados

- `...`

## Bibliotecas instaladas

Nenhuma. / `pacote@versao` em `workspace` — motivo.

## Racionais

...

## Comandos executados

| Comando        | Resultado |
| -------------- | --------- |
| `bun run lint` | Passou    |
```

## 7. Limites de atuação

- **Escopo:** não refatore, renomeie ou reformate código fora da tarefa. Se identificar melhoria, registre como sugestão.
- **Dependências:** não adicione biblioteca sem justificar problema, alternativa e custo.
- **Segredos:** nunca commite `.env`, chave, token ou credencial. Não leia segredos sem necessidade.
- **Dados:** não use dado real de clube, atleta ou usuário em teste, exemplo ou log.
- **Destrutivo:** não apague arquivos, branches ou dados sem confirmação explícita.
- **Git:** commit e push só pela skill `commit-and-push`, a pedido do usuário ou no último passo de uma spec. Mensagens em Conventional Commits, sempre com `Co-Authored-By: Claude Code <noreply@anthropic.com>`. O destino do push é sempre `https://github.com/brunolucildo/<repositorio>`, via `origin`; outro destino exige decisão explícita do usuário. Proibido force push, `--amend`, `rebase`/`reset` por conta própria, `--no-verify`, alterar `git config` ou remotos e `git init`. Não commite direto na branch padrão (`main`/`master`): a skill cria `<type>/<slug>`, salvo instrução contrária do usuário.
- **Gerados:** não edite `.next/`, `.turbo/`, `dist/`, `coverage/`, `node_modules/` ou lockfile manualmente.
- **Root `AGENTS.md`:** não remova nem edite o bloco `turborepo-agent-rules`; ele é gerenciado pelo Turbo.
- **Turborepo:** antes de alterar `turbo.json` ou comandos, leia `node_modules/turbo/docs/README.md` da versão instalada.
- **Honestidade:** não invente saída de comando, teste, benchmark ou cobertura. Não declare algo pronto sem validar.

## 8. Quando parar e perguntar

Pare antes de implementar se:

- O requisito admite duas interpretações com impactos diferentes.
- A mudança exige decisão de produto (preço, permissão, retenção, multi-tenancy).
- A tarefa pede algo destrutivo ou irreversível.
- Seria necessário adicionar dependência pesada ou trocar tecnologia.
- Há conflito entre documentos ou entre documento e código.
- A validação exigiria credencial, serviço externo ou dado que você não tem.

Ao parar, explique o bloqueio, apresente opções e recomende uma.

## 9. Skills

Consulte o catálogo antes de começar. Skills de referência:

| Contexto                          | Skill                                              |
| --------------------------------- | -------------------------------------------------- |
| Quebrar prompt grande em specs    | `breakdown-specs` (quando houver 2+ capacidades)   |
| Criar spec a partir de prompt     | `create-spec` (obrigatória no fluxo)               |
| Refinar/auditar spec existente    | `refine-spec` (obrigatória no fluxo)               |
| Interrogatório profundo + plano   | `feature-concept`                                  |
| Executar uma spec                 | `implement-me <slug>` (obrigatória no fluxo)       |
| Executar um range de specs        | `orchestrate-me <range>` (subagents em paralelo)   |
| Refatorar slices fora das camadas | `refactor-slices` (auditoria + plano + refactor)   |
| Commitar e subir ao fim da spec   | `commit-and-push` (obrigatória no fluxo)           |
| Revisar um PR do GitHub           | `code-review <url-do-pr>` (agente `code-reviewer`) |
| UI/design                         | `frontend-design`, `web-design-guidelines`         |
| Next.js (`apps/docs`)             | `next-best-practices`                              |
| Performance React/Next            | `vercel-react-best-practices`                      |
| Testes orientados a comportamento | `tdd`                                              |
| Postgres/Supabase                 | `supabase-postgres-best-practices`                 |
| E2E no browser                    | `playwright`                                       |
| shadcn/ui e design system         | `shadcn`                                           |
| Documentos                        | skills de `.docx`, `.pdf`, `.xlsx`, `pptx`         |

As skills próprias do projeto vivem em `.claude/skills/` (carregadas pelo Claude Code, invocáveis por `/<nome>`): `breakdown-specs/`, `create-spec/`, `refine-spec/`, `feature-concept/`, `implement-me/`, `orchestrate-me/`, `refactor-slices/`, `code-review/` e `commit-and-push/`. É o único local de skills; a antiga `.agents/skills/` (OpenCode) foi removida. Os agentes próprios vivem em `.claude/agents/` (hoje, `code-reviewer`, lançado pela skill `code-review`). Ao alterar uma skill, atualize este documento e `AGENTS.md` na mesma mudança.

Se uma skill de terceiro não estiver instalada, **não invente** e **não bloqueie**: siga estes documentos, aplique o checklist equivalente e registre a ausência no relatório.
