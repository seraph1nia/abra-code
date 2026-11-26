import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect, Exit, Scope } from "effect";
import { OpenCode } from "@opencode/client";
import type { Endpoint } from "@opencode/client/effect/service";
import { AbsolutePath } from "@abracode/contracts/identities";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { observeWorkspaceStreaming } from "./workspace-streaming-checks.ts";
import { checkWorkspaceBootstrap } from "./workspace-bootstrap-checks.ts";
import { checkWorkspacePresentations, type DiagramEvidence } from "./workspace-browser-checks.ts";
import { checkWorkspaceDelivery } from "./workspace-delivery-checks.ts";
type Native = ReturnType<typeof OpenCode.make>;
export interface WorkspaceJourneyInput {
  home: string;
  project: string;
  session: string;
  endpoint: Endpoint;
  client: Native;
  restart: () => Promise<void>;
  providerCount: () => number;
  streaming: { hold: () => void; release: (kind: "tool" | "text") => void };
  readStatus: (id: string) => Promise<any>;
  evidence?: string;
}
export async function workspaceJourney(input: WorkspaceJourneyInput) {
  const evidence: DiagramEvidence = {};
  const scope = await Effect.runPromise(Scope.make());
  try {
    const backend = new NativeWebBackend(
      AbsolutePath.make(input.home),
      input.session,
      Effect.succeed(input.endpoint),
    );
    const web = await Effect.runPromise(
      workspaceServer({ port: 0, backend, assets: join(input.home, "apps/web/dist") }).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    const browser = await launchReportBrowser();
    try {
      const streaming = observeWorkspaceStreaming(input, backend, web.origin);
      try {
        const bootstrap = await checkWorkspaceBootstrap(
          input,
          backend,
          web.origin,
          browser,
          streaming,
        );
        const presentations = await checkWorkspacePresentations(
          input,
          backend,
          web.origin,
          bootstrap,
          evidence,
        );
        return await checkWorkspaceDelivery(
          input,
          backend,
          web.origin,
          bootstrap,
          presentations,
          streaming,
          evidence,
        );
      } finally {
        try {
          if (input.evidence) {
            await mkdir(input.evidence, { recursive: true });
            await writeFile(
              join(input.evidence, "native-transport.json"),
              JSON.stringify(
                {
                  partialBeforeRelease: streaming.partialBeforeRelease,
                  diagramPerformance: evidence.diagramPerformance,
                  trace: streaming.nativeTrace,
                  observers: streaming.observers.map(({ events, errors }) => ({ events, errors })),
                },
                null,
                2,
              ),
            );
          }
        } finally {
          await streaming.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
