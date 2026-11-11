import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT_POLICIES } from "./rate-limit.policies";

describe("AUTH_RATE_LIMIT_POLICIES", () => {
  it("holds exactly the seven auth policies with the agreed limits", () => {
    expect(AUTH_RATE_LIMIT_POLICIES).toEqual({
      "sign-up": { limit: 5, windowSeconds: 3600, keyBy: "ip" },
      "sign-in-ip": { limit: 60, windowSeconds: 600, keyBy: "ip" },
      "sign-in": { limit: 10, windowSeconds: 600, keyBy: "ip-and-email" },
      "confirm-account": { limit: 10, windowSeconds: 600, keyBy: "ip" },
      "resend-confirmation": { limit: 3, windowSeconds: 600, keyBy: "ip-and-email" },
      "forgot-password": { limit: 3, windowSeconds: 600, keyBy: "ip-and-email" },
      "reset-password": { limit: 10, windowSeconds: 600, keyBy: "ip" },
    });
  });
});
