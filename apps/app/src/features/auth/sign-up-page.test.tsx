import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { createAppRouter } from "../../router";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: string, details: unknown[] = []) {
  return jsonResponse(status, { error: { code, message: "Server message.", details } });
}

function renderSignUp() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/auth/sign-up"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );
}

async function fillForm(overrides: Partial<Record<string, string>> = {}) {
  const user = userEvent.setup();
  const values = {
    "First name": "Ana",
    "Last name": "Silva",
    Email: "ana@example.test",
    Password: "correct horse battery",
    "Confirm password": "correct horse battery",
    ...overrides,
  };

  await screen.findByRole("heading", { level: 1, name: "Create your account" });

  for (const [label, value] of Object.entries(values)) {
    await user.type(screen.getByLabelText(label), value);
  }

  return user;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
});

describe("sign-up page", () => {
  it("renders the form with labelled fields, the submit button and a link to sign in", async () => {
    renderSignUp();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    for (const label of ["First name", "Last name", "Email", "Password", "Confirm password"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/sign-in");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("auth-layout")).getByRole("main")).toBeInTheDocument();
  });

  it("shows and hides the password and its confirmation on their own, keeping the values", async () => {
    renderSignUp();

    const user = await fillForm();
    const password = screen.getByLabelText("Password");
    const confirmation = screen.getByLabelText("Confirm password");

    await user.click(screen.getByRole("button", { name: "Show password" }));

    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("correct horse battery");
    expect(confirmation).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password confirmation" }));

    expect(confirmation).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide password" }));

    expect(password).toHaveAttribute("type", "password");
    expect(confirmation).toHaveAttribute("type", "text");
  });

  it("shows a mismatch error by the field before sending and does not call the API", async () => {
    renderSignUp();

    const user = await fillForm({ "Confirm password": "something else" });

    await user.click(screen.getByRole("button", { name: "Create account" }));

    const confirm = screen.getByLabelText("Confirm password");
    const message = await screen.findByText("Passwords do not match");

    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAttribute("aria-describedby", message.id);
    expect(confirm).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("describes every invalid field and focuses the first one", async () => {
    renderSignUp();
    await screen.findByRole("heading", { level: 1, name: "Create your account" });

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByLabelText("First name")).toHaveFocus();
    expect(screen.getByText("First name must have between 1 and 100 characters.")).toBeVisible();
    expect(screen.getByText("Enter a valid email address.")).toBeVisible();
    expect(screen.getByText("Password must have between 8 and 128 characters.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the values and replaces the form with 'Check your email' and the address", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { email: "ana@example.test" }));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Check your email" }),
    ).toBeVisible();
    expect(screen.getByText("ana@example.test")).toBeVisible();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/api\/v1\/auth\/sign-up$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      firstName: "Ana",
      lastName: "Silva",
      email: "ana@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
    });
  });

  it("disables the button and shows progress while the request is in flight", async () => {
    let finish: (response: Response) => void = () => undefined;

    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    const busy = await screen.findByRole("button", { name: "Creating account…" });

    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.test");

    finish(jsonResponse(201, { email: "ana@example.test" }));

    expect(await screen.findByText("Check your email")).toBeVisible();
  });

  it("shows 409 on the e-mail field with a link to sign in and keeps what was typed", async () => {
    fetchMock.mockResolvedValue(apiError(409, "EMAIL_ALREADY_REGISTERED"));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    const email = screen.getByLabelText("Email");
    const message = await screen.findByText(/An account with this email already exists\./);

    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", message.id);
    expect(within(message).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
    expect(email).toHaveValue("ana@example.test");
    expect(screen.getByLabelText("First name")).toHaveValue("Ana");
    await waitFor(() => expect(email).toHaveFocus());
  });

  it("shows 429 as a general message with the wait time", async () => {
    fetchMock.mockResolvedValue(apiError(429, "RATE_LIMITED", [{ retryAfterSeconds: 1800 }]));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many sign-up attempts. Try again in 30 minutes.",
    );
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("shows a general message on a network error and lets the user resend without retyping", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { email: "ana@example.test" }));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not create your account. Check your connection and try again.",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("correct horse battery");

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Check your email")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a general message on a 5xx", async () => {
    fetchMock.mockResolvedValue(apiError(500, "INTERNAL_ERROR"));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not create your account.");
  });

  it("maps 400 details to the matching fields", async () => {
    fetchMock.mockResolvedValue(
      apiError(400, "VALIDATION_FAILED", [
        { field: "email", message: "Enter a valid email address." },
        { field: "email", message: "Second message for the same field." },
      ]),
    );
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeVisible();
    expect(screen.queryByText("Second message for the same field.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the server error of a field once the user edits it", async () => {
    fetchMock.mockResolvedValue(apiError(409, "EMAIL_ALREADY_REGISTERED"));
    renderSignUp();

    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText(/An account with this email already exists\./);
    await user.type(screen.getByLabelText("Email"), "x");

    expect(
      screen.queryByText(/An account with this email already exists\./),
    ).not.toBeInTheDocument();
  });
});
