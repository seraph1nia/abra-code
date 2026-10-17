/** Domain resource failures do not mean the observer connection is unavailable. */
export function resourceFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ("type" in error || "code" in error) &&
    ["not_found", "resource_unavailable", "invalid_selection"].includes(
      String("type" in error ? error.type : "code" in error ? error.code : ""),
    )
  );
}
