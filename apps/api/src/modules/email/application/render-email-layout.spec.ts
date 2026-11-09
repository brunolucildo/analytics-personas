import { describe, expect, it } from "vitest";
import { escapeHtml, html } from "../domain/safe-html";
import { EMAIL_COLORS, renderEmailLayout } from "./render-email-layout";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

const baseInput = {
  title: "Confirm your account",
  preheader: "One step left to start",
  bodyHtml: html`<p>Open the link to confirm.</p>`,
  bodyText: "Open the link to confirm.",
};

describe("renderEmailLayout", () => {
  it("renders an en-US HTML document with title, preheader and body", () => {
    const { html: document } = renderEmailLayout(baseInput);

    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document).toContain('<html lang="en-US">');
    expect(document).toContain("<title>Confirm your account</title>");
    expect(document).toContain("One step left to start");
    expect(document).toContain("<p>Open the link to confirm.</p>");
    expect(document).toContain("</html>");
  });

  it("renders the plain-text part with the same content and no markup", () => {
    const { text } = renderEmailLayout(baseInput);

    expect(text).toContain("Confirm your account");
    expect(text).toContain("Open the link to confirm.");
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it("escapes <script> in title and preheader, and in values interpolated with the html tag", () => {
    const attack = '<script>alert("x")</script>';
    const { html: document, text } = renderEmailLayout({
      title: attack,
      preheader: attack,
      bodyHtml: html`<p>Hello ${attack}</p>`,
      bodyText: `Hello ${attack}`,
    });

    expect(document).not.toContain("<script>");
    expect(document).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(text).toContain(attack);
  });

  it("keeps nested html fragments as markup but still escapes plain values", () => {
    const nested = html`<strong>${"a & b"}</strong>`;

    expect(html`<p>${nested}</p>`.value).toBe("<p><strong>a &amp; b</strong></p>");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });

  it("uses text/background pairs that meet WCAG AA (4.5:1) for normal text", () => {
    const pairs: Array<[string, string]> = [
      [EMAIL_COLORS.ink, EMAIL_COLORS.white],
      [EMAIL_COLORS.ink, EMAIL_COLORS.paper],
      [EMAIL_COLORS.muted, EMAIL_COLORS.white],
    ];

    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
