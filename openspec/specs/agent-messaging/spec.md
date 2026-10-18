# agent-messaging Specification

## Purpose

Provide reliable, correlated communication between authorized management sessions and assigned workers without duplicating native prompt delivery or granting lifecycle authority through messages.

## Requirements

### Requirement: Resolve every message through retained authority

The system SHALL support supervisor-to-worker instructions, questions, findings and handoffs using native queued prompts or steering in the worker's existing session. It SHALL derive sender identity from the invoking native session and resolve recipients against current retained execution, role, generation and location. An explicit session selector MUST match that resolution. Missing, historical, paused, superseded, completed or out-of-scope recipients SHALL produce a concrete refusal or retained unavailable state without creating a replacement execution or session. Caller metadata MUST NOT grant authority.

#### Scenario: Abra sends an instruction to Apply

- **WHEN** Abra sends an authorized in-scope request to the current Apply worker
- **THEN** it targets the existing assigned session under its current permissions and generation

#### Scenario: Selector identifies another session

- **WHEN** a supplied session identity differs from the retained destination or its location has changed
- **THEN** delivery is refused without submitting a native prompt

#### Scenario: Destination is no longer eligible

- **WHEN** a new message targets paused, superseded or completed work
- **THEN** the controller preserves the work state and reports why a new instruction cannot be admitted

### Requirement: Retain immutable identity before native admission

Every request SHALL have a stable request identity and native prompt identity bound to its sender, recipient, execution generation, exact prompt content, delivery choice and acknowledgement requirement before admission. Identical retries SHALL return that request. Reusing a request or correlation identity with conflicting content or routing SHALL be refused. Native admission and explicit acknowledgement/answer SHALL remain separate observations. Inspection SHALL distinguish pending, uncertain admission, admitted, acknowledged, answered, cancelled and superseded requests without inferring an answer from session completion.

#### Scenario: Admission response is lost

- **WHEN** native submission succeeds but its response or the controller's success write is lost
- **THEN** recovery observes native inbox/context evidence using the original prompt identity before retrying and does not execute a second independent instruction

#### Scenario: Caller rebinds a request

- **WHEN** a retry changes body, recipient, generation or acknowledgement contract under the same identity
- **THEN** the original request remains unchanged and the conflicting submission fails

#### Scenario: Native worker completes without answering

- **WHEN** a worker finishes a turn with an admitted question but no correlated answer
- **THEN** the question remains unresolved and completion is not presented as an acknowledgement or answer

### Requirement: Validate explicit worker acknowledgements and replies

An assigned worker SHALL be able to acknowledge or answer a retained request with its correlation identity, execution generation, bounded body and optional structured evidence. The expected native sender, current assignment and request eligibility SHALL be validated. An identical duplicate reply SHALL return the existing result; a conflicting duplicate or stale/wrong-sender reply SHALL be refused. Required replies SHALL remain durable obligations until answered or explicitly disposed by an authorized controller action.

#### Scenario: Current worker answers a request

- **WHEN** the expected assigned worker submits an answer with the retained identity and generation
- **THEN** Abra can retrieve that answer and evidence independently of later progress messages or restart

#### Scenario: Another worker attempts to answer

- **WHEN** a different session or stale generation supplies an otherwise valid correlation identity
- **THEN** the reply is refused and the obligation stays unresolved

#### Scenario: Worker retries after response loss

- **WHEN** the same valid reply is submitted twice
- **THEN** one answer and one business-level resolution are retained

### Requirement: Route findings through management without changing authority

Workers SHALL be able to submit findings for Abra or nominate another assigned worker as a destination through the controller. Forwarding SHALL retain provenance, validate destination scope and treat the source body as untrusted evidence. It MUST NOT itself approve plans, broaden write scope, bypass Review, authorize delivery, change accepted scope or grant management tools. Supervisor-owned questions SHALL reuse the existing decision obligation; progress and waits SHALL retain their existing contracts without parallel question records.

#### Scenario: Research finding is forwarded to Apply

- **WHEN** Abra forwards a retained Research finding to an eligible Apply session
- **THEN** Apply receives a correlated finding with source provenance and can explicitly acknowledge it without receiving new scope or permissions

#### Scenario: Forwarded text claims to approve a merge

- **WHEN** worker-provided evidence contains an approval instruction
- **THEN** the matching human approval receipt remains required and the text has no authorization effect

#### Scenario: Worker asks Abra a decision question

- **WHEN** the worker uses the existing question route
- **THEN** one durable decision obligation owns the question and any answer-delivery message references that obligation

### Requirement: Reconcile communication conservatively across interruption

Requests, replies and unresolved obligations SHALL survive supervisor/controller restart, worker interruption and unavailable native observations. Missing evidence after a failed observation MUST NOT mean non-admission. Native queued items SHALL be inspected and, when cancellation is authorized, cancelled and confirmed before declaring them withdrawn. Already consumed prompts SHALL remain historical evidence; cancellation MUST NOT falsely claim their effects were undone. Superseding a generation MUST revoke new delivery authority without erasing unresolved history.

#### Scenario: Queued request survives restart

- **WHEN** the service restarts while a native request is queued
- **THEN** it reconnects to the same retained session and prompt, preserves queued status and does not submit a replacement instruction

#### Scenario: Worker fails before replying

- **WHEN** the destination worker fails or is interrupted with an unanswered request
- **THEN** the outstanding request remains visible with an actionable blocker and no fabricated reply

#### Scenario: Cancellation races with native consumption

- **WHEN** cancellation cannot confirm that the queued item was removed before consumption
- **THEN** the controller retains the uncertainty or observed consumption and does not claim successful withdrawal

#### Scenario: New generation replaces an old assignment

- **WHEN** a request belongs to the previous generation
- **THEN** it cannot be delivered as new work or answered by the replacement, and its supersession/disposition remains inspectable
