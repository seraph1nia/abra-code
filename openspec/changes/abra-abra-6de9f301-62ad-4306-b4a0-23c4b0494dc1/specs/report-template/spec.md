# report-template Delta

## ADDED Requirements

### Requirement: Renderer source discovery is installation relative

Renderer preparation SHALL include required source inputs when the canonical installation is nested under a `.abracode` ancestor. Metadata exclusion SHALL apply only to exact installation-relative `.abracode` path segments, not absolute ancestors or similarly named source paths. Existing containment, canonical-path, symlink, input bounds and cache-integrity checks MUST remain enforced.

#### Scenario: Owned installation is under a worktree metadata ancestor

- **WHEN** renderer preparation runs from a valid installation nested under `.abracode/worktrees`
- **THEN** its required source inputs are retained and the configured build succeeds without changing source identity or metadata safety rules

#### Scenario: Source and metadata names are similar

- **WHEN** required source includes a `.abracode-other` path and installation-local `.abracode` metadata also exists
- **THEN** the source remains eligible while exact metadata segments remain excluded

#### Scenario: A renderer input redirects outside the installation

- **WHEN** an otherwise eligible input resolves through a link to an outside target
- **THEN** preparation rejects the escape rather than weakening containment to make the nested installation build pass
