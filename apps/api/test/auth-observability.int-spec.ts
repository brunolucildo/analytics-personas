import { createHash, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Test } from "@nestjs/testing";
import argon2 from "argon2";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { clearCapturedEmails } from "../src/modules/email";
import { AUTH_FAILURE_REASONS } from "../src/observability/auth-telemetry";
import { baseLogger } from "../src/observability/logger";
import { resetRateLimitStore } from "./support/rate-limit";
import { sessionsOf } from "./support/sessions";
import { type TelemetryRecorder, startTelemetryRecorder } from "./support/telemetry";
import {
  assertMigrationsApplied,
  createAdminClient,
  deleteUsersByEmail,
  uniqueEmail,
} from "./support/supabase";

const PREFIX = "/api/v1/auth";
const PASSWORD = "Sentinel-Pass-93f1c7";
const NEW_PASSWORD = "Sentinel-New-71ab02";
const HOUR_MS = 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

type AuthLog = Record<string, unknown>;

describe("authentication observability (real API, in-memory OpenTelemetry)", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];
  /** Every value that identifies a person or opens an account: none may reach any signal. */
  const sentinels: string[] = [];
  /** Spans, metrics and logs of every test, as text, for the final leak check. */
  const artifacts: string[] = [];
  const reasonsSeen = new Set<string>();
  let recorder: TelemetryRecorder;
  let app: INestApplication;
  let passwordHash: string;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const track = (...values: string[]) => sentinels.push(...values);

  async function createAccount(label: string, confirmed: boolean) {
    const email = uniqueEmail(label);
    const { data, error } = await admin
      .from("users")
      .insert({
        first_name: "Sentinelle",
        last_name: "Fortescue",
        email,
        password_hash: passwordHash,
        email_confirmed_at: confirmed ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    createdEmails.push(email);

    const userId = (data as { id: string }).id;

    track(email, userId, "Sentinelle", "Fortescue");

    return { email, userId };
  }

  async function addToken(userId: string, type: "email_confirmation" | "password_reset") {
    const token = randomBytes(32).toString("base64url");
    const { error } = await admin.from("auth_tokens").insert({
      user_id: userId,
      type,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + HOUR_MS).toISOString(),
    });

    expect(error).toBeNull();
    track(token);

    return token;
  }

  const post = (path: string, body: object = {}, headers: Record<string, string> = {}) =>
    request(app.getHttpServer()).post(`${PREFIX}/${path}`).set(headers).send(body);

  const signIn = (email: string, password = PASSWORD) => post("sign-in", { email, password });

  /** Counter points as `operation|outcome|reason` -> count, since the test started. */
  async function counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    for (const point of await recorder.metric("auth.operations")) {
      const { operation, outcome, reason } = point.attributes as Record<string, string>;

      reasonsSeen.add(reason ?? "");
      result[`${operation}|${outcome}|${reason}`] = point.value;
    }

    return result;
  }

  const authLogs = (): AuthLog[] =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(([fields]) => fields as AuthLog)
      .filter((fields) => fields?.event === "auth_operation");

  const authSpans = (name: string) => recorder.spans().filter((span) => span.name === name);

  beforeAll(async () => {
    await assertMigrationsApplied(admin);
    passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    track(PASSWORD, NEW_PASSWORD, "127.0.0.1", "::ffff:127.0.0.1", "::1");
    recorder = startTelemetryRecorder();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await recorder.stop();
    await deleteUsersByEmail(admin, createdEmails);
  });

  beforeEach(() => {
    resetRateLimitStore(app);
    recorder.reset();
    infoSpy = vi.spyOn(baseLogger, "info");
    warnSpy = vi.spyOn(baseLogger, "warn");
  });

  afterEach(async () => {
    artifacts.push(
      JSON.stringify({
        spans: recorder.exportedSpans(),
        metrics: [
          ...(await recorder.metric("auth.operations")),
          ...(await recorder.metric("auth.operation.duration")),
          ...(await recorder.metric("db.client.operation.duration")),
        ],
        logs: authLogs(),
      }),
    );
    clearCapturedEmails();
    vi.restoreAllMocks();
  });

  it("sign-up: counts the success, the duplicate account and the invalid body", async () => {
    const email = uniqueEmail("signup");

    createdEmails.push(email);
    track(email);

    const body = {
      firstName: "Sentinelle",
      lastName: "Fortescue",
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    };

    expect((await post("sign-up", body)).status).toBe(201);
    expect((await post("sign-up", body)).status).toBe(409);
    expect((await post("sign-up", { email: "not-an-email" })).status).toBe(400);

    expect(await counts()).toEqual({
      "sign_up|success|none": 1,
      "sign_up|failure|email_already_registered": 1,
      "sign_up|failure|validation_failed": 1,
    });
    // The refusal by validation never reaches the use case: no span for it, but it is counted.
    expect(
      authSpans("auth.sign_up")
        .map((span) => span.attributes["auth.outcome"])
        .sort(),
    ).toEqual(["failure", "success"]);
    expect(
      authSpans("auth.sign_up").find((span) => span.status.code === 2)?.attributes,
    ).toMatchObject({ "auth.error_code": "EMAIL_ALREADY_REGISTERED" });
    expect(authLogs()).toHaveLength(3);
  });

  it("confirm-account and sign-in: every outcome is counted with its reason", async () => {
    const { email, userId } = await createAccount("lifecycle", false);

    expect((await signIn(email)).status).toBe(403);
    expect((await post("confirm-account", { token: "not-a-real-token" })).status).toBe(400);

    const token = await addToken(userId, "email_confirmation");
    const confirmed = await post("confirm-account", { token });

    expect(confirmed.status).toBe(200);
    track(confirmed.body.accessToken as string);
    expect((await signIn(email, "wrong password!")).status).toBe(401);

    const opened = await signIn(email);

    expect(opened.status).toBe(200);
    track(opened.body.accessToken as string);

    expect(await counts()).toEqual({
      "sign_in|failure|email_not_confirmed": 1,
      "sign_in|failure|invalid_credentials": 1,
      "sign_in|success|none": 1,
      "confirm_account|failure|token_invalid_or_expired": 1,
      "confirm_account|success|none": 1,
    });
    expect(authSpans("auth.sign_in")).toHaveLength(3);
    expect(authSpans("auth.confirm_account")).toHaveLength(2);

    for (const session of await sessionsOf(admin, userId)) {
      track(String((session as { id?: string }).id ?? ""));
    }
  });

  it("sign-out: a refusal by the session guard is counted without a use case span", async () => {
    const { email } = await createAccount("signout", true);
    const { body } = await signIn(email);

    track(body.accessToken as string);

    expect((await post("sign-out", {}, bearer(body.accessToken as string))).status).toBe(204);
    expect((await post("sign-out", {}, bearer(body.accessToken as string))).status).toBe(401);
    expect((await post("sign-out")).status).toBe(401);

    expect(await counts()).toMatchObject({
      "sign_out|success|none": 1,
      "sign_out|failure|unauthenticated": 2,
    });
    expect(authSpans("auth.sign_out")).toHaveLength(1);
  });

  it("forgot-password and resend-confirmation: an existing and an unknown e-mail look the same", async () => {
    const confirmed = await createAccount("forgot-known", true);
    const unconfirmed = await createAccount("resend-known", false);
    const unknown = uniqueEmail("nobody");

    track(unknown);

    for (const email of [confirmed.email, unknown]) {
      expect((await post("forgot-password", { email })).status).toBe(202);
    }

    for (const email of [unconfirmed.email, unknown]) {
      expect((await post("resend-confirmation", { email })).status).toBe(202);
    }

    expect(await counts()).toEqual({
      "forgot_password|success|none": 2,
      "resend_confirmation|success|none": 2,
    });

    for (const name of ["auth.forgot_password", "auth.resend_confirmation"]) {
      const attributes = authSpans(name).map((span) => span.attributes);

      expect(attributes).toHaveLength(2);
      expect(attributes[0]).toEqual(attributes[1]);
    }
  });

  it("reset-password: bad token, invalid password and success", async () => {
    const { email, userId } = await createAccount("reset", true);

    expect(
      (
        await post("reset-password", {
          token: "nope",
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        })
      ).status,
    ).toBe(400);
    expect(
      (await post("reset-password", { token: "nope", password: "short", confirmPassword: "short" }))
        .status,
    ).toBe(400);

    const token = await addToken(userId, "password_reset");

    expect(
      (
        await post("reset-password", {
          token,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        })
      ).status,
    ).toBe(204);
    expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);

    expect(await counts()).toMatchObject({
      "reset_password|failure|token_invalid_or_expired": 1,
      "reset_password|failure|validation_failed": 1,
      "reset_password|success|none": 1,
    });
  });

  it("refusals before the use case: rate limit (429) and oversized body (413)", async () => {
    const email = uniqueEmail("limit");

    track(email);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await signIn(email, "wrong password!")).status).toBe(401);
    }

    const limited = await signIn(email, "wrong password!");

    expect(limited.status).toBe(429);

    const tooLarge = await post("sign-in", { email: "a".repeat(200_000), password: PASSWORD });

    expect(tooLarge.status).toBe(413);

    expect(await counts()).toEqual({
      "sign_in|failure|invalid_credentials": 10,
      "sign_in|failure|rate_limited": 1,
      "sign_in|failure|request_failed": 1,
    });
    expect(authSpans("auth.sign_in")).toHaveLength(10);
  });

  it("a failing log sink never changes the answer (telemetry is best-effort)", async () => {
    const { email } = await createAccount("sink", true);

    // Only the auth event fails; the request logger (pino-http) keeps its own behavior.
    infoSpy.mockImplementation((fields: unknown) => {
      if ((fields as AuthLog | undefined)?.event === "auth_operation") {
        throw new Error("log sink is down");
      }
    });

    const response = await signIn(email);

    expect(response.status).toBe(200);
    track(response.body.accessToken as string);
  });

  it("database: each Postgres call is a child span and a duration point named by table or function", async () => {
    const { email } = await createAccount("db", true);

    recorder.reset();

    const response = await signIn(email);

    expect(response.status).toBe(200);
    track(response.body.accessToken as string);

    const parent = authSpans("auth.sign_in")[0];
    const dbSpans = recorder
      .spans()
      .filter((span) => span.attributes["db.system.name"] === "postgresql");

    expect(dbSpans.map((span) => span.name)).toEqual(
      expect.arrayContaining(["select users", "rpc auth_issue_session"]),
    );

    for (const span of dbSpans) {
      expect(span.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
      expect(span.attributes["db.response.status_code"]).toBe("200");
    }

    const points = await recorder.metric("db.client.operation.duration");

    expect(points.map((point) => point.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ "db.operation.name": "select", "db.collection.name": "users" }),
        expect.objectContaining({
          "db.operation.name": "rpc",
          "db.stored_procedure.name": "auth_issue_session",
        }),
      ]),
    );

    for (const point of points) {
      expect(point.attributes).not.toHaveProperty("error.type");
    }
  });

  it("only emits the closed reason set and leaks no personal data in any signal", () => {
    expect(artifacts.length).toBeGreaterThan(0);

    const allowed = new Set<string>([...AUTH_FAILURE_REASONS, "none"]);

    for (const reason of reasonsSeen) {
      expect(allowed.has(reason)).toBe(true);
    }

    const everything = artifacts.join("\n");

    expect(everything).toContain("auth_operation");
    expect(everything).toContain("auth.sign_in");

    for (const sentinel of sentinels.filter((value) => value.length > 0)) {
      expect(everything, `a signal contains "${sentinel.slice(0, 12)}..."`).not.toContain(sentinel);
    }
  });
});
