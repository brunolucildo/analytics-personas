import { expect, test } from "@playwright/test";

test("redirects / to /app and renders the home placeholder without console errors", async ({
  page,
}) => {
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

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello World");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
