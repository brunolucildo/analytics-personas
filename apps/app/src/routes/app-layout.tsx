import { Outlet } from "@tanstack/react-router";

/** Layout of the private `/app/*` group. Access control arrives with the session guard. */
export function AppLayout() {
  return (
    <div data-testid="app-layout" className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  );
}
