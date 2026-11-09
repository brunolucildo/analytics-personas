import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_METADATA = "auth:public";

/**
 * Opens a route (or a whole controller) to requests without a session. The API
 * is closed by default: every route without this decorator needs a valid bearer
 * token, so an exception is always explicit and visible in the code.
 */
export const Public = () => SetMetadata(IS_PUBLIC_METADATA, true);
