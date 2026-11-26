import { Data, Effect, Schema } from "effect";
import { StorageKey } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";

class RecordFormatError extends Data.TaggedError("RecordFormatError")<{
  code: "INVALID_RECORD" | "UNSUPPORTED_RECORD_VERSION" | "RECORD_IDENTITY";
  message: string;
}> {}
function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkedRecord(key: StorageKey, raw: unknown): Record<string, unknown> {
  if (!isRecordObject(raw))
    throw new RecordFormatError({ code: "INVALID_RECORD", message: `${key}: Expected a record` });
  if (raw.schema_version !== 1)
    throw new RecordFormatError({
      code: "UNSUPPORTED_RECORD_VERSION",
      message: `${key}: Unsupported record version; preserve data and use a compatible runtime`,
    });
  const identity = key.startsWith("project/")
    ? raw.id
    : key.startsWith("setup/")
      ? raw.repository_id
      : raw.issue_id;
  if (identity !== key.slice(key.indexOf("/") + 1))
    throw new RecordFormatError({
      code: "RECORD_IDENTITY",
      message: `${key}: Record identity does not match its key`,
    });
  return raw;
}

export function decodeRecord<S extends Schema.ConstraintDecoder<unknown>>(
  key: StorageKey,
  raw: unknown,
  schema: S,
) {
  return Effect.try({
    try: () => checkedRecord(key, raw),
    catch: (error) =>
      error instanceof RecordFormatError
        ? new CrewError(error.code, error.message)
        : CrewError.from(error),
  }).pipe(Effect.flatMap((record) => decode(schema, record, key)));
}

export function unknownExtensions(
  original: unknown,
  owned: ReadonlySet<string>,
): Record<string, unknown> {
  return isRecordObject(original)
    ? Object.fromEntries(Object.entries(original).filter(([field]) => !owned.has(field)))
    : {};
}
