import { readFile, writeFile } from "node:fs/promises";
import { ExpressPromptGenerator } from "@a2ui/agent";
import { catalog } from "@abracode/contracts/web/catalog";

const skill = new URL("../../agents/assets/skills/express/SKILL.md", import.meta.url);
const source = await readFile(skill, "utf8");
const signatures = new ExpressPromptGenerator([catalog])
  .generateCatalogInstructions()
  .split("\n")
  .filter((line) => line.startsWith("• "));
const block = /(## Work catalog signatures\n[\s\S]*?```text\n)[\s\S]*?(\n```)/;
if (!block.test(source) || signatures.length === 0) throw new Error("Missing Express signatures");
await writeFile(
  skill,
  source.replace(block, (_match, start, end) => start + signatures.join("\n") + end),
);
