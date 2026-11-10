import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { seedUnconfirmedUser } from "./support/confirmation";
import { ACCESS_TOKEN_KEY } from "./support/session";

const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:5173";
const API_URL = `${process.env.E2E_API_URL ?? "http://localhost:3002"}/api/v1`;
const CONFIRM_SUBJECT = "Confirm your email address";
const INVALID_HEADING = "This link is invalid or has expired";
const RESEND_SUCCESS =
  "If an account exists for that email and is not confirmed, we sent a new link.";
const LINK_PATTERN = /(https?:\/\/\S+\/auth\/confirm-account\?token=[A-Za-z0-9_-]+)/;

/** Confirmation links mailed to an address, oldest first (read from the capture mailbox). */
async function confirmationLinks(request: APIRequestContext, to: string): Promise<string[]> {
  const response = await request.get(`${API_URL}/test-support/emails`, { params: { to } });

  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    emails: Array<{ subject: string; text: string }>;
  };

  return body.emails
    .filter((email) => email.subject === CONFIRM_SUBJECT)
    .map((email) => LINK_PATTERN.exec(email.text)?.[1] as string);
}

async function waitForLinks(request: APIRequestContext, to: string, count: number) {
  await expect
    .poll(async () => (await confirmationLinks(request, to)).length, { timeout: 10_000 })
    .toBe(count);

  return confirmationLinks(request, to);
}

async function requestNewLink(page: Page, email: string) {
  await page.goto("/auth/resend-confirmation");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send new link" }).click();
  await expect(page.getByRole("status")).toHaveText(RESEND_SUCCESS);
}

const storedToken = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), ACCESS_TOKEN_KEY);

test.describe("confirm account", () => {
  test("mailed link confirms the account and lands on /app; the same link again is invalid", async ({
    page,
    request,
  }) => {
    const { email } = await seedUnconfirmedUser("flow");
    const confirmRequests: string[] = [];

    page.on("request", (apiRequest) => {
      if (apiRequest.url().endsWith("/auth/confirm-account")) {
        confirmRequests.push(apiRequest.method());
      }
    });

    await requestNewLink(page, email);

    const [link] = await waitForLinks(request, email, 1);

    expect(link).toContain(`${APP_URL}/auth/confirm-account?token=`);

    await page.goto(link as string);

    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
    expect(await storedToken(page)).toBeTruthy();
    // One POST, even though the dev build runs React StrictMode.
    expect(confirmRequests).toEqual(["POST"]);

    // The link is single use: opening it again shows the invalid-link page.
    await page.goto(link as string);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_HEADING);
    await expect(
      page.getByRole("link", { name: "Request a new confirmation email" }),
    ).toHaveAttribute("href", "/auth/resend-confirmation");
    await expect(page).toHaveURL(/\/auth\/confirm-account\?token=/);
  });

  test("the seeded sign-up link confirms the account too", async ({ page }) => {
    const { token } = await seedUnconfirmedUser("seeded");

    await page.goto(`/auth/confirm-account?token=${token}`);

    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
  });

  test("shows the invalid-link page for a link without a token or with a made-up one", async ({
    page,
  }) => {
    await page.goto("/auth/confirm-account");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_HEADING);

    await page.goto("/auth/confirm-account?token=not-a-real-token");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_HEADING);
    expect(await storedToken(page)).toBeNull();

    await page.getByRole("link", { name: "Request a new confirmation email" }).click();
    await expect(page).toHaveURL(`${APP_URL}/auth/resend-confirmation`);
  });
});

test.describe("resend confirmation", () => {
  test("shows the form with a labelled field, the button and a link back to sign in", async ({
    page,
  }) => {
    await page.goto("/auth/resend-confirmation");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resend confirmation email");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send new link" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
  });

  test("shows the same message for any e-mail, mails only the unconfirmed account and replaces the old link", async ({
    page,
    request,
  }) => {
    const { email: unconfirmed, token: oldToken } = await seedUnconfirmedUser("resend");
    const unknown = `unknown-${Date.now()}@example.test`;

    for (const email of [unconfirmed, unknown]) {
      await requestNewLink(page, email);
    }

    const [newLink] = await waitForLinks(request, unconfirmed, 1);

    expect(newLink).not.toContain(oldToken);
    expect(await confirmationLinks(request, unknown)).toEqual([]);

    // The link the account had before the resend no longer works...
    await page.goto(`/auth/confirm-account?token=${oldToken}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(INVALID_HEADING);

    // ...and the new one confirms the account.
    await page.goto(newLink as string);
    await expect(page).toHaveURL(`${APP_URL}/app`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
  });
});
