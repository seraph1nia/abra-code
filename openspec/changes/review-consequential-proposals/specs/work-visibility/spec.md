# Spec Delta

## ADDED Requirements

### Requirement: Inspect proposal findings for the reviewed revision

The workspace SHALL present selected proposal reviews in an A2UI findings view linked to the exact reviewed plan. It SHALL distinguish the reader's interpretation, actionable findings, cited evidence and outstanding decisions. A person SHALL be able to distinguish a completed clean review, an outstanding review and an explicit human choice to continue without one.

#### Scenario: Read the report and act on one scope question

- **WHEN** a fresh review raises a scope question and a wording edit
- **THEN** the findings view shows the reason and evidence for each and opens the current scope question in the existing decision flow
- **AND** reading findings, opening evidence or submitting editorial feedback does not answer that question or approve implementation

#### Scenario: Reopen an earlier dashboard

- **WHEN** plan B replaces plan A and the person reopens A's published dashboard after restart
- **THEN** the view identifies A, shows A's retained reading and findings, and identifies them as historical
- **AND** the person can reach B's current review status without submitting a decision for either revision

#### Scenario: Review has no findings or is unavailable

- **WHEN** a completed report has no material findings
- **THEN** the view shows the reader's understanding and the completed outcome
- **WHEN** review is unavailable instead
- **THEN** the person sees the reason and can reach the authorized retry or continue choice, including when ordinary plan approval is optional

#### Scenario: Reopen after explicit continuation

- **WHEN** the person reopens the reviewed work after choosing to continue with the reviewer unavailable
- **THEN** the view identifies that choice and revision and distinguishes it from a successful independent review
