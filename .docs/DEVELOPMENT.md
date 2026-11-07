# Desenvolvimento

> **Público:** qualquer pessoa ou agente que altere código.
> Aplique estas regras em toda mudança. Elas complementam `ARCHITECTURE.md` (estrutura) e `QA.md` (validação).

## 1. Princípios

| Princípio              | Como aplicar                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **KISS**               | A solução mais simples que atende ao requisito. Sem abstração preventiva.                                                       |
| **DRY**                | Não duplique **conhecimento**: regra de negócio, validação, contrato e configuração vivem em um só lugar.                       |
| **WET (com critério)** | Duas ocorrências concretas podem ser mantidas separadas até o conceito ficar claro. Abstração errada custa mais que duplicação. |
| **SOLID**              | Responsabilidades pequenas, dependência de interfaces (ports), sem acoplamento a detalhes.                                      |
| **Clean Code**         | Nomes que revelam intenção, funções curtas, sem comentários óbvios, sem código morto.                                           |

> **DRY e WET não se contradizem:** DRY vale para conhecimento; WET é tolerado para estrutura acidental. Só extraia quando houver um conceito estável e reutilizado.

## 2. Arquitetura de código

### 2.1 Backend (`apps/api`)

Cada domínio é uma fatia vertical com quatro camadas:

| Camada           | Contém                                                 | Não contém                |
| ---------------- | ------------------------------------------------------ | ------------------------- |
| `domain`         | Entidades, value objects, regras, ports                | Framework, HTTP, SQL, SDK |
| `application`    | Casos de uso, orquestração, transações                 | Detalhes de banco ou HTTP |
| `infrastructure` | Repositórios, clients, filas, storage, LLM, conectores | Regra de negócio          |
| `interface`      | Controllers, DTOs, guards, presenters                  | Acesso direto ao banco    |

Dependências apontam para dentro: `interface → application → domain`; `infrastructure` implementa ports de `domain`/`application`.

### 2.2 Vertical slices

- Organize por domínio, não por tipo global (`controllers/`, `services/` na raiz).
- Compartilhamento só em `apps/api/src/modules/shared`, quando usado por 2+ módulos e estável.
- Um módulo não importa outro módulo diretamente; se precisar, exponha um caso de uso ou um port.

### 2.3 Frontend

`apps/app` é uma SPA React + Vite (ADR 0001). Estrutura-alvo, a criar quando a primeira feature existir:

```text
apps/app/src/
  features/<dominio>/   # componentes, hooks e chamadas da fatia
  lib/                  # clients, configuração, utilitários
  App.tsx, main.tsx     # composição e providers
```

- `App.tsx` e rotas compõem; não concentram regra de negócio.
- Primitivos visuais em `packages/ui`; composições na feature.
- Não crie uma camada `services/` genérica; use clients explícitos em `lib/`.
- `apps/docs` segue o App Router do Next.js (Server Components por padrão; `"use client"` só na folha interativa).

## 3. TypeScript

- `strict: true` e `noUncheckedIndexedAccess: true` já estão no tsconfig base. Não relaxe.
- Proibido `any`. Use `unknown` e estreite o tipo.
- Prefira uniões discriminadas a flags booleanas.
- Use `import type` para tipos.
- Evite `as` e `!`; quando inevitável, comente a invariante.
- Valide dados externos na fronteira (HTTP, conector, env, storage). Não confie em payload de terceiro.
- Tipos de domínio não importam tipos de framework.

## 4. React e Next.js

**`apps/app` (React + Vite):**

- **TanStack Query** é o caminho para dados remotos (cache, mutations, estados de carregando/erro). O `QueryClientProvider` já envolve a árvore em `main.tsx`.
- Não use `useEffect` para carregar dado inicial; use query.
- Componentes só apresentam; regra de negócio fica na API ou em funções puras testáveis.
- Nunca coloque segredo, service role key ou token em código de cliente.
- Só variáveis `VITE_*` entram no bundle; trate-as como públicas. O `.env` é lido da raiz (`envDir`).
- Acesse o Supabase pelo cliente de `lib/supabase.ts` (só chave pública); dados sensíveis passam pela API.

**`apps/docs` (Next.js):**

- Server-first; `page.tsx` fina (composição e metadata).
- Use `next/font` para fontes e `next/image` para imagens.
- Defina `metadata` por rota e `lang="pt-BR"`.
- Crie `loading.tsx` e `error.tsx` quando a rota tiver operação assíncrona relevante.

## 5. API (Nest.js)

- Controller fino: recebe DTO, chama caso de uso, devolve presenter.
- Validação de entrada com DTO/schema; rejeite payload inválido antes do caso de uso.
- Erros de domínio são mapeados para HTTP na camada de interface; não vaze stack trace.
- Nenhum acesso direto ao Supabase dentro do controller.
- Toda integração externa tem timeout, retry limitado e erro tipado.
- Endpoints precisam de autenticação/autorização explícitas, exceto health check.

