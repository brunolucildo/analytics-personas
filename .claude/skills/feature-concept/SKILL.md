---
name: feature-concept
description: Turns a vague feature idea, ticket, or request into a precise, executable spec and plan through a deep, structured interview. Use this skill whenever the user says "feature-concept", "grill me", "me pergunta tudo", "levantar requisitos", "planejar feature", "transformar ideia em spec", "escrever a spec", "detalhar o escopo", or asks for a plan before implementation—even if they do not mention the skill by name. Do not write production code in this skill; produce the spec/plan and hand off to implement-me.
---

# Feature Concept

Transformar uma ideia incompleta em uma **spec executável**: requisitos testáveis, escopo fechado, decisões explícitas e um plano que outra pessoa (ou agente) consegue implementar sem adivinhar.

Esta skill é deliberadamente inquisitiva. O objetivo não é burocratizar: é evitar retrabalho, interpretação errada e planos que viram ação pela metade.

## Contrato da skill

- **Entrada:** descrição da feature, ticket, conversa, link ou apenas o nome da spec.
- **Saída:** spec em `.specs/<slug>.md` (seguindo `.specs/_template.md`) + plano em `.plans/<slug>-plan.md`, mais um resumo e a lista de perguntas abertas.
- **Não faz:** implementar código, instalar dependências, alterar arquivos de produto.
- **Handoff:** ao final, indique `implement-me <slug>` (ou o caminho da spec/plano).
- **Skills relacionadas:** use `create-spec` quando o objetivo for apenas escrever a spec e `refine-spec` quando ela já existir e precisar de auditoria. Esta skill é para quando também é necessário planejar a implementação.

## 1. Carregar contexto antes de perguntar

Leia, nesta ordem, o que existir:

1. `AGENTS.md` da raiz e `.docs/AGENTS.md`.
2. `.docs/BUSINESS.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/QA.md`, `.docs/RULES.md`.
3. `.specs/`, `.plans/` e `.adrs/` existentes.
4. Código e configuração diretamente relacionados à feature.

**Regra:** nunca pergunte algo que o repositório já responde. Se a resposta estiver no código, cite o arquivo e confirme a interpretação. Isso reduz o questionário e mostra que você fez o dever de casa.

Comece com um **pré-spec de 5–10 linhas**:

```markdown
Entendi que:

- Problema: ...
- Usuário: ...
- Resultado esperado: ...
- Fora do escopo (minha leitura): ...
- Suposições: ...
```

Pergunte apenas: “O que está errado ou faltando nesse resumo?”. Só avance depois de corrigir o entendimento.

## 2. Como conduzir o interrogatório

Use rodadas curtas. Uma rodada = **um tema**, no máximo **5 perguntas**. Não despeje 30 perguntas de uma vez; isso faz a pessoa responder por alto justamente o que importa.

Para cada pergunta:

- Explique em uma frase **por que** a resposta muda a spec.
- Prefira cenários concretos (“o analista abre a lista e não há nenhum expert: o que ele vê?”) a abstrações (“qual o comportamento em estado vazio?”).
- Ofereça opções quando ajudar (A/B/C), mas permita “não sei” e “decida por mim”.
- Quando a pessoa não souber, proponha um default, marque como **premissa** e siga. Não trave a feature por detalhe reversível.
- Registre respostas literalmente na spec; não “melhore” o requisito sem avisar.

### Roteiro de temas

Pule o que já estiver claro. A ordem é uma prioridade, não uma obrigação.

1. **Problema e sucesso**
   - Quem sente o problema hoje e como resolve sem a feature?
   - Qual decisão/ação muda quando a feature existe?
   - Como medimos sucesso? Qual número ou comportamento observável?
   - O que acontece se não fizermos nada?

