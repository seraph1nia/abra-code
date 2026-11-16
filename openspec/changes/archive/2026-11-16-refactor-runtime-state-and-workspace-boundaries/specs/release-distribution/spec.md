# Spec Delta

## ADDED Requirements

### Requirement: Workspace consumers use complete declared interfaces

Each workspace consumer SHALL resolve its supported interfaces and dependencies from a frozen installation through declared package exports. Browser-safe shared interfaces MUST exclude host execution capabilities, and portable rendering MUST exclude live application capabilities. Undeclared cross-package source imports and missing runtime dependencies SHALL fail contributor checks or packaging.

#### Scenario: Shared interface is consumed by both applications

- **WHEN** the web workspace and portable report use a shared data or presentation interface
- **THEN** both resolve its declared compatible export without importing implementation files from the other application

#### Scenario: Consumer reaches into another package's source

- **WHEN** a workspace adds an undeclared relative or aliased cross-package implementation import, including a type-only import
- **THEN** contributor validation identifies the boundary violation rather than relying on root dependency hoisting

#### Scenario: Browser-safe package imports a host capability

- **WHEN** a shared browser interface gains filesystem, controller, native-registration or host-runtime dependencies
- **THEN** boundary validation fails before a supported browser or portable artifact is published

### Requirement: Source relocation preserves operational entry points

Supported root commands, native plugin loading, operational skills, development reload and report export SHALL work from a relocated frozen source installation after internal package moves. Builds and installation fixtures SHALL include required workspace code and assets without author-local paths, undeclared global tools or imports back into the original checkout.

#### Scenario: Fresh installation moves to another directory

- **WHEN** the supported source installation is created outside the development checkout
- **THEN** launch, attach, configuration, browser development and report export resolve their own packages, tools, skills and assets

#### Scenario: Managed worker activates after package extraction

- **WHEN** a worker location loads the installed native plugin
- **THEN** its expected role, registered skills and controller contract resolve through the installation without depending on the original source layout

#### Scenario: Compatible entry point is invoked

- **WHEN** an operator uses an existing documented root command after upgrade
- **THEN** that command retains its supported behavior and does not implicitly restart another service or authorize a lifecycle checkpoint

### Requirement: Dependency cleanup retains evidenced compatibility

Dependency maintenance SHALL identify each direct dependency's owning workspace and actual runtime, build or peer use. Updates and removals SHALL preserve supported peer resolution, coherent shared runtime identities, supplier notices and frozen installation. Compatibility exceptions SHALL remain narrow and documented; a newer registry version alone MUST NOT justify an incompatible upgrade.

#### Scenario: Latest major conflicts with a required peer

- **WHEN** a dependency's newest major is incompatible with a supported renderer peer requirement
- **THEN** the compatible pinned contract remains and the reason is documented without silently widening overrides

#### Scenario: Unused direct dependency is removed

- **WHEN** cleanup removes a dependency declaration believed unnecessary
- **THEN** frozen package-local resolution, required peer use and artifact licensing checks prove that every supported consumer remains complete

#### Scenario: Compatible type dependency is updated

- **WHEN** supported frontend type packages receive compatible pinned updates
- **THEN** all affected workspace checks and shipped component consumers validate against the resulting lockfile
