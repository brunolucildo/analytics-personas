import { expect, test } from "@playwright/test";

test("renderiza o Hello World sem erros no console", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(request.url());
  });

  await page.goto("/");

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello World");
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
