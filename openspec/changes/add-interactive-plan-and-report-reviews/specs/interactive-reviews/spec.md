# Spec Delta

## Purpose

Let users provide structured choices and visual design feedback in the context of an exact plan or report, with reliable delivery to Abra for revision.

## ADDED Requirements

### Requirement: Compose document review controls

The app SHALL render single choice, multiselect, visual design choices and comments from a bounded declared review. Edits SHALL remain local until explicit submission. Controls SHALL support keyboard use, narrow screens and enlarged image previews.

#### Scenario: Select a design and features

- **WHEN** a user selects a design, several features and enters a comment
- **THEN** the review retains those values without admitting input until the user submits

### Requirement: Bind feedback to exact retained content

Reviews SHALL identify their exact source and revision. New submissions against superseded reviews or changed planning content MUST fail without losing the draft. Retrying an existing response SHALL reconcile its original identity even after the source changes.

#### Scenario: Planning content changes during review

- **WHEN** the planning document changes before a first submission
- **THEN** submission fails visibly and preserves the original draft

### Requirement: Retain bounded owned design previews

Design previews SHALL use retained PNG, JPEG or WebP assets from source-owned resources, capped at 2 MiB each and 8 MiB per review. Missing or corrupt assets SHALL be explicit and MUST NOT hide other review content. Arbitrary URLs, executable image content and escaped paths MUST be refused.

#### Scenario: Worktree is retired

- **WHEN** the original preview file disappears after publication
- **THEN** the retained verified image remains available independently

### Requirement: Preserve review drafts and response identity

The app SHALL share a draft across mounted presentations of the same exact review and restore it on reload when browser storage is available. Revisions SHALL have separate drafts. Submission SHALL retain an exact response identity before admission; ambiguous results MUST NOT automatically generate another native message.

#### Scenario: Response is lost

- **WHEN** native admission succeeds but its HTTP response is lost
- **THEN** reconciliation returns the original receipt without another native message

### Requirement: Request revision without approval authority

An explicit submission SHALL send the validated choices and source identity to central Abra as a revision request. Receipt acknowledgement SHALL remain distinct from a published revision. Feedback MUST NOT authorize implementation, merge or direct worker prompts.

#### Scenario: Abra publishes a response

- **WHEN** Abra publishes a follow-up review correlated to a submitted response
- **THEN** the app offers the revision while retaining the original source and feedback
