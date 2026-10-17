## Context

See proposal.md for motivation. CodingChecks records independent Review against the current verified worktree fingerprint. Advancement routes failed reviews through bounded correction or durable decisions, and finalization owns archival. Approved artifact fingerprints already prevent Apply from rewriting the accepted plan. The native tool schema and stored receipt must expose the same verification evidence.

## Goals / Non-Goals

Keep verification inside the existing read-only Review session and lifecycle. Make report completeness and contradictory verdicts mechanically checkable, while keeping semantic assessment with the reviewer. Retain short-contract lightweight work and avoid adding a separate review engine or automatic plan rewriting.

## Decisions

- Define one specification verification contract for native input, stored evidence and controller checks. Each dimension has an explicit status and evidence; unresolved conflicts contain source references and incompatible expectations. This replaces reliance on an unstructured pass alone.
- Require the scorecard for full-spec reports. Keep the stored field optional to decode historical records; a legacy pass still at the Review checkpoint cannot advance until explicit retry obtains current evidence. Lightweight reports retain their existing short-contract form.
- Accept justified not-applicable dimensions and advisory suggestions. Reject passing reports with failed or unverified applicable dimensions, unresolved conflicts, or unresolved scope dispositions.
- Normalize conflicting full-spec reports to uncertain scope unless already marked scope change. Include conflict sources in durable correction decisions, blocking automatic repair and explicit failed-Review retry while a scope decision remains open.
- A resolved decision permits explicit correction within the unchanged approved plan. Replanning changed requirements clears current evidence and the revised fingerprint must obtain configured approval. Reuse existing revision handling after archival.
- Put review guidance directly in the registered execution skill so workers can read it through the native skill tool without depending on access to reference files outside their assigned repository.

## Risks / Trade-offs

- Structured evidence cannot prove the reviewer's semantic judgment. Concrete source references and an independent role make the assessment inspectable; controller gates only enforce the report contract and accepted-plan identity.
- More report fields can expose stale provider fixtures or sessions. Native tests exercise the actual tool, and explicit retry recovers legacy passes at the Review checkpoint.
- A CI failure can represent either an implementation defect or an obsolete expectation. Corrections preserve the approved plan; contradictions discovered during repair must become questions rather than changes to requirements or weaker gates.

## Migration Plan

The added receipt field is optional on storage reads. New full-spec report submissions require it; existing full-spec passes pending the Review checkpoint must resubmit via explicit retry. Historical delivered records remain readable. A service restart loads updated controller/tool definitions and registered execution guidance.
