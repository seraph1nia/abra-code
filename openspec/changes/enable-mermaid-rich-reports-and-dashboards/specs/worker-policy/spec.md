# Spec Delta

## ADDED Requirements

### Requirement: Expose diagram verification through managed role policy

The authoritative managed role policy SHALL permit `abra_mermaid_verify` for the central Supervisor and current Explore, Apply, Review and Research workers. Native permissions, request visibility and invocation authorization SHALL agree. The capability MUST NOT grant shell, repository write, publication, delivery or lifecycle authority, and inactive or replaced workers MUST remain denied.

#### Scenario: Research verifies a report diagram without shell access

- **WHEN** a current authorized Research worker invokes the verifier with bounded literal sources
- **THEN** native permission, visible tool inventory and execution guards permit diagnostic verification
- **AND** the role's unrelated shell and repository write restrictions remain enforced

#### Scenario: Explore or Review uses the same capability

- **WHEN** current Explore or Review workers verify diagram sources for their assigned work
- **THEN** they receive diagnostic results through the same bounded tool without acquiring report publication or controller checkpoint authority

#### Scenario: Historical assignment attempts verification

- **WHEN** a replaced, inactive, foreign or stale-generation worker directly invokes the verifier
- **THEN** authorization rejects the call before compilation despite retained context or a visible historical tool result

#### Scenario: Project lead is outside the allowed roles

- **WHEN** a project-lead or unmanaged session attempts the managed verifier route
- **THEN** it gains no access from the tool's diagnostic classification or another role's successful result

### Requirement: Treat diagram verification as diagnostic evidence only

The verifier SHALL explicitly declare diagnostic eligibility and return structured results for diagram validity, rendering and safety. A classified invalid diagram SHALL be a completed diagnostic result; authorization failures and unexpected execution failures SHALL retain native failure semantics. Verification MUST NOT approve work, submit prompts, publish artifacts or record successful repository checks.

#### Scenario: Supervisor verifies during diagnostic inspection

- **WHEN** an authorized Supervisor diagnostic turn verifies a malformed diagram
- **THEN** it receives an identified invalid-diagram result without generating a report, admitting a provider turn or advancing a workflow checkpoint

#### Scenario: Successful verification is presented as approval

- **WHEN** an agent or generated report references a successful verifier result
- **THEN** the result remains diagram preparation evidence and cannot satisfy controller plan, repository verification, independent Review or merge authorization

#### Scenario: Caller selects arbitrary execution inputs

- **WHEN** a verifier call supplies file paths, executable names, remote assets, arbitrary configuration or unknown fields
- **THEN** strict input validation refuses the call before compiler execution
