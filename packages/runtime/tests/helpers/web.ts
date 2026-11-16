import { Effect, Stream } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { CrewError } from "../../src/domain.ts";
import { AbsolutePath, IssueId, SessionId, Timestamp } from "../../src/identities.ts";
import type { WebBackend, WorkspaceSnapshot, SurfaceEntry } from "../../src/web/contracts.ts";
import type { SubmissionReceipt } from "../../src/web/http-api.ts";
import type { ResourceSelection } from "../../src/web/resources.ts";

/** Deterministic transport fixture; native authority is covered separately by E2E. */
export class WorkspaceFixture implements WebBackend {
  readonly sessionID = SessionId.make("ses_webfixture");
  readonly changes = Stream.never;
  readonly surfaceHistory = new Map<string, SurfaceEntry>();
  submissions = 0;
  stops = 0;
  reads = 0;
  replies = 0;
  value: WorkspaceSnapshot = {
    session_id: this.sessionID,
    agent_id: "abra",
    at: "2026-11-15T10:00:00Z",
    busy: false,
    messages: [],
    forms: [],
    permissions: [],
    receipts: [],
    inbox: [],
    surfaces: [],
    projects: [{ id: "fixture", name: "Fixture project", path: "/fixture" }],
    work: {
      home: AbsolutePath.make("/fixture"),
      at: Timestamp.make("2026-11-15T10:00:00Z"),
      work: [
        {
          issue_id: IssueId.make("abra-web"),
          title: "Build a single workspace",
          priority: 2,
          issue_status: "in_progress",
          eligible: false,
          blockers: [],
          sessions: [],
        },
      ],
    },
  };
  snapshot = Effect.sync(() => this.value);
  observe = (_scope: import("@abracode/contracts/web/changes").ChangeScope) =>
    Effect.suspend(() => this.snapshot);
  resolve = (target: ResourceSelection) => Effect.succeed(target);
  surface = (id: string, revision: number) =>
    Effect.sync(
      () =>
        this.surfaceHistory.get(`${id}/${revision}`) ??
        this.value.surfaces
          .filter((entry) => "surface" in entry)
          .find(
            (entry) => entry.surface.createSurface.surfaceId === id && entry.revision === revision,
          ) ?? {
          surface_id: id,
          unavailable: "This exact generated-view revision is unavailable.",
        },
    );
  history = () => Effect.succeed({ messages: [] });
  readonly retainedReceipts = new Map<string, SubmissionReceipt>();
  receipt = (requestID: string) =>
    Effect.sync(
      () =>
        this.retainedReceipts.get(requestID) ??
        this.value.receipts.find((receipt) => receipt.request_id === requestID) ??
        null,
    );
  submit = (input: { request_id: string; text: string; delivery: "queue" | "steer" }) =>
    Effect.gen({ self: this }, function* () {
      const prior = this.value.receipts.find((r) => r.request_id === input.request_id);
      if (prior) {
        if (prior.text !== input.text) return yield* new CrewError("WEB_CONFLICT", "Input rebound");
        return prior;
      }
      this.submissions++;
      const receipt: SubmissionReceipt = {
        ...input,
        message_id: SessionMessage.ID.create(),
        at: new Date().toISOString(),
        status: "admitted",
      };
      this.retainedReceipts.set(input.request_id, receipt);
      this.value = {
        ...this.value,
        receipts: [...this.value.receipts, receipt],
        messages: [
          ...this.value.messages,
          { id: receipt.message_id, role: "user", text: input.text, at: receipt.at },
          {
            id: SessionMessage.ID.create(),
            role: "assistant",
            text: "I can help you build that.",
            at: receipt.at,
          },
        ],
      };
      return receipt;
    });
  stop = Effect.sync(() => {
    this.stops++;
    return true;
  });
  private unavailableRead = () =>
    Effect.suspend(() => {
      this.reads++;
      return Effect.fail(new CrewError("FIXTURE_READ", "No resource configured in this fixture"));
    });
  readonly work: { -readonly [K in keyof WebBackend["work"]]: WebBackend["work"][K] } = {
    find: this.unavailableRead,
    leads: this.unavailableRead,
    detail: this.unavailableRead,
    document: this.unavailableRead,
    diff: this.unavailableRead,
    worker: this.unavailableRead,
    "worker-history": this.unavailableRead,
    messages: this.unavailableRead,
    feedback: this.unavailableRead,
    report: this.unavailableRead,
    decisions: this.unavailableRead,
    artifacts: this.unavailableRead,
    artifactDocument: this.unavailableRead,
    artifactSummary: this.unavailableRead,
  };
  artifact = () =>
    Effect.succeed({ html: "<!doctype html><p>Isolated report</p>", hash: "fixture", bytes: 42 });
  exportDocument: WebBackend["exportDocument"] = () =>
    Effect.fail(new CrewError("FIXTURE_EXPORT", "No export configured in this fixture"));
  readExport: WebBackend["readExport"] = () =>
    Effect.fail(new CrewError("FIXTURE_EXPORT", "No export configured in this fixture"));
  saveSurface: WebBackend["saveSurface"] = () =>
    Effect.fail(new CrewError("FIXTURE_SAVE", "No save configured in this fixture"));
  replyForm = () =>
    Effect.sync(() => {
      this.replies++;
    });
  replyPermission = () =>
    Effect.sync(() => {
      this.replies++;
    });
}
