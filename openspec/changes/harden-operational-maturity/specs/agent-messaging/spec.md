# Spec Delta

## MODIFIED Requirements

### Requirement: Validate explicit worker acknowledgements and replies

An assigned worker SHALL be able to acknowledge or answer a retained request with its correlation identity, execution generation, bounded body and optional structured evidence. The expected native sender, current assignment and request eligibility SHALL be validated. An identical duplicate reply SHALL return the existing result; a conflicting duplicate or stale/wrong-sender reply SHALL be refused. Required replies SHALL remain durable obligations until answered or explicitly disposed by an authorized controller action. Acceptance of a new reply SHALL require current authority; an already accepted reply and its evidence SHALL remain readable and valid as historical communication after generation or assignment changes. Escalating a missing response SHALL NOT fabricate a reply or erase the outstanding requirement.

#### Scenario: Current worker answers a request

- **WHEN** the expected assigned worker submits an answer with the retained identity and generation
- **THEN** Abra can retrieve that answer and evidence independently of later progress messages or restart

#### Scenario: Another worker attempts to answer

- **WHEN** a different session or stale generation supplies an otherwise valid correlation identity
- **THEN** the reply is refused and the obligation stays unresolved

#### Scenario: Worker retries after response loss

- **WHEN** the same valid reply is submitted twice
- **THEN** one answer and one business-level resolution are retained

#### Scenario: Accepted reply outlives its generation

- **WHEN** the worker's assignment or control generation changes after a correlated reply was committed
- **THEN** the accepted historical reply remains readable while the replacement cannot submit a new reply under the old authority

## ADDED Requirements

### Requirement: Recover a verified missing response once

A required acknowledgement or answer SHALL remain associated with its original request and expected recipient/generation. The controller SHALL classify native queue, executing, consumed-without-response, failed, interrupted, unavailable, superseded and committed-response states separately. Only positively verified consumption followed by completion of a relevant successful native turn, with no required correlated response, SHALL permit one response-only recovery instruction under existing finite diagnostic authority and execution capacity. The controller SHALL retain its exact identity and content before admission, reference the original request, and validate current assignment, role, generation, location, pause/revocation and prompt authority again at admission. Recovery SHALL NOT repeat the substantive task, create another work item, widen scope or replace the original request. A queued request, possibly running turn, failed/interrupted turn, unavailable outcome or ambiguous consumption/completion ordering MUST NOT trigger a speculative recovery prompt.

#### Scenario: Worker responds normally

- **WHEN** the required acknowledgement or correlated answer is already committed
- **THEN** no recovery prompt is admitted, including when its parent notification has not been delivered

#### Scenario: Worker omits a required answer

- **WHEN** exact consumed-request evidence and a subsequent relevant successful idle outcome establish a missing answer and authority/capacity/budget remain valid
- **THEN** one retained response-only reminder asks the current recipient to answer the original request identity

#### Scenario: Original request is queued or executing

- **WHEN** the original request remains queued or the relevant turn may still be executing
- **THEN** the obligation stays open without a recovery instruction

#### Scenario: Native evidence is ambiguous

- **WHEN** state is unavailable, the prompt is absent after uncertain submission, or failed and succeeded markers have no intervening execution evidence
- **THEN** the controller preserves uncertainty and the original identity without guessing successful consumption or authorizing a replacement prompt

#### Scenario: Recovery cannot bypass a stop or revoked scope

- **WHEN** the recipient is paused, revoked, superseded or outside current session/generation authority before admission
- **THEN** no recovery prompt starts work and the retained request exposes its actual control disposition

### Requirement: Bound response recovery across restart and races

Each original request SHALL have at most one durably identified automatic recovery attempt. Concurrent reconciliation, response loss and restart SHALL reuse that identity and SHALL NOT mint another prompt or reset its budget. Native admission SHALL remain distinct from a response. A correlated reply SHALL resolve the original response requirement; a late reply SHALL remain acceptable only while its original authority is current. Recovery that completes without the required response, fails, or cannot safely proceed SHALL expose one durable actionable escalation, distinguished by missing acknowledgement, missing answer, failure, interruption, unavailable state or stale assignment. Escalation SHALL identify the original request, admitted/uncertain transport, attempt status, last verified native observation and an explicit inspect/retry/resume action. Exhausted budget SHALL retain the same actionable requirement without another model turn. Escalation SHALL remain inspectable until explicitly handled or superseded, even if no optional notification can be admitted.

#### Scenario: Supervisor restarts after reminder admission

- **WHEN** native admission succeeded but the recovery admission receipt was lost
- **THEN** reconciliation observes the same recovery prompt identity and admits no independent second reminder

#### Scenario: Recovery succeeds

- **WHEN** the authorized recipient answers the original request during the reminder turn
- **THEN** the original obligation resolves with its correlated reply and recovery is shown as resolved

#### Scenario: Recovery completes without acknowledgement

- **WHEN** a verified reminder turn completes without the required acknowledgement
- **THEN** one missing-acknowledgement escalation remains actionable across repeated ticks and restart without another automatic prompt

#### Scenario: A reply races recovery reservation

- **WHEN** the response is committed before a reminder is admitted
- **THEN** fresh admission checks suppress the unused reminder and preserve the response without stale-snapshot overwrite

#### Scenario: Recovery budget or native state is unavailable

- **WHEN** the controller cannot safely admit the one reminder because authority, budget or native evidence is unavailable
- **THEN** the original obligation and concrete blocked/escalated reason remain visible without implying the worker ignored the request

### Requirement: Keep resolved history out of recurring transport inspection

Ordinary reconciliation SHALL avoid native admission/history reads for durably answered requests and acknowledged acknowledgement-only requests unless an unresolved cancellation, ownership or checkpoint condition specifically requires them. Historical records SHALL remain available for paginated inspection, replay conflict checks and authorized cancellation. Native activity SHALL be observed independently; a resolved request MUST NOT establish session idleness. Work for a fixed set of active requests SHALL add no recurring native transport I/O as resolved history grows. Observation reuse SHALL be scoped to one reconciliation and MUST NOT supply stale authorization to a mutation.

#### Scenario: One active request follows substantial resolved history

- **WHEN** one unanswered request coexists with 200 resolved requests in the same assignment
- **THEN** recurring transport reads inspect the active request without rechecking every resolved historical admission

#### Scenario: Acknowledgement is not the required answer

- **WHEN** an answer-required request has only an acknowledgement
- **THEN** it remains active for response reconciliation

#### Scenario: Resolved message coexists with running work

- **WHEN** all communication is resolved but the native worker is executing
- **THEN** historical-message filtering does not release capacity or present the worker as idle
