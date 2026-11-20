import assert from "node:assert/strict";
import { join } from "node:path";
import { rm, symlink, readFile, writeFile } from "node:fs/promises";
import { test } from "vite-plus/test";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { fixture } from "../fixtures.ts";
import { goal } from "../helpers/work-goal.ts";
import { run } from "../effects.ts";
import { RequestId, RelativePath } from "../../src/identities.ts";

test("a repository Playwright trace and versioned references survive removal of the producing files", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = await run(f.work.create(goal("trace")));
  const e = await run(f.controller.start(issue.id));
  const session = e.explore_session_id!,
    root = e.worktree_directory!;
  const browser = await launchReportBrowser();
  t.onTestFinished(() => browser.close());
  const context = await browser.newContext();
  await context.tracing.start({ snapshots: true });
  const page = await context.newPage();
  await page.setContent("<button>Test target</button>");
  await page.getByRole("button").click();
  await context.tracing.stop({ path: join(root, "result.zip") });
  const bytes = await readFile(join(root, "result.zip"));
  const input = {
    kind: "trace" as const,
    request_id: RequestId.make("trace"),
    path: RelativePath.make("result.zip"),
    description: "Target interaction",
  };
  const code = {
    kind: "code" as const,
    file: RelativePath.make("source.txt"),
    revision: e.base_commit!,
    line: 1,
    symbol: "source",
  };
  const doc = {
    kind: "documentation" as const,
    title: "Playwright",
    version: "fixture-version",
    url: "https://playwright.dev/docs/trace-viewer",
  };
  await assert.rejects(
    run(
      f.controller.workerProgress(session, 0, "Report", undefined, [
        { ...doc, url: "javascript:alert(1)" },
      ]),
    ),
    /Worker reference/,
  );
  await symlink(join(root, "result.zip"), join(root, "link.zip"));
  await assert.rejects(
    run(
      f.controller.workerProgress(session, 0, "Report", {
        ...input,
        path: RelativePath.make("link.zip"),
      }),
    ),
    /assigned directory/,
  );
  await writeFile(join(root, "wrong.zip"), "PK bogus");
  await assert.rejects(
    run(
      f.controller.workerProgress(session, 0, "Report", {
        ...input,
        path: RelativePath.make("wrong.zip"),
      }),
    ),
    /trace ZIP/,
  );
  const receipt = (
    await run(
      f.controller.workerProgress(session, 0, "Report", input, [
        doc,
        code,
        { ...code, file: RelativePath.make("absent.ts") },
      ]),
    )
  ).capture!;
  const view = await run(f.controller.queries.verification(issue.id));
  assert.ok(
    view.references?.some(
      (r) => r.source.kind === "documentation" && r.source.version === doc.version,
    ),
  );
  assert.ok(
    view.references?.some(
      (r) => r.source.kind === "code" && r.source.file === "absent.ts" && r.excerpt === undefined,
    ),
  );
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(
    Buffer.from((await run(f.controller.queries.evidence(receipt))).data, "base64"),
    bytes,
  );
});
