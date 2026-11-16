import { Schema } from "effect";
import { CrewError, ensure, type Config, type Role, type WorkerModel } from "../domain.ts";
import {
  workerRoles,
  DispatchSchema,
  type Dispatch,
  type SelectionSource,
} from "@abracode/contracts/config/dispatch";
export * from "@abracode/contracts/config/dispatch";
const completeModel = (m: WorkerModel): WorkerModel => ({
  providerID: m.providerID,
  id: m.id,
  ...(m.variant === undefined ? {} : { variant: m.variant }),
});
/** Stable role/model property order is part of retained request identity. */
export function normalizeDispatch(raw: unknown): Dispatch {
  let input: Dispatch;
  try {
    input = Schema.decodeUnknownSync(DispatchSchema, {
      onExcessProperty: "error",
      reportInput: false,
    })(raw);
  } catch {
    throw new CrewError(
      "DISPATCH",
      "Use known worker roles with exactly one complete model or profile each",
    );
  }
  return Object.fromEntries(
    workerRoles.flatMap((role) => {
      const s = input[role];
      return s
        ? [[role, s.model ? { model: completeModel(s.model) } : { profile: s.profile! }]]
        : [];
    }),
  );
}
function selected(
  config: Pick<Config, "profiles">,
  role: Role,
  selection: NonNullable<Dispatch[Role]>,
) {
  if (selection.model) return completeModel(selection.model);
  const name = selection.profile!;
  const profile =
    config.profiles && Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
  ensure(profile, "DISPATCH_PROFILE", `Dispatch profile ${name} is not configured`);
  ensure(
    profile.role === role,
    "DISPATCH_ROLE",
    `Dispatch profile ${name} is for ${profile.role}, not ${role}`,
  );
  return completeModel(profile.model);
}
export function validateDispatch(config: Pick<Config, "profiles">, dispatch?: Dispatch) {
  if (dispatch)
    for (const role of workerRoles) {
      const s = dispatch[role];
      if (s) selected(config, role, s);
    }
}
/** Models only: profiles cannot change agents, skills, tools or permissions. */
export function resolveDispatch(
  config: Config,
  role: Role,
  repository?: Dispatch,
  task?: Dispatch,
): { model: WorkerModel; provenance: SelectionSource } {
  const selection = task?.[role] ?? repository?.[role];
  if (selection)
    return {
      model: selected(config, role, selection),
      provenance: {
        source: task?.[role]
          ? selection.model
            ? "task.model"
            : "task.profile"
          : selection.model
            ? "repository.model"
            : "repository.profile",
        profile: selection.profile,
      },
    };
  const model =
    config.workers[role]?.model ?? config.models.overrides?.[role] ?? config.models.default;
  const override =
    config.models.overrides?.[role] ||
    JSON.stringify(completeModel(model)) !== JSON.stringify(completeModel(config.models.default));
  return {
    model: completeModel(model),
    provenance: { source: override ? "role_override" : "default" },
  };
}
