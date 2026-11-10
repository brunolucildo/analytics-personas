import { expect, test } from "@playwright/test";
import { ACCESS_TOKEN_KEY, seedSignedInUser } from "./support/session";

for (const path of ["/does-not-exist", "/auth/does-not-exist"]) {
  test(`shows the not-found page for ${path}`, async ({ page }) => {
    await page.goto(path);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");

    await page.getByRole("link", { name: "Go to the home page" }).click();

    // Nobody is signed in: the home (/app) sends the visitor on to /auth/sign-in.
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });
}

test("shows the not-found page for /app/does-not-exist when signed in", async ({ page }) => {
  const { token } = await seedSignedInUser("routing");

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [ACCESS_TOKEN_KEY, token],
  );
  await page.goto("/app/does-not-exist");

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");

  await page.getByRole("link", { name: "Go to the home page" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
});
