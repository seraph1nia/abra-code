# Spec Delta

## ADDED Requirements

### Requirement: Mandatory finishing decisions bypass optional diagnostic exhaustion

Local synchronization, scope and cleanup disposition questions needed to finish an execution SHALL be retained as user-owned obligations and delivered through Abra independently of optional stall-diagnostic budgets. The obligation SHALL identify current execution generation, applicable content or residue evidence, concrete choices and the clearing action. Delivery SHALL be deduplicated and retain native admission/form identity across restart. An unrelated admitted, unavailable or exhausted incident MUST NOT indefinitely suppress routing of the mandatory question. Routing a decision MUST NOT grant repair, merge or disposal authority; each consequential action SHALL require its matching controller gate and receipt. Intentional pause SHALL suppress dependent actions without hiding existing questions.

#### Scenario: Earlier stall consumed the diagnostic budget

- **WHEN** cleanup requires user disposition after an earlier stall has exhausted the execution's diagnostic allowance
- **THEN** the concrete finishing question and any required native form still reach Abra without resetting or increasing the diagnostic budget

#### Scenario: Unhandled older incident occupies attention capacity

- **WHEN** an older attention admission is unresolved while a mandatory finishing decision is ready
- **THEN** the controller revalidates that admission, releases its slot if authoritatively obsolete, and durably queues current decision routing without treating the occupied optional-diagnostic slot as an indefinite veto or starting duplicate concurrent Supervisor prompts

#### Scenario: Delivery response is lost

- **WHEN** a finishing question or its native form was submitted but the admission response was lost
- **THEN** recovery observes the retained admission identity and reuses it rather than presenting another independent approval request

#### Scenario: User defers cleanup

- **WHEN** the user explicitly defers a finishing decision or pauses the execution
- **THEN** the obligation retains that disposition, the resources remain preserved, and unchanged polling does not repeatedly ask or resume dependent work

### Requirement: Attention follows its current underlying condition

The controller SHALL re-evaluate retained attention against authoritative current execution state. A suspected worker stall that is disproved by subsequent meaningful progress, successful completion of its owned turn or transition beyond that worker SHALL be superseded with retained evidence and its attention slot released. A resolved or replaced finishing blocker SHALL supersede only its matching obsolete incident. Historical diagnostic exhaustion SHALL remain inspectable but MUST NOT by itself determine the current ticket label. Unresolved failures, identity conflicts and user decisions MUST NOT be cleared merely because another phase or status message appears.

#### Scenario: A previously stalled worker completes

- **WHEN** retained native evidence proves the worker turn associated with a suspected stall completed and execution advanced to delivery
- **THEN** the old stall is superseded and no longer consumes an admission slot or labels the ticket exhausted

#### Scenario: Cleanup residue changes

- **WHEN** fresh owned inspection proves a previous cleanup blocker resolved or replaced by a different blocker
- **THEN** only the obsolete matching incident is superseded and any current question remains visible with its own evidence

#### Scenario: Unrelated question is still open

- **WHEN** a stall is superseded while another current user-owned decision remains open
- **THEN** that decision remains retained and actionable without being cleared as part of stall housekeeping
