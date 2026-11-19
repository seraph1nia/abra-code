# Spec Delta

## Purpose

Provide programmable, composable agent definitions that prepare explicit native profiles and assignment context without owning workflow authority.

## ADDED Requirements

### Requirement: Provide the six bundled agents through one programmable interface

The agents package SHALL expose one common agent service, six independently usable bundled implementations and a catalog supporting list, lookup and preparation. The bundled definitions SHALL represent Abra, Explore, Apply, Review, Research and Project Lead with their current guidance and boundaries. Additional definitions MUST NOT create workflow roles or controller authority.

#### Scenario: Consumer selects each bundled definition

- **WHEN** a consumer lists the catalog and prepares each bundled definition
- **THEN** it receives six distinct identities with the correct guidance, mode, policy and skill selection
- **AND** preparation of one implementation does not replace another under the common service identity

#### Scenario: Programmatic specialist is added

- **WHEN** a consumer supplies a seventh definition using injected dependencies
- **THEN** catalog lookup and preparation work without adding a workflow role, loader, frontend or special runtime handler
- **AND** duplicate definition identities and unknown selections fail explicitly

### Requirement: Author complete definitions with explicit dependencies

Definitions SHALL support stable identity, description, mode, optional model preference, instruction sources, native tool references, typed custom tools, available and preload skills, and a context provider producing named fragments. Provider input SHALL be immutable task/repository data, not a runtime controller. Callback dependencies SHALL be supplied at construction.

#### Scenario: Specialist prepares authored capabilities

- **WHEN** a specialist declares an instruction source, a custom typed read-only tool, an available skill, a preload skill and a dependency-backed context provider
- **THEN** preparation resolves those contributions and retains separately named context fragments
- **AND** only the preload skill's resolved body is automatically included in instructions

#### Scenario: Tool contract is invalid

- **WHEN** a contribution collides with an existing tool or lacks a usable input/output contract
- **THEN** preparation or registration reports the conflicting definition/contribution without replacing the existing handler

### Requirement: Preparation uses the caller's effect environment

Preparation SHALL use injected filesystem/path and callback dependencies, report typed definition/source failures and expose traced operations. Importing the package MUST NOT perform I/O. Services MUST NOT start nested runtimes. Interruption and scoped cleanup SHALL remain observable through the caller's environment, rather than being converted to successful preparation or ordinary definition failures.

#### Scenario: Instruction source cannot be read

- **WHEN** an injected filesystem refuses a declared instruction source
- **THEN** preparation fails with definition/source identity and no usable partial prepared result

#### Scenario: Provider is interrupted

- **WHEN** the caller interrupts a suspended provider and closes its scope
- **THEN** interruption propagates and acquired provider/registration resources are released without a leaked background runtime

### Requirement: Native profiles reflect prepared static definitions

Native registration SHALL map resolved static instructions to system guidance and description, model preference, mode and permissions to corresponding native fields. Abra SHALL remain primary and visible only centrally; Project Lead SHALL remain hidden under its current identity. Managed worker profiles SHALL be hidden and controller-selectable at owned worker locations. Shared profiles MUST NOT contain task-specific facts.

#### Scenario: Foreign worker location has no role files

- **WHEN** the plugin activates at an owned worker location lacking central role Markdown
- **THEN** the bundled worker profiles are discoverable and selectable there without copying files over repository configuration
- **AND** Abra does not become a visible worker-location user entry point

#### Scenario: Definition revision changes

- **WHEN** two resolved static worker definitions differ in instructions or native profile configuration
- **THEN** their managed native profile IDs differ
- **AND** changing only assignment facts does not create a different shared profile revision

### Requirement: Native contributions have scoped registration ownership

The native adapter SHALL register profiles, custom contributions and skills through supported native transforms in the existing plugin scope. It SHALL reference existing runtime-owned management/tool handlers without registering duplicates. Scope closure SHALL release its registrations. Unrelated repository tools, skills and instructions SHALL be preserved.

#### Scenario: Two definitions reference one management tool

- **WHEN** bundled definitions reference the same existing runtime-owned tool
- **THEN** the native registry contains one handler registered by its existing runtime owner

#### Scenario: Native plugin scope closes

- **WHEN** a disposable plugin scope containing package registrations is closed
- **THEN** its registrations are disposed without removing unrelated native entries

### Requirement: Host-capable package boundaries are enforced

Runtime SHALL consume the agents package through declared exports. The package MUST NOT depend on runtime or browser applications, and browser-safe contracts, presentation and application source MUST NOT import the host-capable agents package. Frozen relocated installations SHALL contain its code and assets; standard package checks and test discovery SHALL include it.

#### Scenario: Browser imports the agents package

- **WHEN** browser or portable-rendering source imports a package export, including a type-only import
- **THEN** contributor boundary validation rejects it

#### Scenario: Source installation is relocated

- **WHEN** a disposable frozen installation starts outside the development checkout
- **THEN** the installed plugin resolves package assets, definitions and canonical skill sources without paths into the original checkout
