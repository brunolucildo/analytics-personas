import { expect, test } from "@playwright/test";
import { ACCESS_TOKEN_KEY, seedSignedInUser } from "./support/session";

test("redirects / to /app and then to /auth/sign-in when nobody is signed in", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});

test("redirects / to /app and renders the home without console errors when signed in", async ({
  page,
}) => {
  const { token } = await seedSignedInUser("home", "Carla", "Lima");
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
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [ACCESS_TOKEN_KEY, token],
  );

  await page.goto("/");

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Carla");
  await expect(page.getByText("You are signed in.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
