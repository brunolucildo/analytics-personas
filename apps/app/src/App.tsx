import { Button } from "@repo/ui/button";

export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
      <h1 className="text-center text-4xl font-black tracking-tight sm:text-6xl">Hello World</h1>
      <Button>Analytics Personas</Button>
    </main>
  );
}
