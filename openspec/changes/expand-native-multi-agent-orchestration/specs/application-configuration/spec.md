# Spec Delta

## ADDED Requirements

### Requirement: Resolve task model selections and declarative dispatch profiles

Tasks SHALL support complete per-role model selections and named declarative profiles bound to a worker role and complete native model selection. For a role, precedence SHALL be explicit task selection, task-selected role profile, repository dispatch selection/profile, role override, then required default model. Contradictory selections at one level and mismatched role profiles SHALL be rejected. Existing complete model/variant validation and no-silent-substitution behavior SHALL apply. The resolved per-role selections and provenance SHALL be captured before execution and SHALL NOT drift after configuration changes or restart; explicit controller recovery remains required to change active work.

#### Scenario: Task overrides project model

- **WHEN** a task explicitly selects an Apply model and the project has an Apply dispatch profile
- **THEN** the captured Apply selection uses the task choice and identifies its provenance while other roles resolve independently

#### Scenario: Selected profile has the wrong role

- **WHEN** an Apply selection names a Research-only profile
- **THEN** validation refuses it without starting a session or broadening role permissions

#### Scenario: Selected model is unavailable

- **WHEN** the captured model or variant is absent from the worker location's native inventory
- **THEN** admission reports a concrete blocker and does not silently select another model

#### Scenario: Existing configuration has no dispatch settings

- **WHEN** a legacy installation upgrades without task selections or profiles
- **THEN** existing default/role resolution and captured execution selections remain unchanged

### Requirement: Compose bounded operational supervision postures

Configuration SHALL support optional manual, attended-automatic and unattended operational postures composed from existing scheduling and finite supervision policies. Omission SHALL preserve existing effective settings. An explicit posture and legacy flags SHALL resolve deterministically or fail on conflict, with effective scheduling, budgets and notification behavior inspectable. Manual SHALL disable new automatic dispatch and optional diagnostic/repair admission while retaining safe observation and already authorized deterministic reconciliation. Attended-automatic SHALL dispatch eligible authorized work and surface meaningful decisions/deliverables. Unattended SHALL continue only within previously authorized scope and budgets, retain human-owned decisions for later attention and continue unrelated eligible work. No posture SHALL change approval ownership, scope, permissions or delivery gates, grant nonzero repair budgets, or resume paused work.

#### Scenario: Upgrade preserves conservative behavior

- **WHEN** the new posture is omitted from existing configuration
- **THEN** the prior automatic-scheduling and finite diagnostic/repair behavior is preserved

#### Scenario: Unattended work needs human approval

- **WHEN** unattended execution reaches a required human checkpoint
- **THEN** the decision remains durable and unapproved while independent authorized work continues

#### Scenario: Manual mode observes an accepted approval

- **WHEN** manual posture is selected and an already accepted exact-content approval permits deterministic reconciliation
- **THEN** existing guarded reconciliation can continue without granting new dispatch or diagnostic authority
