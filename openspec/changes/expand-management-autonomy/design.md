# Design

## Context

This is an unapplied follow-up to the reduced reliability/visibility checkpoint. See [proposal.md](proposal.md) and the parent change's [checkpoint](../harden-operational-maturity/checkpoint.md). Native lead routing and repeated acceptance remain unresolved. The original full plan is retained in `original-scope/`; its checked tasks refer to earlier implementation, not completion of this follow-up.

## Goals / Non-Goals

**Goals:** explicit bounded project-lead authority, atomic accounting, conservative revocation, quiet outcome summaries and evidence-led operational assessment.

**Non-Goals:** starting implementation now, treating a checkpoint as a passed P0 gate, new services/harnesses/schedulers, unrestricted lead authority or paid/comparative runs without separate authorization.

## Decisions

The inherited decisions below are a starting point, not an approved schema migration. Re-audit existing APIs, policies and transaction seams after the prerequisite gate is green; split into smaller changes if warranted.

### 7. Coalesce meaningful outcomes without duplicating notification ownership

The monitor already coalesces events and periodically reconciles. Attention currently batches communication references within one execution, suppresses repeated references and reserves finite diagnostic capacity; it does not provide a cross-task outcome digest. Add a pure classification helper near Attention for silent, digest-worthy and immediate-attention observations. Reuse incident IDs/dispositions as source truth.

Build a bounded deterministic digest over pending existing incidents in a supervision cycle. Elect one existing source incident as the batch anchor; retain the exact source incident IDs on that anchor before admitting one native prompt. Other sources are marked covered only by that retained membership, never handled implicitly. A lost admission receipt retries/observes the anchor prompt ID. Late incidents remain for the next digest. Budget charge is recorded against an identified source before admission, with no new free supervisory budget or duplicate per-source wakeups. If reliable cross-record reservation cannot be expressed with current short coordination commits, introduce only minimal membership on existing incidents and a conservative anchor-first commit protocol; partial reservation is reconciled from the anchor, not a new notification store.

Immediate items keep direct visibility and the existing native human forms independently of the digest slot. Unattended suppresses user-only explanatory wakeups while retaining decisions; returning to attended mode surfaces unresolved important sources once. Manual does not admit automatic routine reasoning. Tests count actual prompt IDs/turns: unchanged polls yield zero, related routine outcomes share one, and no unresolved decision disappears through digest disposition or exhausted budget.

### 8. Put grant authority and intake accounting in the existing SQLite transaction

Current leads persist proposal/notification state through plugin storage, which has no public transaction/CAS. The SQLite graph already atomically creates batches/items/dependencies. Counting budget in the lead record followed by a separate SQL commit would create crash windows and concurrent overspending.

**Chosen extension:** a versioned grant relation in the existing work database, plus a nullable immutable grant/version/lead-registration binding on existing batches. Derive total used tasks through existing `batch_items` joined to the bound batch; do not create a second task store, usage counter ledger or separate database. Index grant-bound batch and item-to-issue lookup paths. A grant row stores schema/version identity, lead ID/registration revision, repositories, allowed task kinds/workflows, maximum new/active tasks, required expiry, scheduling permission and revoked state/time. Grant scopes intersect current registered scope/project policy; no client field can enlarge them. Task kind is a narrow admitted category (investigation or minor correction) validated with the corresponding workflow and retained batch provenance, not a general policy engine.

Only Abra's existing authenticated control path issues/revokes grants. No implicit grants on upgrade; a lead never grants or revises itself. Grant issuance defaults to existing human approval requirements and cannot relax them. A grant binds one registration revision; scope/model/session revisions require an explicit new grant. New total allowance requires explicit new authority, not an automatic budget reset.

**Intake:** validate native caller/current registration in a short coordination section, normalize using WorkIntake, then inside one SQL transaction revalidate active grant/version/expiry, project-policy snapshot, repository/dependency/task-kind/workflow restrictions and remaining total budget. Insert ordinary batch/items/dependencies with the grant binding. Existing request identity returns the original mapping and derived usage after response loss; conflicting content or grant binding fails. An unauthorized lead cannot use a retry to admit work, but Abra can inspect a committed historical receipt after revocation. Keep parent supervisor identity on executions: lead provenance is not worker ownership.

