import { Clock, Effect, Exit, Fiber, Ref, Result, Scope, Semaphore } from "effect";
import type {
  InboxPage,
  InboxQuery,
  InboxTarget,
} from "@abracode/contracts/visibility/github-inbox";
import { CrewError, ensure, type Config, type Project } from "../domain.ts";
import { sha256Json } from "../digest.ts";
import { domainEffect } from "../effect.ts";
import type { Records } from "../storage/store.ts";
import type { SessionId } from "@abracode/contracts/identities";
import { InboxForge, githubHosts, inboxOrigin, type InboxOrigin } from "../git/inbox.ts";
import type { WorkAdmission } from "../workflow/admission.ts";
import {
  indexEffect,
  freshMs,
  dayMs,
  type InboxIndex,
  type Scan,
  type DeliveryLink,
} from "./inbox-index.ts";
import { InboxDetailCache } from "./inbox-cache.ts";
import { assignInboxWork } from "./inbox-assign.ts";

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

/** Compute a finite high-water-mark timestamp across items without NaN propagation or call-stack spread. */
export function computeHighWatermark(
  base: number,
  items: readonly { readonly updated_at: string }[],
) {
  let high = Number.isFinite(base) ? base : 0;
  const times: number[] = [];
  for (const item of items) {
    const parsed = Date.parse(item.updated_at);
    if (!Number.isFinite(parsed)) continue;
    times.push(parsed);
    if (parsed > high) high = parsed;
  }
  return { high, times };
}

