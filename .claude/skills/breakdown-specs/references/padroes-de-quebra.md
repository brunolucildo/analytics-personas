# Padrões de quebra

Pontos de partida para `breakdown-specs`. **Não são checklist**: use o que o prompt pediu, mande o resto para o backlog do mapa e adapte ao que o repositório já tem.

Convenções:

- **Nº** é a ordem sugerida, não o número final da spec.
- **Junte** capacidades que compartilham tela, contrato e risco; **separe** as que têm risco, permissão ou irreversibilidade diferentes.
- Toda fatia precisa de verificação própria (teste de integração, E2E ou comportamento observável).

## 1. Autenticação

Prompt típico: “autenticação com sign-in, sign-up, confirmar conta, esqueci a senha…”.

**Decisões compartilhadas a fechar antes do corte** (irreversíveis, valem para todas as specs): provedor de identidade (hoje própria na API, ADR `0007`; ver `.docs/BUSINESS.md`), identificador (e-mail, usuário), política de senha, modelo de sessão (cookie/token, expiração), quando a conta é considerada ativa, isolamento por clube/workspace, e-mail transacional (remetente, templates, limites), o que não pode ser logado (senha, token, link).

| Nº | Slug sugerido | Capacidade | Depende de | Observação |
| -- | ------------- | ---------- | ---------- | ---------- |
| 1 | `auth-sign-up` | Criar conta com e-mail e senha | — | Esqueleto ambulante. Define política de senha, validação e estado “não confirmada”. |
| 2 | `auth-confirm-account` | Confirmar e-mail por link/código e reenviar confirmação | 1 | Define expiração do token e a mensagem para link inválido ou expirado. |
| 3 | `auth-sign-in` | Entrar com e-mail e senha e manter sessão | 2 | Define bloqueio por tentativas e o que acontece com conta não confirmada. |
| 4 | `auth-sign-out` | Encerrar sessão (atual e, se pedido, todas) | 3 | Costuma ser pequena: junte à 3 se for só “limpar sessão atual”. |
| 5 | `auth-forgot-password` | Solicitar redefinição sem revelar se o e-mail existe | 2 | Resposta idêntica para e-mail existente e inexistente; rate limit. |
| 6 | `auth-reset-password` | Definir nova senha com token e invalidar sessões antigas | 5 | Pode ser juntada à 5 se o fluxo for um só; separe se tiver token, tela e invalidação próprios. |
| 7 | `auth-change-password` | Trocar senha estando logado | 3 | Exige senha atual. |
| 8 | `auth-session-guard` | Rotas protegidas e redirecionamento | 3 | Habilitadora **só** se 2+ specs dependerem dela. |

Candidatas comuns que **só entram se o prompt pedir** (senão, backlog): login social, MFA, convite de usuário, troca de e-mail, exclusão de conta, papéis e permissões (`auth-roles` como habilitadora), auditoria de acessos, “lembrar de mim”.

## 2. CRUD de uma entidade (produtos, usuários, experts…)

Prompt típico: “CRUD de produtos”.

**Decisões compartilhadas:** campos e regras da entidade, unicidade, quem enxerga e altera (papéis, isolamento por clube), exclusão lógica vs. física, paginação e ordenação padrão, o que é PII.

| Nº | Slug sugerido | Capacidade | Depende de | Observação |
| -- | ------------- | ---------- | ---------- | ---------- |
| 1 | `<entidade>-list` | Listar com paginação, ordenação e estado vazio | — | Esqueleto ambulante. Se não há dados ainda, semeie ou faça junto com `create`. |
| 2 | `<entidade>-create` | Criar com validação | 1 | Define o modelo de dados e as regras de unicidade. |
| 3 | `<entidade>-detail` | Ver detalhe | 1 | Junte à 1 se for só abrir um registro sem fluxo próprio. |
| 4 | `<entidade>-update` | Editar | 2 | Decida concorrência (edição simultânea) e o que é imutável. |
| 5 | `<entidade>-delete` | Excluir ou arquivar (e restaurar) | 2 | **Separe sempre:** é irreversível ou sensível; confirmação, vínculos e retenção. |
| 6 | `<entidade>-search-filter` | Busca e filtros | 1 | Só se o prompt pedir; senão, backlog. |

