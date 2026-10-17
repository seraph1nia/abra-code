// Explicit maintainer operation: downloads metadata/license evidence; never used by startup.
import fs from "node:fs";
import { classifyUses } from "./uses.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "yaml";
const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const lockText = fs.readFileSync("pnpm-lock.yaml", "utf8");
const lock = parse(lockText);
const uses = classifyUses(lock);
const installed = new Map();
for (const entry of fs.readdirSync("node_modules/.pnpm")) {
  const dir = path.join("node_modules/.pnpm", entry, "node_modules");
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).filter((name) => !name.startsWith("."))) {
    const names = name.startsWith("@")
      ? fs.readdirSync(path.join(dir, name)).map((n) => `${name}/${n}`)
      : [name];
    for (const name of names) {
      const location = path.join(dir, name);
      if (!fs.existsSync(path.join(location, "package.json"))) continue;
      const pkg = JSON.parse(fs.readFileSync(path.join(location, "package.json"), "utf8"));
      installed.set(`${pkg.name}@${pkg.version}`, { location, pkg });
    }
  }
}
const old = fs.existsSync("licenses/inventory.json")
  ? JSON.parse(fs.readFileSync("licenses/inventory.json", "utf8"))
  : undefined;
const records = new Map();
const texts = new Map();
const sourceNotes = [];
const request = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) return undefined;
  return { url, text: await response.text() };
};
const ids = Object.keys(lock.packages).sort();
const queue = [...ids];
async function inspect(id) {
  const at = id.lastIndexOf("@");
  const name = id.slice(0, at),
    version = id.slice(at + 1);
  const metaResponse = await request(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
  );
  if (!metaResponse) throw Error(`Registry evidence unavailable: ${id}`);
  const meta = JSON.parse(metaResponse.text);
  const local = installed.get(id);
  const pkg = local?.pkg ?? meta;
  let license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
  const evidence = [];
  if (local) {
    for (const file of fs
      .readdirSync(local.location)
      .filter((n) => /license|notice|copying/i.test(n))) {
      const absolute = path.join(local.location, file);
      if (!fs.statSync(absolute).isFile()) continue;
      const text = fs.readFileSync(absolute, "utf8");
      const digest = hash(text);
      texts.set(digest, text);
      evidence.push({ source: `npm:${id}/${file}`, sha256: digest });
      if (!license && /MIT License/.test(text)) license = "MIT";
    }
  }
  let repo = meta.repository?.url ?? pkg.repository?.url ?? meta.repository ?? pkg.repository;
  if (name.startsWith("@opencode/")) repo = "https://github.com/anomalyco/opencode";
  if (repo && typeof repo === "string") {
    const match = /(?:github\.com[/:])?([^/:]+\/[^/#]+?)(?:\.git)?$/.exec(
      repo.replace(/^git\+/, "").replace(/\.git$/, ""),
    );
    if (match) {
      repo = `https://github.com/${match[1]}`;
      if (!evidence.length && local) {
        const ref = name.startsWith("@opencode/") ? `v${version}` : (meta.gitHead ?? `v${version}`);
        for (const filename of [
          "LICENSE",
          "LICENSE.md",
          "LICENSE.txt",
          "license",
          "license.md",
          "COPYING",
          "LICENSE-MIT",
          "LICENSE-MIT.txt",
        ]) {
          const result = await request(
            `https://raw.githubusercontent.com/${match[1]}/${ref}/${filename}`,
          );
          if (!result) continue;
          const digest = hash(result.text);
          texts.set(digest, result.text);
          evidence.push({ source: result.url, sha256: digest });
          break;
        }
        if (!evidence.length) {
          for (const filename of [
            "LICENSE",
            "LICENSE.md",
            "LICENSE.txt",
            "license",
            "license.md",
            "LICENCE",
            "LICENSE-MIT",
            "LICENCE.md",
          ]) {
            const result = await request(
              `https://raw.githubusercontent.com/${match[1]}/HEAD/${filename}`,
            );
            if (!result) continue;
            const digest = hash(result.text);
            texts.set(digest, result.text);
            evidence.push({ source: result.url, sha256: digest });
            break;
          }
        }
      }
    }
  }
  if (local && !evidence.length && license && /^[A-Za-z0-9.-]+$/.test(license)) {
    // A declared SPDX grant with no supplied notice: retain the declaration/author and full standard terms.
    const result = await request(
      `https://raw.githubusercontent.com/spdx/license-list-data/main/text/${license}.txt`,
    );
    if (result) {
      const digest = hash(result.text);
      texts.set(digest, result.text);
      evidence.push({
        source: result.url,
        sha256: digest,
        basis: "supplier SPDX declaration; package ships no license notice",
      });
    }
  }
  const resolution = lock.packages[id].resolution;
  const fingerprint = hash(JSON.stringify({ id, license, resolution, evidence }));
  const previous = old?.packages.find((p) => p.id === id && p.fingerprint === fingerprint);
  records.set(id, {
    id,
    license: license ?? "UNKNOWN",
    repository: repo ?? null,
    author: meta.author ?? null,
    registry: metaResponse.url,
    integrity: resolution?.integrity ?? null,
    installed: !!local,
    category: local
      ? /^(?:@opencode\/cli|agent-browser|@effect\/tsgo-|@voidzero-dev\/vite-plus-.*(?:gnu|musl))/.test(
          name,
        )
        ? "supplier-installed-executable"
        : "dependency-installation"
      : "optional-platform-not-installed",
    evidence,
    uses: uses.get(id),
    fingerprint,
    disposition: previous?.disposition ?? "pending-review",
  });
}
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) await inspect(queue.shift());
  }),
);
fs.mkdirSync("licenses/texts", { recursive: true });
for (const [digest, text] of texts) fs.writeFileSync(`licenses/texts/${digest}.txt`, text);
const missing = [...records.values()].filter((p) => p.installed && !p.evidence.length);
const inventory = {
  version: 1,
  distribution: "source clone; dependencies downloaded by the operator from their suppliers",
  lock_sha256: hash(lockText),
  packages: ids.map((id) => records.get(id)),
  source_notes: old?.source_notes ?? sourceNotes,
  sources: old?.sources ?? [],
  assets: old?.assets ?? [],
};
fs.writeFileSync("licenses/inventory.json", JSON.stringify(inventory, null, 2) + "\n");
console.log(
  JSON.stringify({
    packages: records.size,
    installed: installed.size,
    licenseTexts: texts.size,
    missingEvidence: missing.map((p) => p.id),
    pendingReview: [...records.values()].filter((p) => p.disposition === "pending-review").length,
    root,
  }),
);
