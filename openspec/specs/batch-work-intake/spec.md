# batch-work-intake Specification

## Purpose

Create several related work items safely from one conversational request, with stable retry identities, validated policy choices and explicit local dependency resolution.

## Requirements

### Requirement: Create bounded batches atomically

An authorized management request SHALL create between one and 32 tasks under an explicit stable batch identity. Each task SHALL have a unique local key and reuse ordinary work-intake validation for registered repository, goal, title, workflow, priority and applicable scope/quality requirements. The result SHALL map local keys to durable issue identities. Creation of all issues, request identities and dependencies SHALL commit atomically; validation or storage failure SHALL leave no partial batch. Creation MUST NOT itself grant missing execution, approval or delivery authority.

#### Scenario: Three tasks are accepted

- **WHEN** Abra submits three valid independent task definitions
- **THEN** three durable issues and their local-key mapping are committed together with their selected workflow policies

#### Scenario: One task violates repository policy

- **WHEN** any item lacks required lightweight scope or requests a disallowed workflow
- **THEN** the entire batch is rejected and no issues are created

### Requirement: Resolve dependencies without ambiguous references

Batch inputs SHALL distinguish local task keys from existing issue references, allow forward local references and validate the complete dependency graph before commit. Unknown references, duplicate conflicting local keys, self-dependencies and cycles SHALL be rejected. Recommendations SHALL remain agent judgments; the controller MUST preserve explicit user/project verification and approval policy.

#### Scenario: Forward dependency is valid

- **WHEN** an item depends on a later item's local key
- **THEN** its stored dependency points to that item's committed issue identity

#### Scenario: Proposed dependency graph cycles

- **WHEN** local dependencies form a cycle or reference a nonexistent task
- **THEN** the batch fails without partial records or dispatch

### Requirement: Retrying intake preserves task identities

The same batch identity with the same normalized keyed definitions SHALL return the original mapping after response loss or restart. Changed goals, membership, dependencies, policy, dispatch selections or repository under that identity SHALL be refused. Item ordering alone SHALL NOT create different work. Stable per-item request identities SHALL be retained so ordinary intake cannot silently rebind a batch-owned task.

#### Scenario: Commit response is lost

- **WHEN** the database committed a batch but the client did not receive the result
- **THEN** an identical retry returns all original issues without creating duplicates

#### Scenario: Retry changes a task

- **WHEN** the caller reuses a batch identity with a different task goal
- **THEN** the original batch remains unchanged and the retry reports an identity conflict
