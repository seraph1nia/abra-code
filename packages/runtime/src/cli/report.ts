import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import { Console, Effect, FileSystem } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { CrewError } from "../domain.ts";
import { AbsolutePath } from "@abracode/contracts/identities";
import { sourceInstallationRoot } from "../installation.ts";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import { realpath } from "../filesystem.ts";
import { ProcessRunner } from "../process.ts";
import { maximumHTMLBytes, validatePortableHTML } from "../reporting/report-build.ts";
import { readBoundedText } from "../reporting/renderer-evidence.ts";
import { ReactDocumentRenderer } from "../reporting/report-export.ts";

const readBoundedReportFile = (input: string, maxBytes: number) => {
  const path = resolve(input);
  return realpath(dirname(path)).pipe(
    Effect.flatMap((directory) => readBoundedText(join(directory, basename(path)), maxBytes)),
    Effect.catchIf(
      (error) => error.code === "REPORT_PATH",
      () =>
        Effect.fail(
          new CrewError("REPORT_INPUT", "A bounded regular saved report file is required."),
        ),
    ),
  );
};

export const runReportPrepare = Effect.gen(function* () {
  const renderer = new ReactDocumentRenderer(
    AbsolutePath.make(sourceInstallationRoot()),
    new ProcessRunner(),
  );
  const prepared = yield* renderer.prepare;
  yield* Console.log(`Portable renderer: ${prepared}`);
});

export const runReportExport = (input: string, output: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* readBoundedReportFile(input, 1024 * 1024);
    const parsed = readReportDocument(text);
    if (!parsed.supported) return yield* new CrewError("REPORT_DOCUMENT", parsed.reason);
    const renderer = new ReactDocumentRenderer(
      AbsolutePath.make(sourceInstallationRoot()),
      new ProcessRunner(),
    );
    const bundle = yield* renderer.acquire;
    const html = yield* bundle.render(parsed.document);
    const target = resolve(output);
    yield* fs
      .writeFileString(target, html, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError((cause) => CrewError.from(cause.reason.cause ?? cause)));
    yield* Console.log(`Exported ${Buffer.byteLength(html)} bytes to ${target}`);
  });

export const runReportPreview = (input: string, port: number) =>
  Effect.gen(function* () {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      return yield* new CrewError("REPORT_PORT", "Port must be 0–65535.");
    const text = yield* readBoundedReportFile(input, maximumHTMLBytes);
    yield* Effect.try({
      try: () => validatePortableHTML(text),
      catch: CrewError.from,
    });
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* NodeHttpServer.make(() => createServer(), {
          port,
          host: "127.0.0.1",
          gracefulShutdownTimeout: "1 second",
        });
        if (!("port" in server.address))
          return yield* new CrewError("REPORT_PREVIEW", "Expected a loopback TCP listener");
        const handler = Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "GET" || request.url !== "/")
            return HttpServerResponse.empty({ status: 404 });
          return HttpServerResponse.text(text, {
            status: 200,
            contentType: "text/html; charset=utf-8",
            headers: {
              "cache-control": "no-store",
              "content-security-policy":
                "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
              "x-content-type-options": "nosniff",
            },
          });
        });
        yield* server.serve(handler).pipe(Effect.provide(NodeHttpServer.layerHttpServices));
        yield* Console.log(
          `Report preview: http://127.0.0.1:${server.address.port}/\nKeep this terminal open. Ctrl+C stops only this preview.`,
        );
        return yield* Effect.never;
      }),
    );
  });
