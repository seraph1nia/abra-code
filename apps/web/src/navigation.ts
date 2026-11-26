import { MessageId, SessionId } from "@abracode/contracts/identities";
import {
  RetainedTarget,
  WorkDiscoveryQuery,
} from "@abracode/contracts/visibility/discovery-contracts";
import { InboxQuery, InboxTarget } from "@abracode/contracts/visibility/github-inbox";
import { ThoughtQuery, ThoughtReference } from "@abracode/contracts/visibility/thoughts";
import { SurfaceDestinationSchema } from "@abracode/contracts/web/surface-destination";
import { Schema } from "effect";
import { ResourceSelectionSchema, type ResourceSelection } from "@abracode/contracts/web/resources";

export const inspectorTabs = [
  "Overview",
  "Plan",
  "Diff",
  "Verification",
  "Activity",
  "Reports",
] as const;
export type InspectorTab = (typeof inspectorTabs)[number];
export const activitySections = ["sessions", "communication", "checks", "leads"] as const;
export type ActivitySection = (typeof activitySections)[number];
export const destinations = {
  "/": "Chat",
  "/work": "Work",
  "/github": "GitHub",
  "/thoughts": "Thoughts",
  "/attention": "Attention",
  "/more": "More",
} as const;
export type Destination = keyof typeof destinations;
export function destinationFor(path: string): Destination | undefined {
  return Object.hasOwn(destinations, path) ? (path as Destination) : undefined;
}
const CollectionState = Schema.Struct({
  work: Schema.optional(WorkDiscoveryQuery),
  section: Schema.optional(Schema.Literals(["tasks", "sessions", "capacity", "recent"])),
  github: Schema.optional(
    Schema.Struct({
      repository_id: InboxQuery.fields.repository_id,
      state: InboxQuery.fields.state,
      kind: InboxQuery.fields.kind,
      search: InboxQuery.fields.search,
      label: InboxQuery.fields.label,
      role: InboxQuery.fields.role,
      offset: InboxQuery.fields.offset,
    }),
  ),
  item: Schema.optional(InboxTarget),
  notebook: Schema.optional(ThoughtQuery),
  memo: Schema.optional(ThoughtReference),
  previousCursors: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(Schema.isMaxLength(32)),
  ),
});
export type CollectionState = typeof CollectionState.Type;
export type WorkspaceSearch = {
  collection?: CollectionState;
  view?: "finder" | "canvas";
  message?: { session_id: SessionId; message_id: MessageId };
  retained?: RetainedTarget;
  review?: { review_id: string; revision: number };
  surface?: typeof SurfaceDestinationSchema.Type;
  issue?: string;
  tab?: InspectorTab;
  activity?: ActivitySection;
  file?: string;
  scope?: "all" | "uncommitted";
  resource?: ResourceSelection;
  canvas?: boolean;
  artifact_offset?: number;
};
export function workspaceSearch(value: Record<string, unknown>): WorkspaceSearch {
  const decoded = Schema.decodeUnknownOption(CollectionState)(value.collection);
  const context = decoded._tag === "Some" ? { collection: decoded.value } : {};
  if (value.message !== undefined) {
    const message = Schema.decodeUnknownOption(
      Schema.Struct({ session_id: SessionId, message_id: MessageId }),
    )(value.message);
    if (message._tag === "Some") return { ...context, message: message.value };
  }
  if (value.retained !== undefined) {
    const retained = Schema.decodeUnknownOption(RetainedTarget)(value.retained);
    if (retained._tag === "Some") return { ...context, retained: retained.value };
  }
  if (value.review !== undefined) {
    const review = Schema.decodeUnknownOption(
      Schema.Struct({
        review_id: SurfaceDestinationSchema.fields.surface_id,
        revision: SurfaceDestinationSchema.fields.revision,
      }),
    )(value.review);
    if (review._tag === "Some") return { ...context, review: review.value };
  }
  if (value.surface !== undefined) {
    const surface = Schema.decodeUnknownOption(SurfaceDestinationSchema)(value.surface);
    if (surface._tag === "Some") return { ...context, surface: surface.value };
  }
  const legacy = {
    Workers: "sessions",
    Communication: "communication",
    Feedback: "checks",
  } as const;
  const legacyActivity =
    typeof value.tab === "string" && Object.hasOwn(legacy, value.tab)
      ? legacy[value.tab as keyof typeof legacy]
      : undefined;
  const tab =
    inspectorTabs.find((tab) => tab === value.tab) ??
    (legacyActivity ? "Activity" : value.tab === "Decisions" ? "Overview" : undefined);
  const activity = activitySections.find((section) => section === value.activity) ?? legacyActivity;
  let resource: ResourceSelection | undefined;
  if (value.resource !== undefined) {
    try {
      resource = Schema.decodeUnknownSync(ResourceSelectionSchema, {
        onExcessProperty: "error",
        reportInput: false,
      })(value.resource);
    } catch {
      /* Invalid bookmarks grant no read capability. */
    }
  }
  const result = {
    ...context,
    ...(typeof value.issue === "string" && value.issue.length <= 1024
      ? { issue: value.issue }
      : {}),
    ...(tab ? { tab } : {}),
    ...(activity ? { activity } : {}),
    ...(typeof value.file === "string" && value.file.length <= 4096 ? { file: value.file } : {}),
    ...(value.scope === "uncommitted" ? { scope: "uncommitted" as const } : {}),
    ...(typeof value.artifact_offset === "number" &&
    Number.isSafeInteger(value.artifact_offset) &&
    value.artifact_offset >= 0
      ? { artifact_offset: value.artifact_offset }
      : {}),
  };
  return resource
    ? {
        ...result,
        ...searchForResource(resource),
        ...(resource.action === "open_artifact" && value.canvas === true ? { canvas: true } : {}),
      }
    : !result.issue && (value.view === "finder" || value.view === "canvas")
      ? { ...context, view: value.view }
      : result;
}
export function resourceFromSearch(search: WorkspaceSearch): ResourceSelection | undefined {
  if (search.resource) return search.resource;
  if (!search.issue) return undefined;
  const sections = {
    Overview: "summary",
    Plan: "plan",
    Verification: "verification",
    Activity: "activity",
    Reports: "reports",
  } as const;
  const candidate =
    search.tab === "Diff"
      ? {
          action: "open_changes",
          issue_id: search.issue,
          ...(search.file ? { file: search.file } : {}),
          ...(search.scope ? { scope: search.scope } : {}),
        }
      : {
          action: "open_task",
          issue_id: search.issue,
          section: sections[search.tab ?? "Overview"],
          ...(search.tab === "Activity" && search.activity ? { activity: search.activity } : {}),
        };
  try {
    return Schema.decodeUnknownSync(ResourceSelectionSchema, {
      onExcessProperty: "error",
      reportInput: false,
    })(candidate);
  } catch {
    return undefined;
  }
}
/** Legacy task/file/scope URLs continue to map into one shared inspector. */
export function searchForResource(resource: ResourceSelection): WorkspaceSearch {
  const sections = {
    summary: "Overview",
    plan: "Plan",
    changes: "Diff",
    verification: "Verification",
    activity: "Activity",
    reports: "Reports",
  } as const;
  switch (resource.action) {
    case "open_changes":
      return {
        issue: resource.issue_id,
        tab: "Diff",
        file: resource.file,
        scope: resource.scope,
        resource,
      };
    case "open_finding":
      return { issue: resource.issue_id, tab: "Activity", activity: "checks", resource };
    case "open_passage":
      return { issue: resource.issue_id, tab: "Plan", file: resource.file, resource };
    case "open_session":
      return { issue: resource.issue_id, tab: "Activity", activity: "sessions", resource };
    case "open_decision":
      return { issue: resource.issue_id, tab: "Overview", resource };
    case "open_artifact":
      return { issue: resource.issue_id, tab: "Reports", resource };
    case "open_task":
      return {
        issue: resource.issue_id,
        tab: sections[resource.section ?? "summary"],
        activity: resource.activity,
        resource,
      };
  }
}
