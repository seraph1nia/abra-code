# Spec Delta

## ADDED Requirements

### Requirement: Recommend the next actionable item on demand

When asked to prioritize work, Abra SHALL consult the relevant local work and GitHub observations, use the developer's stated constraints and give one concrete next action when the evidence supports one. The answer SHALL identify its source and explain the fact that drove the choice. Requests for advice alone SHALL leave assignments, approvals and priorities intact.

#### Scenario: A decision can unblock other work

- **WHEN** a developer asks what to do next and one available decision blocks another task while a competing item can proceed independently
- **THEN** Abra identifies the recommended action, cites its task or GitHub item and explains the dependency or other observed fact that decides between them.

#### Scenario: Available evidence limits the choice

- **WHEN** coverage is partial, stale or empty
- **THEN** Abra discloses the relevant limit, qualifies any supported pick, and explains what evidence is missing if it cannot identify an actionable item.

#### Scenario: A challenge changes the premise

- **WHEN** the developer corrects a deadline or challenges the earlier ranking
- **THEN** Abra revisits the affected reasoning and explains why it keeps or changes its recommendation, without updating tracked priorities on the strength of the correction alone.

### Requirement: Resolve a requested action to the discussed GitHub item

When the developer explicitly requests pickup or private review after a recommendation, Abra SHALL use the existing assignment route for the intended repository and item, preserving existing retries and approvals.

#### Scenario: The recommendation identifies one PR

- **WHEN** the developer says “review that PR” after a recommendation clearly identifies a particular PR
- **THEN** Abra uses the original source identity and requested concern for a private review, and repeating the request resolves to the same assignment.

#### Scenario: Two items fit the reference

- **WHEN** a follow-up could reasonably refer to either of two PRs discussed
- **THEN** Abra asks which repository and PR the developer means before assigning any work.
