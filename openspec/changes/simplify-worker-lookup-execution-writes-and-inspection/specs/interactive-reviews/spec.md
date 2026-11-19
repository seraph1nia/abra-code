# Spec Delta

## MODIFIED Requirements

### Requirement: Preserve review drafts and response identity

The app SHALL share a draft across mounted presentations of the same exact review and restore it on reload when browser storage is available. When its first view reopens, it SHALL reconcile the latest valid stored draft for that identity while preserving unsaved edits on storage failure. Revisions SHALL have separate drafts. Submission SHALL retain an exact response identity before admission. Ambiguous results MUST NOT automatically generate another native message.

#### Scenario: Response is lost

- **WHEN** native admission succeeds but its HTTP response is lost
- **THEN** reconciliation returns the original receipt without another native message

#### Scenario: Another tab edits a closed review

- **WHEN** the last view of a review closes in tab A, tab B saves a different answer for that revision, and tab A reopens it
- **THEN** tab A displays the saved answer without requiring a reload or another storage event

#### Scenario: Another tab submits while the review is closed

- **WHEN** the reopened review has a valid persisted pending request or admitted receipt for its exact session, review, revision and hash
- **THEN** the app reconciles the original request or displays its outcome without dispatching on remount or creating another identity

#### Scenario: Storage is unavailable or contains incompatible evidence

- **WHEN** a view reopens with an unsaved local edit and storage cannot be read or decoded, or the stored draft identifies a different revision
- **THEN** the local edit remains available and the app cannot adopt a foreign pending request or receipt