export class GithubInbox {
  private readonly scope = Scope.makeUnsafe();
  private readonly permits = Semaphore.makeUnsafe(2);
  private readonly runningRef = Ref.makeUnsafe<ReadonlyMap<string, Fiber.Fiber<void, CrewError>>>(
    new Map(),
  );
  private readonly refreshFailures = Ref.makeUnsafe<ReadonlyMap<string, CrewError>>(new Map());
  private readonly details = new InboxDetailCache();
  private published?: { revision: string; rows: DeliveryLink[] };
  constructor(
    private remote: InboxForge,
    private index: InboxIndex,
    private records: Records,
    private admission: WorkAdmission,
    private config: Config,
  ) {}
  private get running() {
    return Effect.runSync(Ref.get(this.runningRef));
  }
  close = () => this.details.clear().pipe(Effect.andThen(Scope.close(this.scope, Exit.void)));
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
  private recordFailure(job: Job, prior: Scan, now: number, error: CrewError) {
    return Effect.gen({ self: this }, function* () {
      const denied = error.code === "INBOX_ACCESS" || error.code === "INBOX_AUTH";
      const retry = now + (error.code === "INBOX_LIMIT" ? 3600000 : 60000);
      if (denied) {
        yield* indexEffect(() => this.index.revoke(job.partition, retry, error.message));
        yield* this.details.clear();
        return;
      }
      if (yield* indexEffect(() => this.index.cooldown(job.partition, now))) return;
      yield* indexEffect(() =>
        this.index.failedScan(
          job.stream,
          {
            ...prior,
            attempt: now,
            retry,
            denied,
            error: error.message,
            ...(error.code === "INBOX_CURSOR" ? { cursor: undefined } : {}),
          },
          error.code === "INBOX_LIMIT" ? job.credential : undefined,
        ),
      );
    });
  }
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
        const observed = yield* domainEffect(
          Effect.gen({ self: this }, function* () {
            const page = yield* this.remote.page(
              job.p,
              job.o,
              job.kind,
              mode,
              prior.cursor,
              job.label,
            );
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
            return page;
          }),
        ).pipe(Effect.result);
        if (Result.isFailure(observed))
          return yield* this.recordFailure(job, prior, now, observed.failure);
        const page = observed.success;
        if (yield* indexEffect(() => this.index.cooldown(job.partition, now))) return;
        const { high, times } = computeHighWatermark(
          resume ? prior.high : prior.watermark,
          page.items,
        );
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
        yield* indexEffect(() =>
          this.index.page(
            job.stream,
            job.partition,
            page.items,
            next,
            now,
            !cursor && mode === "open" && !job.label ? { kind: job.kind, start } : undefined,
          ),
        );
      }),
    );
  }
  private start(job: Job, background: boolean) {
    return Effect.gen({ self: this }, function* () {
      const existing = (yield* Ref.get(this.runningRef)).get(job.stream);
      if (existing) return existing;
      let launched: Fiber.Fiber<void, CrewError> | undefined;
      const task = Effect.gen({ self: this }, function* () {
        const now = yield* Clock.currentTimeMillis;
        const prior = yield* this.state(job, now);
        if (prior.retry <= now) yield* this.page(job, prior, now);
      }).pipe(
        this.permits.withPermits(1),
        Effect.tapError((error) =>
          background
            ? // A warm reader already returned its cached page. Surface the failed refresh on its next read.
              Ref.update(this.refreshFailures, (map) => {
                const next = new Map(map);
                next.set(job.partition, error);
                return next;
              })
            : Effect.void,
        ),
        Effect.ensuring(
          Ref.update(this.runningRef, (map) => {
            if (launched && map.get(job.stream) !== launched) return map;
            const next = new Map(map);
            next.delete(job.stream);
            return next;
          }),
        ),
      );
      const fiber = yield* task.pipe(Effect.forkIn(this.scope, { startImmediately: false }));
      launched = fiber;
      yield* Ref.update(this.runningRef, (map) => {
        const next = new Map(map);
        next.set(job.stream, fiber);
        return next;
      });
      return fiber;
    });
  }
  private state(job: Job, now: number) {
    return indexEffect(() => {
      const prior = this.index.scan(job.stream) ?? empty;
      const denied = this.index.cooldown(job.partition, now);
      const limit = denied ?? this.index.cooldown(job.credential, now);
      return limit ? { ...prior, ...limit, denied: !!denied } : prior;
    });
  }
  list = (q: InboxQuery = {}) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const now = yield* Clock.currentTimeMillis;
        const jobs: Job[] = [],
          errors: Coverage[] = [];
        const keys = new Map<string, string | undefined>();
        let selected = false;
        const hosts = yield* githubHosts;
        for (const p of yield* this.records.projects()) {
          if (q.repository_id && q.repository_id !== p.id) continue;
          const o = inboxOrigin(p, hosts);
          if (!o) continue;
          selected = true;
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
              (yield* indexEffect(
                () =>
                  !this.index.scan(baseline)?.last || this.index.needsLabelScan(partition, kind),
              ))
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
        if (q.repository_id && !selected)
          return yield* new CrewError("INBOX_PROJECT", "Select an onboarded GitHub project");
        const failure = yield* Ref.modify(this.refreshFailures, (map) => {
          for (const { partition } of jobs) {
            const found = map.get(partition);
            if (found) {
              const next = new Map(map);
              next.delete(partition);
              return [found, next] as const;
            }
          }
          return [undefined, map] as const;
        });
        if (failure) return yield* failure;
        const states = yield* Effect.forEach(jobs, (job) =>
          this.state(job, now).pipe(Effect.map((prior) => ({ job, prior }))),
        );
        if (q.refresh)
          for (const entry of states) {
            if (entry.prior.last && !entry.prior.cursor && entry.prior.retry <= now) {
              entry.prior = { ...entry.prior, requested: true };
              yield* indexEffect(() => this.index.save(entry.job.stream, entry.prior));
            }
          }
        const due = states.filter(
          ({ prior }) =>
            prior.retry <= now &&
            (prior.cursor || !prior.last || prior.requested || now - prior.last >= freshMs),
        );
        due.sort((a, b) => a.prior.attempt - b.prior.attempt);
        const cold = states.every(({ prior }) => !prior.last && !prior.cursor);
        const fibers = yield* Effect.forEach(due.slice(0, 2), ({ job }) => this.start(job, !cold));
        if (cold) yield* Effect.forEach(fibers, (f) => Fiber.join(f));
        const active = yield* Ref.get(this.runningRef);
        const coverage: Coverage[] = [...errors];
        const scopes = new Set<string>();
        for (const { job } of states) {
          const state = yield* this.state(job, now);
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
                : state.requested || active.has(job.stream) || now - state.last >= freshMs
                  ? "stale"
                  : "current",
            observed_at: state.last || undefined,
            message: state.error,
          });
        }
        const deliveries = yield* this.deliveries();
        const found = yield* indexEffect(() => this.index.find([...scopes], q, deliveries));
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
        const key = sha256Json([
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
        const denied = yield* indexEffect(() => this.index.cooldown(partition, now));
        if (denied) return yield* new CrewError("INBOX_ACCESS", denied.error);
        const read = domainEffect(
          Effect.gen({ self: this }, function* () {
            const observedAt = yield* Clock.currentTimeMillis;
            const limit = yield* indexEffect(() => this.index.cooldown(credential, observedAt));
            if (limit) return yield* new CrewError("INBOX_LIMIT", limit.error);
            const data = yield* this.remote.detail(p, o, target).pipe(
              Effect.tapError((error) =>
                Effect.gen({ self: this }, function* () {
                  if (error.code === "INBOX_LIMIT")
                    yield* indexEffect(() =>
                      this.index.backoff(credential, observedAt + 3600000, error.message),
                    );
                  if (error.code === "INBOX_ACCESS") {
                    yield* this.details.clear();
                    yield* indexEffect(() =>
                      this.index.revoke(partition, observedAt + 60000, error.message),
                    );
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
              !(yield* indexEffect(() => this.index.cooldown(partition, observedAt))),
              "INBOX_ACCESS",
              "Repository access changed during detail read",
            );
            return { at: observedAt, data };
          }),
        );
        const hit = yield* this.details.observe(key, force, read);
        const deliveries = yield* this.deliveries();
        return {
          ...hit.data,
          observed_at: hit.at,
          links: yield* indexEffect(() => this.index.links(hit.data, deliveries)),
        };
      }),
    );
  assign = (target: InboxTarget, session: SessionId, instructions = "") =>
    assignInboxWork(
      {
        remote: this.remote,
        index: this.index,
        admission: this.admission,
        config: this.config,
        detail: this.detail,
        project: this.project,
      },
      target,
      session,
      instructions,
    );
}
