import { randomUUID } from "node:crypto";
import { type INestApplication, NotFoundException, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import pinoHttp from "pino-http";
import { AppModule } from "./app.module";
import { AllExceptionsFilter, toErrorResponse } from "./common/all-exceptions.filter";
import { createValidationException } from "./common/validation-exception";
import type { Environment } from "./config/environment";
import { createAuthTelemetryMiddleware } from "./modules/auth";
import { createHttpRouteMiddleware } from "./observability/http-route";
import { baseLogger, StructuredLogger } from "./observability/logger";

export const API_PREFIX = "api/v1";

/**
 * Applies every HTTP-level convention (prefix, CORS, logging, validation and the
 * error envelope). Shared by the real bootstrap and by integration tests.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get<ConfigService<Environment, true>>(ConfigService);
  const appOrigin = config.get("appUrl", { infer: true });

  // With TRUST_PROXY=true Express takes `request.ip` from the first X-Forwarded-For
  // address; with false the header is ignored. The rate limiter keys on this IP.
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", config.get("trustProxy", { infer: true }));
  app.useLogger(new StructuredLogger());
  app.setGlobalPrefix(API_PREFIX);
  // First on purpose: the CORS middleware answers preflights by itself, so anything registered
  // after it never sees them. This gives every request, preflights included, its `http_route`.
  app.use(createHttpRouteMiddleware());
  app.enableCors({
    // Callback form: any origin other than the app gets no CORS headers at all.
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, requestOrigin === appOrigin),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 600,
  });
  app.use(
    pinoHttp({
      logger: baseLogger,
      genReqId(request, response) {
        const header = request.headers["x-request-id"];
        const requestId = typeof header === "string" && header.length > 0 ? header : randomUUID();

        response.setHeader("x-request-id", requestId);
        return requestId;
      },
      customProps(request) {
        return { requestId: request.id };
      },
      // Apenas campos sem PII: sem headers, IP, query string ou corpo.
      serializers: {
        req: (request) => ({
          id: request.id,
          method: request.method,
          url: request.url?.split("?")[0],
        }),
        res: (response) => ({ statusCode: response.statusCode }),
      },
    }),
  );
  // Counts every auth attempt, including those refused before a controller runs (400, 401, 429).
  app.use(createAuthTelemetryMiddleware({ prefix: API_PREFIX }));
  // Nest only answers 404 under the global prefix; everything else would fall
  // through to Express's HTML 404. Nothing is served outside the prefix.
  app.use(
    (
      request: { path: string },
      response: { status(code: number): { json(body: unknown): void } },
      next: () => void,
    ) => {
      if (request.path === `/${API_PREFIX}` || request.path.startsWith(`/${API_PREFIX}/`)) {
        next();
        return;
      }

      const { status, body } = toErrorResponse(new NotFoundException());

      response.status(status).json(body);
    },
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: createValidationException,
    }),
  );
  app.enableShutdownHooks();

  return app;
}

export async function createNestApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  return configureApp(app);
}
