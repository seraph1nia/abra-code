# Workspace view authoring

## ADDED Requirements

### Requirement: Answer a request for a visual explanation in context

When the user asks to see a topic already identified in the conversation, the Supervisor SHALL publish a focused workspace view using the relevant observations and briefly state the takeaway in chat. The user can refer to the preceding answer in ordinary language.

#### Scenario: A dependency blocks delivery

- **WHEN** the Supervisor has identified an outstanding prerequisite as the cause of a delivery wait and the user follows up with “Can you show me why?”
- **THEN** the attached view identifies the blocked issue, its prerequisite and their relationship using the issue scope from the conversation.

#### Scenario: A decision blocks delivery

- **WHEN** the user asks the same follow-up for an issue that has dependencies but whose observed delivery wait is for a human decision
- **THEN** the attached view foregrounds the outstanding question and identifies the issue it concerns.

#### Scenario: The cause is unknown

- **WHEN** a user asks to see why an issue is blocked and the only available evidence lists related issues without establishing a cause
- **THEN** the response identifies the gap and distinguishes the observed relationships from any explanation of the wait.

#### Scenario: Compare two plans

- **WHEN** two identified plan revisions are available and the user asks for a visual comparison of what changed
- **THEN** the view pairs each consequential change's previous and proposed behavior, labels the two revisions, and keeps supporting excerpts secondary to the comparison.

### Requirement: Follow specified work through dashboard revisions

The Supervisor SHALL use live work data for a dashboard requested for ongoing monitoring and SHALL revise the same view when the user asks to add information to it, preserving the requested work scope unless the user changes it.

#### Scenario: Extend a release dashboard

- **WHEN** the user asks for a dashboard to follow a specified set of release issues and later asks “Add pending decisions”
- **THEN** the initial dashboard follows those issues live, and the next revision of that dashboard presents decision information for the same issues alongside the existing release view.
