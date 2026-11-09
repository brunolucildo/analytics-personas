import { expect, test } from "@playwright/test";

for (const path of ["/does-not-exist", "/auth/does-not-exist", "/app/does-not-exist"]) {
  test(`shows the not-found page for ${path}`, async ({ page }) => {
    await page.goto(path);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");

    await page.getByRole("link", { name: "Go to the home page" }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello World");
  });
}
