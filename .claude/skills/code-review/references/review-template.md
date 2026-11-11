# Templates da revisão

Dois arquivos por revisão, ambos gravados no diretório da execução (`<RUN_DIR>`): `review.json` (o rascunho que o agente produz) e, depois do lint, `review.final.json` (o payload que a skill publica).

## `review.json`

```json
{
  "commit_id": "<SHA de 40 caracteres do head do PR que você revisou>",
  "body": "<corpo geral em Markdown, com {{VERDICT}} (ver abaixo)>",
  "comments": [
    {
      "path": "apps/api/src/modules/auth/interface/request-handlers/sign-in.request-handler.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "issue (bug): ..."
    },
    {
      "path": "apps/app/src/features/auth/sign-in-form.tsx",
      "start_line": 30,
      "start_side": "RIGHT",
      "line": 34,
      "side": "RIGHT",
      "body": "suggestion (a11y): ..."
    }
  ]
}
```

Regras dos campos:

- **Só** estas chaves por comentário: `path`, `line`, `side`, `start_line`, `start_side`, `body`. Não use `position` (obsoleto).
- `path` é o caminho do arquivo **no head do PR** (o mesmo do diff).
- `line` é o número da linha **no arquivo**, não a posição dentro do diff. `side: "RIGHT"` (padrão) é o arquivo novo (linhas adicionadas e de contexto); `side: "LEFT"` é o arquivo antigo (linhas removidas e de contexto), para comentar código apagado.
- Comentário de **várias linhas**: `start_line` < `line`, no **mesmo hunk**.
- A linha precisa **aparecer no diff** (linha alterada ou as 3 de contexto em volta). Fora disso a API recusa a revisão inteira. O lint lista as linhas válidas; se a linha não existe, ancore na mais próxima relevante ou mova o ponto para "Comentários gerais" no corpo.
- Arquivo apagado: só `side: "LEFT"`. Arquivo novo: só `RIGHT`. Binário e arquivo sem hunk não aceitam comentário inline.

## Corpo geral (`body`)

O comentário geral **fecha** a revisão. Deve ser útil em 30 segundos. Use `{{VERDICT}}` na primeira linha: o script troca pelo veredito **calculado** (🔴 Solicitar mudanças / 🟢 Aprovado). Nunca escreva o veredito à mão.

```markdown
{{VERDICT}}

## Resumo

<2 a 4 frases: o que o PR faz (confirmado no diff, não só na descrição) e a avaliação geral.
Diga o que mais pesou no veredito.>

## Escopo da revisão

- Commit revisado: `<sha7>` · <N> arquivos · +<A> −<D>
- CI: <resultado de `gh pr checks`, ou "sem CI configurado">
- Não verificado: <o que você não pôde confirmar: testes não executados (a revisão é estática),
  comportamento em runtime, partes do PR não lidas por tamanho, etc.>

## Por dimensão

| Dimensão | Status | Observação |
| --- | --- | --- |
| Padrões | ✅ | <uma frase> |
| Performance | ✅ | |
| Bug / funcionalidade | ❌ | <ex.: 1 `issue` em `sign-in.request-handler.ts:42`> |
| Legibilidade | ⚠️ | |
| Acessibilidade | — | <não se aplica: o PR não toca UI> |
| I18n | ✅ | |
| Testes (QA) | ❌ | |
| Observabilidade | ✅ | |
| Segurança e demais | ✅ | <arquitetura, dados, API, dependências, escopo, docs: cite só as relevantes> |

Legenda: ✅ sem ressalvas · ⚠️ só comentários não bloqueantes · ❌ há `issue` ou `blocking` · — não se aplica.
O status é derivado dos comentários (inline **e** gerais): ❌ se a dimensão tem algum bloqueante.

## Comentários gerais

<Só o que não dá para ancorar em uma linha. Uma linha por item, no formato Conventional Comments,
sem negrito nem marcador além do `- `. Remova a seção se não houver nenhum.>

- issue (tests): o endpoint `POST /api/v1/...` não tem teste de integração
- chore (docs): registrar o ADR da decisão X (RULES.md §5)

## O que está bom

- <1 a 3 pontos específicos; remova a seção se nada se destacou>

## Próximos passos

<REQUEST_CHANGES: liste só os bloqueantes, em ordem de prioridade, com `arquivo:linha`.
APPROVE: diga que nada bloqueia e cite, se houver, as sugestões que mais valem o esforço.>

1. `apps/api/.../sign-in.request-handler.ts:42` — tratar `null` de `findByEmail`
2. Teste de integração do endpoint novo

{{COUNTS}}
```

Regras do corpo:

1. **`{{VERDICT}}` exatamente uma vez**; `{{COUNTS}}` (resumo `issue 2 · suggestion 3 · ...`, calculado) uma vez no fim. O script adiciona sozinho um marcador HTML de idempotência.
2. **Somente a seção "Comentários gerais"** tem linhas que começam com um label (`issue`, `note`, ...) seguido de `:`. Em qualquer outro lugar evite iniciar uma linha com essas palavras, porque o lint as conta como comentário (e pode mudar o veredito).
3. **Não repita os comentários inline** no corpo; a tabela e os "Próximos passos" só os referenciam. Cada bloqueante aparece **uma vez** como comentário (inline ou geral).
4. Mantenha o corpo abaixo de ~6.000 caracteres. Detalhe vai no comentário inline.
5. Fatos, não adjetivos: "1 `issue` em ..." em vez de "o código tem problemas".
6. Não cole segredo, token ou dado pessoal encontrado no diff; cite arquivo e linha.

## Revisão repetida (o PR já foi revisado por você)

- Leia as revisões e os comentários anteriores (`gh pr view --json reviews` e `gh api .../pulls/<n>/comments`).
- **Não repita** inline um comentário cujo problema já foi corrigido (o código mudou) nem um que ainda está aberto na mesma linha.
- **Problema que persiste** precisa continuar **bloqueando**: reescreva-o como um item de "Comentários gerais", citando a discussão anterior, ex.:
  ```text
  - issue (bug): pendente da revisão anterior (sign-in.request-handler.ts:42): o null de findByEmail ainda não é tratado
  ```

  Sem isso o veredito viraria 🟢 só porque o comentário antigo não foi repetido.
- Diga no "Resumo" o que foi resolvido desde a última revisão.
