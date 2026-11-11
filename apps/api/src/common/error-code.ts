/**
 * The error envelope `code` of the current response, kept in `response.locals` by the global
 * exception filter. Later `finish` listeners (telemetry) read it without parsing the body.
 */
const LOCALS_KEY = "errorCode";

interface HasLocals {
  locals?: Record<string, unknown>;
}

export function rememberErrorCode(response: HasLocals, code: string): void {
  if (response.locals !== undefined) {
    response.locals[LOCALS_KEY] = code;
  }
}

export function recalledErrorCode(response: HasLocals): string | undefined {
  const code = response.locals?.[LOCALS_KEY];

  return typeof code === "string" ? code : undefined;
}
