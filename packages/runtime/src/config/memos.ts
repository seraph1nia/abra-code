import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect, Redacted } from "effect";
import { decodeJSON } from "../decode.ts";
import { InlineMemosSettings } from "./contracts.ts";
import { CrewError, type Config } from "../domain.ts";
import { readFile } from "../filesystem.ts";

type NotebookLocation = Pick<Config, "home" | "config_path">;
export const devNotebookPath = (config: NotebookLocation) =>
  join(
    config.home,
    ".abracode",
    `memos-${createHash("sha256").update(config.config_path).digest("hex")}.json`,
  );

export const readDevNotebook = (config: NotebookLocation) =>
  readFile(devNotebookPath(config), "utf8").pipe(
    Effect.flatMap((content) => decodeJSON(InlineMemosSettings, content, "Local Memos connection")),
    Effect.catchIf(
      (error) => error.code === "ENOENT",
      () => Effect.undefined,
    ),
  );

/** Read file-backed credentials only when accessing the notebook. */
export const memosConnection = (config: Pick<Config, "memos">) =>
  Effect.gen(function* () {
    if (!config.memos)
      return yield* new CrewError(
        "MEMOS_UNCONFIGURED",
        "Configure a Memos notebook in personal settings.",
      );
    const instance = new URL(config.memos.instance).origin;
    if ("token" in config.memos) return { instance, token: config.memos.token };
    const credentialError = () =>
      new CrewError("MEMOS_CREDENTIAL", "The Memos token file is missing, unreadable or invalid.");
    const value = (yield* readFile(config.memos.token_file, "utf8").pipe(
      Effect.mapError(credentialError),
    )).trim();
    if (!/^[\x21-\x7e]+$/.test(value)) return yield* credentialError();
    return { instance, token: Redacted.make(value) };
  });
