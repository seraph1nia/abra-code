# execution-coordination Delta

## ADDED Requirements

### Requirement: Controlled planning requires an attributable source baseline

Before controlled Explore admission, the controller SHALL retain an exact reconstructable source baseline bound to execution, repository, worktree identity, change, generation and stable control intent. Dirty content MUST match prior attributable authorized work or exact native human adoption. Replan intent, idle state and native success alone MUST NOT legitimize unknown content. Capture MUST preserve real index, files, HEAD and historical approvals.

#### Scenario: Legitimate dirty Apply work is retained

- **WHEN** idle owned work matches previously retained authorized Apply attribution and controlled replanning is requested
- **THEN** the baseline includes its distinct staged, unstaged and untracked content before Explore admission without committing, staging or rewriting that work
- **AND** planning may change only assigned artifacts relative to that baseline

#### Scenario: Unknown content precedes the replan request

- **WHEN** source content differs from retained attribution or has no sufficient provenance
- **THEN** normal replan refuses to establish it as authorized content and retains current checkpoints and resources for explicit recovery

#### Scenario: Capture changes while being observed

- **WHEN** source, index, HEAD or ownership changes during baseline preparation
- **THEN** admission fails closed without publishing a usable baseline or launching Explore

### Requirement: Planning compares every source view with its retained boundary

Controlled planning SHALL allow only regular, contained artifacts under its exact assigned change to differ from its baseline. Git-defined source edits, deletions, nonignored untracked paths, mode/link changes, index-only mutations and cross-boundary moves MUST be refused. Both staged and candidate views and the existing full fingerprint SHALL be checked. HEAD changes MUST be refused. Validation SHALL apply through plan collection and Apply admission.

#### Scenario: Explore changes outside the assigned change

- **WHEN** any subsequent Git-defined source edit, deletion, nonignored untracked path, executable-mode change, link replacement or cross-boundary move occurs
- **THEN** planning fails with a retained source violation and cannot offer a valid plan approval or admit Apply
- **AND** newline-containing paths and prefix siblings cannot conceal that mutation, while existing filter/ignored/cache/flag limitations are not misrepresented as new filesystem guarantees

#### Scenario: Index changes but final working content does not

- **WHEN** Explore changes a staged source version and restores only the working file
- **THEN** validation detects the separate staged-content delta and refuses advancement

#### Scenario: Source changes while a plan form is pending

- **WHEN** an otherwise valid controlled plan has an open human form and source changes before collection or Apply admission
- **THEN** the form cannot authorize advancement over the changed source

### Requirement: Planning attempts preserve identity through retries and restart

A controlled planning attempt SHALL retain its immutable baseline, intent, original generation, admission bindings and violations across retries, response loss, capacity waits and restart. A new request MUST NOT erase an unresolved attempt or violation. Resume after confirmed pause SHALL retain the same baseline with explicit current ownership. New controlled plans SHALL require fresh checkpoint identity even for identical artifact bytes.

#### Scenario: Response is lost after capture or admission

- **WHEN** the controller restarts after baseline persistence or uncertain prompt submission
- **THEN** recovery reuses the same baseline and retained prompt intent, observes native admission and never recaptures the current tree or starts a second assignment

#### Scenario: Retry follows a source violation

- **WHEN** a retry or a differently keyed replan is requested after an outside-change violation
- **THEN** the old baseline and violation remain authoritative until explicit guarded recovery and no automatic recapture masks the violation

#### Scenario: Identical plan bytes are presented again

- **WHEN** a new controlled planning attempt yields the same artifact bytes as a previously approved plan
- **THEN** its checkpoint has a fresh attempt-bound identity and the previous human receipt remains historical rather than authorizing it

#### Scenario: A paused planning attempt resumes

- **WHEN** an explicit resume follows confirmed stop in a newer control generation
- **THEN** current ownership and the delta are revalidated against the original retained baseline without rewriting its origin or recapturing source

### Requirement: Pre-delivery recovery distinguishes history from prospective adoption

Explicit pre-delivery planning recovery SHALL reuse only an already complete verified retained baseline with its original binding when claiming a historical boundary. If insufficient, it SHALL offer exact current Git-defined content for human adoption as a new baseline, explicitly not historical reconstruction. Historical violations and approvals MUST remain retained. This recovery MUST NOT require fabricated publication or external-run evidence.

