/**
 * A failed database call. The message is fixed on purpose: Postgres messages can
 * echo row values (e-mail addresses, token hashes), so only the operation name and
 * the SQLSTATE-like code are kept.
 */
export class DataAccessError extends Error {
  constructor(
    readonly operation: string,
    readonly code?: string,
  ) {
    super(
      code === undefined
        ? `Database operation failed: ${operation}.`
        : `Database operation failed: ${operation} (${code}).`,
    );
    this.name = "DataAccessError";
  }
}
