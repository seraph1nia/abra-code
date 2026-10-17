import { AbsolutePath, RelativePath } from "../identities.ts";
import { Schema } from "effect";
export const DirectoryIdentitySchema = Schema.Struct({
  path: AbsolutePath,
  device: Schema.String,
  inode: Schema.String,
  birth: Schema.String,
});
export const RetirementSchema = Schema.Struct({
  generated: Schema.Array(
    Schema.Struct({
      path: RelativePath,
      identity: DirectoryIdentitySchema,
      state: Schema.Literals(["authorized", "removing", "removed"]),
    }),
  ),
  native: Schema.Literals(["not_started", "requested", "confirmed"]),
});
