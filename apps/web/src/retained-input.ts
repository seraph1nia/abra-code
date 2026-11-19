import { Schema } from "effect";

export function readRetained<S extends Schema.ConstraintDecoder<unknown>>(
  key: string,
  schema: S,
): S["Type"] | undefined {
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return undefined;
  }
}

export function writeRetained(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