2. **Escopo e não-objetivos**
   - O que é obrigatório no primeiro release? (Must)
   - O que é desejável, mas pode ficar para depois? (Should/Could)
   - O que está explicitamente fora? (Won't)
   - Existe uma versão menor que já entrega valor?

3. **Usuários, papéis e permissões**
   - Quais papéis usam a feature e o que cada um pode ver/fazer?
   - O isolamento é por clube, workspace, usuário ou outro? (multi-tenant)
   - Quem aprova, audita ou recebe notificação?
   - O que acontece quando alguém perde acesso?

4. **Fluxos e estados**
   - Qual é o gatilho e o caminho feliz, passo a passo?
   - Estado vazio, carregando, erro, sucesso parcial, cancelamento e retry.
   - O que o usuário vê quando uma integração falha?
   - Existe ação irreversível? Como confirmar e como desfazer?

5. **Dados e domínio**
   - Quais entidades e campos novos existem? Qual é a fonte de verdade?
   - Quem cria, edita, apaga e exporta? Com que frequência?
   - Volume inicial e crescimento esperado.
   - Retenção, auditoria, migração e dados históricos.
   - O que é PII? O que não pode ser logado?

6. **Integrações**
   - Quais sistemas externos entram? Quem autentica?
   - Sincronização contínua, agendada ou sob demanda?
   - Rate limit, timeout, idempotência, duplicidade e reconexão.
   - O que acontece se o provedor mudar o contrato?

7. **Experiência e interface**
   - Existe referência visual, fluxo ou produto que devemos seguir?
   - Desktop, tablet e mobile: o que muda em cada um?
   - Conteúdo real, tom, idioma e microcopy.
   - Acessibilidade: teclado, foco, leitor de tela, contraste.
   - A feature precisa existir sem JavaScript?

8. **Arquitetura e operação**
   - Restrições de stack, deploy, latência, custo ou prazo.
   - Isso cria um novo módulo, contrato ou dependência?
   - Precisa de fila, job, cache, storage ou webhook?
   - Como observar em produção? Quais logs/métricas provam saúde?
   - Como fazer rollout e rollback?

9. **Aceite e testes**
   - Quais são os critérios de aceite em Given/When/Then?
   - Quais seams públicos serão testados? (unidade, integração, E2E)
   - Qual é o teste que falha se a regra principal quebrar?
   - O que pode ser verificado manualmente e o que precisa de automação?

## 3. Critério de convergência

Pare de perguntar quando você conseguir:

- escrever critérios de aceite para **todos os requisitos Must**;
- descrever o caminho feliz + estados vazio/erro/carregando;
- identificar dados, permissões e integrações afetadas;
- listar arquivos/áreas prováveis e a estratégia de teste;
- separar o que é decisão do que é premissa.

Se a pessoa estiver com pouca disponibilidade, entregue um **rascunho de spec e plano** com defaults marcados e faça só as perguntas que podem invalidar a arquitetura. Não faça mais de **3 rodadas** sem mostrar um artefato concreto.

## 4. Escrever a spec e o plano

### 4.1 Spec — `.specs/<slug>.md`

Use `.specs/_template.md` como estrutura obrigatória. A spec deve conter, no mínimo:

1. Cabeçalho com status, slug, data, owner e relacionados.
2. Escopo dentro/fora.
3. Contexto e necessidade de negócio (usuário, decisão, resultado, métrica).
4. Requisitos com ID, prioridade e critério de aceite.
5. Fluxos e estados (feliz, vazio, carregando, erro, sucesso parcial, cancelamento/retry).
6. Acceptance Criteria em Given/When/Then.
7. O que fazer e o que não fazer.
8. Riscos e dependências.
9. Resultado verificável.
10. Perguntas abertas e premissas.
11. Histórico de refinamento, quando houver.

Numere specs quando o repositório já usar prefixo (`0000-foundation.md`). **Não copie o template para dentro desta skill**: `.specs/_template.md` é a fonte de verdade e pode evoluir.

Se a spec já existir, não a reescreva do zero: use `refine-spec` para auditá-la e preserve as decisões anteriores.

### 4.2 Plano — `.plans/<slug>-plan.md`

Crie o plano usando o template de `.docs/RULES.md` como base:

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

Papéis, isolamento e regras de acesso.

## Fluxos e estados

Caminho feliz, vazio, carregando, erro, cancelamento e retry.

## Requisitos

| ID  | Requisito | Prioridade | Critério de aceite       |
| --- | --------- | ---------- | ------------------------ |
| R1  | ...       | Must       | Given... When... Then... |

## Contratos de dados

Entidades, campos, fonte de verdade, retenção e PII.

## Integrações

Sistemas, autenticação, timeout, retry, idempotência e falha.

## Decisões e premissas

- Decisão:
- Premissa:
- Dúvida em aberto:

## Abordagem

1. ...
2. ...

## Arquivos/áreas afetadas

- `caminho` — motivo

## Estratégia de testes

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
```

Regras de qualidade do plano:

- Todo item **Must** tem critério de aceite verificável.
- Toda integração tem caminho de falha.
- Todo dado sensível tem regra de acesso e retenção.
- Toda premissa tem impacto declarado.
- Nenhuma pergunta aberta pode bloquear a implementação sem estar marcada como bloqueante.
- Nada de “implementar a feature” como passo; os passos precisam ser ações concretas.

## 5. Revisar com a pessoa

Antes de encerrar:

1. Mostre um resumo de 5–10 linhas da spec e do plano.
2. Liste as **perguntas abertas** e o impacto de cada uma.
3. Peça confirmação explícita do escopo e dos critérios de aceite.
4. Se houver mudanças, atualize spec e plano e mostre o diff conceitual.
5. Só marque `Status: pronto para implementar` após a confirmação.

## 6. Handoff

Ao final, diga:

```text
Spec salva em .specs/<slug>.md
Plano salvo em .plans/<slug>-plan.md
Status: pronto para implementar
Próximo passo: implement-me <slug>
```

Não implemente nada nesta skill. Se a pessoa pedir implementação imediata, carregue `implement-me` e siga o fluxo dele.

## Guardrails

- Não invente requisitos para preencher lacunas; proponha defaults e marque como premissa.
- Não trate preferência estética como requisito funcional sem confirmar.
- Não ignore restrições de `.docs/ARCHITECTURE.md` e `.docs/BUSINESS.md`.
- Não crie uma spec gigante para uma tarefa pequena; proporcione profundidade ao risco.
- Se houver conflito entre pedido e documentação, exponha o conflito e peça decisão.
- Se a feature envolver autenticação, permissões, multi-tenancy, dinheiro ou dados pessoais, redobre as perguntas e registre ADR.
