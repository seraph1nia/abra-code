# Design

## Context

The operator narrowed this cycle on 2026-10-18 after reliability and visibility implementation. See [audit.md](audit.md), [implementation.md](implementation.md) and [checkpoint.md](checkpoint.md). The superseded full design and task list are preserved in `../expand-management-autonomy/original-scope/`.

## Goals / Non-Goals

**Goals:** checkpoint implemented message reliability, finite response recovery, measured reconciliation improvements, isolated operational tooling and read-only native fleet visibility. Retain failures and incomplete acceptance plainly.

**Non-Goals:** delegation grants, autonomous task intake, grant migrations, cross-task notification digests, recursive management, further retention/refactoring expansion and real-provider/Firstmate execution. These require a separate change and authorization. No additional work package starts in this checkpoint.

## Decisions

### Preserve authority and identity in existing request records

Messages owns worker requests; Leads owns scoped management requests; shared request contracts enforce immutable identity and accepted response history. Native admission, explicit acknowledgement and correlated answer remain separate. Historical accepted replies remain readable after generation changes; current session/role/generation/location checks authorize new mutations. Native guards require retained controller intent, exact prompt/delivery and current ownership.

### Spend one irreversible response-recovery slot

A verified consumed request followed by its bound successful native completion can reserve one response-only reminder. Pending native completion, queued/running work, failure, interruption and unavailable evidence cannot authorize a speculative reminder. Existing diagnostic and worker/management capacity apply, with fresh pause/revocation checks. The original request remains the response identity. Recovery uses optional request metadata, not another work item or database. An exhausted or unsafe attempt leaves one durable actionable incident or lead-parent escalation receipt.

### Treat native observation uncertainty conservatively

Runtime distinguishes actual busy/queue state from transient incomplete completion observations. `completion_pending` is derived, not persisted authority. Worker observation preserves capacity and the response obligation across mismatched session/active/inbox/context snapshots. Exact native identities reconcile receipt loss; no replacement prompt is inferred from missing success evidence.

### Keep resolved history off the transport hot path

Batch native admission lookup and per-reconciliation observations eliminate repeated terminal-message inspection. Reads are invalidated on mutation and do not become a long-lived authority cache. Assignment execution is observed independently of message disposition. The 35-case before/after benchmark retains adapter-call counts and explicitly separates fixture timings from service/provider latency.

### Derive native visibility without another fleet store

Pure fleet classification projects existing issues, execution state, decisions, attention and native observations. Completion counts query existing work events using host-local calendar-day boundaries and an index, independently of the visible closed page. Native observation coverage remains explicit and bounded. Lead inspection isolates malformed observer records while mutation authorization stays fail-closed. Lazy paginated communication links existing Decisions and exposes native admission separately from acknowledgement and answer. Observer RPCs remain read-only; conversation and protected actions return to Abra/native forms.

### Keep operational testing opt-in and isolated

The bounded runner reuses disposable native installations, local remotes and deterministic providers. It validates scenario receipts and recorded resource cleanup, emits redacted external evidence and records unavailable usage as unknown. Linux resource probing includes children spawned by service threads and recorded report process groups. Measurement hooks exist only in disposable fixture copies. No production process or background service is added.

## Risks / Trade-offs

- Latest default native E2E failed in lead-decision routing. A subsequent fixture-only routing attempt timed out and was reverted; the underlying routing/capacity race remains unresolved.
- Repeated full native soak is not green. One complete cycle passed; the second main journey failed and the runner summary is incomplete. Earlier report-readiness intermittence and management-capacity refusal have not been causally resolved.
- Native uncertainty favors retained obligations over speculative work, which can require explicit inspection.
- Array retention limits remain unchanged and fail visibly rather than evicting unresolved authority. Multi-day/provider behavior is unverified.
- Disabled/stopping lead display precedence and closed-history fallback communication summary are known UI limitations. Further artifact shortcuts and cross-task digests are deferred.
- Measured lock/scheduler/CPU maxima do not establish production latency or idle performance guarantees. Provider usage and actual comparative model quality remain unmeasured.

## Migration Plan

Existing records without recovery metadata decode with no attempt and no added authority. SQLite remains at its existing version with one additional index; no grant migration occurs. Normal controller controls govern pause/stop and safe reconciliation. Preserve receipts and native identities during rollback; do not delete recovery evidence to force replay. This is a local checkpoint with an open acceptance gate, not a deployment or archive.
