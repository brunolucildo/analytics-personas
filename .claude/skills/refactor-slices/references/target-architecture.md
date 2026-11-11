# Arquitetura-alvo — vertical slices em camadas

> Referência carregada pelos agentes da skill `refactor-slices`.
> Fonte de verdade do projeto: `.docs/ARCHITECTURE.md` §4.1–4.2 e `.docs/DEVELOPMENT.md` §2.1–2.2.
> Se o código atual divergir desta referência, o código vence **até** a refatoração ser aplicada; a divergência é exatamente o que a skill corrige.

## 1. Contrato das camadas

Cada fatia vertical vive em `apps/api/src/modules/<dominio>/` e contém quatro camadas:

| Camada | Responsabilidade | Pode importar | Não pode importar |
| --- | --- | --- | --- |
| `domain` | Entidades, value objects, regras puras, erros de domínio, ports (interfaces) | Apenas TypeScript relativo dentro de `domain` | Framework, HTTP, banco, SDK, `application`, `infrastructure`, `interface` |
| `application` | Casos de uso (um fluxo por classe), orquestração, serviços de capacidade reutilizáveis | `domain`, `application`, barrel público de outro módulo | Framework, HTTP, banco, `infrastructure`, `interface` |
| `infrastructure` | Adaptadores concretos dos ports: repositórios, clients, filas, storage, LLM, e-mail | `domain`, `application`, bibliotecas externas | `interface`; regra de negócio |
| `interface` | Entrada/saída HTTP: request handlers, DTOs, presenters, guards, decorators | `application`, `domain`, `interface`, bibliotecas de HTTP | `infrastructure` diretamente; acesso a banco |

**Direção das dependências:** `interface → application → domain`; `infrastructure` implementa ports de `domain`/`application` e é injetada no módulo. Nenhuma seta aponta para fora.

## 2. Layout-alvo

```text
apps/api/src/modules/<dominio>/
  <dominio>.module.ts              # composição: controllers + providers
  <dominio>.tokens.ts              # tokens de injeção (quando houver)
  index.ts                         # barrel público do módulo
  domain/
    <agregado>.ts                  # entidade/value object, se houver
    <dominio>-rules.ts             # regras puras
    <dominio>-errors.ts            # erros tipados
    <fluxo>-ports.ts               # ports do fluxo (interfaces)
  application/
    use-cases/
      <fluxo>.use-case.ts          # UMA classe, UM fluxo, UM execute()
    services/
      <capacidade>.service.ts      # só capacidade reutilizável, nunca um fluxo
  infrastructure/
    <adaptador>.repository.ts
    <adaptador>.client.ts
    <adaptador>.mailer.ts
  interface/
    request-handlers/
      <fluxo>.request-handler.ts   # UMA classe, UM endpoint, UM use case
    dto/
      <fluxo>.dto.ts
    presenters/
      <fluxo>.presenter.ts
    guards/
      <dominio>.guard.ts
```

O planner pode adaptar nomes para o domínio, mas **não pode** eliminar a separação das quatro camadas nem o vínculo 1:1 entre endpoint, request handler e use case.

## 3. Request handler pattern (interface)

### Regra 1:1

- Cada endpoint HTTP tem **uma classe** de request handler.
- Cada request handler injeta **exatamente um** use case.
- Cada use case é consumido por **exatamente um** request handler (na camada `interface`).
- Se dois endpoints precisam do mesmo comportamento, crie dois use cases ou extraia a parte comum para um serviço de capacidade em `application/services/`; não compartilhe o use case entre handlers.

### Responsabilidades do request handler

1. Declarar a rota e o método (`@Controller("<prefixo>")` + `@Post("<rota>")`).
2. Aplicar decorators de borda: `@Public()`, `@RateLimit(...)`, `@HttpCode(...)`, `@CurrentSession()`.
3. Receber e validar o DTO (`class-validator`).
4. Chamar **um** use case, passando um command explícito.
5. Traduzir erros de domínio em `ApiException` (status, código, mensagem, details).
6. Apresentar a resposta com um presenter.
7. Envolver a operação em telemetria de borda (`traceAuthOperation`, quando aplicável).

O handler **não** contém regra de negócio, não acessa banco, não conhece `infrastructure`, não orquestra mais de um use case e não decide fluxo alternativo.

### Exemplo

```ts
// interface/request-handlers/sign-in.request-handler.ts
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../../common/api-exception";
import { Public } from "../../../../common/public.decorator";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { InvalidCredentialsError, EmailNotConfirmedError } from "../../domain/auth-errors";
import { SignInUseCase } from "../../application/use-cases/sign-in.use-case";
import { SignInDto } from "../dto/sign-in.dto";
import { presentSession, type SessionResponse } from "../presenters/session.presenter";

@Controller("auth")
export class SignInRequestHandler {
  constructor(@Inject(SignInUseCase) private readonly signIn: SignInUseCase) {}

  @Post("sign-in")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit("sign-in-ip", "sign-in")
  async handle(@Body() body: SignInDto): Promise<SessionResponse> {
    return traceAuthOperation("sign_in", async () => {
      try {
        return presentSession(
          await this.signIn.execute({ email: body.email, password: body.password }),
        );
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          throw new ApiException(
            HttpStatus.UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
          );
        }
        if (error instanceof EmailNotConfirmedError) {
          throw new ApiException(
            HttpStatus.FORBIDDEN,
            "EMAIL_NOT_CONFIRMED",
            "Confirm your email to sign in.",
          );
        }
        throw error;
      }
    });
  }
}
```

