# Spec Delta

## ADDED Requirements

### Requirement: Establish cleanup readiness before merge

An execution SHALL inspect its exact owned worktree before requesting a new merge approval and again before controller merge. The preflight SHALL distinguish deliverable edits, authorized generated directories, unexpected residue and unsafe or unavailable inspection. Authorized generated directories SHALL be inspected for existing retirement safety constraints without deleting them before verified preservation. Unexpected files SHALL create a durable disposition question through Abra and prevent controller merge until resolved. Path samples SHALL remain bounded, safely encoded and explicitly marked when incomplete; a sample or a filename MUST NOT be treated as exhaustive disposal authority. Retirement SHALL inspect again after preservation rather than trusting preflight as proof that no new files exist.

#### Scenario: Build produces only authorized generated output

- **WHEN** the deliverable worktree is synchronized and its only residue is contained in authorized generated directories that pass safety inspection
- **THEN** preflight permits merge readiness and retains the generated output for disposal after preservation without another cleanup question

#### Scenario: An ignored note is found before approval

- **WHEN** an ignored local note remains outside authorized generated directories
- **THEN** Abra presents a retained decision naming the note and clearing action before offering a new merge approval, and the note is neither silently committed nor deleted

#### Scenario: Approval is pending when new residue appears

- **WHEN** an unexpected path appears after preflight while a matching merge approval is pending or accepted
- **THEN** merge remains blocked on fresh disposition even though the exact-head approval receipt itself remains retained

#### Scenario: Inventory is incomplete

- **WHEN** inspection fails, exceeds its bounds or yields only a truncated sample insufficient for disposition
- **THEN** readiness remains unconfirmed and the controller does not authorize disposal of omitted paths

### Requirement: Generated-directory exceptions have execution-specific authorization

The system SHALL offer native user authorization through Abra for exact additional generated directories in a blocked execution. Authorization SHALL identify the execution generation, owned worktree identity, exact selected directories and applicable inspection evidence; it SHALL state that those directories' generated contents may be disposed of after preservation. The receipt MUST NOT alter project defaults or authorize other paths, another execution or a replacement directory. An arbitrary question answer, worker statement or diagnostic disposition MUST NOT grant deletion authority. Existing exclusions for broad paths, control paths, tracked descendants, nested repositories, escaping links and unsafe resources SHALL remain enforced before authorization and again before removal. Authorized generated directories can contain newly regenerated output under that explicit directory policy, but replacement directory identity or newly unsafe contents SHALL invalidate its applicability.

#### Scenario: Dependency output was omitted from the captured policy

- **WHEN** an exact owned generated dependency directory passes inspection and the user authorizes its execution-specific disposal through the native form
- **THEN** the controller retains that authorization, reruns readiness and later removes only that directory after verified preservation without requiring manual shell cleanup or changing repository defaults

#### Scenario: A later configuration edit lists the directory

- **WHEN** repository defaults are broadened while an existing execution is blocked
- **THEN** that execution still requires its own applicable captured policy or explicit execution-specific authorization

#### Scenario: Selected directory becomes unsafe

- **WHEN** an authorized directory is replaced or contains tracked content, a nested repository or an escaping link before disposal
- **THEN** the controller preserves it, rejects the old authorization's use and surfaces the applicable safety blocker

#### Scenario: Remaining item is an ordinary file

- **WHEN** a remaining file is not covered by an authorized generated directory
- **THEN** the controller offers an explicit delivery-inclusion or preserve-and-reinspect decision as applicable and does not widen directory authorization into arbitrary file deletion

#### Scenario: User chooses inclusion in delivery

- **WHEN** a user explicitly selects a retained file for inclusion in the ticket's deliverable
- **THEN** the file enters scope assessment, verification, Review and publication before merge; ignored-file inclusion requires exact-path authorization and never indiscriminate force staging

### Requirement: Disposition resumes finalization without another finish request

An accepted and still-applicable disposition SHALL cause eligible reconciliation to refresh readiness or resume cleanup automatically. Deferral or intentional pause SHALL preserve files and suppress dependent mutation. After preservation, cleanup SHALL revalidate quiescence, resource identity, applicable directory authorizations and deliverable preservation, remove only authorized generated output, retire through the non-force native interface and close only after confirmed retirement. Resolution of a cleanup blocker SHALL not require another merge or a fresh approval for unchanged delivered content.

#### Scenario: Generated-directory approval resolves the final blocker

- **WHEN** the matching native disposal authorization is accepted and no other blocker or pause remains
- **THEN** reconciliation continues through the applicable merge and cleanup checkpoints to verified closure without a user-issued finish command

#### Scenario: User preserves an unexpected file elsewhere

- **WHEN** the user selects preservation and later inspection proves the unexpected file has been explicitly moved out of the owned worktree
- **THEN** reconciliation clears the matching blocker and resumes eligible finishing without interpreting the selection alone as proof that preservation happened

#### Scenario: New residue appears after merge

- **WHEN** post-preservation inspection finds new unexpected files absent from the successful preflight
- **THEN** delivery remains verified, the files are retained, and a mandatory decision is presented without repeating merge or treating the earlier preflight as deletion permission
