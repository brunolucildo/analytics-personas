import { describe, expect, it } from "vitest";
import { AppController } from "./app.controller";

describe("AppController", () => {
  it("devolve Hello World", () => {
    const controller = new AppController();

    expect(controller.getHello()).toEqual({ message: "Hello World" });
  });
});