## 6. Dados (PostgreSQL/Supabase)

- Migrations versionadas; schema não é alterado "na mão" em produção.
- Nomes de tabela/coluna em `snake_case`; tipos explícitos; FKs e índices justificados.
- Multi-tenant exige isolamento no banco (RLS) e teste cobrindo acesso cruzado.
- Service role key só no servidor.
- Storage com URLs assinadas e validação de tipo/tamanho de arquivo.
- Dados pessoais: minimize coleta, não logue PII, defina retenção.

## 7. Erros, logs e observabilidade

- Logs estruturados (JSON, `pino`) com `requestId`, operação, duração e resultado. A API já gera `requestId` por request (header `x-request-id`).
- Não use `console.log` em código de produto; use o logger do serviço (`StructuredLogger`/`baseLogger` em `apps/api/src/observability/logger.ts`).
- Não logue token, senha, documento, conversa, conteúdo de fonte, headers, IP ou query string.
- Falha de conector não derruba a demanda inteira: registre, isole e informe a lacuna.
- A API exporta traces, métricas e logs por OpenTelemetry para o Grafana LGTM (ver `ARCHITECTURE.md` §4.4). Exportação nunca bloqueia nem derruba o request.
- Métricas mínimas a manter: latência, taxa de erro, throughput e, quando existirem, falhas por conector.

## 8. Acessibilidade e responsividade

- WCAG 2.2 AA é o piso, não um extra.
- Todo componente interativo funciona por teclado e tem foco visível.
- Inputs com label; erros em texto; imagens com `alt`.
- Layout validado em mobile, tablet e desktop.
- `prefers-reduced-motion` respeitado.
- Siga `DESIGN.md` para contraste e identidade visual.

## 9. Testes

Abordagem TDD: escreva o teste do comportamento antes ou junto da implementação.

| Nível      | Ferramenta         | Comando                    | Onde vive                                                 |
| ---------- | ------------------ | -------------------------- | --------------------------------------------------------- |
| Unitário   | Vitest             | `bun run test`             | `apps/app/src/**/*.test.tsx`, `apps/api/src/**/*.spec.ts` |
| Integração | Vitest + Supertest | `bun run test:integration` | `apps/api/test/*.int-spec.ts`                             |
| E2E        | Playwright         | `bun run test:e2e`         | `e2e/*.spec.ts`                                           |

Regras:

- Teste comportamento observável, não implementação.
- Use nomes que descrevam cenário e resultado.
- Não faça teste depender de dado real, rede externa ou ordem de execução.
- Bug corrigido ganha teste de regressão.
- Ao adicionar um novo tipo de teste ou workspace, crie o script real, adicione a task no `turbo.json` e atualize `QA.md`. Não invente comandos.
- Testes da API definem env fictícia em `apps/api/test/setup-env.ts`; não use chave real nem a service role.

## 10. Dependências

- Instale no workspace consumidor, não na raiz, salvo ferramenta global do monorepo.
- Justifique a dependência no relatório final: problema, alternativa considerada e custo.
- Prefira a biblioteca já presente no stack antes de adicionar outra.
- Verifique licença e manutenção antes de adotar.
- Não atualize versões fora do escopo da tarefa.

## 11. Definição de pronto

Uma mudança só está pronta quando:

- [ ] O comportamento solicitado funciona e o escopo não foi extrapolado.
- [ ] `bun run lint` passa.
- [ ] `bun run check-types` passa.
- [ ] `bun run build` passa (quando a mudança afeta build).
- [ ] `bun run test` e, conforme o escopo, `test:integration` e `test:e2e` passam.
- [ ] Testes foram adicionados/atualizados quando há comportamento novo.
- [ ] Acessibilidade e responsividade foram verificadas em UI.
- [ ] Nenhum segredo, PII ou artefato gerado foi commitado.
- [ ] Plano e ADR foram registrados quando aplicável.
- [ ] `.docs` foi atualizado se a realidade mudou.
- [ ] O relatório final lista comandos realmente executados.

## 12. Anti-padrões proibidos

- `any`, `@ts-ignore` e `eslint-disable` sem justificativa.
- Regra de negócio em componente, controller ou página.
- Chamada direta ao banco a partir do browser.
- `useEffect` para busca inicial de dados.
- Texto hardcoded de produto em primitivo de UI.
- Hex de cor espalhado em componentes.
- Copiar componente para "mudar só uma coisinha".
- Deixar `console.log`, código morto ou template demo em produção.
- Afirmar que um teste passou sem executá-lo.
