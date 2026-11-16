import { type AbsolutePath } from "../identities.ts";
import { CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { Effect, Schema } from "effect";
import { readFile } from "../filesystem.ts";
import { join } from "node:path";

import { Skill } from "@opencode/plugin";
import { type Context } from "@opencode/plugin/effect/plugin";
import { parseYaml } from "../config/contracts.ts";
import { decode } from "../decode.ts";
import { engineeringSkills } from "./engineering-skills.ts";
export function registerSkills(ctx: Context, home: AbsolutePath, central: boolean) {
  return domainEffect(
    Effect.gen(function* () {
      const workflowNames = central
        ? ["orchestration", "openspec-execution", "project-onboarding", "recovery", "browser"]
        : ["openspec-execution", "browser"];
      const names = [...workflowNames, ...engineeringSkills.map(({ name }) => name)];
      const skills = yield* Effect.forEach(
        names,
        (name) =>
          domainEffect(
            Effect.gen(function* () {
              const path = join(home, ".agents/skills", name, "SKILL.md");
              const source = yield* readFile(path, "utf8");
              const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
              if (!match)
                return yield* new CrewError(
                  "SKILL_FRONTMATTER",
                  `Invalid skill frontmatter: ${path}`,
                );
              const metadata = yield* decode(
                Schema.Struct({ description: Schema.NonEmptyString }),
                yield* parseYaml(match[1], `Skill ${name}`),
                `Skill ${name}`,
              );
              return yield* Schema.decodeEffect(Skill.Info)({
                id: `abra-${name}`,
                name: `abra-${name}`,
                description: metadata.description,
                path,
                content: match[2],
              });
            }),
          ),
        { concurrency: "unbounded" },
      );
      yield* ctx.skill.transform((editor) => {
        for (const skill of skills) editor.add(skill);
      });
    }),
  );
}