## 4. Use case pattern (application)

- Uma classe por fluxo, com **um** método público `execute(command)`.
- Recebe ports por construtor (interfaces de `domain`), nunca implementações.
- Orquestra a ordem: validação de domínio → port → efeito colateral (e-mail, evento) **depois** do commit.
- Devolve um resultado de domínio ou lança erro de domínio tipado.
- Não importa `@nestjs/*`, HTTP, banco, SDK, `infrastructure` ou `interface`.
- Não conhece DTO, status HTTP, presenter ou `ApiException`.
- Pode usar um serviço de capacidade (`SessionService`, `EmailService`) desde que ele não represente um fluxo de endpoint.

```ts
// application/use-cases/sign-in.use-case.ts
import { EmailNotConfirmedError, InvalidCredentialsError } from "../../domain/auth-errors";
import type { IssuedSession } from "../../domain/session-ports";
import type {
  CredentialsRepository,
  NewSessionMailer,
  PasswordVerifier,
} from "../../domain/sign-in-ports";
import type { SessionService } from "../services/session.service";

export interface SignInCommand {
  email: string;
  password: string;
}

export class SignInUseCase {
  constructor(
    private readonly credentials: CredentialsRepository,
    private readonly verifier: PasswordVerifier,
    private readonly sessions: Pick<SessionService, "issue">,
    private readonly mailer: NewSessionMailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: SignInCommand): Promise<IssuedSession> {
    const stored = await this.credentials.findByEmail(command.email);
    const matches = await this.verifier.verify(command.password, stored?.passwordHash ?? null);

    if (stored === null || !matches) {
      throw new InvalidCredentialsError();
    }
    if (!stored.emailConfirmed) {
      throw new EmailNotConfirmedError();
    }

    const session = await this.sessions.issue(stored.userId);
    await this.mailer.sendNewSession({
      to: session.user.email,
      firstName: session.user.firstName,
      signedInAt: this.now(),
    });

    return session;
  }
}
```

## 5. Ports e adaptadores

- Port = interface em `domain` (ou `application` quando o contrato só existe para orquestração) com nome de intenção: `UserRepository`, `PasswordHasher`, `NewSessionMailer`.
- Adaptador = classe em `infrastructure` que implementa o port e esconde o detalhe (Supabase, Argon2, Resend, HTTP).
- O módulo Nest faz a ligação: token → `useFactory`/`useClass` → implementação.
- O use case depende do token/port, nunca da classe concreta.
- Erros de infraestrutura são traduzidos para erros tipados antes de cruzar a fronteira (`DataAccessError`).

## 6. Módulo e injeção

- `controllers: []` lista **todos** os request handlers, um por endpoint.
- `providers: []` registra use cases, adaptadores e tokens.
- O módulo é o único lugar que conhece as implementações concretas.
- Guards globais continuam no módulo raiz, na ordem definida em `.docs/DEVELOPMENT.md` §13.4–13.5.

## 7. O que não é uma fatia

Módulos transversais podem não ter as quatro camadas, mas a exceção precisa ser **explícita** no plano:

- `modules/shared/` — código estável usado por 2+ fatias; não é fatia.
- `apps/api/src/health/` — endpoint operacional mínimo; pode ser exceção documentada.
- `apps/api/src/common/`, `config/`, `observability/` — infraestrutura transversal, não fatias.

`rate-limit` **é** uma fatia: tem regra (políticas/chave), caso de uso (avaliar limite), adaptador (store em memória) e interface (guard/decorator). Deve ser refatorado, não excetuado.

## 8. Regras de comportamento preservado

A refatoração é estrutural. Estes contratos **não podem mudar**:

- rotas, métodos HTTP, prefixos e status codes;
- campos, validações e mensagens de DTO;
- códigos e mensagens do envelope de erro;
- operações, labels e motivos de telemetria (`AUTH_OPERATIONS`, `AUTH_FAILURE_REASONS`);
- políticas e chaves de rate limit;
- regras de `@Public()` e do `AuthGuard`;
- SQL, RPC, migrations e permissões;
- templates, assuntos e conteúdo de e-mail;
- dependências externas.

Se um teste precisar mudar de asserção (e não só de import/caminho), a refatoração mudou comportamento: pare e reporte.

## 9. Documentação e ADR

Ao aplicar o padrão pela primeira vez no projeto:

1. Crie `.adrs/NNNN-request-handler-por-endpoint.md` (próximo número livre) explicando a decisão, alternativas e consequências.
2. Atualize `.docs/DEVELOPMENT.md` §2.1/§5 e `.docs/ARCHITECTURE.md` §4.2 para descrever o request handler 1:1 e o layout de `use-cases/` e `request-handlers/`.
3. Registre no plano e no relatório final.
