import { observeChecks } from "./checks.ts";
import { type Check } from "./check-contracts.ts";
import { CheckName, ErrorCode, timestamp } from "../identities.ts";

import { Effect, Schema } from "effect";
import { type ManagedExecution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { Count } from "../contracts.ts";
import { Forge, RuleSchema, RequiredParameters, ProtectionSchema, type PR } from "./forge.ts";
import { type OperationResult } from "../workflow/results.ts";

export { ForgeObservationSchema } from "./readiness-contracts.ts";
type Requirement = { context: CheckName; app_id?: number };
const waiting = (code: string, reason: string, owner = "forge"): OperationResult => ({
  category: "waiting",
  code: ErrorCode.make(code),
  reason: reason.slice(0, 2048),
  owner,
});
const failed = (code: string, reason: string): OperationResult => ({
  category: "verification",
  code: ErrorCode.make(code),
  reason: reason.slice(0, 2048),
});
const ready: OperationResult = { category: "completed", value: undefined };
const protectionQuery = `query($owner:String!,$name:String!,$ref:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){branchProtectionRule{requiresStatusChecks requiredStatusChecks{context app{databaseId}}}}}}`;
/** Explicit check policy with authoritative missing-context and application identity evidence. */
export class GitHubReadiness {
  constructor(private forge: Forge) {}
  check = Effect.fn("GitHubReadiness.check")(
    function* (this: GitHubReadiness, p: Project, e: ManagedExecution, pr: PR, checksOnly = false) {
      const policy = e.effective_policy.ci_policy;
      const allowEmpty = e.effective_policy.allow_no_checks;
      const method = e.effective_policy.merge_method;
      const requirements: Requirement[] = [];
      let checks: Check[] = [];
      const reasons: string[] = [];
      let confirmed = false;
      const observedAt = yield* timestamp;
      let gate: OperationResult | undefined;
      const observe = (result: OperationResult, requiredConfirmed = confirmed) => {
        e.forge_observation = {
          head: pr.headRefOid,
          at: observedAt,
          ci_policy: policy,
          required_confirmed: requiredConfirmed,
          required: requirements,
          checks: checks.slice(0, 200).map((c) => ({
            ...c,
            blocking:
              policy === "all-reported" ||
              requirements.some(
                (r) => r.context === c.name && (r.app_id === undefined || r.app_id === c.app_id),
              ),
          })),
          checks_total: checks.length,
          limited: checks.length > 200,
          reasons: [...reasons, ...(result.category === "completed" ? [] : [result.reason])],
        };
        return gate ?? result;
      };
      if (!checksOnly && pr.isDraft) gate = waiting("PR_DRAFT", "PR is a draft", "maintainer");
      if (!checksOnly && pr.reviewDecision === "CHANGES_REQUESTED")
        gate ??= failed("REVIEW_FAILED", "Forge review requests changes");
      if (!checksOnly && pr.reviewDecision === "REVIEW_REQUIRED")
        gate ??= waiting("REVIEW_REQUIRED", "Required forge review has not passed", "reviewers");
      if (!checksOnly && pr.mergeable !== "MERGEABLE")
        gate ??= waiting("PR_MERGEABILITY", `PR mergeability is ${pr.mergeable}`, "maintainer");
      const repo = yield* this.forge.repo(p);
      if (
        !checksOnly &&
        !(method === "merge"
          ? repo.allow_merge_commit
          : method === "squash"
            ? repo.allow_squash_merge
            : repo.allow_rebase_merge)
      )
        gate ??= waiting(
          "MERGE_METHOD_RESTRICTED",
          `Repository does not allow configured ${method} merging`,
          "repository policy",
        );
      const target = e.target_branch ?? p.target_branch;
      const rulePages = yield* this.forge.json(p, Schema.Array(Schema.Array(RuleSchema)), [
        "api",
        `repos/${repo.full_name}/rules/branches/${encodeURIComponent(target)}?per_page=100`,
        "--paginate",
        "--slurp",
      ]);
      if (!rulePages.length)
        return observe(
          waiting(
            "CHECK_POLICY_UNCONFIRMED",
            "Missing applicable rule pagination evidence",
            "repository policy",
          ),
          false,
        );
      const rules = rulePages.flat();
      const known = new Set([
        "creation",
        "update",
        "deletion",
        "required_linear_history",
        "required_signatures",
        "pull_request",
        "required_deployments",
        "required_status_checks",
        "non_fast_forward",
        "merge_queue",
        "workflows",
        "required_workflows",
        "commit_message_pattern",
        "commit_author_email_pattern",
        "committer_email_pattern",
        "branch_name_pattern",
        "tag_name_pattern",
        "file_path_restriction",
        "max_file_path_length",
        "file_extension_restriction",
        "max_file_size",
        "code_scanning",
        "copilot_code_review",
      ]);
      if (rules.some((rule) => !known.has(rule.type)))
        return observe(
          waiting(
            "CHECK_POLICY_UNCONFIRMED",
            "An applicable rule type is unsupported; inspect repository policy",
            "repository policy",
          ),
          false,
        );

      if (!checksOnly && rules.some((r) => r.type === "merge_queue"))
        gate ??= waiting(
          "MERGE_QUEUE_REQUIRED",
          "Repository requires a merge queue; queue delivery is unsupported",
          "repository policy",
        );
      if (
        !checksOnly &&
        method === "merge" &&
        rules.some((r) => r.type === "required_linear_history")
      )
        gate ??= waiting(
          "MERGE_METHOD_RESTRICTED",
          "Linear history conflicts with configured merge commits",
          "repository policy",
        );
      if (rules.some((r) => ["workflows", "required_workflows"].includes(r.type)))
        return observe(
          waiting(
            "CHECK_POLICY_UNCONFIRMED",
            "Required workflow policy needs an explicit supported check identity",
            "repository policy",
          ),
          false,
        );
      for (const rule of rules.filter((r) => r.type === "pull_request")) {
        const review = yield* decode(
          Schema.Struct({
            required_approving_review_count: Count,
            require_code_owner_review: Schema.Boolean,
          }),
          rule.parameters,
          "GitHub pull-request rule",
        );
        if (
          !checksOnly &&
          (review.required_approving_review_count > 0 || review.require_code_owner_review) &&
          pr.reviewDecision !== "APPROVED"
        )
          gate ??= waiting(
            "REVIEW_REQUIRED",
            "Applicable rules require approved forge review",
            "reviewers",
          );
      }
      for (const rule of rules.filter((r) => r.type === "required_status_checks")) {
        const parameters = yield* decode(
          RequiredParameters,
          rule.parameters,
          "GitHub required-status-check rule",
        );
        requirements.push(
          ...parameters.required_status_checks.map((r) => ({
            context: r.context,
            ...(r.integration_id && r.integration_id > 0 ? { app_id: r.integration_id } : {}),
          })),
        );
      }
      const [owner, name] = repo.full_name.split("/");
      const protection = (yield* this.forge.json(p, ProtectionSchema, [
        "api",
        "graphql",
        "-f",
        `query=${protectionQuery}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-f",
        `ref=refs/heads/${target}`,
      ])).data.repository.ref.branchProtectionRule;
      if (!checksOnly && protection?.requiresLinearHistory && method === "merge")
        gate ??= waiting(
          "MERGE_METHOD_RESTRICTED",
          "Legacy branch protection requires linear history",
          "repository policy",
        );
      if (!checksOnly && protection?.requiresApprovingReviews && pr.reviewDecision !== "APPROVED")
        gate ??= waiting(
          "REVIEW_REQUIRED",
          "Legacy branch protection requires approved review",
          "reviewers",
        );
      if (protection?.requiresStatusChecks) {
        if (!protection.requiredStatusChecks?.length)
          return observe(
            waiting(
              "CHECK_POLICY_UNCONFIRMED",
              "Required legacy check identities are unavailable",
              "repository policy",
            ),
            false,
          );
        requirements.push(
          ...protection.requiredStatusChecks.map((r) => ({
            context: r.context,
            ...(r.app ? { app_id: r.app.databaseId } : {}),
          })),
        );
      }
      confirmed = true;
      checks = yield* observeChecks(this.forge, p, repo.full_name, pr.headRefOid);
      for (const required of requirements) {
        const matches = checks.filter(
          (c) =>
            c.name === required.context &&
            (required.app_id === undefined || c.app_id === required.app_id),
        );
        const label = `${required.context}${required.app_id ? ` (app ${required.app_id})` : ""}`;
        if (!matches.length)
          return observe(
            waiting("CI_REQUIRED", `Missing required check: ${label}`, "forge checks"),
          );
        if (matches.some((c) => c.bucket === "fail" || c.bucket === "cancel"))
          return observe(failed("CI_FAILED", `Required check failed: ${label}`));
        if (matches.some((c) => c.bucket === "pending"))
          return observe(
            waiting("CI_REQUIRED", `Required check pending: ${label}`, "forge checks"),
          );
      }
      if (!checks.length && !allowEmpty)
        return observe(
          waiting(
            "CI_REQUIRED",
            "No checks reported; no-check delivery is not authorized",
            "forge checks",
          ),
        );
      const blocking =
        policy === "all-reported"
          ? checks
          : checks.filter((c) =>
              requirements.some(
                (r) => r.context === c.name && (r.app_id === undefined || r.app_id === c.app_id),
              ),
            );
      const failing = blocking.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
      if (failing.length)
        return observe(
          failed(
            failing.some((c) => c.bucket === "cancel") ? "CI_CANCELLED" : "CI_FAILED",
            `CI checks failed: ${failing
              .slice(0, 10)
              .map((c) => c.name)
              .join(", ")}`,
          ),
        );
      const pending = blocking.filter((c) => c.bucket === "pending");
      if (pending.length)
        return observe(
          waiting(
            "CI_REQUIRED",
            `CI checks pending: ${pending
              .slice(0, 10)
              .map((c) => c.name)
              .join(", ")}`,
            "forge checks",
          ),
        );
      const advisory = checks.filter(
        (c) => !blocking.includes(c) && ["fail", "cancel"].includes(c.bucket),
      );
      if (advisory.length)
        reasons.push(
          `Advisory failures: ${advisory
            .slice(0, 10)
            .map((c) => c.name)
            .join(", ")}`,
        );
      if (!checksOnly && !["CLEAN", "UNSTABLE"].includes(pr.mergeStateStatus))
        return observe(
          waiting("PR_BLOCKED", `Forge merge state is ${pr.mergeStateStatus}`, "repository policy"),
        );
      return observe(ready);
    }.bind(this),
    domainEffect,
  );
}
