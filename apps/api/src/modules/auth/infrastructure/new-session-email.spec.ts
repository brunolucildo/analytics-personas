import { describe, expect, it } from "vitest";
import { buildNewSessionEmail, formatUtc } from "./new-session-email";

const INPUT = {
  to: "ana@example.test",
  firstName: "Ana",
  signedInAt: new Date("2026-11-09T19:15:30.000Z"),
  forgotPasswordUrl: "http://localhost:5173/auth/forgot-password",
};

describe("buildNewSessionEmail", () => {
  const message = buildNewSessionEmail(INPUT);

  it("has the subject, the recipient and the purpose", () => {
    expect(message.to).toBe("ana@example.test");
    expect(message.subject).toBe("New sign-in to Analytics Personas");
    expect(message.purpose).toBe("new_session");
  });

  it("greets by first name, gives the UTC time and says the earlier session ended", () => {
    for (const body of [message.text, message.html]) {
      expect(body).toContain("Hi Ana,");
      expect(body).toContain("2026-11-09 19:15 UTC");
      expect(body).toContain("earlier session was signed out");
    }
  });

  it("warns and links to forgot-password", () => {
    expect(message.text).toContain(
      "If this wasn't you, reset your password: http://localhost:5173/auth/forgot-password",
    );
    expect(message.html).toContain('href="http://localhost:5173/auth/forgot-password"');
  });

  it("carries no IP, device, token or password wording", () => {
    // Plain text only: the HTML layout has a `width=device-width` viewport meta of its own.
    expect(message.text).not.toMatch(/\bIP\b|device|browser|location|token/i);
  });

  it("escapes the first name in the HTML", () => {
    const hostile = buildNewSessionEmail({ ...INPUT, firstName: "<script>x</script>" });

    expect(hostile.html).not.toContain("<script>x</script>");
  });
});

describe("formatUtc", () => {
  it("formats as `YYYY-MM-DD HH:mm UTC`", () => {
    expect(formatUtc(new Date("2026-01-02T03:04:59.000Z"))).toBe("2026-01-02 03:04 UTC");
  });
});
