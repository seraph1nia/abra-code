import fs from "node:fs";
import { classifyUses } from "./uses.mjs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parse } from "yaml";
export const digest = (text) => createHash("sha256").update(text).digest("hex");
export function validateInventory(inventory, lockText, readEvidence) {
  const errors = [];
  const lock = parse(lockText);
  if (inventory.version !== 1 || inventory.lock_sha256 !== digest(lockText))
    errors.push("Inventory version/lock is stale");
  const uses = classifyUses(lock);
  const records = new Map(inventory.packages.map((p) => [p.id, p]));
  if (records.size !== Object.keys(lock.packages).length)
    errors.push("Package inventory differs from frozen lock");
  for (const [id, data] of Object.entries(lock.packages)) {
    const record = records.get(id);
    if (!record || !record.disposition?.startsWith("reviewed:") || record.license === "UNKNOWN") {
      errors.push(`Unreviewed license: ${id}`);
      continue;
    }
    if (JSON.stringify(record.uses) !== JSON.stringify(uses.get(id)))
      errors.push(`Stale distribution classification: ${id}`);
    if (record.integrity !== (data.resolution?.integrity ?? null))
      errors.push(`Changed package: ${id}`);
    if (record.installed && !record.evidence.length)
      errors.push(`Missing actual license evidence: ${id}`);
    for (const evidence of record.evidence) {
      const text = readEvidence(evidence.sha256);
      if (!text || digest(text) !== evidence.sha256) errors.push(`Missing/stale notice: ${id}`);
    }
    const fingerprint = digest(
      JSON.stringify({
        id,
        license: record.license,
        resolution: data.resolution,
        evidence: record.evidence,
      }),
    );
    if (fingerprint !== record.fingerprint) errors.push(`Changed license review: ${id}`);
  }
  for (const asset of inventory.assets ?? []) {
    const text = readEvidence(asset.sha256, asset.file);
    if (!text || digest(text) !== asset.sha256)
      errors.push(`Missing/stale distributed notice: ${asset.file}`);
  }
  for (const source of inventory.sources ?? []) {
    const text = readEvidence(source.sha256, source.file);
    if (!text || digest(text) !== source.sha256)
      errors.push(`Changed distributed source: ${source.file}`);
  }
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = JSON.parse(fs.readFileSync("licenses/inventory.json", "utf8"));
  const errors = validateInventory(
    inventory,
    fs.readFileSync("pnpm-lock.yaml", "utf8"),
    (sha, file) => {
      try {
        return fs.readFileSync(file ?? `licenses/texts/${sha}.txt`, "utf8");
      } catch {
        return undefined;
      }
    },
  );
  for (const file of [
    "package.json",
    ".opencode/plugins/abracode/package.json",
    "templates/reporter/package.json",
  ]) {
    if (JSON.parse(fs.readFileSync(file, "utf8")).license !== "MIT")
      errors.push(`Project license metadata differs: ${file}`);
  }
  if (!inventory.assets?.length || !inventory.sources?.length)
    errors.push("Missing distributed source/notice manifest");
  if (!fs.existsSync("THIRD_PARTY_NOTICES.md")) errors.push("Missing third-party notices");
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `License evidence matches ${inventory.packages.length} locked components and ${inventory.sources.length} distributed source files. External supplier installations are not relicensed by AbraCode.`,
    );
}
