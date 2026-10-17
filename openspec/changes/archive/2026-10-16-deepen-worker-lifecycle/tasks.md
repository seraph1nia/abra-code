# Tasks

## 1. Own worker observation and completion

- [x] 1.1 Characterize completion behavior through `Controller`: retain existing busy, interrupted, failed and missing-Review-report coverage, adding only uncovered assertions that completed-role context and structured failure diagnostics survive observation; verify the affected lifecycle and coordination scenarios pass before moving code.
- [x] 1.2 Add shared internal observation and domain dispositions to `WorkerSessions`, move worker outcome interpretation and the existing reconciliation session-directory checks from `Advancement`, and make explicit completion use the module without resubmitting prompts; verify lifecycle/coordination tests preserve error behavior, completed Review context, session-location checks and evidence-gated phase advancement.
- [x] 1.3 Update the module ownership description in `docs/architecture.md` for worker observation/completion; verify it identifies controller-owned policy gates and matches the resulting call sites without describing native success as work completion.

## 2. Own retained admission recovery

- [x] 2.1 Add focused controller characterization for a lost prompt-admission response followed by reconciliation, contrasted with an explicit new turn after a confirmed interruption; verify reconciliation retains the original session/prompt ID and progress age, while the authorized new turn reuses the role session with a fresh prompt ID.
- [x] 2.2 Move session-intent recovery and retained-prompt resubmission into `WorkerSessions`, sharing admission internals without converting recovery into a new-turn launch; verify the lost-session-creation and uncertain-prompt scenarios retain one native admission identity, conservative capacity and current model-selection behavior.
- [x] 2.3 Route background worker reconciliation through the module after the existing role-specific gates, removing duplicate raw native outcome/resubmission branches from `Advancement`; verify Review capacity waits reuse checks, changed verification/plan evidence still prevents the corresponding role admission, and policy/restart tests preserve explicit pause and decision handling. Add a focused stale-evidence capacity-wait scenario only if that behavior is not already covered.
- [x] 2.4 Update `docs/recovery.md` to distinguish retained admission recovery from an authorized new turn; verify the documented identities, reservations and resume behavior match the controller scenarios and existing native adapter contract.

## 3. Share confirmed worker stopping

- [x] 3.1 Characterize foreground pause and restart reconciliation of a pending stop using fixture barriers and controlled native read/interrupt failures; verify inconclusive stopping keeps the request pending, retains conservative active capacity and refuses a replacement writer.
- [x] 3.2 Put native stop confirmation and worker-field release behind `WorkerSessions`, and use one controller helper to persist confirmed stop plus the controller-operation checkpoint from both pause and reconciliation; verify the stop scenarios and held-check coordination test preserve generation rejection, exact queued-prompt cancellation, lock ordering and session/worktree history.
- [x] 3.3 Update the stop/ownership descriptions in `docs/architecture.md` and `docs/recovery.md`; verify they keep stop request, generation advance and exclusive execution ownership in the controller, with no native waits inside shared coordination.

## 4. Verify integration and compatibility

- [x] 4.1 Review the final lifecycle call sites and record diff against the design: verify worker progression no longer interprets native snapshots or resubmits retained prompts in `Advancement`, aside from the deliberately unchanged steering command; verify policy gates and issue transitions remain controller-owned and public tool/native contracts, persisted field names and schema versions are unchanged.
- [x] 4.2 Run `pnpm check`, `pnpm test` and `pnpm test:e2e` with the repository's disposable fixtures; verify all pass, including mixed-policy restart, concurrent Review reporting, capacity, migration, native model inheritance and pause/resume coverage, without pushing to user remotes.
