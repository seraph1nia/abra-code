import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { MemoryStore, TestLocks, fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { SurfacePublications } from "../../src/web/surface-publications.ts";
import { validateSurface, catalogId } from "../../src/web/surfaces.ts";
import { Reports } from "../../src/workflow/reports.ts";

test(
  "diagram preflight refuses partial surface and report publication while preserving original retries",
  { timeout: 60000 },
  async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const session = Id.SessionId.make("ses_diagram-publication"),
      issue = Id.IssueId.make("diagram-publication");
    f.seed.named(issue);
    await run(f.controller.start(issue, session));
    await run(f.controller.recordSupervisor(session));
    const owner = new SurfacePublications(new MemoryStore(), new TestLocks());
    const observation = Effect.succeed({
      home: f.config.home,
      at: Id.Timestamp.make("2026-11-16T00:00:00.000Z"),
      work: [],
      work_revision: "observed",
    });
    const request = (id: string, source: string) => ({
      session_id: session,
      message_id: Id.MessageId.make(id),
      call_id: id,
      surface: validateSurface({
        version: "1.0",
        createSurface: {
          surfaceId: "diagram-board",
          catalogId,
          components: [{ id: "root", component: "Mermaid", title: "Diagram", source }],
        },
      }),
    });
    const first = request("msg_valid", "flowchart LR\nA --> B");
    await run(owner.publish(first, observation));
    await assert.rejects(
      run(owner.publish(request("msg_invalid", "flowchart LR\nA -->"), observation)),
      /DIAGRAM|Parse error|syntax/,
    );
    const retained = await run(owner.read(session, "diagram-board", 1));
    assert.equal(
      retained.surface.createSurface.components[0]!.source,
      first.surface.createSurface.components[0]!.source,
    );
    assert.equal(
      (await run(owner.publish(first, Effect.die("Retry must not observe or compile")))).revision,
      1,
    );

    const reports = new Reports(f.config.home, f.records, f.git, f.locks, f.work, (...args) =>
      f.runtime.notify(...args),
    );
    const empty = await run(
      reports.generate(session, issue, { request_id: Id.RequestId.make("empty"), diagrams: [] }),
    );
    assert.deepEqual(empty.snapshot!.diagrams, []);
    await assert.rejects(
      run(
        reports.generate(session, issue, {
          request_id: Id.RequestId.make("invalid"),
          diagrams: [{ title: "Broken", source: "flowchart LR\nA -->" }],
        }),
      ),
    );
    assert.equal(
      (await run(f.records.execution(issue)))!.visual_reports!.filter(
        (b) => b.status === "published",
      ).length,
      1,
    );
    assert.equal(
      (
        await run(
          reports.generate(session, issue, {
            request_id: Id.RequestId.make("empty"),
            diagrams: [],
          }),
        )
      ).artifact!.hash,
      empty.artifact!.hash,
    );
  },
);
