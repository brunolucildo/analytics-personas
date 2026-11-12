import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { query } from "./support/database";
import { E2E_EMAIL_PREFIX } from "./support/global-teardown";

const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:5173";
const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;
const PASSWORD = "correct horse battery";
const RESET_SUBJECT = "Reset your Rondo password";
const SUCCESS = "If an account exists for that email, we sent instructions to reset your password.";

function newEmail(label: string): string {
  return `${E2E_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`;
}

/** Reset mails sent to an address (the sign-up confirmation mail is not counted). */
async function capturedResetEmails(request: APIRequestContext, to: string) {
  const response = await request.get(`${API_URL}/test-support/emails`, { params: { to } });

  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    emails: Array<{ to: string; subject: string; text: string }>;
  };

  return body.emails.filter((email) => email.subject === RESET_SUBJECT);
}

/** Signs the account up through the API; `confirmed` also sets `email_confirmed_at` in the database. */
async function createAccount(request: APIRequestContext, email: string, confirmed: boolean) {
  const created = await request.post(`${API_URL}/auth/sign-up`, {
    data: {
      firstName: "Ana",
      lastName: "Silva",
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
  });

  expect(created.status()).toBe(201);

  if (confirmed) {
    await query("update public.users set email_confirmed_at = $1 where email = $2", [
      new Date(),
      email,
    ]);
  }
}

async function requestReset(page: Page, email: string) {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(SUCCESS);
}

test.describe("forgot password page", () => {
  test("shows the form with a labelled field, the button and a link back to sign in", async ({
    page,
  }) => {
    await page.goto("/auth/forgot-password");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Forgot your password?");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
  });

  test("shows an invalid e-mail by the field without calling the API", async ({ page }) => {
    const requests: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/auth/forgot-password") && request.method() === "POST") {
        requests.push(request.url());
      }
    });

    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toBeFocused();
    expect(requests).toEqual([]);
  });

  test("shows the same message for existing and unknown e-mails and mails only the confirmed account", async ({
    page,
    request,
  }) => {
    const confirmed = newEmail("confirmed");
    const unconfirmed = newEmail("unconfirmed");
    const unknown = newEmail("unknown");

    await createAccount(request, confirmed, true);
    await createAccount(request, unconfirmed, false);

    for (const email of [confirmed, unconfirmed, unknown]) {
      await requestReset(page, email);
      await expect(page.getByLabel("Email")).toHaveCount(0);
    }

    await expect
      .poll(async () => (await capturedResetEmails(request, confirmed)).length, { timeout: 10_000 })
      .toBe(1);

    const [message] = await capturedResetEmails(request, confirmed);

    expect(message?.subject).toBe(RESET_SUBJECT);
    expect(message?.text).toContain("Hi Ana,");
    expect(message?.text).toContain(`${APP_URL}/auth/reset-password?token=`);
    expect(message?.text).toMatch(/token=[A-Za-z0-9_-]{43}/);

    // The mail for the confirmed account already arrived, so any other mail would be here by now.
    expect(await capturedResetEmails(request, unconfirmed)).toEqual([]);
    expect(await capturedResetEmails(request, unknown)).toEqual([]);
  });
});
