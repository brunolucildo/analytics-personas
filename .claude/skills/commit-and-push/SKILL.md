---
name: commit-and-push
description: Analyzes every pending change in the working tree, writes a Conventional Commits message with Claude Code as co-author, stages everything, commits and pushes. Use this skill whenever the user says "commit-and-push", "commitar e dar push", "commita e sobe", "faz o commit", "subir as alterações", "git commit e push", or when an implement-me run finishes a spec (it is the mandatory last step of every spec). Do not use it on your own initiative in the middle of a task.
argument-hint: "[contexto opcional, ex.: slug da spec]"
---

# Commit And Push

Transformar as mudanças pendentes em **um commit Conventional Commits** e enviá-lo ao remoto: **status → análise → segurança → mensagem → add → commit → push**.

## Contrato da skill

- **Entrada:** nenhuma obrigatória. Um texto opcional (ex.: slug da spec) serve só de contexto para a mensagem; ele não substitui a leitura do diff.
- **Saída:** um commit na branch atual (ou em uma branch nova, ver 1.4), push feito e um relatório curto.
- **Quando roda:** apenas quando o usuário pedir (`/commit-and-push`) ou ao **final de cada execução de spec** (`implement-me`, passo "Commit e push"). Nunca por iniciativa própria no meio de uma tarefa.
- **Destino:** sempre `github.com/brunolucildo/<repositorio>`, via `origin`. Qualquer outro destino faz a skill parar.
- **Não faz:** `git init`, `--force`/`--force-with-lease`, `--amend`, `rebase`, `reset`, `--no-verify`, alterar `git config` ou remotos, commitar segredos ou artefatos gerados, resolver conflito de merge.

## 1. Pré-checagens

Rode e leia o resultado de cada uma antes de continuar.

1. **É um repositório git?** `git rev-parse --is-inside-work-tree`. Se falhar, **pare**: diga que o diretório não é um repositório git e que nada foi commitado. Não rode `git init` (criar repositório é decisão do usuário). Registre a limitação no relatório da spec.
2. **Estado:** `git status --porcelain=v1 -b`, `git branch --show-current`, `git remote -v`.
   - Árvore limpa: informe "nada a commitar" e encerre. Não faça push de commits antigos por conta própria.
   - Conflito (`UU`, `AA`, `DD`) ou operação em andamento (`.git/MERGE_HEAD`, `.git/rebase-merge`, `.git/CHERRY_PICK_HEAD`): **pare** e explique.
   - `HEAD` solto (sem branch): **pare** e peça uma branch.
3. **Remoto (destino fixo):** o push só vai para a conta **`brunolucildo`** no GitHub, sempre pelo remoto `origin`. Confira `git remote get-url origin` **e** `git remote get-url --push origin`; ambas as URLs precisam começar com `https://github.com/brunolucildo/` ou `git@github.com:brunolucildo/`.
   - Sem `origin`: o commit local ainda pode ser feito, mas o push não. Não invente a URL; informe `git remote add origin https://github.com/brunolucildo/<repositorio>.git` e registre a pendência.
   - `origin` apontando para outra conta, outro host ou outra URL de push: **pare antes de commitar**, mostre a URL e peça decisão. Não troque o remoto por conta própria.
4. **Branch padrão:** se a branch atual for `main`, `master` ou a de `origin/HEAD`, **não commite nela**. Crie `<type>/<slug>` (type da mensagem, slug em `kebab-case` vindo da spec ou do assunto) com `git switch -c` e diga isso no relatório. Se o usuário já disse que quer commitar direto na branch padrão, respeite. **Exceção:** o commit raiz (a branch ainda não tem nenhum commit, `git log` falha) vai direto para `main`, para que o primeiro push defina a branch padrão do repositório remoto.

## 2. Analisar todas as mudanças pendentes

Leia o conjunto inteiro, não só a lista de nomes:

```bash
git status --short
git diff HEAD --stat          # staged + unstaged, rastreados
git diff HEAD                 # conteúdo; leia por arquivo em diffs grandes
git ls-files --others --exclude-standard   # novos, não ignorados
git log -n 10 --oneline       # escopos e estilo já usados
```

- Leia o conteúdo dos arquivos novos que importam (pule binários, lockfiles e arquivos gerados; basta citar o nome).
- Mudanças já em stage também entram; o `git add -A` do passo 5 inclui tudo.
- Agrupe por intenção (funcionalidade, correção, docs, infra, dependências, testes) e identifique spec, plano ou ADR relacionados em `.specs/`, `.plans/` e `.adrs/`.
- Se houver mudanças sem relação entre si, escolha o tipo pela de maior impacto e descreva as demais no corpo. Não divida em vários commits.

## 3. Segurança antes do `git add`

Verifique a lista de arquivos modificados e novos (`git status --short`):

| Verificar                                                                                                              | Se encontrar                                                |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `.env`, `.env.*` (exceto `.env.example`), `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `credentials*`                          | **Pare**, liste e pergunte. Não adicione.                   |
| Conteúdo com chave ou token real (`BEGIN PRIVATE KEY`, `SERVICE_ROLE_KEY=` com valor, tokens `sk-`, `ghp_`, JWT longos) | **Pare**, mostre o arquivo e a linha (sem repetir o valor). |
| Artefatos gerados fora do `.gitignore` (`node_modules`, `dist`, `.next`, `.turbo`, `coverage`, `test-results`, `supabase/.temp`) | **Pare** e proponha ajustar o `.gitignore`.                 |
| Arquivo com mais de 5 MB                                                                                               | **Pare** e pergunte.                                        |

Chaves demo públicas do Supabase local e placeholders do `.env.example` não são segredo. Em caso de dúvida, pare e pergunte.

## 4. Escrever a mensagem (Conventional Commits 1.0.0)

```text
<type>(<scope>)!: <descrição>

