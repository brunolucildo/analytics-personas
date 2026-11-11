import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { seedUserWithPassword } from "./support/credentials";
import { E2E_EMAIL_PREFIX } from "./support/global-teardown";
import { ACCESS_TOKEN_KEY } from "./support/session";

const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:5173";
const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;
const NEW_SESSION_SUBJECT = "New sign-in to Rondo";
const CONFIRM_SUBJECT = "Confirm your email address";
const INVALID_MESSAGE = "Invalid email or password.";
const LINK_PATTERN = /(https?:\/\/\S+\/auth\/confirm-account\?token=[A-Za-z0-9_-]+)/;

const storedToken = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), ACCESS_TOKEN_KEY);

async function mailTo(request: APIRequestContext, to: string, subject: string) {
  const response = await request.get(`${API_URL}/test-support/emails`, { params: { to } });

  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    emails: Array<{ subject: string; text: string }>;
  };

  return body.emails.filter((email) => email.subject === subject);
}

async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("sign-in page", () => {
  test("shows the form with labelled fields and the links to recover or create an account", async ({
    page,
  }) => {
    await page.goto("/auth/sign-in");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/auth/sign-up",
    );
  });

  test("shows and hides the password with the toggle, by mouse and by keyboard", async ({
    page,
  }) => {
    await page.goto("/auth/sign-in");
    const password = page.getByLabel("Password", { exact: true });

    await password.fill("correct horse battery");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("correct horse battery");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");

    await password.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Show password" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
  });

  test("fits a 375 px screen without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/auth/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("signs in with the keyboard, stores the token, lands on /app and mails the new sign-in notice", async ({
    page,
    request,
  }) => {
    const { email, password } = await seedUserWithPassword("ok", { firstName: "Dora" });
    const consoleErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Dora");
    expect(await storedToken(page)).toBeTruthy();

    await expect
      .poll(async () => (await mailTo(request, email, NEW_SESSION_SUBJECT)).length, {
        timeout: 10_000,
      })
      .toBe(1);

    const [notice] = await mailTo(request, email, NEW_SESSION_SUBJECT);

    expect(notice?.text).toContain("Hi Dora,");
    expect(notice?.text).toContain(`${APP_URL}/auth/forgot-password`);
    expect(consoleErrors).toEqual([]);
  });

  test("shows the same message for a wrong password and an unknown e-mail, clears the password and mails nothing", async ({
    page,
    request,
  }) => {
    const { email } = await seedUserWithPassword("wrong");
    const unknown = `${E2E_EMAIL_PREFIX}unknown-${randomUUID()}@example.test`;

    await page.goto("/auth/sign-in");

    for (const target of [email, unknown]) {
      await fillAndSubmit(page, target, "a wrong password");

      await expect(page.getByRole("alert")).toHaveText(INVALID_MESSAGE);
      await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Email")).toHaveValue(target);
      await expect(page).toHaveURL(`${APP_URL}/auth/sign-in`);
    }

    expect(await storedToken(page)).toBeNull();
    expect(await mailTo(request, email, NEW_SESSION_SUBJECT)).toEqual([]);
  });

  test("tells an unconfirmed account to confirm, with a link to resend, only for the right password", async ({
    page,
  }) => {
    const { email, password } = await seedUserWithPassword("unconfirmed", {
      confirmed: false,
    });

    await page.goto("/auth/sign-in");
    await fillAndSubmit(page, email, "a wrong password");
    await expect(page.getByRole("alert")).toHaveText(INVALID_MESSAGE);

    await fillAndSubmit(page, email, password);

    const alert = page.getByRole("alert");

    await expect(alert).toContainText("Confirm your email to sign in.");
    await expect(alert.getByRole("link", { name: "Resend confirmation email" })).toHaveAttribute(
      "href",
      "/auth/resend-confirmation",
    );
    expect(await storedToken(page)).toBeNull();

    await alert.getByRole("link", { name: "Resend confirmation email" }).click();
    await expect(page).toHaveURL(`${APP_URL}/auth/resend-confirmation`);
  });
});

test.describe("full flow and a single session per user", () => {
  test("confirm by e-mail, sign out, sign in; a sign-in in another browser ends the first session", async ({
    page,
    request,
    browser,
  }) => {
    // The account stands in for a sign-up (its quota of 5 per hour per IP is used up by the other
    // specs; the sign-up page has its own spec): unconfirmed, with a real password hash. The
    // confirmation link still comes from the real flow: the resend page and the e-mail.
    const { email, password } = await seedUserWithPassword("flow", { confirmed: false });

    await page.goto("/auth/resend-confirmation");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send new link" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    // Confirm with the mailed link (this also signs the person in).
    await expect
      .poll(async () => (await mailTo(request, email, CONFIRM_SUBJECT)).length, { timeout: 10_000 })
      .toBe(1);

    const [confirmation] = await mailTo(request, email, CONFIRM_SUBJECT);
    const link = LINK_PATTERN.exec(confirmation?.text ?? "")?.[1] as string;

    await page.goto(link);
    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

    // The confirmation signs in without a "new sign-in" notice: that is for the sign-in only.
    expect(await mailTo(request, email, NEW_SESSION_SUBJECT)).toEqual([]);

    // Sign out (the 0008 button), then sign in with the credentials.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${APP_URL}/auth/sign-in`);
    expect(await storedToken(page)).toBeNull();

    await fillAndSubmit(page, email, password);
    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

    await expect
      .poll(async () => (await mailTo(request, email, NEW_SESSION_SUBJECT)).length, {
        timeout: 10_000,
      })
      .toBe(1);

    // A second browser signs in with the same account: the first one loses its session.
    const other = await browser.newContext({ baseURL: APP_URL });
    const otherPage = await other.newPage();

    try {
      await otherPage.goto("/auth/sign-in");
      await fillAndSubmit(otherPage, email, password);
      await expect(otherPage).toHaveURL(`${APP_URL}/app`);
      await expect(otherPage.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");

      await page.goto("/app");
      await expect(page).toHaveURL(`${APP_URL}/auth/sign-in`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
      expect(await storedToken(page)).toBeNull();

      // The second browser keeps working.
      await otherPage.goto("/app");
      await expect(otherPage.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
    } finally {
      await other.close();
    }

    await expect
      .poll(async () => (await mailTo(request, email, NEW_SESSION_SUBJECT)).length, {
        timeout: 10_000,
      })
      .toBe(2);
  });
});
