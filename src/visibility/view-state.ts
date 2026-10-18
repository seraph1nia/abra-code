import { type WorkerInspection } from "./worker.ts";
import { type FeedbackPage } from "../workflow/feedback-contracts.ts";
import { type MessagesPageSchema } from "../workflow/message-contracts.ts";
import {
  ViewKey,
  type IssueId,
  type RepositoryId,
  type SessionId,
  type RelativePath,
  type LeadId,
} from "../identities.ts";
import { type Section } from "./presentation.ts";

import {
  type WorkDetail,
  type WorkDiff,
  type WorkDocument,
  type WorkSnapshot,
  type DiffScope,
} from "./protocol.ts";
export type Tab = "overview" | "plan" | "diff" | "workers" | "feedback" | "communication";
export interface ViewLocation {
  selected?: IssueId;
  feedback_page?: number;
  messages_offset?: number;
  tab: Tab;
  document_path?: RelativePath | "@report";
  diff_file?: RelativePath;
  diff_scope: DiffScope;
  diff_view: "unified" | "split";
}
export interface ViewState extends ViewLocation {
  lead_id?: LeadId;
  worker_id?: SessionId;
  worker?: WorkerInspection;
  worker_error?: string;
  worker_loading?: boolean;
  feedback?: FeedbackPage;
  feedback_loading?: boolean;
  feedback_error?: string;
  messages?: typeof MessagesPageSchema.Type;
  messages_loading?: boolean;
  messages_error?: string;
  snapshot?: WorkSnapshot;
  detail?: WorkDetail;
  detail_error?: string;
  error?: string;
  loading: boolean;
  resource_error?: string;
  session_sync: Record<SessionId, "syncing" | "ready" | "unavailable">;
  activity: Record<SessionId, string>;
  query: string;
  repository: RepositoryId | "";
  closedPage: number;
  collapsed: Section[];
  history: ViewLocation[];
  saved: Record<IssueId, ViewLocation>;
  scroll: Record<ViewKey, number>;
  return_session?: SessionId;
  diff?: WorkDiff;
  diff_loading: boolean;
  diff_error?: string;
  document?: WorkDocument;
  document_error?: string;
}
export type UpdateView = (mutation: (state: ViewState) => void) => void;
export const locationOf = (s: ViewState): ViewLocation => ({
  selected: s.selected,
  feedback_page: s.feedback_page,
  messages_offset: s.messages_offset,
  tab: s.tab,
  document_path: s.document_path,
  diff_file: s.diff_file,
  diff_scope: s.diff_scope,
  diff_view: s.diff_view,
});
export const scrollKey = (s: ViewState) =>
  ViewKey.make(
    s.selected
      ? `${s.selected}/${s.tab}/${s.tab === "plan" ? (s.document_path ?? "proposal") : s.tab === "diff" ? `${s.diff_scope}/${s.diff_file ?? ""}` : s.tab === "feedback" ? (s.feedback_page ?? 0) : s.tab === "communication" ? (s.messages_offset ?? 0) : ""}`
      : "home",
  );

/** Explicit assignments also clear optional fields omitted by the reactive store. */
export function restoreLocation(state: ViewState, location: ViewLocation) {
  state.selected = location.selected;
  state.feedback_page = location.feedback_page ?? 0;
  state.messages_offset = location.messages_offset ?? 0;
  state.tab = location.tab;
  state.document_path = location.document_path;
  state.diff_file = location.diff_file;
  state.diff_scope = location.diff_scope;
  state.diff_view = location.diff_view;
}
