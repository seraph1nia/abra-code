import { parseAllDocuments } from "yaml";

/** pnpm 12 stores toolchain and workspace resolutions in separate documents. */
export function parseLock(text) {
  const result = { importers: {}, packages: {}, snapshots: {} };
  for (const document of parseAllDocuments(text)) {
    if (document.errors.length) throw document.errors[0];
    const lock = document.toJS();
    if (!lock || typeof lock !== "object") throw Error("Invalid lockfile document");
    for (const section of ["packages", "snapshots"]) {
      for (const [id, value] of Object.entries(lock[section] ?? {})) {
        if (
          Object.hasOwn(result[section], id) &&
          JSON.stringify(result[section][id]) !== JSON.stringify(value)
        )
          throw Error(`Conflicting lockfile ${section}: ${id}`);
        result[section][id] = value;
      }
    }
    for (const [id, importer] of Object.entries(lock.importers ?? {}))
      result.importers[id] = { ...result.importers[id], ...importer };
  }
  return result;
}