**Scheduling:** `allow_scheduling` permits a request to the existing central scheduler, never a new scheduler or override of global auto-scheduling policy. Define a grant-active task conservatively as a grant-created issue with an existing controller claim and not yet closed/released; paused/approval-waiting tasks count. Check the grant active limit in the same SQLite claim transaction, together with existing unique ownership; existing global/repository/role/retained-resource capacity remains enforced by the controller. This is separate from native compute occupancy. A task admitted but not claimed consumes total budget, not an active slot. Releasing compute alone never frees the grant's active-task slot.

Revocation/expiry denies new **delegated** mutations and automatic grant-based claims. Queued tasks remain ordinary recorded work, visibly awaiting authority; Abra may explicitly start preserved authorized work through its ordinary controller route, retaining provenance and applicable capacity/approval rules. Running work continues under its captured controller authorization. Existing human decisions/Review/merge/retirement gates remain unchanged. Do not automatically cancel/delete already authorized tasks when future lead authority is revoked.

**Cross-store order:** lead disable/scope change first revokes the relevant SQLite grant under controller coordination, then saves the revised plugin registration, then reconciles native stop/queued requests outside coordination. A crash between revocation and registration save fails closed. Grant issuance validates current plugin registration while coordination is held before a synchronous SQL commit. No native API or awaited provider call occurs inside that section. This keeps one authorization order without pretending plugin storage and SQLite form one database transaction.

Alternatives rejected: prompt-only limits are unenforced; plugin counters plus SQL tasks are not atomic; a new usage store duplicates task provenance; grant scheduling directly spawning workers bypasses central admission. Extend current intake/claim contracts, avoiding a generic authorization subsystem.

### 9. Treat revocation and historical work separately

Test idle/active lead, pending proposal, committed delegated batch, queued message, running task and pending human approval at disable/revocation/expiry/scope revision. The transition revokes future control first; native interrupt/cancel confirms only actual queue/stop results. Consumed instructions stay historical and cannot mutate through a revoked native principal. Already committed tasks/proposals/replies remain inspectable, with explicit historical or superseded status.

Lost registration response, idempotent session creation, interruption/model unavailability, answered-before-notified, parent Abra restart and commit-before-receipt all reconcile via existing retained IDs/locks. Preserve retired-session recognition so stale leads cannot masquerade as Abra. Lead prompts/recovery share explicit management capacity and diagnostic budgets; no lead registration by another lead and no recursive wakeup chain. A notification is evidence delivery, never intake authority.

### 10. Simplify only demonstrated overlapping responsibilities

Complete an ownership ledger for Leads, Messages, Attention, Runtime, Advancement and VisualReports: persisted writes, native effects, lock ordering, idempotence, permission checks and crash windows. Trace lock order from controller coordination to per-execution/per-lead/attention/report operations; avoid acquiring an outer operation lock while holding coordination. Await native calls/report builds outside global coordination. Target concurrent message/lead changes, long report builds alongside scheduler admission, stale result commits and interrupted reservations.

Extract small pure helpers only for actually shared semantics (candidate selection, correlation equality, grant evaluation/accounting, notification classification, compatibility). Keep service-owned persistence/native effects in the service; no generic rules engine or LOC-driven service split.

Inspect existing hard bounds before extending them: 256 execution communications, 128 lead requests, 32 proposals, 32 retired lead sessions, and current attention/report/round limits. The current code refuses new entries rather than evicting history; preserve unresolved records. Pagination does not make retained arrays unlimited. If soak evidence shows these caps impede sustained operation, add targeted resolved-history pagination/archival within existing stores and prove immutable identity/receipt lookup; never silently truncate unresolved authority or increase limits without measurement.

Measure production LOC, changed files, persistent schema fields/relations, native reads, processes, dependencies and behavioral test coverage before/after. Explain responsibility/crash-path improvements; LOC alone is not maintainability proof.

## Risks / Trade-offs

Grant accounting must not cross plugin storage and SQLite non-atomically. Revocation must deny future mutations while preserving admitted tasks and human approvals. Digests must preserve durable source identities and cannot resolve decisions. Existing retention/lock pressure needs measurement before adding abstractions or state. Native acceptance failures in the parent change block autonomy expansion.

## Migration Plan

First obtain independent review and clean repeated reliability acceptance on frozen source. Then request explicit application of this change, revalidate grant/accounting design and implement focused increments. No grants or authority are seeded on upgrade. Preserve ordinary task ownership and historical receipts after expiry/revocation. Real-provider and Firstmate execution stay optional and separately authorized.
