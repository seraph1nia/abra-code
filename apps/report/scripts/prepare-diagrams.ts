import { lstat, readFile, writeFile } from "node:fs/promises";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import { diagramPreparer } from "./preparation.ts";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";

/** Trusted bounded preparation only; no application compilation or captured code. */
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4)
  throw Error("Expected captured document and new diagram output paths");
const stat = await lstat(input);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
  throw Error("Captured document exceeds its regular-file bound");
const document = readReportDocument(await readFile(input, "utf8"));
if (!document.supported) throw Error(document.reason);
const prepared = await diagramPreparer.prepare(
  collectDiagrams(
    document.document.surface.createSurface.components,
    document.document.data.evidence,
  ),
);
if (!prepared.verified)
  throw Error(
    prepared.results
      .filter((r) => r.status !== "verified")
      .map((r) => `${r.id}: ${r.status}: ${r.message}`)
      .join("\n"),
  );
await writeFile(output, JSON.stringify(prepared.assets), { flag: "wx", mode: 0o600 });
