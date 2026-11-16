import { Effect } from "effect";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { type AutomationSchema } from "../../src/config/policy.ts";
import { type Project } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";

export async function deliveredPR(
  t: { onTestFinished: (close: () => Promise<void>) => void },
  policy: typeof AutomationSchema.Type = {},
) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  Object.assign(p, policy);
  await run(f.records.saveProject(p));
  const e = await run(delivered(f));
  e.feedback = {
    schema_version: 1,
    head: e.delivered_commit!,
    pr: e.pull_request_reference!,
    target: e.target_branch!,
    observed_at: 1,
    next_check_at: 2,
    complete: true,
    attempts: 0,
    digest: "fixture",
    findings: [],
    history: [],
    actions: [],
  };
  await run(f.records.save(e));
  return { f, e, p };
}

export const noEffect = (_project: Project) => Effect.die(new Error("Unexpected remote mutation"));
