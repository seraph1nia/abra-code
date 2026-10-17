# release-distribution Specification

## Purpose

Make AbraCode's source release usable by Linux operators with reproducible installation instructions and explicit rights and obligations for project-owned and third-party material.

## Requirements

### Requirement: Publish project licensing without replacing third-party terms

The source distribution SHALL include an MIT license for project-owned code and documentation and consistent package license metadata. Third-party material SHALL retain its applicable licenses, copyright notices and required attribution. Licensing documentation MUST distinguish AbraCode's grant from dependency licenses, external service terms and trademark rights; it MUST NOT claim that every installed component has been relicensed under MIT.

#### Scenario: User reads the public license information

- **WHEN** a user inspects a fresh source release
- **THEN** the root license and package metadata identify MIT for AbraCode-owned material and direct the user to third-party licensing information

#### Scenario: A generated skill includes upstream material

- **WHEN** the release includes an upstream-derived skill or template
- **THEN** its provenance and required notices remain available with the distributed material

### Requirement: Review the actual release and installation components

Release verification SHALL inventory the pinned dependencies and distributed code, skills, templates and assets, distinguishing source material, runtime components, build-only tools, downloaded executables and optional external integrations. The inventory SHALL identify versions or revisions, license evidence, applicable redistribution obligations and how those obligations are satisfied. Unknown rights, incompatible restrictions or unmet obligations SHALL block release readiness. Copyleft or attribution licenses MUST NOT be treated as automatically incompatible without assessing their actual use and distribution.

#### Scenario: Dependency metadata omits a license

- **WHEN** a component has missing or ambiguous license metadata
- **THEN** readiness requires evidence from its actual license/provenance or an explicit removal or replacement, rather than assuming MIT

#### Scenario: Build dependency is absent from the shipped report

- **WHEN** a build tool is installed but its engine is not present in a generated report
- **THEN** the inventory distinguishes the installed tool from the report contents and evaluates each distributed artifact separately

#### Scenario: Native tooling downloads another executable

- **WHEN** installation or optional browser setup downloads a platform executable
- **THEN** release evidence identifies that component and its licensing source separately from the JavaScript wrapper

### Requirement: Support a pinned Linux source installation

The first public release SHALL support installation from a cloned repository on documented Linux environments using pinned Node and pnpm versions and a frozen dependency lockfile. The documented install SHALL supply the supported local OpenCode, OpenSpec and agent-browser executables and packaged operational skills without requiring global installations of those tools. The instructions SHALL distinguish required core executables, provider authentication, GitHub delivery prerequisites, optional browser provisioning and optional external validation. Unsupported operating systems MUST NOT be advertised as supported.

#### Scenario: Clean Linux user follows the installation guide

- **WHEN** a user installs the documented prerequisites and runs the frozen installation and configuration steps in a fresh clone
- **THEN** local runtime tooling and skills resolve from that installation and no author-specific paths or model credentials are required

#### Scenario: Browser has not been provisioned

- **WHEN** core prerequisites are available but Chrome or Chromium is not installed
- **THEN** non-browser work remains usable and the guide and diagnostics identify browser setup as a separate capability

#### Scenario: Core executable or runtime version is unsupported

- **WHEN** a required executable is absent or a runtime version is outside the declared support range
- **THEN** installation/startup diagnostics identify the prerequisite and clearing action without claiming a successful supported setup

### Requirement: Launch and reattach through one ordinary command

After configuration and authentication, one documented normal launch command SHALL start or discover the dedicated local service and attach to the persistent Abra conversation. Repeated launches SHALL reuse the same healthy service and Abra session. Service-only start, attach, authentication, stop and restart commands SHALL remain available for operator use. Launch MUST NOT require the user to select a worker conversation or authorize pending lifecycle decisions implicitly.

#### Scenario: User launches a configured fresh installation

- **WHEN** no AbraCode service exists and the user runs the normal launch command
- **THEN** the service and Abra session are created and the client opens Abra

#### Scenario: User launches again

- **WHEN** the dedicated service and Abra session already exist
- **THEN** launch reattaches without creating a second service, a second Abra session or another worker turn

### Requirement: Document the complete operator and contributor contract

The README and linked guides SHALL describe installation prerequisites, configuration, authentication, the five model-bearing roles and their boundaries, deterministic controller responsibilities, workflow choices, repository registration, approval checkpoints, optional capabilities, updates, diagnostics and troubleshooting. Contributor guidance SHALL identify the required checks and isolated test environment. Documentation MUST distinguish a successful config parse from a functioning provider, browser or remote delivery capability and MUST NOT require unshipped author-local tools.

#### Scenario: New user needs to choose models

- **WHEN** a user follows the README to configure the default and overrides
- **THEN** the role table explains that Supervisor is Abra, Explore plans, Apply implements, Review independently assesses and Research investigates, with implementation and authorization limits stated

#### Scenario: Contributor validates changes

- **WHEN** a contributor follows the documented validation sequence
- **THEN** it includes `pnpm check`, `pnpm test` and `pnpm test:e2e`, uses temporary repositories and does not push to user remotes
