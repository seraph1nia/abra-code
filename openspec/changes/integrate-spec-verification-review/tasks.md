## 1. Independent verification contract

- [x] 1.1 Add shared completeness/correctness/coherence and conflict evidence to full-spec Review reports, with controller admission and archival guards; verify rejection and delivery scenarios in spec-verification.test.ts.
- [x] 1.2 Preserve lightweight reports and historical storage decoding while supporting explicit retry of legacy passes at the Review checkpoint; verify unit recovery and native report fixtures.
- [x] 1.3 Document verification in the registered execution skill, Review agent, operations and recovery guidance; confirm workers can obtain guidance through their existing skill tool.

## 2. Conflict resolution

- [x] 2.1 Retain referenced contradictions as durable uncertain/scope-change decisions and block automatic repair or failed-Review retry while scope is unresolved; verify source retention and unchanged plan fingerprints.
- [x] 2.2 Verify obsolete-test correction preserves accepted scope, while changed requirements require a revised plan approval; document the distinction from advisory suggestions.

## 3. Integration validation

- [x] 3.1 Run pnpm check, pnpm test and pnpm test:e2e and validate this OpenSpec change strictly; retain results without pushing to user remotes.
