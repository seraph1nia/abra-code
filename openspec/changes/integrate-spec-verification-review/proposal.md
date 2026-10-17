## Why

Independent Review currently accepts a pass without explicit evidence that code matches the approved OpenSpec change. Conflicting reviews, instructions or CI expectations also need a clear route that preserves the accepted requirements instead of automatically rewriting them.

## What Changes

- Include completeness, correctness and coherence verification in the existing full-spec Review, with concrete evidence and unresolved conflict references.
- Require that evidence in the controller before accepting a full-spec pass and advancing to archival.
- Route unresolved contradictions to durable scope decisions even when a reviewer labels them in scope; retain bounded repairs for clear implementation defects.
- Preserve lightweight Review's short contract and report compatibility for stored historical records.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-policies`: Require explicit independent specification verification and evidence-based conflict resolution without silently changing approved scope.

## Impact

Review report tool and stored receipt, controller admission and recovery, worker prompts and execution guidance, regression tests and native end-to-end provider fixture. No additional native API or lifecycle phase is introduced.
