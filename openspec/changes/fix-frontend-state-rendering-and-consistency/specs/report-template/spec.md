# Spec Delta

## ADDED Requirements

### Requirement: Render shared catalog layouts independently of the host shell

Every supported work widget SHALL retain readable layout and semantic styling in live views, frozen app previews and portable exports without relying on web-shell CSS. Disabling app navigation SHALL preserve card content geometry. Host differences MUST NOT compress titles into decorative columns, remove metadata styling or make later controls unreachable.

#### Scenario: Kanban is exported without app navigation

- **WHEN** a saved Kanban containing a task titled "Frozen task title" is exported and opened offline
- **THEN** the title uses the card's available text width rather than a 7px decorative column
- **AND** ordinary title text remains readable without character-by-character wrapping

#### Scenario: Every widget is viewed in each supported host

- **WHEN** a fixture containing every supported work widget is opened as live app content, frozen app content and relocated portable HTML
- **THEN** cards, tables, metrics, decisions, dependencies, timelines, resource labels and diagram presentations retain their defined readable structure
- **AND** live links remain labeled as current navigation while portable navigation remains unavailable without changing captured evidence

#### Scenario: Layout is narrow or contains long text

- **WHEN** the same fixture includes long titles, identifiers and excerpts at 375px, 390px and desktop widths in light and dark themes
- **THEN** surrounding content stays within the viewport, wide tables/boards/code scroll within their containers and later controls remain reachable

#### Scenario: Reader prefers reduced motion

- **WHEN** a reader with reduced-motion preference opens a portable report and operates its shared controls
- **THEN** shared presentation honors that preference without depending on a web-shell stylesheet

### Requirement: Size isolated HTML previews to their reading surface

Legacy retained HTML and explicitly exported HTML previews SHALL have a defined usable reading area within chat attachments, the inspector and expanded viewing. Their width SHALL fit the available container and their height SHALL permit reading and local scrolling. Preview sizing MUST preserve script sandboxing and withheld same-origin privileges.

#### Scenario: Legacy HTML is opened from an attachment or inspector

- **WHEN** a reader opens a supported retained HTML report preview
- **THEN** the frame fills the available reading width with an explicit usable height rather than an unstyled 300px by 150px frame
- **AND** the outer page has no horizontal overflow at 375px or 390px

#### Scenario: Export preview is opened and expanded

- **WHEN** a reader opens an explicit offline export preview or expands a retained report
- **THEN** the reading area follows the selected surface size, its content can be scrolled and closing returns focus appropriately
- **AND** the preview retains its isolation without using parent-document access to measure or resize report content
