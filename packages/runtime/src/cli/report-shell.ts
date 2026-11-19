import { Effect } from "effect";
import { AbsolutePath } from "../identities.ts";
import { sourceInstallationRoot } from "../installation.ts";
import { ProcessRunner } from "../process.ts";
import { ReactDocumentRenderer } from "../workflow/report-export.ts";

if (process.argv.includes("--help"))
  console.log(
    "Usage: pnpm report:prepare — prepare/reuse this installation's portable renderer shell",
  );
else {
  const renderer = new ReactDocumentRenderer(
    AbsolutePath.make(sourceInstallationRoot()),
    new ProcessRunner(),
  );
  console.log(`Portable renderer: ${await Effect.runPromise(renderer.prepare)}`);
}
