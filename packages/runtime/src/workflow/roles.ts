import { type Phase, type Policy, type Role } from "../domain.ts";

/** Policy selects initial admission; phase identifies the same worker during recovery. */
export const initialRole = (policy: Policy): Role =>
  policy === "research-only" ? "research" : policy === "lightweight-fix" ? "apply" : "explore";

export const phaseRole = (phase: Phase): Role | undefined => {
  switch (phase) {
    case "exploring":
    case "planning":
      return "explore";
    case "applying":
      return "apply";
    case "researching":
      return "research";
    case "verifying":
      return "review";
    default:
      return undefined;
  }
};
