# application-configuration Specification

## Purpose

Give AbraCode one explicit, validated configuration contract whose effective model and application settings can be understood without editing generated host files or exposing private runtime data.

## Requirements

### Requirement: Keep user configuration separate from tracked examples and runtime files

AbraCode SHALL read its personal settings from `abracode.yaml` in the installation root by default, with an explicit documented path override. The repository SHALL track `abracode.example.yaml`, its configuration schema, application defaults and accompanying skills. Exact root ignore entries SHALL exclude the actual default personal configuration and `.abracode/` runtime directory while leaving examples, schemas and required source assets trackable. Provider secrets SHALL use native credential storage or environment variables and MUST NOT be required in the YAML.

#### Scenario: User prepares a public clone for personal use

- **WHEN** a user copies and edits the example and runs AbraCode
- **THEN** the actual default configuration and generated runtime contents are ignored while the example, schema and skills remain trackable

#### Scenario: User selects another configuration file

- **WHEN** the documented path override selects a configuration
- **THEN** startup, validation, inspection and repository configuration writes consistently use that file and identify its resolved path without dumping its contents

### Requirement: Validate a versioned configuration before startup side effects

The configuration SHALL declare a supported schema version and SHALL reject malformed YAML, duplicate keys, unknown settings at owned object boundaries, invalid values, duplicate repository identities and missing required settings with bounded field-specific diagnostics. Application defaults SHALL be deterministic and documented. A missing configuration or default model SHALL produce setup guidance rather than silently selecting a provider/model. Invalid configuration MUST NOT start the service, initialize a work database or change repository registrations.

#### Scenario: Setting contains a typo

- **WHEN** a user supplies an unknown setting or a duplicate YAML key
- **THEN** validation fails with the offending path or location and no startup side effect occurs

#### Scenario: User starts without a default model

- **WHEN** configuration is absent or lacks the required default provider/model
- **THEN** startup explains the example and required selection instead of inheriting a machine-global model

#### Scenario: Configuration version is unknown

- **WHEN** the version is unsupported
- **THEN** startup and validation refuse it without interpreting it as another version

### Requirement: Resolve model defaults and complete role overrides explicitly

One default provider/model selection SHALL be required. Optional complete selections SHALL override that default independently for Supervisor, Explore, Apply, Review and Research. Each selection SHALL include provider and model identity and SHALL optionally select a native reasoning variant. The effective selection and its source SHALL be inspectable per role. An override MUST NOT inherit a variant from a different model, silently fall back to another selection or use another conversation's model as a configuration source. Native inventory validation SHALL verify configured models, supported variants and role tool requirements before model work.

#### Scenario: Only Apply has an override

- **WHEN** the configuration specifies a default model and an Apply override
- **THEN** Supervisor, Explore, Review and Research resolve to the default and Apply resolves to its complete override

#### Scenario: Override omits reasoning variant

- **WHEN** an override selects a different provider/model without a variant
- **THEN** it uses that selected model's native default variant rather than the default selection's explicit variant

#### Scenario: Configured variant is unavailable

- **WHEN** live native inventory does not offer the chosen variant for a role's model
- **THEN** that selection is blocked with a role-specific diagnostic and no substitute is selected

### Requirement: Generate host configuration from the same resolved settings

AbraCode SHALL generate its required OpenCode configuration beneath `.abracode/` from the validated user settings and tracked application assets. All application-owned service/client entry points SHALL use that configuration and the same resolved installation root. The generated configuration SHALL define Abra as the central agent and preserve enforced role permissions. Routine user setup MUST NOT require editing a second tracked host file or embedding personal provider/model choices in tracked source.

#### Scenario: User changes the Supervisor model override

- **WHEN** the user follows the documented configuration-apply/restart procedure
- **THEN** Abra's configured model and generated host settings reflect the same resolved selection

#### Scenario: User edits generated host configuration directly

- **WHEN** the next normal generation occurs
- **THEN** application settings are regenerated from the authoritative user configuration and documentation identifies the generated file as disposable

### Requirement: Provide read-only configuration validation and inspection

Documented commands SHALL validate configuration and display effective settings with default/override provenance, selected config path and resolved runtime paths. They SHALL support a machine-readable result and a nonzero exit for invalid configuration. These commands MUST NOT start services, initialize or migrate databases, clone/fetch repositories, execute project checks, install tools or call model providers. Environment diagnostics SHALL separately label checks that are unavailable without a running service or credentials rather than treating static validation as live proof. Sensitive environment values and command secrets MUST NOT appear in displayed settings.

#### Scenario: User validates on an offline machine

- **WHEN** the dependencies are installed and the user runs static validation without a service or network
- **THEN** structural validation completes without runtime mutation and explicitly leaves live model/provider readiness unverified

#### Scenario: User inspects effective models

- **WHEN** the user requests effective configuration
- **THEN** all five roles show their resolved selections and provenance without exposing credentials

### Requirement: Preserve captured execution settings across config changes

New work SHALL capture the resolved role selections and applicable repository policies before admitting workers. Configuration edits and service restart SHALL affect subsequent work without silently replacing the selected models, permissions, accepted scope or authorization policy of an active execution. Deliberate changes to active work SHALL use the existing controller change/recovery route, and uncertain admission SHALL retain its original prompt/context identity.

#### Scenario: Configuration changes between Explore and Apply

- **WHEN** a user edits a model override while an execution is already active
- **THEN** that execution's later role admissions retain its captured selections and newly created work uses the new configuration

#### Scenario: Service restarts after uncertain submission

- **WHEN** a captured worker admission may already have succeeded and configuration has changed
- **THEN** recovery checks retained native evidence and does not rebuild or replay the admission using the new configuration
