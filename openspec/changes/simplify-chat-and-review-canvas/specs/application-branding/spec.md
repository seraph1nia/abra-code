# Spec Delta

## ADDED Requirements

### Requirement: Keep workspace controls in one compact header

The web workspace SHALL present one compact header with the Abra identity, work finder, connection or working state, pending attention, and access to appearance and Settings. Changing between light, dark, and system appearance SHALL be possible in place while composing or reviewing.

#### Scenario: Change appearance during a review

- **WHEN** a developer changes appearance with a canvas selection, a partially answered form, and an unsent message
- **THEN** the appearance updates across the open workspace, focus can return to the menu trigger, and the selection, reading position, form values, and message remain available

#### Scenario: Use the header on a phone

- **WHEN** the workspace is opened at a width of 375 or 390 pixels and the connection is interrupted
- **THEN** the connection state has an accessible text description, the work finder and pending attention remain reachable, and the header fits without page-wide horizontal scrolling

### Requirement: Give conversation prose a readable measure

The transcript SHALL give prose a comfortable reading width and render a short user message in a bubble sized to its content. Code, tables, and diagrams SHALL be able to use the available reading pane. Shared controls in the composer, canvas, and generated views SHALL follow the active palette and expose legible labels and keyboard focus.

#### Scenario: Read a short question and a long answer

- **WHEN** a wide desktop shows a short user question followed by several paragraphs and a wide code example
- **THEN** the short question occupies only the space it needs, the paragraphs have a bounded line length, and the example can use extra width independently of the prose

#### Scenario: Review evidence beside chat or in a sheet

- **WHEN** the reader resizes the desktop canvas or opens and dismisses the narrow-screen viewer
- **THEN** prose wraps in the available space, wide evidence can be inspected locally, and the anchored message and composer remain reachable