<corpo>

Refs: .specs/<arquivo>.md
BREAKING-CHANGE: <só quando houver>
Co-Authored-By: Claude Code <noreply@anthropic.com>
```

Todos os footers (`Refs`, `BREAKING-CHANGE`, `Co-Authored-By`) ficam em **um único bloco no fim**, sem linha em branco entre eles, separado do corpo por uma linha em branco. É assim que o git os reconhece como trailers. Use sempre `BREAKING-CHANGE` com hífen (sinônimo oficial de `BREAKING CHANGE` na especificação): com espaço, o git não reconhece o token como trailer e descarta o bloco inteiro, inclusive o co-author.

**Tipos:**

| type       | Use para                                                      |
| ---------- | ------------------------------------------------------------- |
| `feat`     | Nova capacidade observável (inclui entrega de uma spec)       |
| `fix`      | Correção de comportamento                                     |
| `refactor` | Reestruturação sem mudar comportamento                        |
| `perf`     | Ganho de desempenho                                           |
| `docs`     | Só documentação (`.docs/`, README, ADR, spec, plano)          |
| `test`     | Só testes                                                     |
| `build`    | Dependências, bundler, `package.json`, Docker, Supabase, `turbo.json` |
| `ci`       | Pipelines e hooks de CI                                       |
| `style`    | Formatação sem efeito no código                               |
| `chore`    | Manutenção que não cabe nos demais (ex.: skills, configs)     |
| `revert`   | Reversão de commit anterior                                   |

Escolha pelo conteúdo do diff, não pelo nome da tarefa. Uma spec que entrega funcionalidade costuma ser `feat`; uma que só mexe em ferramentas costuma ser `build` ou `chore`.

**Scope** (opcional, minúsculo, uma área): `app`, `api`, `docs`, `ui`, `infra`, `supabase`, `scripts`, `e2e`, `deps`, `specs`, `adrs`, `skills`, `config`. Com várias áreas igualmente relevantes, omita o scope.

**Regras:**

- Header com até 72 caracteres; descrição em pt-BR, no presente ("adiciona", "corrige", "remove"), minúscula, sem ponto final. `type` e `scope` ficam em inglês.
- Corpo (separado por linha em branco) explica o **porquê** e resume o que mudou por área, em tópicos curtos. Quebre linhas em ~72 colunas.
- Mudança que quebra contrato ou remove algo usado (ex.: remoção de `apps/web`): `!` depois do type/scope **e** footer `BREAKING-CHANGE: <o que quebra e como migrar>`.
- Referencie a spec no footer `Refs: .specs/<arquivo>.md` (acrescente `ADR 000N`, se houver). Sem spec relacionada, omita o `Refs`.
- **Co-author obrigatório:** a última linha da mensagem é sempre `Co-Authored-By: Claude Code <noreply@anthropic.com>`, no bloco de footers. Não adicione outros co-autores nem altere `user.name`/`user.email`.
- Não coloque segredo, PII, dado real de clube ou atleta na mensagem.

## 5. Adicionar e commitar

```bash
git add -A
git status --short            # confira o que entrou
git commit -F - <<'EOF'
<mensagem>
EOF
```

No PowerShell, use um here-string de aspas simples (`@'...'@`) com `git commit -F -`. Depois, `git log -1 --stat` para confirmar.

**Hook de pre-commit:** o `lefthook` roda `lint-staged` (OXLint `--fix` + OXFmt). Se o hook falhar:

1. leia a causa e corrija;
2. `git add -A` de novo;
3. crie o commit outra vez.

Nunca use `--no-verify` nem `--amend` para contornar o hook.

## 6. Push

- Sempre explícito para o destino fixo, depois de reconferir a URL do `origin` (passo 1.3): `git push origin <branch>`, ou `git push -u origin <branch>` se a branch ainda não tem upstream. Nunca para outro remoto nem para uma URL passada na linha de comando.
- Sem `origin`: pare e informe que o commit ficou só local.
- Repositório inexistente no GitHub (erro `repository not found`): relate; não tente criá-lo.
- Push rejeitado (non-fast-forward): **pare**, mostre a mensagem e sugira `git pull --rebase`; só execute se o usuário pedir.
- Falha de autenticação ou permissão: relate o erro; não tente outras credenciais.
- **Nunca** use `--force` nem `--force-with-lease`.

## 7. Relatório

Entregue, em poucas linhas:

- branch (e se foi criada por esta skill);
- hash curto e header do commit;
- quantidade de arquivos e as áreas tocadas;
- resultado do push (remoto e branch) ou o motivo de ele não ter ocorrido;
- se a branch é nova, sugira abrir um PR, sem abri-lo.

## Guardrails

- Não rode esta skill sem pedido do usuário, a não ser no passo final de `implement-me`.
- Não commite se os gates da spec falharem; quem chama esta skill deve ter validado antes.
- Não commite segredo, `.env`, artefato gerado ou arquivo grande (passo 3).
- Não reescreva histórico (`--amend`, `rebase`, `reset`, force push).
- Não pule hooks nem altere a configuração do git, inclusive remotos (`git remote add|set-url|remove`).
- Nunca faça push para fora de `github.com/brunolucildo/`; destino diferente exige decisão explícita do usuário e mudança desta skill.
- Não inicialize repositório git; sem `.git`, relate e pare.
- Não declare commit ou push feitos sem ter visto a saída do comando.
