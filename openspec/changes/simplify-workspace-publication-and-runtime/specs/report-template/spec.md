# Spec Delta

## MODIFIED Requirements

### Requirement: Reuse prepared renderer assets across documents

Explicit exports SHALL pin one complete immutable renderer installed by a successful build or explicit renderer preparation. Each export SHALL embed its exact captured document and matching prepared diagrams as inert data. Normal export SHALL verify the prepared assets it uses without compiling application code, resolving mutable renderer dependencies or rescanning renderer source inputs. Preparation or export failure MUST preserve canonical JSON and previous artifacts.

#### Scenario: Two documents use the same renderer

- **WHEN** two distinct saved documents are exported under the same installed renderer identity
- **THEN** they share the prepared code, styles, diagram preparer and notices and each HTML artifact contains only its own document and matching diagram data

#### Scenario: Concurrent exports need an unprepared renderer

- **WHEN** exports require a new artifact and the installation has no complete compatible prepared renderer
- **THEN** each export reports how to run the build or explicit renderer preparation command and preserves the documents and existing exports
- **AND** any concurrent preparation makes its bundle selectable only after successful verification

#### Scenario: Renderer preparation is interrupted

- **WHEN** preparation stops before a complete verified renderer is installed
- **THEN** the prior complete renderer, if present, remains selected and the interrupted attempt publishes no partial bundle or HTML artifact

#### Scenario: Preparation completes during an export

- **WHEN** an export pins one bundle and another successful preparation activates a new bundle before export completes
- **THEN** the in-flight export can finish with the verified assets and original identity it pinned, and subsequent exports select the newly active bundle

#### Scenario: Prepared assets are damaged

- **WHEN** required prepared bytes fail integrity validation
- **THEN** export reports the problem before using those bytes and preserves the affected evidence, saved JSON and existing valid exports

### Requirement: Export cache identity follows rendering inputs

Exporter identity SHALL cover prepared renderer behavior, catalog, styles, resolved rendering dependencies including the diagram preparer, prepared-asset format and required notices. Relevant changes SHALL take effect at successful explicit preparation. Unrelated backend or dependency changes MUST NOT invalidate the prepared identity. Existing receipts and destinations SHALL retain their original identity.

#### Scenario: Unrelated controller source changes

- **WHEN** a backend-only file changes while all rendering inputs remain unchanged
- **THEN** export and subsequent explicit preparation reuse the existing exporter identity and verified cached artifact

#### Scenario: Unrelated dependency resolution changes

- **WHEN** only a dependency outside the renderer's resolved inputs changes
- **THEN** exporter identity remains unchanged after explicit preparation

#### Scenario: Renderer dependency or notices change

- **WHEN** renderer sources, a resolved rendering dependency, catalog behavior, style, asset format or a required notice changes on disk
- **THEN** exports continue to use the active bundle, including its original diagram behavior and notices
- **AND** after a successful build or explicit preparation incorporates the rendering change, exports use a distinct identity and previous valid exports remain readable under their original receipts
