import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { workEvents } from "@abracode/contracts/presentation/work-events";
import { WorkspaceFixture } from "../helpers/web.ts";
import { ObligationKey, SessionId, Timestamp, IssueId } from "@abracode/contracts/identities";

test("generated timelines sort captured cross-task events without inventing missing times or resolutions", () => {
  const task = new WorkspaceFixture().value.work.work[0];
  const question = {
    key: ObligationKey.make("scope"),
    generation: 0,
    scope: "Task",
    question: "Choose scope",
    owner: "user" as const,
    session_id: SessionId.make("ses_scope"),
    opened_at: 30,
    status: "open" as const,
  };
  const result = workEvents([
    {
      ...task,
      progress: {
        generation: 0,
        session_id: question.session_id,
        at: 40,
        summary: "Newest progress",
        source: "worker",
      },
      decisions: [question],
      waits: [
        {
          key: ObligationKey.make("legacy"),
          generation: 0,
          kind: "user",
          reference: question.key,
          condition: "Legacy wait without a time",
          owner: "Abra",
          status: "waiting",
        },
      ],
    },
    {
      ...task,
      issue_id: IssueId.make("abra-earlier"),
      closed_at: Timestamp.make(new Date(50).toISOString()),
      decisions: [{ ...question, status: "answered", opened_at: 10, resolved_at: 20 }],
    },
  ]);
  assert.deepEqual(
    result.events.map((event) => [event.at, event.label]),
    [
      [10, "Decision opened"],
      [20, "Decision answered"],
      [30, "Decision opened"],
      [40, "Latest progress"],
      [50, "Issue closed"],
    ],
  );
  assert.equal(new Set(result.events.map((event) => event.id)).size, 5);
  assert.equal(result.events.find((event) => event.at === 40)?.detail, "Newest progress");
  assert.equal(result.total, 5);
  assert.deepEqual(workEvents([task]), { events: [], total: 0 });
});
