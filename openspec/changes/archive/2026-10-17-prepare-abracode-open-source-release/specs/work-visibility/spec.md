# Spec Delta

## ADDED Requirements

### Requirement: Inspect workers without opening another conversation

AbraCode's work surface SHALL expose worker role, native activity, model selection, progress, decisions, reports and available bounded transcript evidence through read-only inspection. Worker selections and worker-related commands SHALL open this inspection rather than a native worker chat composer, and discovery MUST NOT create worker conversation tabs. Conversation navigation SHALL lead to Abra. Missing or retired worker evidence SHALL be labeled unavailable without inventing a transcript, and inspection MUST NOT submit prompts or advance lifecycle state.

#### Scenario: User selects a worker

- **WHEN** the user selects a worker from a ticket or worker command
- **THEN** the interface opens read-only worker inspection and preserves Abra as the conversational entry point

#### Scenario: New worker is discovered

- **WHEN** a refresh discovers a newly created managed worker session
- **THEN** activity is synchronized without opening or focusing a worker conversation tab

#### Scenario: Transcript is unavailable

- **WHEN** selected worker evidence cannot be loaded or was not retained
- **THEN** inspection labels its availability and keeps other ticket information usable

#### Scenario: User needs to give new instructions

- **WHEN** the user follows the conversation action from a worker inspection
- **THEN** navigation opens Abra and no input is forwarded to the worker as an observer side effect

## MODIFIED Requirements

### Requirement: Display native running and queued session state

Worker activity SHALL use the host's synchronized native session and pending-prompt state within read-only work views. Known queued prompts SHALL remain distinguishable from idle workers, including when a worker is not selected for inspection. Missing or failed synchronization MUST NOT be presented as authoritative idle state, and display data MUST NOT determine controller admission, approval or stop confirmation. Synchronization MUST NOT open a worker conversation or expose a worker composer.

#### Scenario: Worker has a queued prompt

- **WHEN** a managed session has pending native prompt admission but no running provider turn
- **THEN** its work view indicates queued activity rather than presenting it as idle

#### Scenario: Newly discovered worker is off screen

- **WHEN** a new managed session appears while its inspection is not selected
- **THEN** the observer synchronizes its native status and pending state without opening worker tabs or stealing focus from Abra

#### Scenario: Session synchronization fails

- **WHEN** worker status cannot be synchronized
- **THEN** the observer marks the presentation unavailable or stale rather than inferring confirmed worker quiescence