#### Scenario: Historical digest exists without content

- **WHEN** a stranded execution retains only a pre-Explore digest, formatter candidate or incomplete diff
- **THEN** recovery does not reconstruct history from today's tree and requires exact prospective adoption or remains stopped

#### Scenario: Complete attributable historical content exists

- **WHEN** independently retained pre-Explore content and its original ownership/admission binding are verified
- **THEN** historical recovery compares the current delta with that actual baseline and refuses any outside-change violation

#### Scenario: Formatting-only planning is falsely alleged to edit source

- **WHEN** planning changes only assigned `design.md`, including table formatting and a comma in its documentation example, over legitimate retained Apply WIP that the old-base guard misattributes to Explore
- **THEN** recovery preserves the historical allegation/error without presenting it as proof of an outside-source edit
- **AND** absent a complete verified old baseline with original binding, historical content is not invented and exact-current-tree native human adoption establishes only a new prospective baseline

#### Scenario: A separate fixture really mutates outside source

- **WHEN** a distinct negative fixture changes a source file outside the assigned planning change after a valid retained baseline
- **THEN** planning remains rejected and its actual outside-source delta and violation remain retained across retry or later prospective adoption

### Requirement: Prospective baseline adoption requires exact native human authority

Adoption SHALL require an answered native human form bound to the exact offered content, staged state, HEAD, execution, repository, worktree, change, generation, intent and violation. Missing, stale, rejected, deferred or mismatching authority MUST fail closed. Consumption SHALL be single-use and retry-safe. Adoption MUST NOT grant Apply, publication, merge or cleanup authority; fresh plan gates, checks and independent Review remain mandatory.

#### Scenario: Human adopts the exact current offer

- **WHEN** a current matching native adoption answer is persisted and explicitly consumed under valid ownership
- **THEN** the controller retains a new prospective planning baseline before admitting planning-only Explore
- **AND** subsequent implementation still requires a distinct current plan approval and the existing checks and independent Review

#### Scenario: Offered content changes

- **WHEN** files, staged content, modes, links, HEAD or bound ownership changes after the offer
- **THEN** the old answer cannot authorize the changed tree and recovery remains stopped without refreshing that offer under the old receipt

#### Scenario: Authority is absent or rejected

- **WHEN** only model prose, a generic decision answer, an old plan receipt, a missing native answer, rejection or defer exists
- **THEN** no adoption baseline is admitted and the current tree and history remain preserved

#### Scenario: Native form response or receipt persistence is lost

- **WHEN** restart occurs before authorization was durably retained
- **THEN** recovery uses the retained form/target identity and requires native human reauthorization if the in-memory answer is unavailable
- **AND** a durably consumed answer reconciles the same attempt rather than creating a second baseline

### Requirement: Planning control preserves ownership and refusal boundaries

Replan and planning recovery SHALL enforce idle/queue, claim, location, directory, branch, generation, pause, custody and admission guards before invalidating evidence or admitting a writer. Busy-writer refusal SHALL retain its native failure without changing the active phase, claim, assignment or checkpoints. Initial Explore, correction and synchronization trust boundaries and budgets MUST remain intact.

#### Scenario: Advance races with a running writer

- **WHEN** explicit advancement observes a busy or completion-pending managed writer
- **THEN** it returns the existing busy refusal without blocking/replacing the assignment, changing its claim or submitting another prompt

#### Scenario: Ownership changes before admission

- **WHEN** a claim, session location, worktree directory/branch or generation no longer matches the prepared intent
- **THEN** baseline persistence or admission is refused without clearing current evidence or stealing ownership

#### Scenario: Pause or external custody is active

- **WHEN** paused/stopping work or external custody is present
- **THEN** replan/recovery cannot implicitly resume it or admit a replacement writer

#### Scenario: Initial or published revision planning is evaluated

- **WHEN** planning belongs to initial Explore, correction or publication synchronization rather than a valid controlled baseline attempt
- **THEN** the existing applicable trusted boundary and authority remain enforced without borrowing a pre-delivery adoption receipt or resetting budgets
