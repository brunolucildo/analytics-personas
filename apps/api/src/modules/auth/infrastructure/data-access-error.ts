/**
 * A failed database call. The message is fixed on purpose: Postgres and
 * PostgREST messages can echo row values (e-mail addresses), so only the
 * operation name and the SQLSTATE-like code are kept.
 */
export class DataAccessError extends Error {
  constructor(
    readonly operation: string,
    readonly code?: string,
  ) {
    super(`Database operation failed: ${operation}.`);
    this.name = "DataAccessError";
  }
}
