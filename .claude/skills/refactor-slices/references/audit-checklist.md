# Checklist de auditoria de slices

> Usado pelo **Agente 1 (Auditor)** e pelo **Agente 4 (QA)**.
> O script pega o que é mecânico; o auditor precisa ler o código e julgar o que é semântico.

## 1. Rodar o script

Na raiz do repositório:

```bash
node .claude/skills/refactor-slices/scripts/audit-slices.mjs --scope apps/api/src/modules
```

Variações:

```bash
# JSON para anexar ao run directory
node .claude/skills/refactor-slices/scripts/audit-slices.mjs --json > .claude/refactor/<run-id>/01-audit.raw.json

# Gate final: falha (exit 1) se sobrar violação
node .claude/skills/refactor-slices/scripts/audit-slices.mjs --strict
```

O script encontra:

- camadas ausentes;
- import de camada externa para interna (`domain → application`, `application → infrastructure`, `interface → infrastructure`, `infrastructure → interface`);
- pacote externo em `domain`/`application`;
- import direto de outra fatia (sem passar pelo barrel);
- controller com mais de um endpoint;
- handler com mais de uma injeção;
- classe de `application` sem `execute` ou com mais de um `execute`;
- arquivo solto na raiz do módulo.

O script **não** encontra:

- regra de negócio dentro de controller ou presenter;
- use case que só repassa chamadas ou que orquestra dois fluxos;
- port implementado em `domain`;
- adaptador com regra de negócio;
- DTO usado como entidade de domínio;
- dependência circular escondida por barrel;
- teste que mudou de asserção para acomodar comportamento novo.

## 2. Auditoria semântica por camada

### 2.1 `domain`

- [ ] Entidades/value objects não importam framework, HTTP, banco ou SDK.
- [ ] Regras puras (normalização, limites, TTL, validação de domínio) vivem aqui, não no controller.
- [ ] Erros de domínio são classes tipadas, não strings/`Error` genérico.
- [ ] Ports descrevem intenção de negócio, não detalhe de tecnologia (`UserRepository`, não `SupabaseClient`).
- [ ] Nenhum `execute`/orquestração de fluxo mora no domínio.
- [ ] Nenhum DTO de HTTP, decorator de validação ou `ApiException` no domínio.

### 2.2 `application`

- [ ] Cada fluxo tem **uma** classe de use case com **um** `execute`.
- [ ] O use case recebe ports por construtor; não instancia adaptador.
- [ ] O use case não importa `@nestjs/*`, `express`, `@supabase/*`, `pino`, `argon2`, `jose` nem `infrastructure`/`interface`.
- [ ] O use case não conhece DTO, status HTTP, presenter ou `ApiException`.
- [ ] Efeitos colaterais externos (e-mail, evento) acontecem **depois** do commit e não mudam a resposta.
- [ ] Serviço em `application/services/` é capacidade reutilizável (ex.: `SessionService`), não um fluxo disfarçado.
- [ ] Não existe `*.service.ts` que agrega vários fluxos; se agrega, dividir em use cases.

### 2.3 `infrastructure`

- [ ] Cada adaptador implementa um port e esconde o detalhe (Supabase, Argon2, Resend, HTTP).
- [ ] Nenhuma regra de negócio (limite, normalização, decisão de fluxo) mora no adaptador.
- [ ] Erros do provedor são traduzidos para erro tipado (`DataAccessError`, `EmailDeliveryError`).
- [ ] Timeout, retry limitado e falha tipada existem em integração externa.
- [ ] O adaptador não importa `interface`.
- [ ] A instrumentação (OTel, logs) não vaza PII, query string, token ou corpo.

### 2.4 `interface`

- [ ] Cada endpoint tem **uma** classe de request handler.
- [ ] Cada handler injeta **exatamente um** use case.
- [ ] O handler só faz: rota/decorators → DTO → use case → erro de domínio → presenter → telemetria de borda.
- [ ] Nenhuma regra de negócio, acesso a banco ou chamada a `infrastructure` no handler.
- [ ] DTO valida a entrada na fronteira; o use case recebe command já validado/normalizado.
- [ ] Presenter monta a resposta pública; não vaza entidade interna.
- [ ] Erros de domínio são mapeados para `ApiException` com o código/status corretos.
- [ ] `@Public()`, `@RateLimit`, `@HttpCode` e `@CurrentSession()` permanecem iguais aos da rota original.

### 2.5 Módulo

- [ ] `controllers` lista todos os request handlers, um por endpoint.
- [ ] `providers` registra use cases, adaptadores e tokens.
- [ ] O módulo é o único lugar que conhece implementações concretas.
- [ ] Nenhum outro módulo importa arquivo interno desta fatia; só o barrel `index.ts`.
- [ ] Guards globais continuam no módulo raiz, na ordem correta.

## 3. Classificação de cada fatia

Para cada fatia, produza **uma** classificação:

| Classificação | Critério |
| --- | --- |
| `conforming` | Tem as quatro camadas e nenhuma violação semântica/estrutural. |
| `non-conforming` | Tem ao menos uma violação que será corrigida nesta execução. |
| `exception` | É um módulo transversal (ex.: `shared`, `health`) e o padrão não se aplica; a justificativa é registrada no plano e no ADR. |
| `out-of-scope` | Fora do escopo pedido (`--slice`, `--scope`); registre o motivo. |

`exception` não é sinônimo de "difícil": `rate-limit` tem regra, caso de uso, adaptador e interface, então é `non-conforming`, não exceção.

## 4. Severidade

| Severidade | Uso |
| --- | --- |
| `high` | Quebra a direção das dependências, mistura fluxos, controller com múltiplos endpoints ou handler com múltiplos use cases. Corrigir nesta execução. |
| `medium` | Serviço de aplicação que pode ser capacidade ou fluxo; adaptador com cheiro de regra; arquivo no lugar errado com impacto limitado. Avaliar e corrigir ou justificar. |
| `low` | Nome/local de arquivo, classe auxiliar sem `execute`, código morto aparente. Corrigir se for barato; registrar se não for. |

## 5. Evidência obrigatória

Toda violação no relatório do auditor precisa de:

- `arquivo:linha`;
- trecho ou símbolo que prova a violação;
- regra violada (da tabela acima ou do script);
- por que importa;
- mudança-alvo (mover, dividir, extrair port, criar handler etc.);
- risco da mudança.

Sem evidência, não é achado: é opinião. O planner não deve planejar em cima de opinião.

## 6. Falsos positivos comuns

- `index.ts`, `*.module.ts`, `*.tokens.ts` e `*.spec.ts` na raiz do módulo são permitidos.
- `application/services/session.service.ts` pode ser capacidade reutilizável; não é violação automática.
- `render-email-layout.ts` é helper de aplicação, não fluxo; não precisa de `execute`.
- `shared/` não é fatia.
- `health/` fora de `modules/` não entra no escopo padrão.
- Um controller com um endpoint mas com regra de negócio é violação **semântica**, mesmo que o script não aponte.

## 7. Critério de saída do auditor

- [ ] Rodou o script e anexou a saída bruta.
- [ ] Leu cada fatia e classificou todas.
- [ ] Toda violação tem evidência e mudança-alvo.
- [ ] Exceções têm justificativa.
- [ ] Nenhum arquivo de código foi modificado.
- [ ] `01-audit.md` está no run directory e `state.json` foi atualizado.
