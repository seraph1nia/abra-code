/** Classify every frozen component by the workspace entry points that reach it. */
export function classifyUses(lock) {
  const groups = new Map();
  const visit = (name, ref, use, seen = new Set()) => {
    const version = String(ref?.version ?? ref).split("(")[0];
    const key = Object.hasOwn(lock.packages, `${name}@${version}`) ? `${name}@${version}` : version;
    if (seen.has(key)) return;
    seen.add(key);
    if (Object.hasOwn(lock.packages, key)) {
      const values = groups.get(key) ?? new Set();
      values.add(use);
      groups.set(key, values);
    }
    // Include every peer-context snapshot, rather than selecting an arbitrary one.
    for (const [id, snapshot] of Object.entries(lock.snapshots ?? {})) {
      if (id !== key && !id.startsWith(key + "(")) continue;
      for (const [child, value] of Object.entries({
        ...snapshot.dependencies,
        ...snapshot.optionalDependencies,
      }))
        visit(child, value, use, seen);
    }
  };
  for (const [name, ref] of Object.entries(lock.importers?.["."]?.dependencies ?? {}))
    visit(name, ref, "application-runtime");
  for (const [name, ref] of Object.entries(lock.importers?.["."]?.devDependencies ?? {}))
    visit(
      name,
      ref,
      ["@opencode/cli", "@fission-ai/openspec", "agent-browser"].includes(name)
        ? "application-runtime"
        : "contributor-build",
    );
  for (const [name, ref] of Object.entries(
    lock.importers?.["templates/reporter"]?.dependencies ?? {},
  ))
    visit(name, ref, "report-artifact");
  for (const [name, ref] of Object.entries(
    lock.importers?.["templates/reporter"]?.devDependencies ?? {},
  ))
    visit(name, ref, "report-authoring-build");
  return new Map(
    Object.keys(lock.packages).map((id) => [
      id,
      [...(groups.get(id) ?? new Set(["optional-platform"]))].sort((a, b) => a.localeCompare(b)),
    ]),
  );
}
