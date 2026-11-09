import { Outlet } from "@tanstack/react-router";

/** Layout of the public `/auth/*` group (sign-up, sign-in, password recovery). */
export function AuthLayout() {
  return (
    <div
      data-testid="auth-layout"
      className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground"
    >
      <main className="w-full max-w-md">
        <Outlet />
      </main>
    </div>
  );
}
