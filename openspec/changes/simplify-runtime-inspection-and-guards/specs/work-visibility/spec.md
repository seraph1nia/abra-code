# Spec Delta

## ADDED Requirements

### Requirement: Bound ticket-scoped worker inspection to the selected execution

When a reader supplies both an issue and a worker session, inspection SHALL resolve membership from that issue's retained execution without enumerating other executions. It SHALL consult native worker evidence only for a session belonging to the selected issue and SHALL preserve the distinction between missing membership and unavailable native evidence.

#### Scenario: Inspect a worker in a populated workspace

- **WHEN** a reader inspects a current worker of one ticket among many retained executions
- **THEN** inspection returns the selected worker's role and available native evidence with zero fleet scans and zero unrelated session reads

#### Scenario: Inspect a previously assigned worker

- **WHEN** the selected execution retains the session and role in correction or synchronization history and the native session is available
- **THEN** inspection returns the recorded historical role and the selected session's evidence using only that ticket's execution

#### Scenario: Session belongs to a different ticket

- **WHEN** the selected execution has no assignment for the supplied session
- **THEN** inspection refuses the lookup as not found before reading that native session, with zero fleet scans

#### Scenario: Native evidence cannot be read

- **WHEN** the selected execution identifies the worker and reading that native session fails
- **THEN** inspection reports the worker as unavailable without searching other tickets or substituting evidence from another session
