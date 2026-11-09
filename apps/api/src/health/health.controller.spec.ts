import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports an ok status without checking dependencies", () => {
    const controller = new HealthController();

    expect(controller.check()).toEqual({ status: "ok" });
  });
});
