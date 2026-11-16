import { CrewError } from "../domain.ts";
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new CrewError(
    "TERMINAL_REQUIRED",
    "pnpm start opens Abra interactively. Use pnpm service:start for background/bootstrap use.",
  );
await import("./start.ts");
await import("./client.ts");
