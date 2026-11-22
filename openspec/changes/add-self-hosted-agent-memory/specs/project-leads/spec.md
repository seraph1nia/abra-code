# Spec Delta

## ADDED Requirements

### Requirement: Consult memory through the scoped lead dispatcher

An enabled project lead SHALL be able to search and read knowledge for one of its assigned repositories and the shared collection through its existing lead action. Each operation SHALL verify the native caller, current registration and exact target repository. A lead SHALL route suggested lessons to Abra through existing communication.

#### Scenario: A lead managing two projects compares precedent

- **WHEN** the lead asks for prior decisions in one authorized repository
- **THEN** results contain only that repository and shared knowledge, and a separate authorized request is needed to consult the other repository

#### Scenario: A lead loses access after retrieving a hit

- **WHEN** a disabled or rebound lead attempts to follow an earlier hit, or an enabled lead names an unassigned repository
- **THEN** the dispatcher denies access before disclosing results or reading the note

#### Scenario: A lead identifies guidance worth sharing

- **WHEN** a lead sees a recurring fix that could help other projects
- **THEN** it can send Abra a scoped recommendation through the existing message route while publication remains an operator-directed action
