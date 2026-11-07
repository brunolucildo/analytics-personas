import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNestApp } from "../src/bootstrap";

describe("GET /", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createNestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde 200 com JSON Hello World", async () => {
    const response = await request(app.getHttpServer()).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ message: "Hello World" });
    expect(response.headers["x-request-id"]).toBeTruthy();
  });
});
