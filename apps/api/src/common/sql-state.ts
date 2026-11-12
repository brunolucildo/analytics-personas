const SQLSTATE = /^[0-9A-Z]{5}$/;
const INFRASTRUCTURE_CLASSES = ["08", "53", "57", "58"] as const;

/** A pg error carries the SQLSTATE in `code`; a connection failure carries none. */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" && SQLSTATE.test(code) ? code : undefined;
}

/**
 * Classes 08 (connection), 53 (resources), 57 (operator intervention) and 58
 * (system) are infrastructure failures. A missing SQLSTATE means the connection
 * itself failed. Business violations (22*, 23*) and any other SQLSTATE are not.
 */
export function isInfrastructureFailure(sqlState: string | undefined): boolean {
  if (sqlState === undefined) {
    return true;
  }

  return INFRASTRUCTURE_CLASSES.some((prefix) => sqlState.startsWith(prefix));
}
