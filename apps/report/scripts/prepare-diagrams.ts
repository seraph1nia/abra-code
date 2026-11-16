import { lstat, readFile, writeFile } from "node:fs/promises";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import { createDiagramRenderer } from "./diagrams.ts";

/** Trusted bounded preparation only; no application compilation or captured code. */
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4)
  throw Error("Expected captured document and new diagram output paths");
const stat = await lstat(input);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
  throw Error("Captured document exceeds its regular-file bound");
const document = readReportDocument(await readFile(input, "utf8"));
if (!document.supported) throw Error(document.reason);
const renderer = await createDiagramRenderer();
try {
  const prepared = [];
  for (const diagram of document.document.data.evidence?.diagrams ?? []) {
    const svg = await renderer.render(diagram.source);
    prepared.push({ source: diagram.source, svg });
    if (Buffer.byteLength(JSON.stringify(prepared)) > 8 * 1024 * 1024)
      throw Error("Prepared diagrams exceed the portable artifact bound");
  }
  await writeFile(output, JSON.stringify(prepared), { flag: "wx", mode: 0o600 });
} finally {
  await renderer.close();
}
