import { Link } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Page not found</h1>
      <p className="max-w-md text-muted-foreground">
        The page you are looking for does not exist or was moved.
      </p>
      <Button asChild>
        <Link to="/">Go to the home page</Link>
      </Button>
    </main>
  );
}
