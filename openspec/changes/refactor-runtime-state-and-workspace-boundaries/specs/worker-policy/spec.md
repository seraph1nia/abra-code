# Spec Delta

## ADDED Requirements

### Requirement: Reusable procedures have one owned source

Managed role guidance SHALL state identity, responsibility and authority boundaries; reusable procedures SHALL have a project-owned skill source. Assignment context SHALL supply task-specific facts and reference applicable procedures. Repeated summaries MUST agree with their owner, and active guidance MUST describe supported behavior rather than retired implementations.

#### Scenario: Research requests a visual report

- **WHEN** a Research worker reads its role and relevant report guidance
- **THEN** the guidance describes the current captured-document and optional-export route without claiming that the retired Solid authoring template is active
- **AND** its read-only repository scope and controller-owned publication route remain explicit

#### Scenario: A procedure is revised

- **WHEN** an owned engineering or execution procedure changes
- **THEN** its role references and generated assignment context remain consistent without maintaining independent full copies of the procedure

#### Scenario: Upstream instructions refresh

- **WHEN** the pinned OpenSpec CLI refreshes generated workflows
- **THEN** the generated bodies remain upstream-owned and custom procedures remain in project-owned sources without restoring duplicate tool-specific workflow copies

### Requirement: Instruction cleanup preserves captured admission authority

Instruction and package restructuring SHALL preserve native skill identifiers, role permissions, mandatory capability prerequisites, conditional skill use and captured assignment evidence. Guidance availability or loading MUST NOT become approval, implementation, delivery or recovery authority. Existing retained contexts MUST NOT be rewritten to appear captured under new instructions.

#### Scenario: Small task does not need every procedure

- **WHEN** a worker receives a bounded task with all mandatory admission prerequisites available
- **THEN** it uses only applicable procedures without a new requirement to perform or report every available skill

#### Scenario: Required capability is unavailable

- **WHEN** a current mandatory skill or tool prerequisite is missing after restructuring
- **THEN** admission retains the existing diagnostic and repair route without weakening permissions or silently substituting another role or provider

#### Scenario: Retained work predates instruction cleanup

- **WHEN** an existing execution resumes after installed guidance changes
- **THEN** its captured model, assignment identities, skill evidence and checkpoint requirements remain retained under their supported compatibility rules
- **AND** current instruction text is not fabricated as historical capture evidence

#### Scenario: Skill suggests a conflicting action

- **WHEN** procedure guidance conflicts with approved scope or an enforced role boundary
- **THEN** the existing decision and controller validation routes remain authoritative and the instruction cannot grant the conflicting action
