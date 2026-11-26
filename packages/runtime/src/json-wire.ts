/** Recursively omit keys whose value is undefined so in-memory outputs match JSON wire shape. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      if (entry !== undefined) out[key] = stripUndefined(entry);
    return out as T;
  }
  return value;
}
