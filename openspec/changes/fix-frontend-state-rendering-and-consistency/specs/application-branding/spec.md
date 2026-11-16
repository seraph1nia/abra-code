# Spec Delta

## ADDED Requirements

### Requirement: Preserve owned typography across presentation hosts

Owned workspace, generated view and portable report content SHALL use the documented type hierarchy and available font stack. Vendor styling MUST NOT silently reset owned heading size, weight or font family. Supported app portals SHALL inherit the same resolved presentation tokens as their invoking surface.

#### Scenario: Workspace mounts beneath vendor styling

- **WHEN** the default workspace renders the Abra heading and owned section headings
- **THEN** their computed size, weight and font family match the owned design rules rather than vendor resets
- **AND** the default Abra heading is 25px with weight 550

#### Scenario: Reader opens a portalled control

- **WHEN** a reader opens an inspector sheet or tooltip in light or dark mode
- **THEN** its text, background, borders and focus indication follow the active theme without acquiring a different font stack

#### Scenario: Fonts are unavailable from the network

- **WHEN** the workspace or portable report renders offline
- **THEN** the documented system font stack remains usable without a missing custom-font promise or remote font request

### Requirement: Resolve web theme before first visible presentation

The web entry SHALL apply a valid saved light/dark preference or the current system preference before visible application presentation. Theme selection SHALL remain usable when browser storage is unavailable, and system mode SHALL respond to operating-system changes. Theme preference MUST NOT change native session or workflow state.

#### Scenario: Saved dark preference is restored

- **WHEN** the page opens with a saved dark preference while the system prefers light
- **THEN** the first visible application background and native color scheme are dark without an intervening light application frame

#### Scenario: System preference changes

- **WHEN** system mode is selected and the operating-system color preference changes
- **THEN** mounted ordinary and portalled content uses the new resolved theme without reloading or losing edits

#### Scenario: Browser storage cannot be read or written

- **WHEN** theme persistence is unavailable
- **THEN** the system default and mounted theme controls still work without crashing the app or report

### Requirement: Present consistent semantic colors and active controls

Ordinary status indicators, attention accents, errors and selected navigation SHALL use shared semantic light/dark styling with visible text and keyboard focus. Active navigation MUST follow its actual selected state. A verified light diagram canvas SHALL remain an explicit readable exception with themed surrounding controls.

#### Scenario: Inspector tab is selected

- **WHEN** an inspector or nested activity tab becomes selected by pointer, keyboard or restored URL
- **THEN** the selected label and indicator receive the documented active styling while unselected tabs remain distinguishable

#### Scenario: Theme changes with attention and errors visible

- **WHEN** the reader changes theme with status indicators, an attention form and an error displayed
- **THEN** all remain readable with their semantic colors and textual meaning intact

#### Scenario: Diagram appears in a dark report

- **WHEN** a prepared diagram is viewed in dark mode
- **THEN** its light canvas retains readable labels and edges while its frame, source disclosure and controls match the surrounding theme
- **AND** theme changes do not modify the captured diagram source

### Requirement: Reuse consistent accessible controls and icons

Owned actions and preferences SHALL use consistent shared control styling and a consistent icon set across web and portable views. Icon-only actions SHALL retain accessible names and visible focus; decorative icons SHALL be hidden from assistive technology. Replacing an icon MUST NOT remove meaningful action or status text.

#### Scenario: Reader uses workspace actions

- **WHEN** refresh, close, send, stop, add, attachment or external-navigation indicators appear
- **THEN** their icons have consistent geometry and alignment rather than platform-dependent text-symbol presentation
- **AND** keyboard and assistive-technology users can identify and operate the actions

#### Scenario: Reader toggles an offline report theme

- **WHEN** the reader toggles the report's labeled theme control by pointer or keyboard
- **THEN** its appearance follows the same shared control conventions and local theme changes require no storage privileges or network

### Requirement: Resolve generated components to one shared source

The supported component-generation command SHALL resolve reusable controls and utilities to the shared presentation owner. Application configuration MUST NOT recreate an independent primitive library or refer to nonexistent utility files. Generated reusable output SHALL remain consumable by both applications through declared package exports.

#### Scenario: Contributor adds a reusable control

- **WHEN** the documented generation command runs in a disposable checkout
- **THEN** reusable component and utility imports resolve to the shared package and package checks succeed
- **AND** no duplicate reusable control tree is created under the web application
