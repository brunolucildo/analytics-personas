import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { Public } from "../../../common/public.decorator";
import type { SessionService } from "../application/session.service";
import type { ActiveSession } from "../domain/session-ports";
import { AuthGuard, type AuthenticatedRequest, readBearerToken } from "./auth.guard";

const SESSION: ActiveSession = {
  sessionId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  userId: "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b",
  user: {
    id: "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b",
    firstName: "Ana",
    lastName: "Silva",
    email: "ana@example.test",
  },
};

class ClosedController {
  handler() {
    return "closed";
  }
}

class OpenController {
  @Public()
  handler() {
    return "open";
  }
}

@Public()
class OpenClassController {
  handler() {
    return "open class";
  }
}

function contextFor(
  target: new () => { handler(): string },
  request: AuthenticatedRequest,
): ExecutionContext {
  return {
    getHandler: () => target.prototype.handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(authenticate: SessionService["authenticate"]) {
  return new AuthGuard(new Reflector(), { authenticate } as SessionService);
}

describe("readBearerToken", () => {
  it.each([
    ["Bearer abc.def.ghi", "abc.def.ghi"],
    ["bearer abc", "abc"],
    ["BEARER abc", "abc"],
  ])("reads the token of %j", (header, token) => {
    expect(readBearerToken(header)).toBe(token);
  });

  it.each([undefined, "", "Bearer", "Bearer ", "Basic abc", "abc", "Bearer a b", " Bearer abc"])(
    "returns undefined for %j",
    (header) => {
      expect(readBearerToken(header)).toBeUndefined();
    },
  );
});

describe("AuthGuard", () => {
  it("lets a @Public() route through without looking at the token", async () => {
    const authenticate = vi.fn();
    const guard = guardWith(authenticate);

    await expect(guard.canActivate(contextFor(OpenController, { headers: {} }))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(contextFor(OpenClassController, { headers: {} }))).resolves.toBe(
      true,
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers 401 UNAUTHENTICATED when there is no Authorization header", async () => {
    const guard = guardWith(vi.fn());

    await expect(
      guard.canActivate(contextFor(ClosedController, { headers: {} })),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
      getStatus: expect.any(Function),
    });
  });

  it("answers the same 401 for a header that is not a bearer token, without asking the service", async () => {
    const authenticate = vi.fn();
    const guard = guardWith(authenticate);
    const failure = await guard
      .canActivate(contextFor(ClosedController, { headers: { authorization: "Basic abc" } }))
      .catch((e: unknown) => e);

    expect(failure).toMatchObject({ code: "UNAUTHENTICATED" });
    expect((failure as { getStatus(): number }).getStatus()).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers 401 when the service does not accept the token", async () => {
    const guard = guardWith(vi.fn().mockResolvedValue(null));

    await expect(
      guard.canActivate(contextFor(ClosedController, { headers: { authorization: "Bearer x" } })),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("attaches the session to the request when the token is accepted", async () => {
    const authenticate = vi.fn().mockResolvedValue(SESSION);
    const request: AuthenticatedRequest = { headers: { authorization: "Bearer good" } };

    await expect(
      guardWith(authenticate).canActivate(contextFor(ClosedController, request)),
    ).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith("good");
    expect(request.session).toEqual(SESSION);
  });

  it("does not turn a service failure into a 401", async () => {
    const guard = guardWith(vi.fn().mockRejectedValue(new Error("database down")));

    await expect(
      guard.canActivate(contextFor(ClosedController, { headers: { authorization: "Bearer x" } })),
    ).rejects.toThrowError("database down");
  });
});
