## ADDED Requirements

### Requirement: Independent full-spec Review verifies the accepted change

Full-openspec Review SHALL report completeness, correctness and coherence with concrete evidence and unresolved source conflicts as part of the existing independent Review. The controller MUST reject missing or blank verification evidence and a passing verdict containing failed or unverified applicable assessments or unresolved conflicts. Intentionally inapplicable schema checks SHALL be reported with reasons rather than invented artifacts. Suggestions alone MUST NOT require scope expansion. Lightweight Review SHALL continue to use its retained short contract without requiring OpenSpec artifacts.

#### Scenario: A passing report lacks verification evidence

- **WHEN** a full-spec reviewer submits a pass without the specification assessments
- **THEN** the controller rejects the report and does not archive or deliver the change

#### Scenario: A report claims success while scenario evidence is unavailable

- **WHEN** an applicable assessment is unverified or failed but the report claims success
- **THEN** the controller rejects the contradictory verdict without replacing the retained review evidence

#### Scenario: A schema intentionally omits checks

- **WHEN** the reviewer explains inapplicable schema checks and verifies all applicable checks with no blocking findings or unresolved conflicts
- **THEN** Review can pass without requiring omitted artifacts or implementing advisory suggestions

#### Scenario: A legacy pass is awaiting the Review checkpoint

- **WHEN** a retained full-spec pass has no specification verification evidence and has not advanced past the Review checkpoint
- **THEN** the controller blocks archival and explicit retry obtains fresh checks and independent Review evidence

### Requirement: Contradictory evidence does not silently redefine accepted scope

Unresolved contradictions between approved requirements, implementation, repository instructions, skills, reviews or CI expectations SHALL retain source references and the incompatible expectations. The controller MUST require a durable decision before admitting correction for a Review report with unresolved conflicts, even when labeled in scope. A failed Review with an unresolved scope decision MUST NOT be retried into Apply. Explicit resolution followed by correction within unchanged scope SHALL preserve the plan and rerun checks and independent Review. Changed requirements MUST follow configured fresh plan approval or explicit short-contract revision; neither a check failure nor a decision answer authorizes changed requirements. Existing archival and revision protections SHALL remain enforced.

#### Scenario: A reviewer labels a spec and CI contradiction as in scope

- **WHEN** Review reports unresolved conflicting sources while requesting an in-scope repair
- **THEN** the controller retains uncertain scope and a durable decision, preserving the approved plan and admitting no automatic repair

#### Scenario: Obsolete expectations are confirmed

- **WHEN** a decision establishes that the approved behavior remains correct and the Supervisor explicitly retries correction of an obsolete test
- **THEN** Apply preserves the approved plan and previous checks and Review evidence are invalidated

#### Scenario: Requirements must change

- **WHEN** a decision determines the accepted behavior must change
- **THEN** full-spec work returns through replanning and configured approval of the revised plan rather than rewriting the plan during Apply or Review
