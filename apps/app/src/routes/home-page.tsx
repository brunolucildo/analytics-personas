import { Button } from "@repo/ui/button";

export function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-center text-4xl font-black tracking-tight sm:text-6xl">Hello World</h1>
      <Button>Analytics Personas</Button>
    </main>
  );
}
