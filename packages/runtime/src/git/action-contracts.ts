import { type Effect } from "effect";
import { type CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { type CurrentAction } from "../workflow/action-contracts.ts";

/** Requests are produced only by read-only adapter validation, never from forge-provided commands. */
export type PreparedWrite = {
  action: CurrentAction;
  command:
    | { kind: "ready" }
    | { kind: "reviewers"; endpoint: string; users: string[]; teams: string[] }
    | { kind: "reply"; endpoint: string; body: string; actor: string }
    | { kind: "resolve"; thread: string }
    | { kind: "rerun"; endpoint: string };
};
export type ActionOutcome =
  | { kind: "confirmed"; receipt: string }
  | { kind: "awaiting"; detail?: string };
export type ActionPreparation = ActionOutcome | { kind: "write"; write: PreparedWrite };
export interface PRActionAdapter {
  prepare(
    p: Project,
    e: ManagedExecution,
    action: CurrentAction,
  ): Effect.Effect<ActionPreparation, CrewError>;
  submit(
    p: Project,
    e: ManagedExecution,
    write: PreparedWrite,
  ): Effect.Effect<ActionOutcome, CrewError>;
  reconcile(
    p: Project,
    e: ManagedExecution,
    action: CurrentAction,
  ): Effect.Effect<ActionOutcome, CrewError>;
}
