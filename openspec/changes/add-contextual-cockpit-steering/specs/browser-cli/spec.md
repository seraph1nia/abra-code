# Spec Delta

## ADDED Requirements

### Requirement: Retain a selected screenshot as verification evidence

An authorized worker SHALL be able to promote a specific bounded image from its assigned screenshot directory into immutable evidence with its issue, native session, execution generation, description and observed source identity. Capture SHALL preserve original bytes and report an unverified source when revision provenance cannot be established.

#### Scenario: A worker designates a screenshot from its own session

- **WHEN** capture succeeds and the scratch directory and worktree are later removed
- **THEN** Review and the developer can open the same retained image and its provenance from the issue
- **AND** unrelated scratch images remain ordinary scratch files

#### Scenario: A capture is retried or rebound

- **WHEN** the same capture request is retried after response loss
- **THEN** it resolves to the original evidence, and conflicting inputs under that identity cannot replace the captured image

#### Scenario: A file is outside the capture contract

- **WHEN** a worker requests another session's file, an escaping link, an unsupported or oversized file, or capture under an obsolete assignment
- **THEN** the request fails without publishing evidence or widening file access

#### Scenario: The screenshot cannot prove the implementation revision

- **WHEN** the worker supplies an observed browser outcome without a verifiable association to the tested code revision
- **THEN** that limitation is visible on the image and the image alone does not establish check success, independent review or delivery readiness
