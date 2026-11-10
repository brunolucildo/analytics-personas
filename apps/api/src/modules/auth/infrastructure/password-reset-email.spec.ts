import { describe, expect, it } from "vitest";
import { buildPasswordResetEmail } from "./password-reset-email";

const LINK = "http://localhost:5173/auth/reset-password?token=abc_DEF-123";

describe("buildPasswordResetEmail", () => {
  it("addresses the recipient with the English subject and the first name", () => {
    const message = buildPasswordResetEmail({
      to: "ana@example.test",
      firstName: "Ana",
      link: LINK,
    });

    expect(message.to).toBe("ana@example.test");
    expect(message.subject).toBe("Reset your Rondo password");
    expect(message.purpose).toBe("password_reset");
    expect(message.html).toContain("Hi Ana,");
    expect(message.text).toContain("Hi Ana,");
  });

  it("puts the same link, the one hour notice and the ignore notice in HTML and text", () => {
    const message = buildPasswordResetEmail({
      to: "ana@example.test",
      firstName: "Ana",
      link: LINK,
    });

    expect(message.html).toContain(`href="${LINK}"`);
    expect(message.text).toContain(LINK);

    for (const body of [message.html, message.text]) {
      expect(body).toContain("This link expires in 1 hour.");
      expect(body).toContain("If you didn't request this, you can ignore this email");
    }
  });

  it("escapes a first name that contains markup", () => {
    const message = buildPasswordResetEmail({
      to: "ana@example.test",
      firstName: '<script>alert("x")</script>',
      link: LINK,
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });
});
