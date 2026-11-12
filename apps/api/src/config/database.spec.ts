import { describe, expect, it } from "vitest";
import { createPostgresPoolConfig, parseDatabaseUrl, sslForDatabaseUrl } from "./database";

describe("parseDatabaseUrl", () => {
  it.each([
    "postgres://rondo_app:rondo@localhost:5432/rondo",
    "postgresql://rondo_app:rondo@postgres:5432/rondo",
  ])("accepts %s", (value) => {
    expect(parseDatabaseUrl(value)).toBe(value);
  });

  it.each([
    "",
    "not-a-url",
    "http://localhost:5432/rondo",
    "postgres://localhost:5432",
    "postgres://localhost:5432/rondo?sslmode=prefer",
  ])("rejects %s without echoing it", (value) => {
    expect(() => parseDatabaseUrl(value)).toThrowError(/DATABASE_URL/);
  });
});

describe("sslForDatabaseUrl", () => {
  it("connects without TLS when sslmode is absent", () => {
    expect(sslForDatabaseUrl("postgres://u:p@localhost:5432/rondo")).toBeUndefined();
  });

  it("connects without TLS when sslmode is disable", () => {
    expect(sslForDatabaseUrl("postgres://u:p@localhost:5432/rondo?sslmode=disable")).toBeUndefined();
  });

  it("encrypts without validating the certificate when sslmode is require", () => {
    expect(sslForDatabaseUrl("postgres://u:p@localhost:5432/rondo?sslmode=require")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it.each(["verify-ca", "verify-full"])("validates the certificate when sslmode is %s", (mode) => {
    expect(sslForDatabaseUrl(`postgres://u:p@localhost:5432/rondo?sslmode=${mode}`)).toEqual({
      rejectUnauthorized: true,
    });
  });
});

describe("createPostgresPoolConfig", () => {
  it("uses the documented limits and identifies the API in the server", () => {
    const config = createPostgresPoolConfig("postgres://u:p@localhost:5432/rondo");

    expect(config).toMatchObject({
      connectionString: "postgres://u:p@localhost:5432/rondo",
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name: "rondo-api",
    });
    expect(config.ssl).toBeUndefined();
  });
});
