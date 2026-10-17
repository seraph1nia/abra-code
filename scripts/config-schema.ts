import { isDeepStrictEqual } from "node:util";
import { Schema } from "effect";
import { ConfigInputSchema } from "../src/config/contracts.ts";
import { readFileSync, writeFileSync } from "node:fs";
const document = Schema.toJsonSchemaDocument(ConfigInputSchema, { onExcessProperty: "error" });
const output =
  JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...document.schema,
      $defs: document.definitions,
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--write")) writeFileSync("abracode.schema.json", output);
else if (
  !isDeepStrictEqual(JSON.parse(readFileSync("abracode.schema.json", "utf8")), JSON.parse(output))
)
  throw new Error("Config schema is stale; run pnpm config:schema --write");
