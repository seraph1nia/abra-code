# application-branding Specification

## Purpose

Present AbraCode as a coherent application powered by OpenCode, with Abra as its recognizable central agent and a clear boundary for fresh installations and upstream-owned interfaces.

## Requirements

### Requirement: Use AbraCode across application-owned public surfaces

Application-owned README, package metadata, launch/help messages, configuration examples, operational guides, skills, command labels, sidebar and work views SHALL consistently identify the project as AbraCode. The central conversational agent SHALL be named Abra. Documentation SHALL distinguish AbraCode from its OpenCode host and retain accurate dependency and upstream attribution. Upstream product names, package identifiers, license notices and historical records MUST NOT be rewritten as if AbraCode authored them.

#### Scenario: User follows the public quick start

- **WHEN** the user reads installation instructions, launches the app and opens the work view
- **THEN** the product is consistently named AbraCode and the user is directed to talk to Abra

### Requirement: Add branding through supported plugin contributions

The terminal integration SHALL present AbraCode identity in its owned work surface and a supported footer or composer-adjacent contribution while respecting host themes, narrow layouts, focus and input behavior. Branding SHALL use the pinned host's public plugin interfaces without patching its executable. Documentation MUST NOT promise replacement of the host's entire name/logo or brand graphical clients where no integration has been verified.

#### Scenario: Terminal is narrow or a dialog owns focus

- **WHEN** branding is rendered in a constrained terminal or while the user interacts with a native dialog
- **THEN** it remains bounded and does not hide required controls or intercept ordinary input

#### Scenario: Host retains its own identity

- **WHEN** upstream-owned interface chrome still displays OpenCode
- **THEN** AbraCode documentation accurately describes the application as powered by OpenCode

### Requirement: Start fresh without adopting or deleting OpenCrew installations

The first AbraCode release SHALL use its own documented configuration and `.abracode/` runtime layout. It SHALL NOT automatically import old OpenCrew registrations, sessions or work databases, reuse a legacy running service, or delete legacy files and resources. Operator instructions SHALL explain the fresh-install boundary and the need to stop an old service separately before operating on the same resources. Old environment/configuration names MUST NOT silently select legacy state.

#### Scenario: Legacy files remain beside the new installation

- **WHEN** an installation root contains `.opencrew/` or `projects.yaml`
- **THEN** AbraCode reads its own configured files, leaves legacy contents untouched and does not claim that old work was migrated

#### Scenario: A legacy service still owns overlapping resources

- **WHEN** detected legacy ownership conflicts with the requested AbraCode resources
- **THEN** startup reports the conflict and requires the operator to resolve it instead of attaching to or terminating the old service automatically
