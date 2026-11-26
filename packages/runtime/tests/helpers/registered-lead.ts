import { Agent } from "@opencode/schema/agent";
import * as Id from "@abracode/contracts/identities";
import { readLeads } from "../../src/workflow/leads/contracts.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
export const parent = Id.SessionId.make("ses_lead-parent");
export const leadID = Id.LeadId.make("frontend-lead");
export const repo = Id.RepositoryId.make("frontend");
export const issue = Id.IssueId.make("lead-work");
export const model = { providerID: Id.ProviderId.make("fixture"), id: Id.ModelId.make("fixture") };
export const declaration = {
  action: "register" as const,
  id: leadID,
  expected_revision: 0,
  repositories: [repo],
  model,
  enabled: true,
};
export async function prepare() {
  const f = await run(fixture);
  f.runtime.sessions.set(parent, {
    id: parent,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(parent));
  f.seed.named(issue, repo);
  await run(f.controller.lead().control(parent, declaration));
  return { f, lead: (await run(readLeads(f.records)))[0]! };
}
