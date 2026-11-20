import { Cause, Option } from "effect";

export function requestError(cause: Cause.Cause<unknown>) {
  const error = Cause.findErrorOption(cause);
  if (
    Option.isSome(error) &&
    error.value &&
    typeof error.value === "object" &&
    "message" in error.value
  ) {
    const code = "code" in error.value ? `${String(error.value.code)}: ` : "";
    return `${code}${String(error.value.message)}`;
  }
  return "Request unavailable. Refresh to try again.";
}
