const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Markup that is safe to embed: built by `html`, which escapes every interpolation. */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

/**
 * Tagged template for e-mail markup. Interpolated strings and numbers are
 * escaped; interpolated `SafeHtml` values (nested templates) are kept as is.
 *
 * @example html`<p>Hi ${firstName}</p>`
 */
export function html(
  strings: TemplateStringsArray,
  ...values: Array<string | number | SafeHtml>
): SafeHtml {
  let result = strings[0] ?? "";

  values.forEach((value, index) => {
    result +=
      (value instanceof SafeHtml ? value.value : escapeHtml(String(value))) +
      (strings[index + 1] ?? "");
  });

  return new SafeHtml(result);
}
