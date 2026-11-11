import { describe, expect, it } from "vitest";
import type { ActiveSession } from "../../domain/session-ports";
import { GetSession } from "./get-session.use-case";

const session: ActiveSession = {
  sessionId: "0b9c3c1e-7a44-4c63-9d3e-0a6c5d1f2e11",
  userId: "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b",
  user: {
    id: "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b",
    firstName: "Ana",
    lastName: "Silva",
    email: "ana@example.test",
  },
};

describe("GetSession", () => {
  it("answers with the user behind the session", () => {
    expect(new GetSession().execute(session)).toEqual(session.user);
  });
});
