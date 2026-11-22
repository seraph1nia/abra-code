# Spec Delta

## MODIFIED Requirements

### Requirement: Recommend the next actionable item on demand

Abra SHALL give one evidence-backed recommendation for a focus request and lead a catch-up request with the same choice given the same scope, evidence and stated priorities. It SHALL identify the decisive fact and source or explain why no supported action is available. Asking for or challenging advice SHALL leave assignments, approvals and tracked priorities intact.

#### Scenario: A decision can unblock other work

- **WHEN** the developer asks each question with the same priorities and a human decision is the only available action that unblocks the release
- **THEN** both answers lead with that decision and identify the dependency. The focus answer can end there. Catch-up also summarizes recent outcomes, work progressing independently and queued or gated work.

#### Scenario: Available evidence limits the choice

- **WHEN** a source is stale, unavailable or truncated
- **THEN** Abra states which part of the answer has limited coverage, preserves independently evidenced decisions and qualifies the recommendation. A claim that the developer has nothing to do requires sufficient coverage of the selected scope.

#### Scenario: A challenge changes the premise

- **WHEN** the developer moves a deadline in conversation or challenges the choice, then asks for focus or catch-up
- **THEN** Abra uses that premise in both answer styles, explains why its choice changes or holds, and keeps stored priorities until the developer requests a change.

#### Scenario: The developer includes wider GitHub work

- **WHEN** the developer requests “include open GitHub work” or explicitly selects a repository's GitHub inbox
- **THEN** either answer style considers the same expanded scope and identifies the relevant GitHub item. Ordinary briefings cover Abra-tracked work and its linked evidence. An unrelated open PR alone establishes no human obligation.

## ADDED Requirements

### Requirement: Resume work from a current briefing

A requested briefing SHALL use a bounded current snapshot and identify human decisions, recent finished outcomes, ongoing assignments and queued work with their blockers. It SHALL preserve the distinction between a proposed next action and a required human decision. Material items SHALL have identifiable sources and usable targets where available. Asking for or opening a briefing SHALL leave work and outstanding decisions intact.

#### Scenario: Return on a fresh browser

- **WHEN** one tracked PR has a current human merge checkpoint, a never-inspected investigation has finished and a third task awaits CI
- **THEN** chat identifies the single human action, opens the corresponding evidence and current form, links the saved research findings, and describes the CI wait as work Abra is watching. A blocked dependent identifies what must clear.

#### Scenario: Reopen the same situation

- **WHEN** the developer requests another briefing and the same human decision is still outstanding
- **THEN** the decision remains visible regardless of its age or prior inspection. The recent outcomes can repeat. The briefing describes them as recent outcomes without asserting they appeared since the developer last looked.

#### Scenario: Follow a stale or settled decision

- **WHEN** another device settles a question or a PR head changes before the developer opens or submits the decision
- **THEN** the existing native checkpoint route revalidates the binding. The app explains the changed state and offers the next current decision when one exists. Opening a briefing or clicking its evidence never approves or advances work.

#### Scenario: The covered fleet is quiet

- **WHEN** observation covers the selected scope, there are no human actions and only an ordinary CI wait remains
- **THEN** Abra says that nothing needs the developer and identifies the wait in a short answer.

### Requirement: Reopen recently inspected tasks from Work

Work and workspace search SHALL retain Recently inspected as a device-local navigation list of explicitly visited tasks. With existing or fresh browser storage, the list SHALL serve only as a shortcut for reopening work. Chat SHALL be the single user-facing focus and briefing experience.

#### Scenario: Reopen a task after upgrade

- **WHEN** existing local inspection history identifies a still-accessible task with no new result
- **THEN** Recently inspected lets the developer reopen that task from its existing destination. The standalone change comparison and a parallel briefing panel are absent.

#### Scenario: No local history

- **WHEN** the browser has no local visits or cannot read its storage
- **THEN** Recently inspected explains its empty or unavailable state. Chat can still brief the developer and Attention can still show current obligations.

## REMOVED Requirements

### Requirement: Separate current attention from local reading history

**Reason**: The device-local comparison duplicates the conversational return-to-work experience and misses unvisited tasks.

**Migration**: Use the current chat briefing for outcomes and decisions, Attention for outstanding forms, and Work → Recently inspected to reopen a visited task.
