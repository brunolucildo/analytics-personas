import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { seedUserWithPassword } from "./support/credentials";
import { ACCESS_TOKEN_KEY, issueAccessToken } from "./support/session";

const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:5173";
const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;
const NEW_PASSWORD = "a brand new password";
const RESET_SUBJECT = "Reset your Rondo password";
const CHANGED_SUBJECT = "Your Rondo password was changed";
const SENT = "If an account exists for that email, we sent instructions to reset your password.";
const NOTICE = "Your password was updated. Sign in with your new password.";
const INVALID_LINK = "This link is invalid or has expired";
const LINK_PATTERN = /(https?:\/\/\S+\/auth\/reset-password\?token=[A-Za-z0-9_-]+)/;

const storedToken = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), ACCESS_TOKEN_KEY);

async function mailTo(request: APIRequestContext, to: string, subject: string) {
  const response = await request.get(`${API_URL}/test-support/emails`, { params: { to } });

  expect(response.ok()).toBe(true);

  const body = (await response.json()) as { emails: Array<{ subject: string; text: string }> };

  return body.emails.filter((email) => email.subject === subject);
}

/** Asks for the link on the real forgot-password page and reads it from the captured e-mail. */
async function requestResetLink(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(SENT);

  await expect
    .poll(async () => (await mailTo(request, email, RESET_SUBJECT)).length, { timeout: 10_000 })
    .toBe(1);

  const [message] = await mailTo(request, email, RESET_SUBJECT);

  return LINK_PATTERN.exec(message?.text ?? "")?.[1] as string;
}

async function fillAndSubmit(page: Page, password: string, confirmation = password) {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password").fill(confirmation);
  await page.getByRole("button", { name: "Reset password" }).click();
}

/** Counts the `POST /auth/reset-password` requests the page makes. */
function countResetRequests(page: Page): string[] {
  const requests: string[] = [];

  page.on("request", (request) => {
    if (request.url().includes("/auth/reset-password") && request.method() === "POST") {
      requests.push(request.url());
    }
  });

  return requests;
}

test.describe("reset password page", () => {
  test("shows the form with labelled masked fields, the button and the way back", async ({
    page,
  }) => {
    await page.goto("/auth/reset-password?token=not-a-real-token");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a new password");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    await expect(page.getByLabel("Confirm new password")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Reset password" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
  });

  test("shows and hides each new password on its own", async ({ page }) => {
    await page.goto("/auth/reset-password?token=any-link-token");
    const password = page.getByLabel("New password", { exact: true });
    const confirmation = page.getByLabel("Confirm new password");

    await password.fill("a brand new password");
    await confirmation.fill("a brand new password");
    await page.getByRole("button", { name: "Show new password" }).click();

    await expect(password).toHaveAttribute("type", "text");
    await expect(confirmation).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password confirmation" }).click();
    await expect(confirmation).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "Hide new password" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("a brand new password");
  });

  test("removes the token from the URL on load, and a reload then shows the invalid link", async ({
    page,
  }) => {
    await page.goto("/auth/reset-password?token=not-a-real-token");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a new password");
    await expect(page).toHaveURL(`${APP_URL}/auth/reset-password`);
    expect(page.url()).not.toContain("token");

    await page.reload();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_LINK);
    await expect(page.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
  });

  test("shows the invalid link, and makes no call, when the URL has no token", async ({ page }) => {
    const requests = countResetRequests(page);

    await page.goto("/auth/reset-password");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_LINK);
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test("shows a short password and a mismatch by the fields without calling the API", async ({
    page,
  }) => {
    const requests = countResetRequests(page);

    await page.goto("/auth/reset-password?token=not-a-real-token");
    await fillAndSubmit(page, "short");

    await expect(page.getByText("Password must have between 8 and 128 characters.")).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toBeFocused();
    await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await fillAndSubmit(page, NEW_PASSWORD, "something else 1");

    await expect(page.getByText("Passwords do not match")).toBeVisible();
    await expect(page.getByLabel("Confirm new password")).toBeFocused();
    expect(requests).toEqual([]);
  });

  test("shows the invalid link when the API refuses the token", async ({ page }) => {
    await page.goto("/auth/reset-password?token=not-a-real-token");
    await fillAndSubmit(page, NEW_PASSWORD);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_LINK);
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  });

  test("is reachable while signed in, and fits a 375 px screen without horizontal scroll", async ({
    page,
  }) => {
    const { id } = await seedUserWithPassword("reachable");
    const token = await issueAccessToken(id);

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [ACCESS_TOKEN_KEY, token],
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/auth/reset-password?token=not-a-real-token");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a new password");
    await expect(page).toHaveURL(`${APP_URL}/auth/reset-password`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("reset password flow", () => {
  test("forgot -> mailed link -> new password -> sign-in notice -> sign in; old session and reused link are dead", async ({
    page,
    request,
    browser,
  }) => {
    // The account stands in for sign-up + confirmation (the sign-up quota is used up by the other
    // specs): confirmed, with a real password hash. The link still comes from the real flow.
    const {
      id,
      email,
      password: oldPassword,
    } = await seedUserWithPassword("flow", {
      firstName: "Dora",
    });
    const oldSession = await issueAccessToken(id);
    const asOldSession = () =>
      request.get(`${API_URL}/auth/session`, {
        headers: { authorization: `Bearer ${oldSession}` },
      });

    expect((await asOldSession()).status()).toBe(200);

    const link = await requestResetLink(page, request, email);

    // Open the link: the token leaves the address bar at once.
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a new password");
    await expect(page).toHaveURL(`${APP_URL}/auth/reset-password`);

    await fillAndSubmit(page, NEW_PASSWORD);

    await expect(page).toHaveURL(new RegExp(`^${APP_URL}/auth/sign-in`));
    await expect(page.getByRole("status")).toHaveText(NOTICE);
    expect(await storedToken(page)).toBeNull();

    // Every old session is gone, and no session was opened by the reset itself.
    expect((await asOldSession()).status()).toBe(401);

    // The success e-mail arrived once, in English, without the password or the link.
    await expect
      .poll(async () => (await mailTo(request, email, CHANGED_SUBJECT)).length, {
        timeout: 10_000,
      })
      .toBe(1);

    const [changed] = await mailTo(request, email, CHANGED_SUBJECT);

    expect(changed?.text).toContain("Hi Dora,");
    expect(changed?.text).toContain(`${APP_URL}/auth/forgot-password`);
    expect(changed?.text).not.toContain(NEW_PASSWORD);
    expect(changed?.text).not.toContain("/auth/reset-password");

    // The old password stops working; the new one leads to /app.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(oldPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");

    await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Dora");

    // The same link again (in a clean browser) is refused.
    const other = await browser.newContext({ baseURL: APP_URL });

    try {
      const again = await other.newPage();

      await again.goto(link);
      await fillAndSubmit(again, "yet another password");
      await expect(again.getByRole("heading", { level: 1 })).toHaveText(INVALID_LINK);
    } finally {
      await other.close();
    }

    // Still only one success e-mail: the refused attempt sent nothing.
    expect(await mailTo(request, email, CHANGED_SUBJECT)).toHaveLength(1);
  });
});
