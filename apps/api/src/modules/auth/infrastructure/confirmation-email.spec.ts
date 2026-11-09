import { describe, expect, it } from "vitest";
import { buildConfirmationEmail } from "./confirmation-email";

const LINK = "http://localhost:5173/auth/confirm-account?token=abc_DEF-123";

describe("buildConfirmationEmail", () => {
  it("addresses the recipient with an English subject and the first name", () => {
    const message = buildConfirmationEmail({
      to: "ana@example.test",
      firstName: "Ana",
      link: LINK,
    });

    expect(message.to).toBe("ana@example.test");
    expect(message.subject).toBe("Confirm your email address");
    expect(message.purpose).toBe("sign_up_confirmation");
    expect(message.html).toContain("Hi Ana,");
    expect(message.text).toContain("Hi Ana,");
  });

  it("puts the same link in the HTML and in the plain text", () => {
    const message = buildConfirmationEmail({
      to: "ana@example.test",
      firstName: "Ana",
      link: LINK,
    });

    expect(message.html).toContain(`href="${LINK}"`);
    expect(message.text).toContain(LINK);
  });

  it("escapes a first name that contains markup", () => {
    const message = buildConfirmationEmail({
      to: "ana@example.test",
      firstName: '<script>alert("x")</script>',
      link: LINK,
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });
});
