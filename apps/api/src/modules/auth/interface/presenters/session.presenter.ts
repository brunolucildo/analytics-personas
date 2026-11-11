import type { IssuedSession, SessionUser } from "../../domain/session-ports";

export interface UserResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface SessionResponse {
  accessToken: string;
  /** ISO 8601, UTC. */
  expiresAt: string;
  user: UserResponse;
}

/** Only the public fields: never the password hash or any internal column. */
export function presentUser(user: SessionUser): UserResponse {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  };
}

/** The session response shared by the confirm-account and sign-in endpoints. */
export function presentSession(session: IssuedSession): SessionResponse {
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt.toISOString(),
    user: presentUser(session.user),
  };
}
