# Proposal

## Why

OpenCrew workers need a consistent way to browse websites and check application behavior from their assigned worktrees. A shared agent-browser CLI and a discoverable skill provide that capability without installing tools in every managed repository or adding a browser orchestration layer.

## What Changes

- Pin agent-browser in OpenCrew's central dependencies, make its native installation reproducible with pnpm, and document one-time browser setup for the service user. Reuse the central executable path already supplied to worktree sessions; require no global installation.
- Register one portable `crew-browser` skill at worker locations. The skill loads the installed CLI's upstream instructions and supplies OpenCrew conventions for browser sessions, screenshots and role scope.
- Give Explore, Apply, Review and Research direct CLI access through native shell tooling. Use native command permissions for the browser exception in currently shell-restricted roles; preserve Apply's existing development shell access.
- Require the shared browser skill and an effective shell tool in worker capability checks, and include a short browser-use nudge and assigned browser session name in new worker context.
- Use an isolated browser session and screenshot directory per native worker session, with ordinary CLI close instructions and no new resource database or browser lifecycle controller.
- Update the Research contract and the role policy's blanket shell prohibitions to describe this explicit browser exception. Keep repository editing scope and controller-owned approvals, delivery and retirement unchanged.

## Capabilities

### New Capabilities

- `browser-cli`: Shared installation, portable browser guidance, direct CLI access, concurrent session conventions and setup diagnostics for managed workers.

### Modified Capabilities

- `work-policies`: Permit Research to use the browser CLI for its assigned investigation while retaining read-only repository work and report requirements.
- `worker-policy`: Permit the browser CLI exception for Explore, Review and Research while preserving their other role boundaries. This capability is introduced by the in-flight `unify-worker-policy-and-context` change; this proposal builds on that change and carries a complete replacement for the affected requirement.

## Impact

Affects `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, setup/doctor scripts and documentation; the shared skill registry; `src/opencode/role-policy.ts` and native session permissions; worker prompt/context assembly and screenshot read access; role guidance; and unit/native integration tests. The existing central service PATH, skill APIs and shell tool are reused. No managed repository control files are copied or rewritten, and no MCP server, custom browser tool, preview-server manager or global skill installer is introduced.

The policy/context implementation already present in the checkout is the baseline. Its pending specifications must be synced before this change's `worker-policy` delta is archived; this proposal does not edit or supersede that change's artifacts.
