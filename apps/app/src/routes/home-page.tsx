import { useSession } from "../features/auth/use-session";

/** Home of the signed-in area. `AppLayout` only renders it once the session is known. */
export function HomePage() {
  const session = useSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
        Welcome, {session.data?.user.firstName}
      </h1>
      <p className="text-lg text-muted-foreground">You are signed in.</p>
    </main>
  );
}
