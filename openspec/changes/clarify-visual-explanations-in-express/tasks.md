# Tasks

## 1. Teach the Supervisor to choose a view

- [x] 1.1 Update the frontmatter description and add a concise “Choose the view” section before the syntax in `packages/agents/assets/skills/express/SKILL.md`. Use original, conversational examples covering a visual follow-up, a comparison and a dashboard revision. Check the registered Supervisor skill description for discoverability and run the existing `engineering-skills.test.ts` checks for role availability, catalog signatures and executable examples.
- [x] 1.2 Ground each example in its inputs. Use the observed issue IDs with DependencyGraph or DecisionSummary according to the cause of a wait. Acknowledge missing causal evidence. Pair the two plans' consequential differences in a Table, using Disclosure for longer excerpts when helpful. For a release dashboard, bind the scoped work widgets live and reuse the surface ID on revision. Check the examples against the installed catalog and verify that the plan comparison labels both revisions.

## 2. Verify the conversational result

- [ ] 2.1 In disposable Supervisor conversations, follow a status answer with “Can you show me why?” Use a prerequisite wait in one case and a decision wait with an incidental dependency in the other. Give the Supervisor the observations and user request without prescribing a skill or widget. Inspect the resulting attachments, issue scope and brief chat takeaways. Repeat with inconclusive evidence and check that the response exposes the gap.
- [x] 2.2 Exercise the plan comparison and the release dashboard follow-up. Inspect the before/after values against the input plans. For “Add pending decisions,” verify the new publication has the original surface ID, a later revision, the same release issue IDs and live bindings. Retain the prompts and observed results using the repository verification recipe. Run `pnpm check` and `pnpm test:all` before handoff.
