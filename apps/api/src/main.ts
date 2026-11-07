import "./observability/telemetry";
import { createNestApp } from "./bootstrap";

async function main() {
  const app = await createNestApp();
  const port = Number(process.env.API_PORT ?? 3002);

  await app.listen(port);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  process.stderr.write(`${message}\n`);
  process.exit(1);
});
