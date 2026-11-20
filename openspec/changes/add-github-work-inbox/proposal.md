# Proposal

## Why

The Work finder starts with work Abra already tracks. Operators need to see what is open across their onboarded GitHub projects, including a colleague's PR or an unlabeled issue, before deciding whether to involve Abra.

## What Changes

- Show every open issue and PR from onboarded GitHub repositories in the default Work overview and in the answer to “What's open?” Keep local-only work reachable. Project, kind, label, state and Abra's role are optional filters.
- Show who opened each item, the GitHub state and Abra's role. An issue can lead to a local task, a PR can have a private review assignment, and a controller-published PR can deliver a task. Keep linked items individually discoverable.
- Support “pick up this issue” through ordinary work intake and “review this PR” through read-only research on its actual changes. Repeat requests return the existing local task, including a completed review. Report local progress, remote closure and merge independently.

## Capabilities

### New Capabilities

- `github-work-inbox` covers repository inventory, stable work links and explicit intake from a GitHub item.

### Modified Capabilities

- `work-visibility` extends the Work finder, item inspection and conversational discovery to include external items before local intake.

## Impact

Extend the native forge reader, SQLite work graph and controller intake, shared visibility contracts, supervisor tools, Work finder and canvas. Add an additive work-link migration. Recognize PRs recorded by existing executions on first use. Existing local issue IDs, workflow policy, delivery records and approval paths remain authoritative.

## Scope and Choices

Use the configured GitHub CLI via the existing `Forge` runner. It already handles machine credentials, isolated repository context and schema-decoded JSON. Octokit would introduce a second client and credential path for reads the existing adapter can perform. GitHub supports authenticated GraphQL requests and variables through this CLI. [GitHub CLI manual](https://cli.github.com/manual/gh_api)

For each registered GitHub origin, bind the host and verified repository, then call `gh api graphql` with fixed queries and variables. Page `repository.issues` and `repository.pullRequests` independently with `states: [OPEN]` by default. Store the host, repository node ID, item kind and item node ID as identity. Display owner/name and number. Fetch bodies, discussion and review evidence on demand. Refresh on inbox access or request, bound each read, and expose continuation and per-project coverage. [Repository fields](https://docs.github.com/en/graphql/reference/repos#repository) · [GraphQL pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api)

Assignment needs an explicit request. A label, author, branch name, mention or review request is descriptive metadata. Reading and reviewing a colleague's PR can produce a private retained report. Public comments, automatic assignment and GitHub close/reopen actions are follow-up work. Existing controller-owned delivery continues through its current gates.

## Retrieval and retention

The native service owns one SQLite summary index shared by chat and Work. Bind observations to authenticated viewer, host and verified repository. Store summaries, indexed filter fields and per-kind coverage separately from permanent source links, accepted scope and reports. Keep selected bodies and discussion in a size-bounded five-minute memory cache. Read patches only for a requested review.

On first demand, publish pages of 50 as they arrive with at most two concurrent inventory calls, alternating repositories and kinds. Fresh reads query SQLite. Coalesce stale refreshes across callers after five minutes, refresh while visible and suspend when hidden. Manual refresh respects backoff. Closed history is demand-loaded. Display partial results and last successful observation on interrupted reads. Keep unlinked closed summaries for 30 days after observation.

After open inventory completes, read all states in descending update order through an overlap with the previous successful scan. Commit each page and continuation atomically and advance the freshness checkpoint only on successful completion. Periodically reconcile open inventory on demand to recover from membership drift. Absence from a scan requires a targeted check before declaring closure. Revalidate source identity and revision for intake independently of cache freshness.
