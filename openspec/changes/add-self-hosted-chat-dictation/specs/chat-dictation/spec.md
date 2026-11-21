# Spec Delta

## Purpose

Let operators dictate English or Dutch into Abra's main chat, review words while speaking, and edit the resulting draft before delivery.

## ADDED Requirements

### Requirement: Control dictation from the active chat

When enabled, the native terminal and web chat SHALL offer a labeled mic control for the main Abra prompt, usable by pointer and keyboard. It SHALL show recording and finishing states, support finish and cancel, and acquire a microphone only after an explicit start.

#### Scenario: Record and finish in either client

- **WHEN** the operator activates the mic in an editable main chat, speaks, and activates it again
- **THEN** the client indicates recording, stops capture on the second activation, and returns focus to the editable draft after finishing.

#### Scenario: The active view cannot accept a chat draft

- **WHEN** a shell prompt, worker inspection, approval form, or pending submission has input focus
- **THEN** dictation cannot start against that target.

### Requirement: Recognize both languages on the configured host

Dictation SHALL use the operator-configured self-hosted recognizer for automatic language detection and explicit English and Dutch transcription. Audio and intermediate text SHALL be transient. Only text committed to a draft SHALL enter normal draft persistence and only submitted text SHALL enter the conversation.

#### Scenario: Dictate with external network access disabled

- **WHEN** the local model is provisioned and the operator dictates an English clip and a Dutch clip, using auto detection or the matching language setting
- **THEN** the client receives text in the spoken language through the configured self-hosted service, including when outbound internet access is blocked.

#### Scenario: Optional dictation is unavailable

- **WHEN** a user enables dictation but microphone access is denied or the recognizer is unreachable
- **THEN** the client identifies the failed prerequisite, releases its recording resources, and the user can continue typing and sending.

#### Scenario: Existing installation launches with default settings

- **WHEN** the operator starts either client with no dictation configuration
- **THEN** ordinary chat is available without a recorder, model download, or connection to a speech service.

#### Scenario: Restart the operator's speech service

- **WHEN** the operator recreates the speech service using its provisioned weights while Abra has an active turn
- **THEN** the active turn and typed chat continue, the weights are reused offline, and a new mic attempt can succeed when the recognizer becomes ready.

### Requirement: Preview speech while preserving responsiveness

In live mode, the client SHALL display provisional words as recognition progresses and allow them to be revised while the user edits the draft. An operator SHALL be able to choose transcription after capture on a slower host. Buffering SHALL be bounded in both modes.

#### Scenario: The recognizer revises a phrase after a pause

- **WHEN** an active stream delivers partial words, a revised phrase, and a finalized segment before the operator finishes
- **THEN** the preview reflects the latest wording in order, typing remains available, and the saved draft contains only the operator's edits until finishing.

#### Scenario: A host uses transcription after capture

- **WHEN** finish-only mode is selected
- **THEN** the recording indicator appears immediately and recognition begins after the operator finishes, yielding an editable transcript through the same mic interaction.

#### Scenario: A capture or transport limit is reached

- **WHEN** a slow or disconnected recognizer would exceed the documented buffering or time limit
- **THEN** the client ends the attempt, releases the microphone, explains the interruption, and preserves the draft for typing or retry.

### Requirement: Insert once into the originating draft

The client SHALL apply the completed transcript once as a local edit at the originating editor's current caret or selection, preserving concurrent typing, attachments, and delivery mode. Dictation SHALL give the operator control over subsequent editing and submission.

#### Scenario: Finish while editing a draft with an attachment

- **WHEN** the operator changes the text or moves the caret while speaking, finishes, and receives duplicate completion events
- **THEN** the client inserts the complete transcript once at the current editing position with surrounding text and attachments intact. No message is sent, queued, or used to steer work.

#### Scenario: Cancel or lose the original target

- **WHEN** the operator cancels, sends the draft, changes sessions or input mode, or closes the original client before recognition completes
- **THEN** the recording is disposed and subsequent recognition events cannot modify any draft, submit input, or affect another attached client.

#### Scenario: Empty or oversized transcript

- **WHEN** the clip contains no recognized speech or insertion would exceed the editor's supported draft limit
- **THEN** the client keeps the existing draft intact and reports the outcome.
