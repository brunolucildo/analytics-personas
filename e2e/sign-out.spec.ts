import { expect, test, type Page } from "@playwright/test";
import { ACCESS_TOKEN_KEY, seedSignedInUser } from "./support/session";

const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;

// Premise: there is no sign-in flow yet (spec 0007), so these tests start from a seeded
// user and a session issued the way the API does (`auth_issue_session`), like `session.spec.ts`.
// Once 0007 exists, `seedSignedInUser` can be replaced by a real sign-in without changing the rest.

/** Puts a token in localStorage before any page script runs. */
async function storeToken(page: Page, token: string) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [ACCESS_TOKEN_KEY, token],
  );
}

const storedToken = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), ACCESS_TOKEN_KEY);

test.describe("Sign out", () => {
  test("ends the session: the token is removed, the server rejects it and /app is private again", async ({
    page,
    request,
  }) => {
    const { token } = await seedSignedInUser("sign-out", "Dora", "Reis");
    const consoleErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    await storeToken(page, token);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Dora");

    const signOutRequest = page.waitForResponse((response) =>
      response.url().endsWith("/auth/sign-out"),
    );

    await page.getByRole("button", { name: "Sign out" }).click();

    const response = await signOutRequest;

    expect(response.status()).toBe(204);
    expect(response.request().headers().authorization).toBe(`Bearer ${token}`);
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(await storedToken(page)).toBeNull();

    // The old token is dead on the server too, not only forgotten by the browser.
    const reused = await request.get(`${API_URL}/auth/session`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(reused.status()).toBe(401);

    // R5: /app does not show the home any more (the init script would put the token back on
    // every load, so drop it for this part: a person who signed out has no token at all).
    await page.addInitScript(
      (key) => window.localStorage.removeItem(key as string),
      ACCESS_TOKEN_KEY,
    );
    await page.goto("/app");

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByText(/Welcome/)).toHaveCount(0);
    expect(consoleErrors.filter((text) => !text.includes("401"))).toEqual([]);
  });

  test("the back button does not bring the home back after signing out", async ({ page }) => {
    const { token } = await seedSignedInUser("sign-out-back");

    await page.goto("/auth/sign-up");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account");

    // Sign in "by hand" after the first page, so reloading later does not restore the token.
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      ACCESS_TOKEN_KEY,
      token,
    ] as [string, string]);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);

    await page.goBack();

    await expect(page).not.toHaveURL(/\/app/);
    await expect(page.getByText(/Welcome/)).toHaveCount(0);
    expect(await storedToken(page)).toBeNull();
  });

  test("works from the keyboard", async ({ page }) => {
    const { token } = await seedSignedInUser("sign-out-keyboard");

    await storeToken(page, token);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

    await page.getByRole("button", { name: "Sign out" }).focus();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });

  test("leaves anyway when the API cannot be reached", async ({ page }) => {
    const { token } = await seedSignedInUser("sign-out-offline");

    await storeToken(page, token);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

    await page.route("**/auth/sign-out", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(await storedToken(page)).toBeNull();
  });

  test("the button has a touch area of at least 44x44 px", async ({ page }) => {
    const { token } = await seedSignedInUser("sign-out-size");

    await storeToken(page, token);
    await page.goto("/app");

    const box = await page.getByRole("button", { name: "Sign out" }).boundingBox();

    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});
