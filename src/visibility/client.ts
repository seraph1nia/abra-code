import { SessionMessage } from "@opencode/schema/session-message";
import { resourceFailure } from "./resource-errors.ts";
import { ViewKey, SessionId, RepositoryId, IssueId, LeadId } from "../identities.ts";
import { type Section, section, stateLabel, leadNeedsAttention } from "./presentation.ts";

import { type Phase, CrewError } from "../domain.ts";

import { type Context } from "@opencode/plugin/tui/context";
import { Effect, Exit, Fiber, FiberMap, Option, Schedule, Scope } from "effect";

import { visibility } from "./protocol.ts";
import { resources } from "./resources.ts";
import { locationOf, restoreLocation, scrollKey, type Tab, type ViewState } from "./view-state.ts";

export const phaseLabel = (phase?: Phase) => phase?.replaceAll("_", " ") ?? "queued";
/** The native TUI uses Promise callbacks. This seam owns an Effect scope for all work. */
export function createWorkView(ctx: Context) {
  const [state, update] = ctx.storage.memory<ViewState>("work-view-v3", {
    initial: {
      loading: true,
      session_sync: {},
      activity: {},
      tab: "overview",
      query: "",
      repository: "",
      closedPage: 0,
      collapsed: ["done"],
      history: [],
      saved: {},
      scroll: {},
      diff_scope: "all",
      diff_view: "unified",
      diff_loading: false,
    },
  });
  update((s) => {
    s.session_sync ??= {};
  });
  const api = ctx.client.rpc(visibility);
  const location = ctx.location ?? ctx.data.location.default();
  const scope = Scope.makeUnsafe();
  const resource = resources(ctx, state, update, scope);
  const known = new Set(state.snapshot?.work.flatMap((w) => w.sessions.map((s) => s.id)) ?? []);
  let disposed = false;
  const tasks = Effect.runSync(
    FiberMap.make<string, void, never>().pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const launchTask = (key: string, effect: Effect.Effect<void>, onlyIfMissing = false) =>
    Effect.runSync(FiberMap.run(tasks, key, effect, { onlyIfMissing }));
  const request = <A>(call: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({
      try: call,
      catch: (error) =>
        resourceFailure(error) && typeof error === "object" && error !== null && "type" in error
          ? new CrewError(
              String(error.type),
              "message" in error ? String(error.message) : "Resource unavailable",
            )
          : CrewError.from(error),
    });
  const launch = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runSync(Effect.forkIn(effect, scope));
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(Effect.flatMap(Effect.forkIn(effect, scope), Fiber.join));
  const loadDetail = (issueID: IssueId) =>
    request((signal) => api.detail({ issue_id: issueID }, { location, signal })).pipe(
      Effect.tap((detail) =>
        Effect.sync(() => {
          if (disposed || state.selected !== issueID) return;
          update((s) => {
            s.detail = detail;
            delete s.detail_error;
          });
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (!disposed && state.selected === issueID)
            update((s) => {
              s.detail_error = error.message;
            });
        }),
      ),
      Effect.asVoid,
    );
  const remember = () =>
    update((s) => {
      if (s.selected) s.saved[s.selected] = locationOf(s);
    });
  const select = (issueID: IssueId) => {
    if (state.selected !== issueID) {
      remember();
      resource.clear();
      update((s) => {
        s.history.push(locationOf(s));
        delete s.detail;
        delete s.detail_error;
        restoreLocation(
          s,
          s.saved[issueID] ?? {
            tab: "overview",
            document_path: undefined,
            diff_file: undefined,
            diff_scope: "all",
            diff_view: "unified",
          },
        );
      });
    }
    update((s) => {
      if (s.selected !== issueID) {
        delete s.detail;
        delete s.detail_error;
      }
      s.selected = issueID;
    });
    if (state.tab === "feedback") resource.feedback();
    if (state.tab === "communication") resource.messages();
    if (state.tab === "diff") resource.diff();
    if (state.tab === "plan" && state.document_path) resource.document();
    launchTask("detail", loadDetail(issueID));
  };
  const show = (issueID?: IssueId) => {
    if (issueID) select(issueID);
    const route = ctx.ui.router.current();
    if (route.type === "session")
      update((s) => {
        s.return_session = SessionId.make(route.sessionID);
      });
    if (!ctx.ui.panel.open("abracode.work"))
      ctx.ui.router.navigate({ type: "plugin", name: "work" });
  };
  const inspectWorker = (id: SessionId, refreshing = false) =>
    Effect.gen(function* () {
      const ticket = state.snapshot?.work.find((item) =>
        item.sessions.some((session) => session.id === id),
      );
      if (!ticket) return;
      if (!refreshing) {
        show(ticket.issue_id);
        update((s) => {
          s.tab = "workers";
          s.worker_id = id;
          delete s.worker;
          delete s.worker_error;
          s.worker_loading = true;
        });
      }
      yield* request((signal) =>
        api.worker({ issue_id: ticket.issue_id, session_id: id }, { location, signal }),
      ).pipe(
        Effect.tap((worker) =>
          Effect.sync(() => {
            if (!disposed && state.worker_id === id && state.selected === ticket.issue_id)
              update((s) => {
                s.worker = worker;
                delete s.worker_error;
                s.worker_loading = false;
              });
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (!disposed && state.worker_id === id)
              update((s) => {
                s.worker_error = error.message;
                s.worker_loading = false;
              });
          }),
        ),
      );
    });
  const openSession = (id: SessionId) =>
    request(() => ctx.data.session.sync(SessionId.make(id))).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (!disposed && !ctx.ui.tabs.focus(id))
            ctx.ui.router.navigate({ type: "session", sessionID: id });
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (!disposed)
            ctx.ui.toast.show({ title: "AbraCode", message: error.message, variant: "error" });
        }),
      ),
      Effect.asVoid,
    );
  const refreshEffect = Effect.gen(function* () {
    const snapshot = yield* request((signal) =>
      api.snapshot({ closed_page: state.closedPage }, { location, signal }),
    );
    if (disposed) return;
    const ids = snapshot.work.flatMap((w) => w.sessions.map((s) => s.id));
    known.clear();
    ids.forEach((id) => known.add(id));
    const focused = ctx.renderer?.currentFocusedRenderable;
    const focusedTicket = focused?.id.startsWith("abracode.ticket:") ? focused.id : undefined;
    update((s) => {
      s.snapshot = snapshot;
      s.closedPage = snapshot.closed_page ?? s.closedPage;
      delete s.resource_error;
      s.loading = false;
      delete s.error;
      for (const id of Object.keys(s.activity))
        if (!ids.includes(SessionId.make(id))) delete s.activity[SessionId.make(id)];
    });
    if (focusedTicket)
      queueMicrotask(() => {
        if (
          !ctx.renderer.currentFocusedRenderable ||
          ctx.renderer.currentFocusedRenderable === focused ||
          focused?.isDestroyed
        )
          ctx.renderer.root.findDescendantById(focusedTicket)?.focus();
      });
    yield* Effect.forEach(
      ids,
      (id) =>
        request(async () => {
          update((s) => {
            s.session_sync[id] = "syncing";
          });
          await ctx.data.session.sync(id);
          await ctx.data.session.pending.sync(id);
          if (disposed) return;
          update((s) => {
            s.session_sync[id] = "ready";
          });
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              if (!disposed)
                update((s) => {
                  s.session_sync[id] = "unavailable";
                });
            }),
          ),
        ),
      { concurrency: 4 },
    );
    if (
      state.selected &&
      (ctx.ui.panel.current()?.name === "abracode.work" ||
        ctx.ui.router.current().type === "plugin")
    ) {
      yield* loadDetail(state.selected);
      if (state.tab === "feedback") resource.feedback();
      if (state.tab === "communication") resource.messages();
      if (state.tab === "workers" && state.worker_id) yield* inspectWorker(state.worker_id, true);
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        if (!disposed)
          update((s) => {
            if (resourceFailure(error)) s.resource_error = error.message;
            else s.error = error.message;
            s.loading = false;
          });
      }),
    ),
  );
  const refresh = () =>
    disposed
      ? Effect.void
      : FiberMap.run(tasks, "refresh", refreshEffect, { onlyIfMissing: true }).pipe(
          Effect.flatMap(Fiber.join),
        );
  const scheduleRefresh = () => {
    if (!disposed)
      launchTask("schedule", Effect.sleep(250).pipe(Effect.andThen(Effect.suspend(refresh))), true);
  };
  const sessionStatus = (id: SessionId) =>
    state.error || state.session_sync[id] !== "ready"
      ? "unavailable"
      : ctx.data.session.status(id) === "running"
        ? "running"
        : ctx.data.session.pending.list(id).length
          ? "queued"
          : "idle";
  launch(
    Effect.tryPromise({
      try: async (signal) => {
        // A fresh subscription always requests a current snapshot; events have no replay.
        scheduleRefresh();
        for await (const event of api.events.subscribe("changed", { signal }))
          if (event.data.home === state.snapshot?.home) scheduleRefresh();
      },
      catch: CrewError.from,
    }).pipe(Effect.ignore, Effect.repeat(Schedule.spaced(1000))),
  );
  const stopEvents = ctx.data.listen(({ details: event }) => {
    if (event.type === "session.created") return scheduleRefresh();
    if (!("sessionID" in event.data) || !known.has(event.data.sessionID)) return;
    const id = event.data.sessionID;
    if (event.type === "session.text.delta")
      update((s) => {
        s.activity[id] = ((s.activity[id] ?? "") + event.data.delta)
          .replace(/\p{Cc}/gu, " ")
          .slice(-160);
      });
    else if (event.type === "session.text.started")
      update((s) => {
        s.activity[id] = "";
      });
    else if (event.type === "session.tool.input.started")
      update((s) => {
        s.activity[id] = `Tool: ${event.data.name}`;
      });
    else if (
      event.type.startsWith("session.execution.") ||
      event.type.startsWith("session.inbox.")
    ) {
      scheduleRefresh();
    }
  });
  Effect.runSync(Scope.addFinalizer(scope, Effect.sync(stopEvents)));
  launch(Effect.suspend(refresh).pipe(Effect.repeat(Schedule.spaced(5000))));
  return {
    state,
    reloadFeedback: resource.feedback,
    reloadMessages: resource.messages,
    messagesPage: (offset: number) => {
      update((s) => {
        s.history.push(locationOf(s));
        s.messages_offset = Math.max(0, offset);
      });
      resource.messages();
    },
    feedbackPage: (page: number) => {
      update((s) => {
        s.history.push(locationOf(s));
        s.feedback_page = Math.max(0, page);
      });
      resource.feedback();
    },
    requestControl: async (tool: string, input: Record<string, unknown>) => {
      const target = state.detail?.work.supervisor_session_id,
        home = state.snapshot?.home;
      if (!target || !home) {
        ctx.ui.toast.show({
          title: "AbraCode",
          message: "Open Abra for this execution first",
          variant: "error",
        });
        return;
      }
      const approved = await ctx.ui.dialog.confirm({
        title: "Request controller action",
        message: `${tool}\n${JSON.stringify(input)}\nThis queues the exact request in Abra. Required human forms remain in force.`,
      });
      if (!approved || disposed) return;
      try {
        await ctx.client.session.prompt({
          sessionID: target,
          id: SessionMessage.ID.create(),
          text: `Use ${tool} for this explicit Work-panel request with exactly these arguments: ${JSON.stringify(input)}. Reconcile retained evidence and show any bound approval form; preserve controller gates.`,
          delivery: "queue",
        });
        await run(openSession(target));
      } catch (error) {
        ctx.ui.toast.show({
          title: "AbraCode",
          message: CrewError.from(error).message,
          variant: "error",
        });
      }
    },
    sessionStatus,
    select,
    selectLead: (id?: LeadId) =>
      update((s) => {
        s.lead_id = id;
      }),
    show,
    overview: () => {
      remember();
      resource.clear();
      update((s) => {
        if (s.selected) s.history.push(locationOf(s));
        delete s.selected;
        delete s.detail;
        delete s.detail_error;
      });
      show();
    },
    back: () => {
      remember();
      resource.clear();
      const previous = state.history.at(-1);
      update((s) => {
        s.history.pop();
        delete s.detail;
        delete s.detail_error;
        restoreLocation(
          s,
          previous ?? { tab: "overview", diff_scope: "all", diff_view: "unified" },
        );
      });
      if (state.selected) select(state.selected);
    },
    refresh: () =>
      run(
        Effect.gen(function* () {
          const previous = FiberMap.getUnsafe(tasks, "refresh");
          if (Option.isSome(previous)) yield* Fiber.join(previous.value);
          yield* Effect.suspend(refresh);
        }),
      ),
    inspectWorker: (id: SessionId) =>
      run(FiberMap.run(tasks, "worker", inspectWorker(id)).pipe(Effect.flatMap(Fiber.join))),
    openSession: (id: SessionId) => run(known.has(id) ? inspectWorker(id) : openSession(id)),
    setTab: (tab: Tab | "issue" | "spec") => {
      update((s) => {
        s.history.push(locationOf(s));
        s.tab = tab === "issue" ? "overview" : tab === "spec" ? "plan" : tab;
      });
      if (state.tab === "feedback" && !state.feedback) resource.feedback();
      if (state.tab === "communication" && !state.messages) resource.messages();
      if (state.tab === "diff" && !state.diff) resource.diff();
      if (state.tab === "plan" && state.document_path && !state.document) resource.document();
    },
    setQuery: (query: string) =>
      update((s) => {
        s.query = query;
      }),
    toggleSection: (id: Section) =>
      update((s) => {
        s.collapsed = s.collapsed.includes(id)
          ? s.collapsed.filter((value) => value !== id)
          : [...s.collapsed, id];
      }),
    saveScrollAt: (key: ViewKey, position: number) =>
      update((s) => {
        s.scroll[key] = position;
      }),
    scrollKey: () => scrollKey(state),
    reloadDiff: resource.diff,
    setDiffScope: (scope: ViewState["diff_scope"]) => {
      resource.clear();
      update((s) => {
        s.diff_scope = scope;
      });
      resource.diff();
    },
    setDiffView: (view: ViewState["diff_view"]) =>
      update((s) => {
        s.diff_view = view;
      }),
    chooseDiffFile: () =>
      run(
        Effect.gen(function* () {
          const selected = yield* request(() =>
            ctx.ui.dialog.select({
              title: "Changed files",
              current: state.diff_file,
              options: (state.diff?.files ?? []).map((f) => ({
                title: f.path,
                value: f.path,
                description: `${f.status} · +${f.additions} −${f.deletions}${f.binary ? " · binary" : ""}${f.limited ? " · preview limited" : ""}`,
              })),
            }),
          );
          if (selected) {
            resource.clear();
            update((s) => {
              s.diff_file = selected;
            });
            resource.diff();
          }
        }),
      ),
    loadReport: () => {
      update((s) => {
        s.history.push(locationOf(s));
        s.tab = "plan";
        s.document_path = "@report";
      });
      resource.document();
    },
    showScope: () => {
      update((s) => {
        s.history.push(locationOf(s));
        delete s.document_path;
        delete s.document;
      });
    },
    chooseDocument: () =>
      run(
        Effect.gen(function* () {
          const selected = yield* request(() =>
            ctx.ui.dialog.select({
              title: "Planning documents",
              current: state.document_path,
              options: (state.detail?.documents ?? []).map((path) => ({
                title: path,
                value: path,
              })),
            }),
          );
          if (selected) {
            update((s) => {
              s.document_path = selected;
            });
            resource.document();
          }
        }),
      ),
    chooseRepository: () =>
      run(
        Effect.gen(function* () {
          const selected = yield* request(() =>
            ctx.ui.dialog.select<RepositoryId | "">({
              title: "Filter by repository",
              current: state.repository,
              options: [
                { title: "All repositories", value: "" },
                ...[
                  ...new Set(
                    state.snapshot?.work
                      .map((w) => w.repository_id)
                      .filter((id): id is RepositoryId => !!id),
                  ),
                ]
                  .sort()
                  .map((id) => ({ title: id, value: id })),
              ],
            }),
          );
          if (selected !== undefined)
            update((s) => {
              s.repository = selected;
            });
        }),
      ),
    closedPage: (page: number) => {
      update((s) => {
        s.closedPage = Math.max(0, page);
      });
      return run(Effect.suspend(refresh));
    },
    openCodeHome: () => {
      ctx.ui.panel.close();
      ctx.ui.router.navigate({ type: "home" });
    },
    chooseAttention: () =>
      run(
        Effect.gen(function* () {
          yield* Effect.suspend(refresh);
          const selected = yield* request(() =>
            ctx.ui.dialog.select({
              title: "AbraCode attention",
              options: [
                ...(state.snapshot?.fleet?.attention ?? []).map((item) => ({
                  title: `${item.issue_id} · ${item.title}`,
                  value: `issue:${item.issue_id}`,
                  description: item.reason,
                })),
                ...(state.snapshot?.leads ?? []).filter(leadNeedsAttention).map((lead) => ({
                  title: `Lead ${lead.id}`,
                  value: `lead:${lead.id}`,
                  description: `${lead.state} · ${lead.outstanding_count} unanswered · ${lead.pending_proposals.length} proposals`,
                })),
              ],
            }),
          );
          if (selected && !disposed) {
            if (selected.startsWith("issue:")) show(IssueId.make(selected.slice(6)));
            else if (selected.startsWith("lead:")) {
              update((s) => {
                s.lead_id = LeadId.make(selected.slice(5));
                delete s.selected;
              });
              show();
            }
          }
        }),
      ),
    chooseIssue: () =>
      run(
        Effect.gen(function* () {
          yield* Effect.suspend(refresh);
          const selected = yield* request(() =>
            ctx.ui.dialog.select({
              title: "AbraCode work",
              current: state.selected,
              options: (state.snapshot?.work ?? []).map((w) => ({
                title: `${w.issue_id} · ${w.title}`,
                value: w.issue_id,
                description: `${w.repository_id ?? "unregistered"} · ${stateLabel(w)}`,
                category: section(w),
              })),
            }),
          );
          if (selected && !disposed) show(selected);
        }),
      ),
    chooseSession: () =>
      run(
        Effect.gen(function* () {
          const id = yield* request(() =>
            ctx.ui.dialog.select({
              title: "Inspect AbraCode workers",
              options: (state.snapshot?.work ?? []).flatMap((w) =>
                w.sessions.map((s) => ({
                  title: `${w.issue_id} · ${s.role}`,
                  value: s.id,
                  category: w.repository_id,
                  description: `${w.title} · ${sessionStatus(s.id)}`,
                })),
              ),
            }),
          );
          if (id && !disposed) yield* inspectWorker(id);
        }),
      ),
    dispose() {
      disposed = true;
      return Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
export type WorkView = ReturnType<typeof createWorkView>;
