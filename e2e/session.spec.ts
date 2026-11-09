import { expect, test, type Page } from "@playwright/test";
import { ACCESS_TOKEN_KEY, issueAccessToken, seedSignedInUser } from "./support/session";

const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;

/** Puts a token in localStorage before any page script runs. */
async function storeToken(page: Page, token: string) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [ACCESS_TOKEN_KEY, token],
  );
}

test.describe("the API is closed by default", () => {
  test("answers 401 UNAUTHENTICATED without a token and keeps health public", async ({
    request,
  }) => {
    const closed = await request.get(`${API_URL}/auth/session`);

    expect(closed.status()).toBe(401);
    expect(await closed.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required.", details: [] },
    });

    expect((await request.get(`${API_URL}/health`)).status()).toBe(200);
  });

  test("answers 401 for a token that is not a session", async ({ request }) => {
    const response = await request.get(`${API_URL}/auth/session`, {
      headers: { authorization: "Bearer not.a.token" },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe("/app without a session", () => {
  test("goes to /auth/sign-in without calling the API when there is no token", async ({ page }) => {
    const apiRequests: string[] = [];

    page.on("request", (request) => {
      if (request.url().startsWith(API_URL)) {
        apiRequests.push(request.url());
      }
    });

    await page.goto("/app");

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(apiRequests).toEqual([]);
  });

  test("sends / to /auth/sign-in as well", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });

  test("removes an invalid token and goes to /auth/sign-in", async ({ page }) => {
    await storeToken(page, "garbage.token.value");
    await page.goto("/app");

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ACCESS_TOKEN_KEY)).toBe(
      null,
    );
  });
});

test.describe("/app with a session", () => {
  test("shows the welcome page for the signed-in user and sends the bearer token", async ({
    page,
  }) => {
    const { token } = await seedSignedInUser("welcome", "Bianca", "Souza");
    const consoleErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    await storeToken(page, token);

    const sessionRequest = page.waitForRequest((request) =>
      request.url().endsWith("/auth/session"),
    );

    await page.goto("/app");

    expect((await sessionRequest).headers().authorization).toBe(`Bearer ${token}`);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Bianca");
    await expect(page.getByText("You are signed in.")).toBeVisible();
    await expect(page.getByText("Hello World")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    expect(consoleErrors).toEqual([]);
  });

  test("keeps the session after a reload and after going to / (which redirects to /app)", async ({
    page,
  }) => {
    const { token } = await seedSignedInUser("reload");

    await storeToken(page, token);
    await page.goto("/");

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

    await page.reload();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
  });

  test("announces the session check while it runs", async ({ page }) => {
    const { token } = await seedSignedInUser("loading");

    await storeToken(page, token);
    await page.route("**/auth/session", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.goto("/app");

    await expect(page.getByRole("status")).toHaveText("Verifying your session…");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("offers a retry, and keeps the token, when the API cannot be reached", async ({ page }) => {
    const { token } = await seedSignedInUser("retry");
    let failures = 1;

    await storeToken(page, token);
    await page.route("**/auth/session", async (route) => {
      if (failures > 0) {
        failures -= 1;
        await route.abort("connectionrefused");
        return;
      }

      await route.continue();
    });
    await page.goto("/app");

    await expect(
      page.getByRole("heading", { level: 1, name: "We couldn't verify your session." }),
    ).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ACCESS_TOKEN_KEY)).toBe(
      token,
    );

    await page.getByRole("button", { name: "Try again" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
  });

  test("shows the not-found page for an unknown /app path", async ({ page }) => {
    const { token } = await seedSignedInUser("notfound");

    await storeToken(page, token);
    await page.goto("/app/does-not-exist");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  });
});

test.describe("/auth/* for a signed-in user", () => {
  test("sends /auth/sign-up to /app", async ({ page }) => {
    const { token } = await seedSignedInUser("auth-redirect");

    await storeToken(page, token);
    await page.goto("/auth/sign-up");

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
  });

  test("still shows /auth/sign-up when the stored token is invalid", async ({ page }) => {
    await storeToken(page, "garbage.token.value");
    await page.goto("/auth/sign-up");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account");
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
  });
});

test.describe("a single session per user", () => {
  test("the older token gets 401 from the API and the SPA, the newer one is accepted", async ({
    page,
    request,
  }) => {
    const { user, token: tokenA } = await seedSignedInUser("single");
    const tokenB = await issueAccessToken(user.id);
    const withToken = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

    expect((await request.get(`${API_URL}/auth/session`, withToken(tokenA))).status()).toBe(401);

    const accepted = await request.get(`${API_URL}/auth/session`, withToken(tokenB));

    expect(accepted.status()).toBe(200);
    expect(((await accepted.json()) as { user: { id: string } }).user.id).toBe(user.id);

    await storeToken(page, tokenA);
    await page.goto("/app");

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });
});
