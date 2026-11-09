import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { createAppRouter } from "../../router";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;
const SUCCESS = "If an account exists for that email, we sent instructions to reset your password.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: string, details: unknown[] = []) {
  return jsonResponse(status, { error: { code, message: "Server message.", details } });
}

function renderPage() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/auth/forgot-password"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );
}

async function typeEmail(email: string) {
  const user = userEvent.setup();

  await screen.findByRole("heading", { level: 1, name: "Forgot your password?" });
  await user.type(screen.getByLabelText("Email"), email);

  return user;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
});

describe("forgot password page", () => {
  it("renders the heading, the explanation, the labelled e-mail field, the button and the link back", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Forgot your password?" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/we will send you a link/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("auth-layout")).getByRole("main")).toBeInTheDocument();
  });

  it("shows an invalid e-mail by the field, focuses it and does not call the API", async () => {
    renderPage();

    const user = await typeEmail("ana-at-example");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    const email = screen.getByLabelText("Email");
    const message = await screen.findByText("Enter a valid email address.");

    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", message.id);
    expect(email).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the e-mail and replaces the form with the generic message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, {}));
    renderPage();

    const user = await typeEmail("ana@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(SUCCESS);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send reset link" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeVisible();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/api\/v1\/auth\/forgot-password$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "ana@example.test" });
  });

  it("shows the same message whatever the e-mail, so the page never reveals an account", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, {}));

    const texts: string[] = [];

    for (const address of ["has-account@example.test", "no-account@example.test"]) {
      renderPage();

      const user = await typeEmail(address);

      await user.click(screen.getByRole("button", { name: "Send reset link" }));
      texts.push((await screen.findByRole("status")).textContent ?? "");
      cleanup();
    }

    expect(texts).toEqual([SUCCESS, SUCCESS]);
  });

  it("disables the button and shows progress while the request is in flight", async () => {
    let finish: (response: Response) => void = () => undefined;

    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    renderPage();

    const user = await typeEmail("ana@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    const busy = await screen.findByRole("button", { name: "Sending…" });

    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.test");

    finish(jsonResponse(202, {}));

    expect(await screen.findByRole("status")).toHaveTextContent(SUCCESS);
  });

  it("shows a 429 as a general message with the wait time and keeps the e-mail", async () => {
    fetchMock.mockResolvedValue(apiError(429, "RATE_LIMITED", [{ retryAfterSeconds: 600 }]));
    renderPage();

    const user = await typeEmail("ana@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Try again in 10 minutes.",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.test");
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  });

  it("shows a network error as a general message, keeps the e-mail and lets the user try again", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(jsonResponse(202, {}));
    renderPage();

    const user = await typeEmail("ana@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not send the reset link. Check your connection and try again.",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(SUCCESS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a 5xx as a general message", async () => {
    fetchMock.mockResolvedValue(apiError(500, "INTERNAL_ERROR"));
    renderPage();

    const user = await typeEmail("ana@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not send the reset link.");
  });

  it("maps a 400 from the API to the e-mail field", async () => {
    fetchMock.mockResolvedValue(
      apiError(400, "VALIDATION_FAILED", [
        { field: "email", message: "Enter a valid email address." },
      ]),
    );
    renderPage();

    const user = await typeEmail("a@b.c");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the server error of the field once the user edits it", async () => {
    fetchMock.mockResolvedValue(
      apiError(400, "VALIDATION_FAILED", [
        { field: "email", message: "Enter a valid email address." },
      ]),
    );
    renderPage();

    const user = await typeEmail("a@b.c");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("Enter a valid email address.");
    await user.type(screen.getByLabelText("Email"), "x");

    expect(screen.queryByText("Enter a valid email address.")).not.toBeInTheDocument();
  });
});
