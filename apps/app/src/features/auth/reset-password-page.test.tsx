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
const LINK_TOKEN = "tok_en-ABC123";
const NEW_PASSWORD = "a brand new password";
const SESSION_TOKEN = "header.payload.signature";
const INVALID_LINK = "This link is invalid or has expired";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: string, details: unknown[] = []) {
  return jsonResponse(status, { error: { code, message: "Server message.", details } });
}

const noContent = () => new Response(null, { status: 204 });

function renderPage(url = `/auth/reset-password?token=${LINK_TOKEN}`) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) });
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );

  return { router, queryClient };
}

async function fillForm(password = NEW_PASSWORD, confirmPassword = NEW_PASSWORD) {
  const user = userEvent.setup();

  await screen.findByRole("heading", { level: 1, name: "Choose a new password" });

  if (password !== "") {
    await user.type(screen.getByLabelText("New password"), password);
  }

  if (confirmPassword !== "") {
    await user.type(screen.getByLabelText("Confirm new password"), confirmPassword);
  }

  return user;
}

const submitButton = () => screen.getByRole("button", { name: /^Reset(ting)?( password|…)/ });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
});

describe("reset password page", () => {
  it("shows and hides each password on its own, keeping the values and without submitting", async () => {
    renderPage();
    const user = await fillForm();
    const password = screen.getByLabelText("New password");
    const confirmation = screen.getByLabelText("Confirm new password");

    await user.click(screen.getByRole("button", { name: "Show new password" }));

    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue(NEW_PASSWORD);
    expect(confirmation).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password confirmation" }));

    expect(confirmation).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide new password" }));

    expect(password).toHaveAttribute("type", "password");
    expect(confirmation).toHaveAttribute("type", "text");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the heading, the labelled masked fields, the button and the way back", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Choose a new password" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    expect(submitButton()).toBeEnabled();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("auth-layout")).getByRole("main")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes the token from the URL as soon as it loads, and still uses it on submit", async () => {
    fetchMock.mockResolvedValueOnce(noContent());

    const { router } = renderPage();

    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(router.state.location.href).toBe("/auth/reset-password");

    const user = await fillForm();

    await user.click(submitButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toEqual({
      token: LINK_TOKEN,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
  });

  it("shows the invalid-link state, with no form and no call, when the URL has no token", async () => {
    renderPage("/auth/reset-password");

    expect(
      await screen.findByRole("heading", { level: 1, name: INVALID_LINK }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an empty token as no token", async () => {
    renderPage("/auth/reset-password?token=");

    expect(
      await screen.findByRole("heading", { level: 1, name: INVALID_LINK }),
    ).toBeInTheDocument();
  });

  it("shows a short password by the field after submit, focuses it and does not call the API", async () => {
    renderPage();

    const user = await fillForm("1234567", "1234567");

    await user.click(submitButton());

    const password = screen.getByLabelText("New password");
    const message = await screen.findByText("Password must have between 8 and 128 characters.");

    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", message.id);
    expect(password).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a mismatch by the confirmation, focuses it and does not call the API", async () => {
    renderPage();

    const user = await fillForm(NEW_PASSWORD, "something else 1");

    await user.click(submitButton());

    const confirmation = screen.getByLabelText("Confirm new password");

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(confirmation).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on success clears the stored session, goes to /auth/sign-in and shows the notice", async () => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, SESSION_TOKEN);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/auth/reset-password")
          ? noContent()
          : jsonResponse(200, {
              user: { id: "u1", firstName: "Ana", lastName: "Silva", email: "ana@example.test" },
            }),
      ),
    );

    const { router } = renderPage();
    const user = await fillForm();

    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth/sign-in");
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your password was updated. Sign in with your new password.",
    );
  });

  it("disables the button while sending, keeps the fields and does not send twice", async () => {
    let release: (response: Response) => void = () => undefined;

    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    renderPage();

    const user = await fillForm();

    await user.click(submitButton());

    const busy = await screen.findByRole("button", { name: "Resetting…" });

    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("New password")).toHaveValue(NEW_PASSWORD);
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(noContent());
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
  });

  it("shows the invalid-link state when the API refuses the token", async () => {
    fetchMock.mockResolvedValueOnce(apiError(400, "TOKEN_INVALID_OR_EXPIRED"));
    renderPage();

    const user = await fillForm();

    await user.click(submitButton());

    expect(
      await screen.findByRole("heading", { level: 1, name: INVALID_LINK }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
  });

  it("shows server field errors by the field and keeps the form usable", async () => {
    fetchMock.mockResolvedValueOnce(
      apiError(400, "VALIDATION_FAILED", [
        { field: "password", message: "Password must have between 8 and 128 characters." },
      ]),
    );
    renderPage();

    const user = await fillForm();

    await user.click(submitButton());

    expect(
      await screen.findByText("Password must have between 8 and 128 characters."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveFocus();
    expect(submitButton()).toBeEnabled();
  });

  it("shows how long to wait on a 429 and keeps the form", async () => {
    fetchMock.mockResolvedValueOnce(apiError(429, "RATE_LIMITED", [{ retryAfterSeconds: 300 }]));
    renderPage();

    const user = await fillForm();

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 5 minutes.",
    );
    expect(screen.getByLabelText("New password")).toHaveValue(NEW_PASSWORD);
    expect(submitButton()).toBeEnabled();
  });

  it.each([
    ["a server error", () => Promise.resolve(apiError(500, "INTERNAL_ERROR"))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("shows a retry message for %s and lets the person try again", async (_label, failure) => {
    fetchMock.mockImplementationOnce(failure).mockResolvedValueOnce(noContent());
    renderPage();

    const user = await fillForm();

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reset your password. Check your connection and try again.",
    );

    await user.click(submitButton());
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
