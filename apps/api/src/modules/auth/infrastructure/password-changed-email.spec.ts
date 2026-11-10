import { describe, expect, it } from "vitest";
import { buildPasswordChangedEmail } from "./password-changed-email";

const INPUT = {
  to: "ana@example.test",
  firstName: "Ana",
  changedAt: new Date("2026-11-09T19:15:30.000Z"),
  forgotPasswordUrl: "http://localhost:5173/auth/forgot-password",
};

describe("buildPasswordChangedEmail", () => {
  const message = buildPasswordChangedEmail(INPUT);

  it("has the subject, the recipient and the purpose", () => {
    expect(message.to).toBe("ana@example.test");
    expect(message.subject).toBe("Your Analytics Personas password was changed");
    expect(message.purpose).toBe("password_changed");
  });

  it("greets by first name and gives the UTC date and time", () => {
    for (const body of [message.text, message.html]) {
      expect(body).toContain("Hi Ana,");
      expect(body).toContain("2026-11-09 19:15 UTC");
    }
  });

  it("warns and links to forgot-password", () => {
    expect(message.text).toContain("If you didn't do this, reset your password again");
    expect(message.text).toContain("http://localhost:5173/auth/forgot-password");
    expect(message.html).toContain('href="http://localhost:5173/auth/forgot-password"');
  });

  it("carries no IP, device, token or reset link wording", () => {
    // Plain text only: the HTML layout has a `width=device-width` viewport meta of its own.
    expect(message.text).not.toMatch(/\bIP\b|device|browser|location|token/i);
  });

  it("escapes the first name in the HTML", () => {
    const hostile = buildPasswordChangedEmail({ ...INPUT, firstName: "<script>x</script>" });

    expect(hostile.html).not.toContain("<script>x</script>");
  });
});
