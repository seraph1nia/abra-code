import * as Id from "@abracode/contracts/identities";
import { domainEffect } from "../effects.ts";
import { Effect } from "effect";
import { Git } from "../../src/git/repository.ts";
import { ensure, type ManagedExecution, type Project } from "../../src/domain.ts";
import { type Delivery, type Publication, type PR } from "../../src/git/delivery.ts";

export class FakeDelivery implements Delivery {
  calls = 0;
  merged = false;
  pr?: PR;
  cleanupFails = false;
  constructor(private git: Git) {}
  deliver = Effect.fn("FakeDelivery.deliver")(
    function* (this: FakeDelivery, _p: Project, e: ManagedExecution, { commit }: Publication) {
      this.calls++;
      yield* this.git.run(e.worktree_directory!, [
        "push",
        "origin",
        `${commit}:refs/heads/${e.branch}`,
      ]);
      this.pr ??= {
        url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
        state: "OPEN",
        headRefOid: commit,
        baseRefName: Id.BranchName.make("main"),
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
      };
      this.pr.headRefOid = commit;
      return { commit, pr: this.pr.url };
    }.bind(this),
    domainEffect,
  );
  findings() {
    return Effect.succeed([
      {
        id: Id.FindingId.make("review-finding"),
        head: this.pr!.headRefOid,
        kind: "review" as const,
        text: "Fix the approved edge case",
      },
    ]);
  }
  inspect() {
    return domainEffect(
      Effect.sync(() => {
        return this.pr;
      }),
    );
  }
  merge() {
    return domainEffect(
      Effect.sync(() => {
        this.merged = true;
        this.pr!.state = "MERGED";
        return { category: "completed", value: undefined } as const;
      }),
    );
  }
  evidence(_p: Project, e: ManagedExecution) {
    return domainEffect(
      Effect.sync(() => {
        ensure(this.merged, "NOT_MERGED", "Not merged");
        return {
          commit: e.delivered_commit!,
          target: Id.BranchName.make("main"),
          at: Id.Timestamp.make("2026-10-16T10:00:00.000Z"),
        };
      }),
    );
  }
}
