# Proposal

## Why

The project currently assumes a personal OpenCrew checkout: it has no root license, personal model settings are split across files, and repository declarations differ from saved registrations. A public AbraCode release needs an auditable license story, reproducible Linux installation, coherent configuration, and one clear conversational entry point named Abra.

## What Changes

- Adopt MIT for project-owned code and documentation; inventory shipped third-party code, generated skills, templates, assets, and downloaded runtime components, preserving their licenses and notices. Block release when a component's redistribution rights or obligations remain unresolved.
- Publish a Linux-only, clone-and-install application with pinned Node/pnpm and local OpenCode/OpenSpec/browser CLI dependencies, a documented setup sequence, and one normal launch command that starts or discovers the service and attaches to Abra. npm publication and standalone binaries are deferred.
- **BREAKING**: Replace personal `projects.yaml` and tracked model configuration with ignored `abracode.yaml`, tracked `abracode.example.yaml` and schema, and ignored `.abracode/` runtime/generated configuration. Require one default provider/model selection with optional overrides for Supervisor, Explore, Apply, Review, and Research.
- Make repository declarations in that same YAML authoritative for intended settings. Save repositories added through Abra there; explicitly reconcile declarations with inspected native registrations without deleting resources or rewriting active execution settings.
- Add read-only configuration validation/effective-settings inspection and capability-aware installation diagnostics. Ship operational skills and document roles, permissions, authentication, prerequisites, updates, and troubleshooting.
- Brand project-owned public surfaces AbraCode using supported plugin APIs. **BREAKING**: name the sole user-facing agent Abra, replace worker-conversation links/tabs with read-only inspection, and route worker questions, user instructions, and approval forms through Abra and the existing controller gates.
- Support fresh AbraCode installations only. No OpenCrew state migration or automatic removal of old data is included.

## Capabilities

### New Capabilities

- `release-distribution`: MIT project licensing, third-party release evidence, Linux source installation, pinned runtime tooling, and complete operator/contributor documentation.
- `application-configuration`: One versioned Effect Schema configuration, model defaults and role overrides, generated host configuration, exact ignore rules, and read-only validation/inspection.
- `repository-configuration`: Durable YAML repository declarations, explicit registration reconciliation, recoverable configuration writes, and separation of desired settings from runtime evidence.
- `application-branding`: AbraCode identity across owned documentation, commands, agent guidance, and supported terminal UI contributions, with explicit upstream attribution and fresh-install boundaries.

### Modified Capabilities

- `native-supervision`: Abra is the only conversational user entry point; controller-owned worker admission and existing human checkpoint authority remain distinct.
- `work-visibility`: Worker state and evidence remain inspectable without exposing worker chat entry points or opening worker conversation tabs.

## Impact

Touches root package/toolchain metadata, licensing/notices and release checks, `.gitignore`, examples/schema, `scripts/`, `src/config/`, native bootstrap/model/skill/guard integration, repository onboarding and execution snapshots, terminal views, agent/skill instructions, README and operator/contributor docs, and corresponding unit/integration/native E2E coverage. Native OpenCode 2.0.28, OpenSpec 1.13.2, Effect 4.0.1 and agent-browser 0.39.1 remain pinned unless an evidenced implementation need requires a separately reviewed update. Work graph, native sessions/worktrees, OpenSpec planning authority, and controller lifecycle gates remain intact. Repository rename/publication and remote mutations are outside implementation acceptance.
