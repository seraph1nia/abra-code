# browser-cli Specification

## Purpose

Give managed OpenCrew workers a shared browser CLI and portable usage guidance so they can investigate websites and check application behavior from independent worktree sessions.

## Requirements

### Requirement: Install the browser CLI once for the managed service

OpenCrew SHALL supply a version-pinned agent-browser executable from its central dependency installation and make it available to worker shell commands from assigned worktrees. Setup SHALL support installing a browser once for the service user or selecting an existing compatible executable. Global CLI installation and installation in managed repositories MUST NOT be prerequisites. Worker admission MUST NOT install packages, download a browser or change host system packages automatically.

#### Scenario: Worker runs from a foreign repository

- **WHEN** a worker invokes agent-browser from a managed repository with no local agent-browser dependency
- **THEN** the command resolves to OpenCrew's centrally installed executable
- **AND** the target repository's manifests and configuration remain unchanged

#### Scenario: Browser runtime needs setup

- **WHEN** browser use fails because no usable browser or required browser library is available
- **THEN** the worker reports the concrete setup failure and the documented clearing action
- **AND** the failure does not authorize automatic system package installation

### Requirement: Browser guidance is available in every worker location

Explore, Apply, Review and Research SHALL have one portable OpenCrew browser skill available through the native skill tool in their assigned worktrees for all supported workflows. The skill SHALL load the installed CLI's upstream workflow instructions and describe OpenCrew's browser session, screenshot and scope conventions. Ordinary admission MUST NOT require browser guidance or browser-only shell tools. A worker profile explicitly requiring the browser skill SHALL validate its availability through the existing worker-location capability validation and require its effective native shell tool. Apply SHALL retain its development-shell prerequisite independently of browser use. Workers SHALL load browser guidance when browser work is needed and report unavailable prerequisites for that work. Skill loading MUST NOT install tools or overwrite managed repository instructions.

#### Scenario: Repository supplies no browser skill

- **WHEN** a Research, Explore, Apply or Review worker starts in a repository without browser-specific instruction files
- **THEN** its native inventory contains the shared OpenCrew browser skill with usable content
- **AND** existing local skills and instructions remain intact

#### Scenario: Explicitly required shared skill is unavailable

- **WHEN** a worker profile explicitly requires the shared browser skill and it is absent or unusable in the worker's native inventory
- **THEN** new admission reports the existing location-specific capability blocker instead of assuming central-only discovery is sufficient

#### Scenario: Ordinary work does not need browser prerequisites

- **WHEN** a worker profile does not explicitly require browser guidance and the assignment does not use a browser
- **THEN** admission succeeds without browser guidance or a browser-only shell tool when its other role and workflow prerequisites are met
- **AND** Apply still requires its development-shell capability

### Requirement: Workers use the CLI through native shell tooling

All four worker roles SHALL be able to invoke agent-browser directly through an effective native shell tool. Explore, Review and Research SHALL receive the browser command exception through native command permissions while unrelated shell commands remain denied. Apply SHALL retain its existing development shell access. The browser skill SHALL NOT be treated as a permission grant, and browser capability MUST NOT grant lifecycle management or repository editing authority beyond the assigned role.

#### Scenario: Research invokes the installed CLI

- **WHEN** an active Research worker invokes an allowed agent-browser command through the native shell tool
- **THEN** the command executes without a custom browser tool or permission widening from a skill

#### Scenario: Browser-only role invokes an unrelated command

- **WHEN** Explore, Review or Research invokes an unrelated shell command such as a repository mutation command
- **THEN** native command permissions reject it
- **AND** direct native editing and controller management calls remain subject to the original role restrictions

### Requirement: New worker context directs relevant browser use

New worker context SHALL name the shared browser skill, recommend agent-browser for website interaction and application behavior checks, and supply the worker's browser session and screenshot directory conventions. Workers SHALL load the shared skill before browser use and report relevant observed behavior and limitations. Browser use SHALL remain driven by the assignment; it MUST NOT replace required repository checks or authorize starting unrelated services. Existing uncertain admissions SHALL retain their captured context and admission identity.

#### Scenario: Assignment requires an application behavior check

- **WHEN** a worker receives a browser-relevant assignment with a reachable application URL
- **THEN** its supplied guidance directs it to load the shared skill and use agent-browser for the check
- **AND** it reports observed results separately from required repository verification

#### Scenario: Application is not reachable

- **WHEN** a browser check depends on an application that is unavailable and the worker cannot start it within its existing authority
- **THEN** the worker reports the missing URL or application prerequisite through the existing worker reporting protocol
- **AND** browser availability alone does not grant arbitrary server-start commands

#### Scenario: Old admission is recovered after rollout

- **WHEN** recovery encounters a previously captured worker prompt
- **THEN** it preserves that prompt and checks the existing policy-compatibility rules rather than silently inserting browser guidance or permissions under the old admission identity

### Requirement: Browser sessions and screenshots are separated by worker session

OpenCrew SHALL supply a distinct valid browser session name and screenshot directory for each native worker session. The shared skill SHALL instruct workers to use that name on every browser invocation, retain it when continuing the same native session, and close only that named browser when finished. It SHALL instruct workers to use fresh isolated browser state and their assigned screenshot directory unless the user explicitly supplies another authorized state source. Native screenshot read access SHALL be limited to the assigned evidence directory rather than a blanket external directory grant. Screenshot paths SHALL be identified as scratch evidence without a guarantee of durable report attachment.

#### Scenario: Concurrent worktree workers follow the supplied browser guidance

- **WHEN** two native worker sessions open browsers with their assigned names
- **THEN** they use separate browser instances, navigation and authentication state
- **AND** closing one named browser leaves the other's browser active

#### Scenario: Worker captures browser evidence

- **WHEN** a worker saves a screenshot using its supplied evidence directory
- **THEN** native file reading can inspect that screenshot
- **AND** the screenshot does not dirty the managed repository or expand native repository editing permissions

### Requirement: Setup diagnostics describe browser prerequisites without provisioning them

The normal setup diagnostics SHALL report whether the pinned CLI can execute and give actionable browser setup instructions. Routine diagnostics and worker capability checks MUST NOT launch a browser, repair other browser sessions or change host packages. Missing browser installation SHALL NOT block assignments that do not use the browser. Browser download and live smoke checks SHALL be explicit setup or validation commands.

#### Scenario: CLI native executable is missing

- **WHEN** dependency installation leaves agent-browser's native executable unavailable
- **THEN** setup diagnostics fail with a clearing action for the central package's installation or build permission
- **AND** a global executable is not silently substituted

#### Scenario: Non-browser work runs before browser installation

- **WHEN** the CLI and shared skill are available but Chrome has not been installed
- **THEN** a non-browser assignment can still be admitted and execute its normal workflow
- **AND** routine diagnostics do not download Chrome or open a browser to probe it
