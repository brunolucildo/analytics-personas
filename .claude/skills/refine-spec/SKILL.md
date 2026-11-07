---
name: refine-spec
description: Audits and rewrites an existing spec in .specs/ to make it precise, testable, and executable without changing its intent. Use this skill whenever the user says "refine-spec", "refinar spec", "melhorar spec", "revisar spec", "detalhar spec existente", "spec está vaga", "spec incompleta", or provides a spec path/slug and wants it improved—even if they do not mention the skill by name. Produces the refined spec; does not implement code.
---

# Refine Spec

Auditar e reescrever uma spec existente para que ela fique **precisa, testável e executável**, preservando a intenção original.

Refinar não é reescrever por gosto. É remover ambiguidade, fechar escopo, tornar critérios verificáveis e expor decisões que estavam escondidas.

## Contrato da skill

- **Entrada:** nome da spec, caminho de arquivo ou slug.
- **Saída:** a mesma spec refinada em `.specs/<slug>.md`, com resumo das mudanças e perguntas abertas.
- **Não faz:** implementar código, criar plano, alterar arquivos de produto ou mudar o escopo sem confirmação.
- **Handoff:** `feature-concept` para planejar ou `implement-me <slug>` para executar.

## 1. Resolver a spec

Aceite qualquer uma destas formas:

```text
refine-spec auth-email-password
refine-spec ./.specs/auth-email-password.md
refine-spec ./.specs/0000-foundation.md
```

Ordem de resolução para um slug `X`:

1. Caminho exato, se a entrada parecer um arquivo.
2. `.specs/X.md`
3. `.specs/X-spec.md`
4. `.specs/*X*.md` (ignorando `_template.md`)

Se houver mais de um candidato plausível, mostre os caminhos e peça para escolher. Se não houver nenhum, avise e ofereça `create-spec`.

## 2. Carregar contexto

Leia, nesta ordem:

1. A spec alvo, integralmente.
2. `.specs/_template.md` — estrutura esperada.
3. `AGENTS.md` da raiz e `.docs/AGENTS.md`.
4. `.docs/BUSINESS.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/QA.md`, `.docs/RULES.md`.
5. Specs relacionadas, `.plans/` e `.adrs/`.
6. Código, configuração e `package.json` das áreas citadas pela spec.

**Regra:** o código e os documentos vencem a spec. Se a spec descrever algo que não existe ou contradiz a arquitetura, registre a divergência antes de reescrever.

## 3. Auditar a spec

Classifique cada achado por severidade:

| Severidade     | Critério                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Bloqueante** | Impede implementar ou validar: requisito sem critério, permissão indefinida, contradição, escopo aberto.  |
| **Importante** | Aumenta risco: estado de erro ausente, integração sem falha, dado sensível sem retenção, premissa oculta. |
| **Melhoria**   | Legibilidade: título, ordem, exemplos, referências, duplicação.                                           |

Checklist mínimo:

- [ ] Título, status, slug e data estão preenchidos.
- [ ] Problema e necessidade de negócio estão explícitos.
- [ ] Escopo dentro/fora está fechado; não há “e também” implícito.
- [ ] Todo requisito tem ID, prioridade e critério de aceite verificável.
- [ ] Todo requisito `Must` tem pelo menos um critério Given/When/Then.
- [ ] Fluxos cobrem caminho feliz, vazio, carregando, erro e cancelamento quando aplicável.
- [ ] Permissões, multi-tenancy e dados sensíveis estão definidos.
- [ ] Integrações têm timeout, retry, idempotência e caminho de falha.
- [ ] Dependências e riscos estão declarados.
- [ ] O resultado esperado pode ser verificado por comando, evidência ou comportamento observável.
- [ ] Perguntas abertas têm impacto, dono e se são bloqueantes.
- [ ] Não há `TODO`, placeholder, termo vago ou requisito que não pode ser testado.
- [ ] A spec não contradiz `.docs/BUSINESS.md` nem `.docs/ARCHITECTURE.md`.

## 4. Decidir o modo de refinamento

| Situação                                          | Modo      |
| ------------------------------------------------- | --------- |
| Estrutura boa, faltam detalhes pontuais           | `patch`   |
| Estrutura incompleta, seções faltando ou confusas | `rewrite` |
| Spec contraditória ou com escopo em conflito      | `pause`   |

Regras:

- **`patch`:** edite apenas o necessário; preserve texto e decisões existentes.
- **`rewrite`:** preserve a intenção, os requisitos e as decisões; reorganize para o template. Não invente requisito novo.
- **`pause`:** se o refinamento exigir mudar o escopo, remover requisito ou decidir algo irreversível, pare e pergunte antes de escrever.

Nunca altere silenciosamente um requisito, uma prioridade ou um critério de aceite. Se a mudança for necessária, mostre o antes/depois e peça confirmação.

## 5. Perguntar apenas o que bloqueia

Se houver lacunas, faça no máximo **duas rodadas** de perguntas, agrupadas por tema e limitadas a **5 perguntas** por rodada.

- Pergunte apenas o que não pode ser respondido pelo repositório.
- Explique o impacto de cada resposta.
- Ofereça um default quando a decisão for reversível.
- Marque o que for premissa.
- Se a pessoa não estiver disponível, refine tudo que for reversível e deixe as lacunas irreversíveis como perguntas bloqueantes.

## 6. Reescrever a spec

Arquivo: `.specs/<slug>.md` (o mesmo caminho de entrada).

Regras:

1. Siga `.specs/_template.md`.
2. Mantenha o título e o slug, salvo se estiverem claramente errados; nesse caso, proponha a mudança.
3. Preserve o conteúdo válido; não reescreva o que já está claro.
4. Todo requisito `Must` precisa de critério de aceite.
5. Converta texto vago em requisito testável ou pergunta aberta.
6. Separe requisito de solução técnica.
7. Não adicione seção “Refinamento” se ela já existir; atualize a linha.
8. Registre o refinamento ao final:

```markdown
## Refinamento

| Data       | O que mudou                 | Motivo                     |
| ---------- | --------------------------- | -------------------------- |
| aaaa-mm-dd | Requisitos R1–R4 detalhados | Critérios não verificáveis |
```

Se a spec estiver vazia ou for só o template, não “refine”: use `create-spec`.

## 7. Auto-revisão

Antes de salvar, confirme:

- [ ] Nenhum requisito foi removido ou alterado sem confirmação.
- [ ] O escopo continua o mesmo, ou a mudança foi aprovada.
- [ ] Todos os `Must` têm critério de aceite.
- [ ] As lacunas restantes estão marcadas como perguntas bloqueantes.
- [ ] O documento não tem `TODO` nem placeholder.
- [ ] O histórico de refinamento foi atualizado.

## 8. Relatório final

Entregue:

1. **Diagnóstico:** achados por severidade (bloqueante / importante / melhoria).
2. **O que mudou:** lista objetiva, com seção e motivo.
3. **O que não mudou:** requisitos e decisões preservados.
4. **Perguntas abertas:** impacto e se bloqueiam a implementação.
5. **Próximo passo:** `feature-concept` para planejar ou `implement-me <slug>` para executar.

## Guardrails

- Não implemente código nem crie plano nesta skill.
- Não mude o escopo para “melhorar” a spec.
- Não transforme preferência em requisito sem confirmação.
- Não invente dados, permissões ou integrações ausentes.
- Não apague requisito, critério ou decisão sem confirmação explícita.
- Se a spec conflitar com o código ou com `.docs`, exponha o conflito e peça decisão.
- Se a spec for irrecuperável, recomende `create-spec` em vez de maquiar o documento.
