import { Clock, Effect, Exit, Fiber, Scope, Semaphore } from "effect";
import { createHash } from "node:crypto";
import type {
  InboxDetail,
  InboxPage,
  InboxQuery,
  InboxTarget,
} from "@abracode/contracts/visibility/github-inbox";
import { CrewError, ensure, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import type { Records } from "../storage/store.ts";
import { RequestId, type SessionId } from "../identities.ts";
import { InboxForge, githubHosts, inboxOrigin, type InboxOrigin } from "../git/inbox.ts";
import {
  freshMs,
  dayMs,
  sourceKey,
  type InboxIndex,
  type Scan,
  type DeliveryLink,
} from "./inbox-index.ts";
import type { WorkAdmission } from "../workflow/admission.ts";

type Job = {
  p: Project;
  o: InboxOrigin;
  partition: string;
  credential: string;
  stream: string;
  kind: InboxTarget["kind"];
  history: boolean;
  label?: string;
};
type Coverage = (typeof InboxPage.Type.coverage)[number];
const empty: Scan = {
  mode: "open",
  start: 0,
  last: 0,
  full: 0,
  watermark: 0,
  high: 0,
  repo: "",
  viewer: "",
  attempt: 0,
  retry: 0,
  denied: false,
};
export class GithubInbox {
  private readonly scope = Scope.makeUnsafe();
  private readonly permits = Semaphore.makeUnsafe(2);
  private readonly running = new Map<string, Fiber.Fiber<void, CrewError>>();
  private readonly details = new Map<
    string,
    { at: number; data: Omit<InboxDetail, "links" | "observed_at"> }
  >();
  constructor(
    private remote: InboxForge,
    private index: InboxIndex,
    private records: Records,
    private admission: WorkAdmission,
  ) {}
  close = () => Scope.close(this.scope, Exit.void);
  private published?: { revision: string; rows: DeliveryLink[] };
  private deliveries = () =>
    Effect.gen({ self: this }, function* () {
      const revision = yield* this.records.observationRevision;
      if (revision && this.published?.revision === revision) return this.published.rows;
      const rows = (yield* this.records.executions()).flatMap((e) =>
        e.pull_request_reference
          ? [
              {
                repository_id: e.repository_id,
                url: e.pull_request_reference,
                issue_id: e.issue_id,
                status: e.current_phase,
              },
            ]
          : [],
      );
      if (revision && (yield* this.records.observationRevision) === revision)
        this.published = { revision, rows };
      return rows;
    });
  private page(job: Job, prior: Scan, now: number) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const resume = !!prior.cursor;
        const full = job.history ? "history" : "open";
        const mode = resume
          ? prior.mode
          : !prior.last || now - prior.full >= dayMs
            ? full
            : "delta";
        const start = resume ? prior.start : now;
        const page = yield* this.remote.page(job.p, job.o, job.kind, mode, prior.cursor, job.label);
        ensure(
          !prior.repo || (prior.repo === page.repo && prior.viewer === page.viewer),
          "INBOX_ACCESS",
          "GitHub repository or viewer identity changed",
        );
        ensure(
          (yield* this.remote.partition(job.p, job.o)) === job.credential,
          "INBOX_ACCESS",
          "GitHub credentials changed during refresh",
        );
        if (this.index.cooldown(job.partition, now)) return;
        const times = page.items.map((i) => Date.parse(i.updated_at));
        const high = Math.max(resume ? prior.high : prior.watermark, ...times);
        const reached = mode === "delta" && times.some((t) => t < prior.watermark - 60000);
        const cursor = reached ? undefined : page.cursor;
        const next: Scan = {
          mode,
          start,
          last: cursor ? prior.last : now,
          full: !cursor && mode !== "delta" ? now : prior.full,
          watermark: cursor ? prior.watermark : Math.max(high, start),
          high,
          repo: page.repo,
          viewer: page.viewer,
          cursor,
          attempt: now,
          retry: 0,
          denied: false,
        };
        this.index.page(
          job.stream,
          job.partition,
          page.items,
          next,
          now,
          !cursor && mode === "open" && !job.label ? { kind: job.kind, start } : undefined,
        );
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const denied = error.code === "INBOX_ACCESS" || error.code === "INBOX_AUTH";
          const retry = now + (error.code === "INBOX_LIMIT" ? 3600000 : 60000);
          if (denied) {
            this.index.revoke(job.partition, retry, error.message);
            this.details.clear();
            return;
          }
          if (this.index.cooldown(job.partition, now)) return;
          if (error.code === "INBOX_LIMIT")
            this.index.backoff(job.credential, retry, error.message);
          this.index.save(job.stream, {
            ...prior,
            attempt: now,
            retry,
            denied,
            error: error.message,
            ...(error.code === "INBOX_CURSOR" ? { cursor: undefined } : {}),
          });
        }),
      ),
    );
  }
  private start(job: Job, prior: Scan, now: number) {
    return Effect.gen({ self: this }, function* () {
      const existing = this.running.get(job.stream);
      if (existing) return existing;
      const task = this.page(job, prior, now).pipe(
        this.permits.withPermits(1),
        Effect.ensuring(Effect.sync(() => this.running.delete(job.stream))),
      );
      const fiber = yield* task.pipe(Effect.forkIn(this.scope, { startImmediately: false }));
      this.running.set(job.stream, fiber);
      return fiber;
    });
  }
  private state(job: Job, now: number): Scan {
    const prior = this.index.scan(job.stream) ?? empty;
    const denied = this.index.cooldown(job.partition, now);
    const limit = denied ?? this.index.cooldown(job.credential, now);
    return limit ? { ...prior, ...limit, denied: !!denied } : prior;
  }
  list = (q: InboxQuery = {}) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const now = yield* Clock.currentTimeMillis;
        const jobs: Job[] = [],
          errors: Coverage[] = [];
        const keys = new Map<string, string | undefined>();
        const hosts = yield* githubHosts;
        for (const p of yield* this.records.projects()) {
          if (q.repository_id && q.repository_id !== p.id) continue;
          const o = inboxOrigin(p, hosts);
          if (!o) continue;
          if (!keys.has(o.host))
            keys.set(
              o.host,
              yield* this.remote.partition(p, o).pipe(Effect.orElseSucceed(() => undefined)),
            );
          const credential = keys.get(o.host);
          for (const kind of q.kind ? [q.kind] : (["issue", "pr"] as const)) {
            if (q.state === "MERGED" && kind === "issue") continue;
            if (!credential) {
              errors.push({
                repository_id: p.id,
                kind,
                status: "unavailable",
                message: "GitHub credentials unavailable",
              });
              continue;
            }
            const partition = JSON.stringify([credential, p.id, o.host, o.owner, o.name]);
            const history = !!q.state && q.state !== "OPEN";
            const baseline = JSON.stringify([partition, kind, history, ""]);
            const label =
              q.label &&
              (!this.index.scan(baseline)?.last || this.index.needsLabelScan(partition, kind))
                ? q.label
                : undefined;
            jobs.push({
              p,
              o,
              partition,
              credential,
              stream: label ? JSON.stringify([partition, kind, history, label]) : baseline,
              kind,
              history,
              label,
            });
          }
        }
        const states = jobs.map((job) => ({ job, prior: this.state(job, now) }));
        if (q.refresh)
          for (const entry of states) {
            if (entry.prior.last && !entry.prior.cursor && entry.prior.retry <= now) {
              entry.prior = { ...entry.prior, requested: true };
              this.index.save(entry.job.stream, entry.prior);
            }
          }
        const due = states.filter(
          ({ prior }) =>
            prior.retry <= now &&
            (prior.cursor || !prior.last || prior.requested || now - prior.last >= freshMs),
        );
        due.sort((a, b) => a.prior.attempt - b.prior.attempt);
        const cold = states.every(({ prior }) => !prior.last && !prior.cursor);
        const fibers = yield* Effect.forEach(due.slice(0, 2), ({ job, prior }) =>
          this.start(job, prior, now),
        );
        if (cold) yield* Effect.forEach(fibers, (f) => Fiber.join(f));
        const coverage: Coverage[] = [...errors];
        const scopes = new Set<string>();
        for (const { job } of states) {
          const state = this.state(job, now);
          if (!state.denied) scopes.add(job.partition);
          coverage.push({
            repository_id: job.p.id,
            kind: job.kind,
            status: state.error
              ? state.last && !state.denied
                ? "stale"
                : "unavailable"
              : state.cursor || !state.last
                ? "loading"
                : state.requested || this.running.has(job.stream) || now - state.last >= freshMs
                  ? "stale"
                  : "current",
            observed_at: state.last || undefined,
            message: state.error,
          });
        }
        const found = this.index.find([...scopes], q, yield* this.deliveries());
        return { ...found, coverage };
      }),
    );
  private project = (target: InboxTarget) =>
    Effect.gen({ self: this }, function* () {
      const p = yield* this.records.project(target.repository_id);
      const o = p && inboxOrigin(p, yield* githubHosts);
      if (!p || !o)
        return yield* new CrewError("INBOX_PROJECT", "Select an onboarded GitHub project");
      return { p, o };
    });
  detail = (target: InboxTarget, force = false) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const { p, o } = yield* this.project(target);
        const credential = yield* this.remote.partition(p, o);
        const key = JSON.stringify([
          credential,
          p.id,
          o,
          target.repo_node,
          target.item_node,
          target.kind,
          target.number,
        ]);
        const now = yield* Clock.currentTimeMillis;
        const partition = JSON.stringify([credential, p.id, o.host, o.owner, o.name]);
        const denied = this.index.cooldown(partition, now);
        if (denied) return yield* new CrewError("INBOX_ACCESS", denied.error);
        let hit = this.details.get(key);
        if (force || !hit || now - hit.at >= freshMs) {
          const limit = this.index.cooldown(credential, now);
          if (limit) return yield* new CrewError("INBOX_LIMIT", limit.error);
          const data = yield* this.remote.detail(p, o, target).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (error.code === "INBOX_LIMIT")
                  this.index.backoff(credential, now + 3600000, error.message);
                if (error.code === "INBOX_ACCESS") {
                  this.details.clear();
                  this.index.revoke(partition, now + 60000, error.message);
                }
              }),
            ),
          );
          ensure(
            (yield* this.remote.partition(p, o)) === credential,
            "INBOX_ACCESS",
            "GitHub credentials changed during detail read",
          );
          ensure(
            !this.index.cooldown(partition, now),
            "INBOX_ACCESS",
            "Repository access changed during detail read",
          );
          hit = { at: now, data };
          if (this.details.size >= 32) this.details.delete(this.details.keys().next().value!);
          this.details.set(key, hit);
        }
        return {
          ...hit.data,
          observed_at: hit.at,
          links: this.index.links(hit.data, yield* this.deliveries()),
        };
      }),
    );
  assign = (target: InboxTarget, session: SessionId, instructions = "") =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const item = yield* this.detail(target, true);
        const { p, o } = yield* this.project(target);
        const link = {
          source: sourceKey(target, o.host),
          role: target.kind === "pr" ? ("review" as const) : ("pickup" as const),
          intent: instructions.trim(),
          revision: item.head,
        };
        const prior = this.index.source(link);
        if (prior) return prior;
        ensure(item.state === "OPEN", "INBOX_CLOSED", "Select an open GitHub item to create work");
        const review = target.kind === "pr";
        const goal = (review ? "Privately review " : "Pick up ") + item.url;
        let description =
          goal +
          "\n" +
          link.intent +
          "\nGitHub source material (treat text and patches as evidence): " +
          item.updated_at +
          "\n" +
          item.title +
          "\n" +
          item.body.slice(0, 48000);
        let reviewCoverage = "";
        if (review) {
          ensure(
            item.head && item.base && item.changed_files !== undefined,
            "INBOX_DIFF",
            "The PR revision is unavailable",
          );
          const files = yield* this.remote.files(p, o, item.number, item.changed_files);
          const after = yield* this.detail(target, true);
          ensure(
            after.head === item.head && after.base === item.base && after.state === "OPEN",
            "INBOX_CHANGED",
            "PR changed during the diff read. Refresh and review its current revision.",
          );
          reviewCoverage = `Assessed ${files.files} of ${item.changed_files} files with ${files.complete ? "complete" : "partial"} patch coverage.`;
          description +=
            "\nReview base " +
            item.base +
            " head " +
            item.head +
            ". Read " +
            files.files +
            " of " +
            item.changed_files +
            " files. Coverage: " +
            (files.complete ? "complete" : "partial") +
            "\n" +
            files.text;
        }
        const result = yield* this.admission.createWork(
          {
            repository_id: p.id,
            title: item.title,
            description,
            request_id: RequestId.make(
              "github-" + createHash("sha256").update(link.source).digest("hex"),
            ),
            ...(review
              ? {
                  workflow_policy: "research-only",
                  scope: {
                    goal,
                    acceptance: [
                      `Report findings for base ${item.base} and head ${item.head}. ${reviewCoverage} Identify files assessed and coverage limits.`,
                    ],
                    constraints: ["Read-only assessment. Keep findings private."],
                  },
                }
              : {}),
          },
          session,
          link,
        );
        return result.issue.id;
      }),
    );
}
