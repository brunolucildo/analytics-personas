/**
 * The development database of `docker-compose.yml` (`rondo_app`, public dev credentials).
 * Tests use it unless the environment already provides a `DATABASE_URL`.
 */
export const LOCAL_DATABASE_URL = "postgres://rondo_app:rondo@localhost:5432/rondo";
