# Spec Delta

## ADDED Requirements

### Requirement: Validate a batch incrementally against a known-valid graph

Ordinary batch admission on a graph with established integrity SHALL validate newly proposed edges and the existence of referenced issues without loading unrelated issue records or revisiting previously validated edges. When existing graph integrity cannot be established, admission MUST verify it before committing new work. A failed validation MUST preserve the original graph and receipts.

#### Scenario: Add a small batch to a known-valid graph

- **WHEN** the first task in a batch depends on the second and the second depends on one existing issue in a graph of 1,000 unrelated issues
- **THEN** the controller validates and commits their requested edges with zero unrelated issue records loaded and zero previously validated edges traversed

#### Scenario: Open or resume with invalid dependency data

- **WHEN** a previously populated database contains a dangling reference or a dependency cycle, on reopen or following an independent writer that invalidates the prior integrity evidence
- **THEN** an otherwise valid new batch is refused before any of its issues, edges, events or receipts are committed

#### Scenario: A failed or repeated request shares a validated graph

- **WHEN** a batch supplies a missing reference, forms a local cycle or fails partway through its writes
- **THEN** the request leaves no partial records and cannot establish integrity evidence for an uncommitted graph
- **AND** repeating a previously committed identical request still returns its original mapping
