import { GitHubFeedback } from "./feedback.ts";
import { type Forge, type PR } from "./forge.ts";
import { type ManagedExecution, type Project } from "../domain.ts";
import { Effect } from "effect";
/** Compatibility facade; canonical CI and discussion normalization lives in one adapter. */
export const forgeFindings = (client: Forge, p: Project, e: ManagedExecution, pr: PR) =>
  new GitHubFeedback(client)
    .observe(p, e, pr)
    .pipe(Effect.map((feedback) => [...feedback.findings]));
