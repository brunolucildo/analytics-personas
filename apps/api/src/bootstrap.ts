import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import pinoHttp from "pino-http";
import { AppModule } from "./app.module";
import { baseLogger, StructuredLogger } from "./observability/logger";

export async function createNestApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(new StructuredLogger());
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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  return app;
}
