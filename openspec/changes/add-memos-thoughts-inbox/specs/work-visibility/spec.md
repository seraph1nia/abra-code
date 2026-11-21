# Spec Delta

## ADDED Requirements

### Requirement: Browse personal thoughts directly in the workspace

The workspace SHALL offer a Thoughts destination alongside work discovery on desktop and phone. With Memos configured, opening it SHALL show recent memos. Users SHALL be able to filter, page, inspect the selected memo and open its original. Browsing SHALL require zero model calls. The view SHALL distinguish empty results, missing configuration and a failed connection.

#### Scenario: Browse without asking Abra

- **WHEN** the user opens Thoughts on a phone, narrows by text, tag and date and selects a result on a later page
- **THEN** the view displays that memo with a link to the original and the user can return to the filtered results
- **AND** no chat message, work item or agent run is created

#### Scenario: A recent search supersedes an earlier one

- **WHEN** results for a previous search arrive after the user changes a filter
- **THEN** the view keeps the current filter's results and continuation together

#### Scenario: The source is unavailable

- **WHEN** the account cannot authenticate or Memos cannot be reached while searching
- **THEN** the view identifies the connection problem and allows a retry without presenting a successful zero-match result

### Requirement: Discuss a selected memo in the existing Abra conversation

The user SHALL be able to attach the selected memo reference to an editable Abra composer draft while preserving existing draft text. The handoff SHALL send only on explicit submission and resolve the exact selected memo at use time.

#### Scenario: Similar notes appear in the results

- **WHEN** two notes have identical snippets and the user selects the second, chooses Ask Abra about this, adds a question and sends
- **THEN** the conversation identifies the second memo by its source reference even if the result ordering has changed
- **AND** the selection and draft edits alone do not submit a message

#### Scenario: Selected wording changes before Send

- **WHEN** the memo at the selected address has different wording when used
- **THEN** Abra requests a fresh selection before using the changed wording
