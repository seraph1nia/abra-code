## ADDED Requirements

### Requirement: Focused decision review

The workspace SHALL present consequential Explore choices as a single revision-bound batch and present the current plan brief with its material changes.

#### Scenario: Review a batch

- **WHEN** Explore raises independent consequential choices
- **THEN** the person can review the recommendation for each, accept them together or edit answers before submitting one native form

#### Scenario: Deliver a decision in Chat

- **WHEN** a new decision reaches idle desktop Chat
- **THEN** its bound editor opens beside the conversation once for that revision

#### Scenario: Preserve focus

- **WHEN** a decision arrives while the person is typing, inspecting evidence or using a phone
- **THEN** Chat offers direct access while preserving the current view and draft

#### Scenario: Review a first plan

- **WHEN** a person reviews a new full OpenSpec plan
- **THEN** its brief presents outcomes, the recommendation, risks and evaluated alternatives with their tradeoffs, with supporting documents available on demand

#### Scenario: Review a revised plan

- **WHEN** a revised plan is presented
- **THEN** the canvas leads with the changes and their significance, or identifies unavailable comparison evidence, and offers the full current brief

#### Scenario: Read the outcome

- **WHEN** a person opens Reports for completed work
- **THEN** the report summarizes delivery, verification, limitations and the next action, with detailed evidence available on demand
