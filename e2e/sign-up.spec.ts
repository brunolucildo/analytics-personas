import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_EMAIL_PREFIX } from "./support/global-teardown";

const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:5173";
const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;
const PASSWORD = "correct horse battery";

function newEmail(label: string): string {
  return `${E2E_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`;
}

async function capturedEmails(request: APIRequestContext, to: string) {
  const response = await request.get(`${API_URL}/test-support/emails`, { params: { to } });

  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    emails: Array<{ to: string; subject: string; text: string }>;
  };

  return body.emails;
}

test.describe("sign-up page", () => {
  test("shows the form with labelled fields and a link to sign in", async ({ page }) => {
    await page.goto("/auth/sign-up");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");

    for (const label of ["First name", "Last name", "Email", "Password", "Confirm password"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
  });

  test("shows the password mismatch by the field without calling the API", async ({ page }) => {
    const signUpRequests: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/auth/sign-up") && request.method() === "POST") {
        signUpRequests.push(request.url());
      }
    });

    await page.goto("/auth/sign-up");
    await page.getByLabel("First name").fill("Ana");
    await page.getByLabel("Last name").fill("Silva");
    await page.getByLabel("Email").fill(newEmail("mismatch"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill("a different password");
    await page.getByRole("button", { name: "Create account" }).click();

    const confirm = page.getByLabel("Confirm password");

    await expect(page.getByText("Passwords do not match")).toBeVisible();
    await expect(confirm).toHaveAttribute("aria-invalid", "true");
    await expect(confirm).toBeFocused();
    expect(signUpRequests).toEqual([]);
  });

  test("creates the account and the confirmation e-mail reaches the capture mailbox", async ({
    page,
    request,
  }) => {
    const email = newEmail("happy");

    await page.goto("/auth/sign-up");
    await page.getByLabel("First name").fill("Ana");
    await page.getByLabel("Last name").fill("Silva");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);

    await expect
      .poll(async () => (await capturedEmails(request, email)).length, { timeout: 10_000 })
      .toBe(1);

    const [message] = await capturedEmails(request, email);

    expect(message?.subject).toBe("Confirm your email address");
    expect(message?.text).toContain("Hi Ana,");
    expect(message?.text).toContain(`${APP_URL}/auth/confirm-account?token=`);
    expect(message?.text).toMatch(/token=[A-Za-z0-9_-]{43}/);
  });

  test("shows the repeated e-mail error on the e-mail field, with a link to sign in", async ({
    page,
    request,
  }) => {
    const email = newEmail("duplicate");
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

    await page.goto("/auth/sign-up");
    await page.getByLabel("First name").fill("Bia");
    await page.getByLabel("Last name").fill("Souza");
    await page.getByLabel("Email").fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    const error = page.getByText(/An account with this email already exists\./);

    await expect(error).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(error.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
    await expect(page.getByLabel("First name")).toHaveValue("Bia");
  });
});
