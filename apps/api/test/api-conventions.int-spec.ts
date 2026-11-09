import { Body, Controller, Get, HttpStatus, Post, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsInt, IsNotEmpty, IsString } from "class-validator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { ApiException } from "../src/common/api-exception";

class ProbeBody {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  age!: number;
}

@Controller("probe")
class ProbeController {
  @Post("validate")
  validate(@Body() body: ProbeBody) {
    return { received: body.name };
  }

  @Get("custom-error")
  customError(): never {
    throw new ApiException(HttpStatus.CONFLICT, "PROBE_CONFLICT", "Probe conflict.", [
      { field: "name", message: "already taken" },
    ]);
  }

  @Get("boom")
  boom(): never {
    throw new Error("secret internal detail that must never leak");
  }
}

const ALLOWED_ORIGIN = "http://localhost:5173";

describe("API conventions (error envelope and CORS)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers an invalid payload with 400 VALIDATION_FAILED and per-field details", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/probe/validate")
      .send({ name: "", age: "not-a-number" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(typeof response.body.error.message).toBe("string");
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name", message: expect.any(String) }),
        expect.objectContaining({ field: "age", message: expect.any(String) }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("rejects unknown fields as a validation failure", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/probe/validate")
      .send({ name: "Ana", age: 30, extra: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "extra" })]),
    );
  });

  it("answers a malformed JSON body with 400 VALIDATION_FAILED", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/probe/validate")
      .set("content-type", "application/json")
      .send("{not-json");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("answers an unknown route with 404 NOT_FOUND", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("answers an unexpected error with 500 INTERNAL_ERROR and no internal detail", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/probe/boom");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("secret internal detail");
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("passes an ApiException with its own code and details through unchanged", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/probe/custom-error");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "PROBE_CONFLICT",
        message: "Probe conflict.",
        details: [{ field: "name", message: "already taken" }],
      },
    });
  });

  it("accepts a preflight from the configured app origin", async () => {
    const response = await request(app.getHttpServer())
      .options("/api/v1/health")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toContain(
      "authorization",
    );
  });

  it("does not grant CORS to any other origin", async () => {
    const response = await request(app.getHttpServer())
      .options("/api/v1/health")
      .set("Origin", "http://evil.example")
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("exposes the request id header to the browser on normal requests", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .set("Origin", ALLOWED_ORIGIN);

    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(response.headers["access-control-expose-headers"]).toContain("X-Request-Id");
  });
});
