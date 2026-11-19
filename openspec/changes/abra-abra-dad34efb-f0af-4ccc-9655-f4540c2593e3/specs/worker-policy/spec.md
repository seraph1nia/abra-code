# Spec Delta

## MODIFIED Requirements

### Requirement: Managed roles have one authoritative permission policy

The agents package SHALL own the authoritative role policy used for native permissions, visible tool filtering and execution-time authorization for managed Supervisor, Explore, Apply, Review, Research and Project Lead sessions. Existing role permissions and policy fingerprints SHALL remain unchanged. Definition instructions SHALL supply guidance, not authority. Missing tools or conflicting instructions MUST NOT widen the policy.

#### Scenario: Native profile and request tool visibility disagree

- **WHEN** a native agent profile exposes a tool forbidden by its assigned role
- **THEN** the tool is excluded from the managed request and a direct invocation is rejected by execution-time authorization

#### Scenario: Role guidance claims additional authority

- **WHEN** definition instructions, a project instruction or a selected skill asks a managed worker to invoke a forbidden tool
- **THEN** the request does not grant permission and the existing role restriction remains effective

#### Scenario: Policy implementation moves into a package

- **WHEN** an existing captured assignment is checked after the ownership move
- **THEN** its policy fingerprint still matches the unchanged role policy
- **AND** native permissions, request filtering and execution-time guards use that same package owner

## ADDED Requirements

### Requirement: Definition contributions respect the assigned role ceiling

Definition permissions, tool references, custom contributions and capability requirements SHALL be constrained by the assignment's existing role policy. Native permissions and both request-time and execute-time authorization SHALL enforce the same contribution eligibility. Contributions MUST NOT impersonate reserved management tools, replace handlers, create delegation authority or bypass file/shell restrictions.

#### Scenario: Specialist contributes a read-only tool

- **WHEN** an additional definition contributes a typed tool eligible under the assigned role's existing read authority
- **THEN** registration and effective filtering expose it only to eligible current assignments
- **AND** direct calls by stale, wrong-role or unrelated assignments are refused

#### Scenario: Review definition requests write authority

- **WHEN** a Review definition or its contribution requests editing, general shell, management or delegation outside Review's policy
- **THEN** preparation or admission rejects the declaration and direct execution remains forbidden

#### Scenario: Explore tool attempts a source mutation

- **WHEN** an Explore assignment attempts source editing, a path escape or an out-of-change move
- **THEN** the existing planning-only containment guard rejects the operation regardless of selected definition or native override

### Requirement: Definitions reference canonical procedures and runtime tools

The package SHALL own bundled role instructions and engineering-skill selection. Skill procedure bodies SHALL remain canonical under `.agents/skills`, with existing native skill IDs and conditional-use semantics. Existing management/tool implementations SHALL remain runtime-owned. New registration MUST NOT retain duplicate discovered role bodies or independent copies of reusable skill procedures.

#### Scenario: Bundled consumers are migrated

- **WHEN** installed consumers and fixtures use the package definitions
- **THEN** the five former discovered role files are absent and no consumer reads those source paths for new guidance
- **AND** canonical procedures remain usable at central and worker locations

#### Scenario: Engineering skill defaults are resolved

- **WHEN** a fresh full-spec or lightweight coding assignment is prepared
- **THEN** its role-relevant engineering requirements and conditional loading guidance match the existing policy
- **AND** Research retains its existing prerequisites without acquiring coding requirements
