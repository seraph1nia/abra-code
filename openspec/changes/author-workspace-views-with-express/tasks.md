# Tasks

## 1. Compile Express against the work catalog

- [ ] 1.1 Pin the server-side `@a2ui/agent` dependency and use its public Express API with the generated work catalog, the supplied surface ID and protocol v1.0. Record the exercised exports and versions in `docs/supported-apis.md`, update the license inventory and verify one resolved web-core identity with the existing dependency checks.
- [ ] 1.2 Bound UTF-8 source before parsing using the current work-surface byte ceiling. Compile the complete untagged body, require exactly one matching v1.0 creation and pass the whole output through the current work-surface validator. Extend the fast surface tests with nested rows and columns, a custom widget, a typed resource link, malformed syntax, mismatched identity, unsupported operations and bindings, and input/output limits. Assert that identical input compiles to stable JSON.

## 2. Check and publish through the native tool

- [ ] 2.1 Replace the input in `packages/runtime/src/web/render-tool.ts` with the Express contract. Share checks for catalog structure, work bindings, resource ownership and diagrams between validate-only and fresh publication. Keep the committed-call lookup ahead of fresh workspace observation on retries. Exercise stale references between calls, invalid Mermaid, verifier unavailability and same-call replay against the existing publication owner.
- [ ] 2.2 Return a distinguishable validation-only success with the surface ID. Keep publication receipts on the existing success path and make tool presentation recognize only a real publication as an attachment. Use bounded native tool failures with actionable syntax, property, resource and diagram diagnostics. Test both modes, worker refusal, oversized diagnostics, repeated dry runs and a failed replacement. Verify the surface head, receipts and associations advance only on successful publication.
- [ ] 2.3 Update the native workspace provider fixtures and the tool contract in `docs/web-workspace.md`. Exercise the documented default publish call and optional dry run against the registered tool. Verify old raw-surface arguments are rejected and the existing JSON renderer opens the revision associated with the publishing message.

## 3. Equip the Supervisor to author views

- [ ] 3.1 Bundle `packages/agents/assets/skills/express/SKILL.md` as `abra-express` in the central skill inventory and Supervisor definition. Keep always-loaded guidance to a discovery hint. Generate component signatures from the installed work catalog for the skill, document the supported literal-text/layout subset, and include runnable examples for comparing two work items and showing a snapshot. Verify the skill loads only in the intended role, compile every example, and check generated signatures for catalog drift.
- [ ] 3.2 Exercise a disposable native workspace journey through dry run, failed draft, corrected publication and reload from the originating message. Verify only the corrected view has an attachment, with the expected widgets and bindings. Follow the repository verification recipe, then run `pnpm check` and `pnpm test:all`.
