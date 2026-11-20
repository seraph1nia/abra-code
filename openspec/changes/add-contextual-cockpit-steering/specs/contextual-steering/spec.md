# Spec Delta

## Purpose

A developer can ask Abra about the exact work they inspected and return to the evidence that answers their request.

## ADDED Requirements

### Requirement: Attach one selection to the Abra draft

The workspace SHALL let a developer explicitly attach, replace or remove one selection while preserving the question already typed. Navigation, incoming work updates and reload SHALL preserve the draft's original target independently of the open canvas.

#### Scenario: A second task needs attention

- **WHEN** a developer attaches lines from task A, types a question, inspects task B and sends the question
- **THEN** Abra receives the question with task A's selected lines and the sent message identifies task A
- **AND** opening B by itself submits no request and replaces no draft text

#### Scenario: Existing text-only draft

- **WHEN** a developer restores a plain-text draft created before selections were supported
- **THEN** its text remains editable and sendable without any selection

### Requirement: Bind diff questions to the observed content

First submission SHALL verify ownership, comparison, file, side, line range and observed content, and retain a bounded excerpt from that verified source. The sent question SHALL reopen its captured excerpt independently of subsequent worktree or session activity.

#### Scenario: The working copy changes before Send

- **WHEN** the selected file's patch has changed, even if its commit is identical
- **THEN** the question remains editable and the developer can inspect the updated diff to select again or remove the attachment before sending

#### Scenario: An uncommitted selection outlives its worktree

- **WHEN** a sent question about an added or removed line is reopened after retirement
- **THEN** its original side, range, file and excerpt are available and labeled as captured content

#### Scenario: A selection cannot be verified

- **WHEN** the first submission cites a foreign issue resource, an unavailable patch, an out-of-range line or an excerpt exceeding the submission bound
- **THEN** the workspace reports the selection problem, preserves the draft and admits no native input

### Requirement: Reconcile the original selected submission

A single request identity SHALL bind the session, original text, selection and delivery choice before native admission. Identical retries SHALL reconcile that reservation independently of subsequent source changes. Conflicting input SHALL be rejected.

#### Scenario: The response is lost and the selected file changes

- **WHEN** the service restarts after native admission and the developer retries the original request
- **THEN** the developer sees the original receipt and excerpt without another prompt
- **AND** an unprovable admission stays visibly uncertain

#### Scenario: Two tabs reuse the identity with different input

- **WHEN** another tab submits the same request identity with a different selection, delivery choice or question
- **THEN** the original reservation stands and the conflicting attempt cannot replace or duplicate it

### Requirement: Distinguish steering Abra from directing a worker

While Abra is busy the composer SHALL offer queueing and steering the current Abra turn for both plain and selected messages. Queueing SHALL remain the default. Worker handoff SHALL use existing assignment authority and independent request and acknowledgement records.

#### Scenario: The developer steers while a different worker is running

- **WHEN** the developer selects Steer current Abra turn and sends a question about another issue
- **THEN** the delivery is addressed to Abra with the selected issue as context, and only an authorized later handoff delivers it to a worker

### Requirement: Show attributable follow-up

A sent question SHALL distinguish its native admission, any explicitly linked worker acknowledgement, and any explicitly linked answer or evidence revision. The user SHALL be able to open the linked result from the question after reload. Each label requires evidence for that particular relationship.

#### Scenario: Another check succeeds on the same issue

- **WHEN** a check passes after the question but has no retained link to the request
- **THEN** it can appear in the issue's verification results while the question still awaits a correlated response

#### Scenario: Abra delegates and a worker returns evidence

- **WHEN** the authorized worker acknowledges a linked handoff and its answer references an owned check result
- **THEN** the question shows the acknowledgement and offers the exact result, including after restart

### Requirement: Ask about plan criteria and image regions

The same draft and submission interaction SHALL support one selected plan criterion or one region of a retained screenshot. The submitted reference SHALL identify the exact source revision and preserve the passage or marked region on reopening.

#### Scenario: A criterion is revised

- **WHEN** a plan changes after the developer selects a criterion but before first submission
- **THEN** the developer can review the new source or detach the criterion, and a prior sent question still opens its original passage

#### Scenario: The captured screenshot is resized for display

- **WHEN** the developer selects an image region on desktop and reopens the sent message on a smaller screen
- **THEN** the marking identifies the same area on the same retained image

#### Scenario: The developer asks for a plan change

- **WHEN** a criterion question or structured review is submitted
- **THEN** Abra receives the feedback through its existing conversation and any required plan approval still uses the current bound human form
