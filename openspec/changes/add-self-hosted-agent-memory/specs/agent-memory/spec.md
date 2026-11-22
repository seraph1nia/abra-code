# Spec Delta

## Purpose

Give operators and authorized agents a self-hosted collection of reusable knowledge that survives sessions and worktrees and can be edited with an ordinary Markdown editor.

## ADDED Requirements

### Requirement: Operate an optional local memory installation

Operators SHALL be able to enable an isolated Basic Memory installation on a supported host. Provisioned memory capture, indexing and text search SHALL work without a cloud account, remote inference or network listener. Notes, collection mappings and private publication records SHALL survive service restarts. Operators SHALL have a documented backup, restore and index-rebuild procedure.

#### Scenario: First installation or disabled provider

- **WHEN** personal settings omit memory or the operator disables it
- **THEN** normal development startup, configuration validation, work admission and Thoughts continue without installing, probing or launching Basic Memory
- **AND** disabling the feature preserves existing notes

#### Scenario: Restore after a lost index

- **WHEN** the operator restores the documented backup into a new installation directory, rebuilds its index and launches a fresh session with external networking unavailable
- **THEN** the authorized repository and shared notes can be found by text, and a prior publication retry resolves to its existing identity

#### Scenario: Provider cannot serve requests

- **WHEN** the executable is missing, incompatible, or times out on a request
- **THEN** the caller receives a bounded, actionable memory error distinguishable from an empty result, other work continues, and the operator can retry after repair

### Requirement: Retrieve scoped knowledge with a verifiable citation

Search SHALL return a bounded page of scoped references, titles and excerpts from the selected registered repository and the explicitly shared collection, or shared alone. Reading SHALL recheck scope and identify the note revision and whether the body is complete. The current Markdown files SHALL determine searchable content after indexing. Each repository's collection SHALL follow its registered identity across sessions and worktrees.

#### Scenario: A fresh worker recalls a prior project lesson

- **WHEN** two repositories contain similarly titled decisions and a fresh assignment in the first searches for the decision
- **THEN** hits and continuations cover only that repository and shared notes, retain unambiguous scope on every hit, and allow the agent to read and cite the matching revision

#### Scenario: A person edits or removes a note in Obsidian

- **WHEN** an operator changes a note on disk and then searches after indexing catches up
- **THEN** the search reflects its current wording, and reading a reference pinned to the previous revision reports a change
- **AND** a renamed or deleted note whose identity cannot be established returns unavailable without substituting a same-title note

#### Scenario: Invalid reference or escaped project location

- **WHEN** a caller supplies a foreign project reference, path traversal, escaping symlink or a continuation from another scope
- **THEN** the operation returns no content, snippets, identifiers or counts from outside the allowed collections

### Requirement: Publish reusable lessons under explicit scope

On an operator's explicit request, Abra SHALL save a note to one named repository or the shared collection. It SHALL identify what was observed, its applicability and the evidence available to the intended readers. Advice or personal observations SHALL remain distinguishable from verified outcomes. A correction SHALL create a separate note citing the exact identity and observed revision of the original in the same collection. Abra SHALL leave the original file under operator control.

#### Scenario: A reported workaround becomes a lesson

- **WHEN** Apply reports a workaround, Review checks it against current work, and the operator asks Abra to remember it for this repository
- **THEN** the note records the trigger, procedure, limits and supporting evidence, can be found in a later assignment, and publication does not change the issue's status

#### Scenario: A general technique is useful in another repository

- **WHEN** the operator explicitly selects the cross-project destination for a lesson
- **THEN** a worker in a different registered repository can retrieve the deliberately shared wording with its scope and revision
- **AND** private source material and repository-restricted evidence are not copied into shared content or exposed through dereference

#### Scenario: Similar advice is found during curation

- **WHEN** a search finds a similar note before a save
- **THEN** Abra can cite the candidate and create a separate correction citing the explicitly selected note and revision
- **AND** similarity alone never causes an automatic merge, cross-project promotion or deletion

### Requirement: Reconcile concurrent and uncertain publications

Every publication SHALL be bound to a stable request identity, destination, source and intended content. A retry SHALL return the verified original result, an explicit conflict or an unresolved outcome. Concurrent updates SHALL preserve human edits. A repeated request SHALL never create a second note or restore a deleted note behind the operator's back.

#### Scenario: Response lost after an upstream write

- **WHEN** a save commits, its reply is lost, and the same request is repeated concurrently or after restart
- **THEN** Abra verifies the exact destination, identity and content before acknowledging success, and retry produces at most one note
- **AND** reusing the key with another scope, source or body produces a conflict

#### Scenario: A note changes before revision or reconciliation

- **WHEN** a human edits or deletes the destination after Abra reads it and before Abra validates the original for a correction or reconciles an uncertain result
- **THEN** the newer state is preserved and the operator sees the conflict or unresolved result with a way to reselect or retry

### Requirement: Promote only selected wording from a private thought

Thoughts and an explicit request to Abra SHALL support remembering a selected contiguous excerpt for a chosen registered repository or for all projects. A first publication SHALL verify the live notebook account, private scope, wording hash and exact excerpt. Full notebook references SHALL stay operator-private. Reading, discussing or accepting a thought for an issue SHALL confer no memory-publication authority.

#### Scenario: Share one sentence from a phone

- **WHEN** an operator selects one sentence from a two-sentence private memo in Thoughts and chooses a repository
- **THEN** the operator sees the exact excerpt and destination, the action can finish without a model turn or an issue, and a fresh authorized worker finds only the selected sentence
- **AND** an ordinary notebook save or a work-intake action leaves the memory collection untouched

#### Scenario: Selection is stale

- **WHEN** the memo was edited, replaced, moved outside private scope or the account switched before the first publication
- **THEN** Abra requests a fresh selection or reports unavailability and publishes nothing
- **AND** later source changes do not alter a previously published excerpt
