# Spec Delta

## ADDED Requirements

### Requirement: Abra is the sole conversational user entry point

AbraCode SHALL expose one persistent central Supervisor agent named Abra as its normal user conversation. Launch, attach, user questions, work instructions, attention decisions and human checkpoint forms SHALL route through that central session and existing authorized controller routes. Explore, Apply, Review and Research SHALL remain independent controller-managed sessions, not alternative agents the user must converse with. A worker question SHALL retain its owner and durable identity and be presented for resolution through Abra. Naming or routing MUST NOT grant Abra implementation authority or replace required human authorization.

#### Scenario: Worker needs a user decision

- **WHEN** a worker reports an unresolved question owned by the user
- **THEN** it appears through Abra and the existing durable decision/form route without requiring a reply in the worker conversation

#### Scenario: Plan or merge needs approval

- **WHEN** the controller reaches a configured human checkpoint
- **THEN** the matching human form is presented in Abra and neither a worker report nor Abra's prose substitutes for its receipt

#### Scenario: User reconnects after service restart

- **WHEN** the existing AbraCode service and central session are rediscovered
- **THEN** the client attaches to the same Abra session with pending obligations preserved

### Requirement: Managed worker prompts require retained controller admission

New prompts directed at assigned or historical managed worker sessions SHALL be admitted only when bound to an eligible retained controller prompt intent, session, role and execution generation. Direct foreground messages and unowned queued prompts SHALL be refused with guidance to use Abra before new worker model work begins. Client-supplied labels or queue delivery alone MUST NOT establish ownership. Native replay evidence for an already admitted owned prompt SHALL retain its existing identity and uncertainty semantics; rejecting a direct message MUST NOT stop or replace an independently valid owned turn.

#### Scenario: User opens a native worker conversation directly

- **WHEN** a new foreground prompt targets a managed worker session without an eligible controller intent
- **THEN** the request is refused and directs the user to Abra without starting worker work

#### Scenario: Caller queues an arbitrary worker prompt

- **WHEN** a queued prompt has no matching retained controller admission identity
- **THEN** queue delivery and supplied metadata do not authorize it

#### Scenario: Controller submits an eligible worker prompt

- **WHEN** the controller has retained the matching current assignment, prompt intent and context
- **THEN** native worker admission proceeds under the existing capability, policy and execution gates

#### Scenario: Owned submission is recovered after response loss

- **WHEN** native inbox/transcript evidence already contains the controller's retained prompt
- **THEN** recovery recognizes that admission without issuing a second prompt or interpreting it as a user conversation
