/* oxlint-disable effecttsgo/unstable-api-usage -- Injected pinned Effect 4.1.4 filesystem/path services. */
import { Effect, FileSystem, Path, Schema } from "effect";
import { Skill } from "@opencode/schema/skill";
import { parse } from "yaml";
import { AgentDefinitionError } from "./errors.ts";
import { engineeringSkills } from "./engineering-skills.ts";

export const skillNames = (central: boolean) => [
  ...(central
    ? [
        "express",
        "orchestration",
        "openspec-execution",
        "project-onboarding",
        "recovery",
        "browser",
      ]
    : ["openspec-execution", "browser"]),
  "memory",
  "open-code-review-delegate",
  ...engineeringSkills.map((s) => s.name),
];
export const readSkill = Effect.fn("Agents.readSkill")(function* (root: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!/^[a-z][a-z0-9-]*$/.test(name))
    return yield* new AgentDefinitionError({
      code: "INVALID_SKILL",
      definition: "skills",
      source: name,
      message: "Invalid skill identity",
    });
  const file = path.join(root, name, "SKILL.md");
  const source = yield* fs.readFileString(file).pipe(
    Effect.mapError(
      () =>
        new AgentDefinitionError({
          code: "SKILL_SOURCE",
          definition: "skills",
          source: name,
          message: `Cannot read skill ${name}`,
        }),
    ),
  );
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!match)
    return yield* new AgentDefinitionError({
      code: "INVALID_SKILL",
      definition: "skills",
      source: name,
      message: `Invalid skill frontmatter: ${name}`,
    });
  const metadata = yield* Effect.try({
    try: () => parse(match[1]),
    catch: () =>
      new AgentDefinitionError({
        code: "INVALID_SKILL",
        definition: "skills",
        source: name,
        message: `Invalid skill metadata: ${name}`,
      }),
  });
  const description = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ description: Schema.NonEmptyString }),
  )(metadata).pipe(
    Effect.mapError(
      () =>
        new AgentDefinitionError({
          code: "INVALID_SKILL",
          definition: "skills",
          source: name,
          message: `Missing description: ${name}`,
        }),
    ),
  );
  return yield* Schema.decodeEffect(Skill.Info)({
    id: `abra-${name}`,
    name: `abra-${name}`,
    description: description.description,
    path: file,
    content: match[2],
  }).pipe(
    Effect.mapError(
      () =>
        new AgentDefinitionError({
          code: "INVALID_SKILL",
          definition: "skills",
          source: name,
          message: `Invalid skill: ${name}`,
        }),
    ),
  );
});
