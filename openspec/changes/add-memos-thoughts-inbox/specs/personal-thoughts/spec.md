# Spec Delta

## Purpose

Let an operator capture private thoughts independently of projects and recover their original wording when discussing an idea or accepting it as work.

## ADDED Requirements

### Requirement: Connect a private notebook independently of projects

The operator SHALL be able to configure one optional Memos connection. List, detail and save SHALL use the connected account's private personal memos outside shared Spaces. Personal configuration SHALL accept a Memos token directly or by file reference. The service SHALL retain the credential server-side. The connection SHALL work with zero registered repositories.

#### Scenario: A new installation has no projects

- **WHEN** the operator connects Memos and their account can see an untagged private personal memo, a public memo and a shared Space memo
- **THEN** only the private personal memo is discoverable and in scope for direct lookup

#### Scenario: A fresh local notebook starts with the development workspace

- **WHEN** the operator runs `pnpm dev` with a fresh Compose notebook and no explicit Memos connection
- **THEN** Abra provisions the local development login, automatically connects its private notebook and reuses the credential on later launches

#### Scenario: Connection is omitted

- **WHEN** the operator launches AbraCode with existing personal settings and no explicit or provisioned notebook
- **THEN** ordinary workspace and coding operations remain available without contacting Memos

### Requirement: Save a thought once with its original wording

On an explicit save request, Abra SHALL store the supplied wording as a private memo and return its source reference once creation is verified. Retries of one request SHALL resolve to at most one memo. Content or identity conflicts SHALL be reported. A save SHALL require neither a repository nor a model-generated title, and SHALL create no work assignment.

#### Scenario: Response lost on the road

- **WHEN** Memos commits a multiline thought, the reply is lost, and Abra retries the same request after restart
- **THEN** Abra returns the verified reference to the original memo with its line breaks intact, or reports an unresolved save if it cannot verify the outcome
- **AND** retries do not create another memo or falsely acknowledge success

#### Scenario: A key is reused with different wording

- **WHEN** a save reuses an existing request identity with different content
- **THEN** Abra reports the conflict and preserves the existing note

### Requirement: Search and inspect the same notebook from chat and the app

Chat and the app SHALL support live, paginated reads by text, tag and creation date. Each result SHALL include its scoped identity, wording digest, snippet, tags and timestamps. Detail SHALL verify scope and wording. A failed search SHALL be distinguishable from an empty one.

#### Scenario: An edit or reused ID changes the selected wording

- **WHEN** the current content differs from the selected wording digest
- **THEN** Abra requests a fresh selection before disclosing or using the changed text
- **AND** a fresh search observes the current version

#### Scenario: An idea is captured while AbraCode is off

- **WHEN** an operator saves an untagged memo directly in Memos from a phone while AbraCode is stopped and later searches from chat and the app against the same notebook state
- **THEN** both return the same matching identities in the same order across pages, and opening the result returns its current wording

#### Scenario: Selected memo leaves the account or changes visibility

- **WHEN** an old reference or cursor is used after switching accounts, or the selected memo is deleted or moved outside the private scope
- **THEN** AbraCode reports the reference as unavailable and does not disclose the old body or substitute another memo

### Requirement: Keep notebook tools scoped to user intent

The central Supervisor SHALL have save, search and get operations. Its guidance SHALL treat retrieved text as source material. Reading a thought SHALL confer no authority to alter the notebook or initiate work. Managed coding workers SHALL have no notebook tools or connection credentials.

#### Scenario: A memo contains an instruction

- **WHEN** the operator asks to read a memo whose content says to start a project or delete a note
- **THEN** Abra presents it as memo content and neither action occurs

### Requirement: Accept selected wording through ordinary coding intake

An explicit work request SHALL bind the chosen goal, registered target repository, memo reference and accepted excerpt to the durable local issue through existing intake and retry policy. Later memo edits SHALL leave the accepted scope intact. Only the selected material SHALL be supplied as notebook context to coding workers.

#### Scenario: Follow-up to a personal idea becomes a coding task

- **WHEN** the operator chooses an excerpt, requests a specific outcome in a registered repository and repeats that request after a lost response
- **THEN** the same issue retains the agreed goal, excerpt and source identity under the usual workflow and approval policy
- **AND** a later edit to the original memo is visible on lookup without rewriting the issue

#### Scenario: The operator wants to discuss an idea

- **WHEN** the operator asks what a first step might be or has yet to choose a target repository for coding work
- **THEN** Abra can discuss the memo or ask for the missing target without creating an issue or starting a worker
