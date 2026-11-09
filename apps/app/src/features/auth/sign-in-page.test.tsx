import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { ACCESS_TOKEN_KEY } from "../../lib/access-token";
import { createAppRouter } from "../../router";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;
const TOKEN = "header.payload.signature";
const USER = { id: "u1", firstName: "Ana", lastName: "Silva", email: "ana@example.test" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: string, details: unknown[] = []) {
  return jsonResponse(status, { error: { code, message: "Server message.", details } });
}

const sessionOk = () =>
  jsonResponse(200, {
    accessToken: TOKEN,
    expiresAt: "2026-11-16T12:00:00.000Z",
    user: USER,
  });

function renderSignIn() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/auth/sign-in"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );

  return { router, queryClient };
}

async function fillForm(email = "ana@example.test", password = "correct horse battery") {
  const user = userEvent.setup();

  await screen.findByRole("heading", { level: 1, name: "Sign in" });

  if (email !== "") {
    await user.type(screen.getByLabelText("Email"), email);
  }

  if (password !== "") {
    await user.type(screen.getByLabelText("Password"), password);
  }

  return user;
}

const submitButton = () => screen.getByRole("button", { name: /^Sign(ing)? in/ });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
});

describe("sign-in page", () => {
  it("renders the heading, the labelled fields, the button and the two links", async () => {
    renderSignIn();

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(submitButton()).toBeEnabled();
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/auth/sign-up",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("auth-layout")).getByRole("main")).toBeInTheDocument();
  });

  it("shows field errors after a submit with empty fields, focuses the e-mail and does not call the API", async () => {
    renderSignIn();

    const user = await fillForm("", "");

    await user.click(submitButton());

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs in: posts the credentials, stores the token and goes to /app showing the name without another call", async () => {
    fetchMock.mockResolvedValueOnce(sessionOk());

    const { router } = renderSignIn();
    const user = await fillForm("Ana@Example.test", "correct horse battery");

    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
    expect(router.state.location.pathname).toBe("/app");
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/api\/v1\/auth\/sign-in$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "Ana@Example.test",
      password: "correct horse battery",
    });
  });

  it("disables the button while sending and does not send twice", async () => {
    let release: (response: Response) => void = () => undefined;

    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    renderSignIn();

    const user = await fillForm();

    await user.click(submitButton());

    const busy = await screen.findByRole("button", { name: "Signing in…" });

    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(sessionOk());
    await screen.findByRole("heading", { level: 1, name: "Welcome, Ana" });
  });

  it("shows one general message for 401, clears the password, keeps the e-mail and focuses the password", async () => {
    fetchMock.mockResolvedValueOnce(apiError(401, "INVALID_CREDENTIALS"));
    renderSignIn();

    const user = await fillForm("ana@example.test", "wrong password");

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.test");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("link", { name: "Resend confirmation email" })).toBeNull();
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(submitButton()).toBeEnabled();
  });

  it("offers the resend link for an unconfirmed account", async () => {
    fetchMock.mockResolvedValueOnce(apiError(403, "EMAIL_NOT_CONFIRMED"));
    renderSignIn();

    const user = await fillForm();

    await user.click(submitButton());

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Confirm your email to sign in.");
    expect(within(alert).getByRole("link", { name: "Resend confirmation email" })).toHaveAttribute(
      "href",
      "/auth/resend-confirmation",
    );
  });

  it("shows how long to wait on a 429", async () => {
    fetchMock.mockResolvedValueOnce(apiError(429, "RATE_LIMITED", [{ retryAfterSeconds: 300 }]));
    renderSignIn();

    const user = await fillForm();

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many sign-in attempts. Try again in 5 minutes.",
    );
  });

  it.each([
    ["a server error", () => apiError(500, "INTERNAL_ERROR")],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("shows a general message on %s and lets the person try again", async (_label, failure) => {
    fetchMock.mockImplementationOnce(failure).mockResolvedValueOnce(sessionOk());
    renderSignIn();

    const user = await fillForm();

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign you in. Check your connection and try again.",
    );

    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome, Ana" })).toBeVisible();
    await waitFor(() => expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(TOKEN));
  });

  it("clears the previous error when submitting again", async () => {
    fetchMock.mockResolvedValueOnce(apiError(401, "INVALID_CREDENTIALS"));
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    renderSignIn();

    const user = await fillForm();

    await user.click(submitButton());
    await screen.findByRole("alert");
    await user.type(screen.getByLabelText("Password"), "another try");
    await user.click(submitButton());

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("maps a 400 field error to the field", async () => {
    fetchMock.mockResolvedValueOnce(
      apiError(400, "VALIDATION_FAILED", [
        { field: "email", message: "Enter a valid email address." },
      ]),
    );
    renderSignIn();

    const user = await fillForm("ana@example.test", "whatever");

    await user.click(submitButton());

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });
});
