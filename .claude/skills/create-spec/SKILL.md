---
name: create-spec
description: Creates a refined, executable spec in .specs/ from a prompt, idea, ticket, or request. Use this skill whenever the user says "create-spec", "criar spec", "escrever spec", "gerar spec", "transformar ideia em spec", "documentar requisito", "spec de <feature>", or asks to turn a request into a spec file—even if they do not mention the skill by name. Produces only the spec document (no plan, no code) and hands off to refine-spec, feature-concept, or implement-me.
---

# Create Spec

Transformar um prompt em uma **spec executável** em `.specs/`, seguindo `.specs/_template.md`.

Esta skill escreve o documento que descreve **o que** deve ser feito e **como saber que ficou pronto**. Ela não decide a implementação nem escreve código.

## Contrato da skill

- **Entrada:** prompt, ideia, ticket, conversa, requisito solto ou link.
- **Saída:** `.specs/<slug>.md` preenchido, mais um resumo curto e a lista de perguntas abertas.
- **Não faz:** implementar código, criar plano de implementação, instalar dependências, alterar arquivos de produto.
- **Handoff:** `refine-spec <slug>` para auditar a spec, `feature-concept` para gerar o plano, `implement-me <slug>` para executar.

## 1. Resolver nome e arquivo

1. Gere um slug curto e estável em `kebab-case` (ex.: `auth-email-password`).
2. Se `.specs/` já usar prefixo numérico (ex.: `0000-foundation.md`), aloque o próximo número e use `<NNNN>-<slug>.md`.
3. Se o arquivo alvo já existir:
   - **vazio** → preencha.
   - **com conteúdo** → não sobrescreva; avise e use `refine-spec`.
4. Crie `.specs/` se não existir.

Nunca invente um slug que colida com spec existente nem sobrescreva trabalho de outra pessoa.

## 2. Carregar contexto antes de perguntar

Leia, nesta ordem, o que existir:

1. `AGENTS.md` da raiz e `.docs/AGENTS.md`.
2. `.docs/BUSINESS.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/QA.md`, `.docs/RULES.md`.
3. `.specs/_template.md`, specs existentes, `.plans/` e `.adrs/`.
4. Código, configuração e `package.json` diretamente relacionados ao pedido.

**Regra:** não pergunte o que o repositório já responde. Se a resposta estiver no código ou nos docs, cite o arquivo e confirme a interpretação.

## 3. Pré-spec e confirmação

Antes de escrever o arquivo, produza um **pré-spec de 5–10 linhas**:

```markdown
Entendi que:

- Problema: ...
- Usuário/papel: ...
- Resultado esperado: ...
- Dentro do escopo: ...
- Fora do escopo (minha leitura): ...
- Suposições: ...
- Dúvida principal: ...
```

Pergunte apenas: “O que está errado ou faltando nesse resumo?”. Só avance depois de corrigir o entendimento.

Se o pedido for pequeno e sem ambiguidade, pule a entrevista longa, mas ainda confirme o pré-spec.

## 4. Entrevista direcionada

Use rodadas curtas: **um tema por rodada**, no máximo **5 perguntas**. Explique em uma frase por que a resposta muda a spec.

Cubra, pulando o que já estiver claro:

1. **Problema e sucesso**
   - Quem sente o problema e como resolve hoje?
   - Qual decisão ou ação muda quando a feature existir?
   - Qual é o resultado observável e a métrica de sucesso?
   - O que acontece se nada for feito?

2. **Escopo**
   - O que é obrigatório no primeiro release? (Must)
   - O que é desejável, mas pode esperar? (Should/Could)
   - O que está explicitamente fora? (Won't)
   - Existe uma versão menor que já entrega valor?

3. **Usuários, permissões e dados**
   - Quais papéis usam a feature e o que cada um pode ver/fazer?
   - O isolamento é por clube, workspace, usuário ou outro?
   - Quais entidades e campos novos existem? Qual é a fonte de verdade?
   - O que é PII, quanto tempo fica retido e quem pode excluir?

4. **Fluxos e estados**
   - Qual é o gatilho e o caminho feliz, passo a passo?
   - O que o usuário vê em estado vazio, carregando, erro, sucesso parcial e cancelamento?
   - Existe ação irreversível? Como confirmar e como desfazer?
   - O que acontece quando uma integração falha?

5. **Integrações e restrições**
   - Quais sistemas externos entram? Quem autentica?
   - Sincronização contínua, agendada ou sob demanda?
   - Timeout, retry, rate limit, idempotência e duplicidade.
   - Restrições de stack, deploy, latência, custo ou prazo.

6. **Aceite**
   - Quais são os critérios de aceite em Given/When/Then?
   - Qual comportamento prova que a feature funciona?
   - O que precisa de automação e o que pode ser verificado manualmente?

Quando a pessoa não souber, proponha um default conservador, marque como **premissa** e siga. Não trave a spec por detalhe reversível; pare apenas em decisões irreversíveis (auth, dados, dinheiro, permissões).

## 5. Escrever a spec

Use `.specs/_template.md` como estrutura obrigatória. Regras:

- Toda seção do template deve ser preenchida ou marcada como “não se aplica”, com motivo.
- Todo requisito `Must` tem critério de aceite verificável.
- O escopo deve ter itens explícitos **dentro** e **fora**.
- Fluxos incluem caminho feliz e, quando houver UI ou integração, estados vazio/erro/carregando.
- Dados sensíveis têm regra de acesso, retenção e o que não pode ser logado.
- Integrações têm caminho de falha.
- Premissas e perguntas abertas ficam visíveis, com impacto e se são bloqueantes.
- Nada de `TODO` solto: ou vira requisito, ou vira pergunta aberta marcada.

A spec descreve comportamento e contrato, não implementação detalhada. Se precisar de decisão arquitetural, registre como pergunta ou dependência; não a esconda no texto.

## 6. Auto-revisão antes de salvar

Confirme:

- [ ] O título e o slug são claros e únicos.
- [ ] O problema e o resultado esperado estão explícitos.
- [ ] O escopo dentro/fora está fechado.
- [ ] Todos os requisitos `Must` têm critério de aceite.
- [ ] Os estados vazio/erro/carregando existem quando aplicáveis.
- [ ] Permissões, multi-tenancy e dados sensíveis estão tratados.
- [ ] Integrações têm falha, timeout e retry descritos.
- [ ] As perguntas abertas estão marcadas como bloqueantes ou não.
- [ ] Não há contradição com `.docs/BUSINESS.md` ou `.docs/ARCHITECTURE.md`.
- [ ] Não há `TODO`, placeholder ou requisito vago (“melhorar”, “otimizar”).

## 7. Handoff

Ao final, diga:

```text
Spec criada em .specs/<slug>.md
Status: rascunho | pronta
Perguntas abertas: <n> (<m> bloqueantes)
Próximo passo: refine-spec <slug> para auditar, feature-concept para planejar ou implement-me <slug> para executar
```

## Guardrails

- Não implemente código nem crie plano nesta skill.
- Não invente requisitos para preencher lacunas; proponha defaults e marque como premissa.
- Não sobrescreva spec existente com conteúdo.
- Não copie a solução técnica para dentro da spec sem separar requisito de decisão.
- Não ignore restrições de `.docs/ARCHITECTURE.md` e `.docs/BUSINESS.md`.
- Se o pedido conflitar com a documentação, exponha o conflito e peça decisão.
- Para features de auth, permissões, multi-tenancy, dinheiro ou dados pessoais, redobre as perguntas e registre as decisões.
