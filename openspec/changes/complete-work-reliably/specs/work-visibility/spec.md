# Spec Delta

## ADDED Requirements

### Requirement: Present current finishing work and its decision

Supervisor tools, work home, sidebar and ticket detail SHALL consistently identify current synchronization, cleanup preflight, approval, preservation, cleanup and closure observations. A current finishing decision SHALL display its owner, safely encoded affected paths or content identity, relevant evidence age, available choices and next clearing action. The normal successful end state SHALL show verified closure rather than a lingering open ticket or an obsolete stall. Historical exhaustion SHALL remain available in diagnostics but MUST NOT override a resolved condition or current finishing stage. The observer SHALL remain read-only, preserve offline freshness labels and distinguish unavailable observations from confirmed readiness.

#### Scenario: Cleanup needs a decision before merge

- **WHEN** an otherwise synchronized PR is waiting on unexpected-file disposition
- **THEN** work home and Abra identify the concrete cleanup decision rather than presenting the PR as ready to merge or merely saying suspected stall and exhausted

#### Scenario: Local edits require republication

- **WHEN** pending local work is being revalidated and published
- **THEN** the work surface identifies synchronization in progress, the last confirmed publication and consumed synchronization allowance without presenting an old approval as authorization for the new head

#### Scenario: PR merged and ordinary cleanup proceeds

- **WHEN** delivery preservation is verified and authorized retirement is progressing
- **THEN** the surface reports delivery verified and cleanup in progress while keeping issue closure separate until the work graph confirms it

#### Scenario: Closure completes after restart

- **WHEN** reconciliation confirms native retirement and work-graph closure after a restart
- **THEN** subsequent reads show the ticket closed with its retained delivery history and without an obsolete exhausted incident keeping it under Needs you

#### Scenario: A mandatory question cannot currently be delivered

- **WHEN** the retained Abra session is unavailable or native admission remains temporarily blocked
- **THEN** the current question and routing state remain visible in tool and native observations with a concrete recovery action rather than being hidden behind generic diagnostic exhaustion

#### Scenario: Offline preflight observation becomes stale

- **WHEN** the observer is disconnected after a previously successful preflight
- **THEN** the retained result is marked with its observation age or unavailable freshness and cannot be presented as current merge authority
