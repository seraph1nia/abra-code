# Spec Delta

## ADDED Requirements

### Requirement: Select definitions independently from native execution profiles

Worker configuration SHALL accept an optional definition selector defaulting to the bundled role definition. The existing agent selector SHALL remain an explicit native execution-profile override, not a definition selector. Both selections SHALL retain managed definition guidance, prerequisites and role restrictions. Unknown or role-incompatible definitions MUST fail explicitly without substitution.

#### Scenario: Configuration omits both selectors

- **WHEN** a new execution is captured with no worker definition or native agent override
- **THEN** each worker selects its bundled role definition and package-owned native profile

#### Scenario: Native override and specialist definition coexist

- **WHEN** configuration selects an additional compatible definition and an explicit native agent
- **THEN** the native agent remains the execution profile while the selected definition supplies managed guidance and prerequisites within the assigned role's limits

#### Scenario: Configured definition does not exist

- **WHEN** a worker selection names a definition absent from the programmatically supplied catalog
- **THEN** validation against that catalog reports the worker field and definition identity without loading a module or falling back to a bundled definition

### Requirement: Definition preferences do not replace configured model dispatch

Definition model preference SHALL be used only when no configured selection exists. Existing task, task-profile, repository, repository-profile, role-override and required-default model resolution SHALL retain its precedence, complete model/variant semantics and provenance. Worker creation and dispatch SHALL explicitly select the resolved session model instead of relying on native agent model inference.

#### Scenario: Definition prefers a different model

- **WHEN** a selected definition prefers one model and configured dispatch resolves another
- **THEN** the native worker uses the configured captured selection and diagnostics retains its existing selection source

#### Scenario: Direct programmable consumer has no configured model

- **WHEN** a consumer prepares a definition without a configured model selection
- **THEN** the definition's model preference can supply the prepared native preference without changing AbraCode's required default-model configuration

#### Scenario: Dispatch overrides remain complete

- **WHEN** task dispatch selects a model without a variant over a repository profile containing a variant
- **THEN** the selected task model uses its own native default variant without inheriting the repository variant or definition preference

### Requirement: Capture definition selection without changing active work

New execution snapshots SHALL capture per-role definition selection distinctly from native agent override and model dispatch. Supported older snapshots SHALL decode without adopting new defaults or rewriting historical selection. Configuration or catalog edits SHALL affect subsequent executions, not active captured work; deliberate replacement SHALL use existing controller routes and approval policy.

#### Scenario: Configuration changes between roles

- **WHEN** configuration selects another definition after Explore is captured
- **THEN** the execution's later role admissions retain its captured definition selections and new executions use the changed configuration

#### Scenario: Old snapshot omits definition fields

- **WHEN** restart loads a supported snapshot captured before programmable agents
- **THEN** it preserves the prior explicit-agent or historical native-default behavior until a deliberate new execution
- **AND** missing definition fields are not rewritten as evidence of earlier package selection

### Requirement: Generated configuration has one agent-definition owner

Host configuration generation SHALL use package-owned definitions or defer their complete native registration to the package adapter. It MUST NOT maintain separate Abra, lead or worker instruction bodies. Configuration schema generation, examples and static inspection SHALL explain both selectors without executing context providers or causing service side effects.

#### Scenario: Host configuration is regenerated

- **WHEN** normal generation runs from validated settings in a relocated installation
- **THEN** stable Abra/lead identity and explicit configured model selection are preserved without references to removed discovered role files or duplicated instructions

#### Scenario: User inspects configuration offline

- **WHEN** static schema validation or configuration inspection runs without a native service
- **THEN** selector structure and effective defaults are reported without provider execution, native registration or installation
- **AND** any catalog-dependent or live-inventory check not performed is identified as unverified
