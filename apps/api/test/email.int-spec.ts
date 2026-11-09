import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { configureApp, createNestApp } from "../src/bootstrap";
import { validateEnvironment } from "../src/config/environment";
import {
  clearCapturedEmails,
  EmailModule,
  EmailService,
  getCapturedEmails,
  renderEmailLayout,
  html,
} from "../src/modules/email";

const baseEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  APP_URL: "http://localhost:5173",
};

describe("capture provider and the test-support route", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createNestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    clearCapturedEmails();
  });

  it("send captures the message, readable by the helper and by the route, without network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { html: document, text } = renderEmailLayout({
      title: "Welcome",
      preheader: "Hi",
      bodyHtml: html`<p>Hello</p>`,
      bodyText: "Hello",
    });

    await app.get(EmailService).send({
      to: "Pat@Example.test",
      subject: "Welcome",
      text,
      html: document,
      purpose: "integration_test",
    });

    expect(getCapturedEmails({ to: "pat@example.test" })).toHaveLength(1);

    const response = await request(app.getHttpServer())
      .get("/api/v1/test-support/emails")
      .query({ to: "pat@example.test" });

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(1);
    expect(response.body.emails[0]).toMatchObject({
      to: "Pat@Example.test",
      subject: "Welcome",
      purpose: "integration_test",
      from: { address: "no-reply@analytics-personas.local" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("dispatch resolves at once and the message shows up after drain", async () => {
    const service = app.get(EmailService);

    await service.dispatch({ to: "sam@example.test", subject: "S", text: "t", html: "<p>t</p>" });
    await service.drain();

    expect(getCapturedEmails({ to: "sam@example.test" })).toHaveLength(1);
  });

  it("DELETE clears the mailbox and the filter by recipient narrows the list", async () => {
    const service = app.get(EmailService);

    await service.send({ to: "a@example.test", subject: "A", text: "t", html: "<p>t</p>" });
    await service.send({ to: "b@example.test", subject: "B", text: "t", html: "<p>t</p>" });

    const filtered = await request(app.getHttpServer())
      .get("/api/v1/test-support/emails")
      .query({ to: "b@example.test" });

    expect(filtered.body.emails.map((email: { subject: string }) => email.subject)).toEqual(["B"]);

    const cleared = await request(app.getHttpServer()).delete("/api/v1/test-support/emails");

    expect(cleared.status).toBe(204);
    expect(getCapturedEmails()).toEqual([]);
  });
});

describe("the test-support route outside capture mode", () => {
  it("answers 404 in the error envelope when the provider is mailtrap", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            validateEnvironment({
              ...baseEnv,
              EMAIL_PROVIDER: "mailtrap",
              EMAIL_FROM: "no-reply@analytics-personas.local",
              MAILTRAP_API_TOKEN: "test-token",
              MAILTRAP_INBOX_ID: "1",
            }),
        }),
        EmailModule,
      ],
    }).compile();
    const app = configureApp(moduleRef.createNestApplication());

    await app.init();

    try {
      const response = await request(app.getHttpServer()).get("/api/v1/test-support/emails");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await app.close();
      fetchSpy.mockRestore();
    }
  });
});

describe("boot validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses to start with EMAIL_PROVIDER=capture in production", async () => {
    // ConfigModule validates when AppModule is evaluated, so load it afresh.
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");

    const boot = async () => {
      const { AppModule: FreshAppModule } = await import("../src/app.module.js");
      const moduleRef = await Test.createTestingModule({ imports: [FreshAppModule] }).compile();

      await moduleRef.init();
    };

    await expect(boot()).rejects.toThrowError(/EMAIL_PROVIDER/);
  });
});