Agrupamentos comuns para entidades simples: `list + detail`, `create + update` (mesmo formulário e mesma validação). Para entidades com workflow (status, aprovação), cada transição relevante é uma capacidade.

## 3. Integração / conector externo

Prompt típico: “conectores com Notion, Google Drive, Jira…”.

**Decisões compartilhadas:** contrato do conector (autenticação, escopo, sincronização), onde ficam as credenciais (nunca no repositório), timeout, retry, rate limit, idempotência, política de dado sensível.

| Nº | Capacidade | Observação |
| -- | ---------- | ---------- |
| 1 | `connectors-contract` (habilitadora) | Só se 2+ conectores forem entrar; define interface, ciclo de vida e tratamento de falha. |
| 2..n | `connector-<fonte>` — **um por fonte** | Autenticar, selecionar o que sincronizar, sincronizar, tratar falha e revogar acesso. Se a fonte for grande, divida em `connect` e `sync`. |
| n+1 | `connectors-status` | Visão de estado e erro das conexões. Só se pedido. |

## 4. Relatório, dashboard ou análise

| Nº | Capacidade | Observação |
| -- | ---------- | ---------- |
| 1 | Fonte de dados do indicador (consulta + contrato) | Faça junto com o primeiro indicador se não houver outro consumidor. |
| 2..n | Um indicador/visual por spec | Estado vazio, carregando e erro obrigatórios. |
| n+1 | Filtros globais, exportação | Só se pedido. |

## 5. Import / export de dados

| Nº | Capacidade | Observação |
| -- | ---------- | ---------- |
| 1 | Importar arquivo com validação e relatório de erros | Define formato, tamanho máximo, tratamento de linha inválida e idempotência. |
| 2 | Exportar | Define formato e quem pode exportar (PII). |

## 6. Configurações / administração

| Nº | Capacidade | Observação |
| -- | ---------- | ---------- |
| 1 | Perfil do usuário | Campos, validação, avatar (storage) só se pedido. |
| 2 | Gestão de membros e papéis | Convite, mudança de papel e remoção são ações com risco diferente: separe as irreversíveis. |
| 3 | Preferências | Só se houver decisão de produto sobre elas. |

## 7. Notificações

| Nº | Capacidade | Observação |
| -- | ---------- | ---------- |
| 1 | Canal e entrega (e-mail ou in-app) | Habilitadora se 2+ specs notificarem; define template, fila e falha. |
| 2..n | Um tipo de notificação por spec **ou** junto da capacidade que a dispara | Prefira junto da capacidade dona do evento. |

## Exemplos de corte errado e como corrigir

| Corte errado | Por quê | Corte certo |
| ------------ | ------- | ----------- |
| `auth-database`, `auth-api`, `auth-screens` | Fatias por camada: nenhuma entrega algo observável sozinha | Uma spec por capacidade (`auth-sign-up`, `auth-sign-in`…), cada uma com banco, API e tela |
| `auth` com tudo dentro | Grande demais, impossível validar em uma execução | Dividir pela tabela da seção 1 |
| `products-crud` | Mistura leitura, escrita e exclusão irreversível | `list`, `create`, `update`, `delete` conforme a seção 2 |
| `auth-error-messages` | Detalhe de outras specs; não tem critério de aceite próprio | Mensagens de erro entram na spec do fluxo que as dispara |
| `auth-sign-up` depende de `auth-sign-in` e vice-versa | Ciclo: o corte está errado | Reagrupar ou extrair a parte comum em uma habilitadora |
