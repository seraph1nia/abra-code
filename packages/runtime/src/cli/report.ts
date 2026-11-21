import { sourceInstallationRoot } from "../installation.ts";
import { createServer } from "node:http";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect } from "effect";
import { AbsolutePath } from "../identities.ts";
import { readReportDocument } from "../presentation/report-document.ts";
import { ReactDocumentRenderer } from "../workflow/report-export.ts";
import { validatePortableHTML, maximumHTMLBytes } from "../workflow/report-build.ts";
import { ProcessRunner } from "../process.ts";

const usage =
  "Usage: pnpm report:export <saved.json> <new.html> | pnpm report:preview <export.html> [port]";
const [mode, input, output, ...extra] = process.argv.slice(2);
if (mode === "--help" || !input) console.log(usage);
else if (extra.length || !["export", "preview"].includes(mode ?? "")) throw new Error(usage);
else {
  const path = resolve(input),
    stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > (mode === "export" ? 1024 * 1024 : maximumHTMLBytes)
  )
    throw new Error("A bounded regular saved report file is required.");
  const text = await readFile(path, "utf8");
  if (mode === "export") {
    if (!output) throw new Error(usage);
    const parsed = readReportDocument(text);
    if (!parsed.supported) throw new Error(parsed.reason);
    const renderer = new ReactDocumentRenderer(
      AbsolutePath.make(sourceInstallationRoot()),
      new ProcessRunner(),
    );
    const bundle = await Effect.runPromise(renderer.acquire);
    const html = await Effect.runPromise(bundle.render(parsed.document));
    await writeFile(resolve(output), html, { flag: "wx", mode: 0o600 });
    console.log(`Exported ${Buffer.byteLength(html)} bytes to ${resolve(output)}`);
  } else {
    validatePortableHTML(text);
    const port = Number(output ?? "4174");
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Port must be 0–65535.");
    const server = createServer((request, response) => {
      if (request.method !== "GET" || request.url !== "/") {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
        "x-content-type-options": "nosniff",
      });
      response.end(text);
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      console.log(
        `Report preview: http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/\nKeep this terminal open. Ctrl+C stops only this preview.`,
      );
    });
    const stop = () => server.close(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
