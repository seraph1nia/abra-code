import { type Context } from "@opencode/plugin/tui/context";
import { Effect, FiberMap, Scope } from "effect";
import { CrewError } from "../domain.ts";
import { visibility } from "./protocol.ts";
import { type UpdateView, type ViewState } from "./view-state.ts";
/** Latest selection owns the response. Scope cancellation also owns in-flight RPCs. */
export function resources(ctx: Context, state: ViewState, update: UpdateView, scope: Scope.Scope) {
  const api = ctx.client.rpc(visibility);
  const location = ctx.location ?? ctx.data.location.default();
  const tasks = Effect.runSync(
    FiberMap.make<string, void, never>().pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const launchTask = (key: string, effect: Effect.Effect<void>) =>
    Effect.runSync(FiberMap.run(tasks, key, effect));
  let feedbackVersion = 0;
  let diffVersion = 0;
  let documentVersion = 0;
  const launch = (effect: Effect.Effect<void>) => Effect.runSync(Effect.forkIn(effect, scope));
  const clear = () => {
    feedbackVersion++;
    diffVersion++;
    documentVersion++;
    launch(FiberMap.clear(tasks));
    update((s) => {
      delete s.feedback;
      delete s.feedback_error;
      s.feedback_loading = false;
      delete s.diff;
      delete s.diff_error;
      delete s.document;
      delete s.document_error;
      s.diff_loading = false;
    });
  };
  return {
    clear,
    feedback: () => {
      const issue = state.selected,
        page = state.feedback_page ?? 0;
      if (!issue) return;
      const version = ++feedbackVersion;
      update((s) => {
        s.feedback_loading = true;
        delete s.feedback_error;
      });
      launchTask(
        "feedback",
        Effect.tryPromise({
          try: (signal) => api.feedback({ issue_id: issue, page }, { location, signal }),
          catch: CrewError.from,
        }).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              if (version !== feedbackVersion || state.selected !== issue) return;
              update((s) => {
                s.feedback = value;
                s.feedback_loading = false;
              });
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              if (version !== feedbackVersion || state.selected !== issue) return;
              update((s) => {
                s.feedback_error = error.message;
                s.feedback_loading = false;
              });
            }),
          ),
          Effect.asVoid,
        ),
      );
    },
    diff: () => {
      const issue = state.selected;
      if (!issue) return;
      const input = { issue_id: issue, scope: state.diff_scope, file: state.diff_file };
      const requestVersion = ++diffVersion;
      update((s) => {
        s.diff_loading = true;
        delete s.diff_error;
      });
      launchTask(
        "diff",
        Effect.tryPromise({
          try: (signal) => api.diff(input, { location, signal }),
          catch: CrewError.from,
        }).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              if (diffVersion !== requestVersion || state.selected !== issue) return;
              update((s) => {
                s.diff = value;
                s.diff_file = value.file;
                s.diff_loading = false;
              });
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              if (diffVersion === requestVersion)
                update((s) => {
                  s.diff_error = error.message;
                  s.diff_loading = false;
                });
            }),
          ),
          Effect.asVoid,
        ),
      );
    },
    document: () => {
      const issue = state.selected,
        path = state.document_path;
      if (!issue || !path) return;
      const requestVersion = ++documentVersion;
      update((s) => {
        delete s.document;
        delete s.document_error;
      });
      launchTask(
        "document",
        Effect.tryPromise({
          try: (signal) =>
            path === "@report"
              ? api
                  .report({ issue_id: issue }, { location, signal })
                  .then(({ content }) => ({ path, content }))
              : api.document({ issue_id: issue, path }, { location, signal }),
          catch: CrewError.from,
        }).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              if (
                documentVersion === requestVersion &&
                state.selected === issue &&
                state.document_path === path
              )
                update((s) => {
                  s.document = value;
                });
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              if (documentVersion === requestVersion)
                update((s) => {
                  s.document_error = error.message;
                });
            }),
          ),
          Effect.asVoid,
        ),
      );
    },
  };
}
