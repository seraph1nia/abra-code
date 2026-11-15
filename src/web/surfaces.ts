/** A2UI 1.0 messages, restricted to AbraCode's local, non-executable catalog. */
export const catalogId = "https://abracode.local/catalog/v1";
export const componentNames = [
  "Column",
  "Row",
  "Text",
  "WorkTable",
  "StatusSummary",
  "Kanban",
  "DependencyGraph",
  "Timeline",
  "DecisionSummary",
  "ReportLink",
] as const;
export type ComponentName = (typeof componentNames)[number];
export interface WorkComponent {
  id: string;
  component: ComponentName;
  children?: string[];
  text?: string;
  issueIds?: string[];
  issueId?: string;
  mode?: "live" | "snapshot";
}
export interface WorkSurface {
  version: "1.0";
  createSurface: { surfaceId: string; catalogId: typeof catalogId; components: WorkComponent[] };
}
const identity = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown surface property");
}
/** Validate the whole replacement before publication; never partly apply malformed UI. */
export function validateSurface(value: unknown, workIds: ReadonlySet<string>): WorkSurface {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536 || !record(value))
    throw new Error("Surface exceeds the 64 KiB limit");
  keys(value, ["version", "createSurface"]);
  const create = value.createSurface;
  if (value.version !== "1.0" || !record(create))
    throw new Error("Expected A2UI 1.0 createSurface and updateComponents");
  keys(create, ["surfaceId", "catalogId", "components"]);
  if (
    typeof create.surfaceId !== "string" ||
    !identity.test(create.surfaceId) ||
    create.catalogId !== catalogId ||
    !Array.isArray(create.components) ||
    create.components.length < 1 ||
    create.components.length > 100
  )
    throw new Error("Invalid surface identity, catalog or component count");
  const ids = new Map<string, WorkComponent>();
  for (const item of create.components) {
    if (!record(item)) throw new Error("Invalid component");
    keys(item, ["id", "component", "children", "text", "issueIds", "issueId", "mode"]);
    if (
      typeof item.id !== "string" ||
      !identity.test(item.id) ||
      ids.has(item.id) ||
      !componentNames.includes(item.component as ComponentName)
    )
      throw new Error("Invalid component identity");
    if (item.text !== undefined && (typeof item.text !== "string" || item.text.length > 4096))
      throw new Error("Invalid text");
    if (item.mode !== undefined && item.mode !== "live" && item.mode !== "snapshot")
      throw new Error("Invalid binding mode");
    for (const property of ["children", "issueIds"]) {
      if (
        item[property] !== undefined &&
        (!Array.isArray(item[property]) ||
          item[property].length > 100 ||
          item[property].some((id: unknown) => typeof id !== "string"))
      )
        throw new Error("Invalid component references");
    }
    const refs = [
      ...((item.issueIds as string[] | undefined) ?? []),
      ...(item.issueId === undefined ? [] : [item.issueId]),
    ];
    if (refs.some((id) => typeof id !== "string" || !workIds.has(id)))
      throw new Error("Unknown work reference");
    ids.set(item.id, item as unknown as WorkComponent);
  }
  const seen = new Set<string>();
  function visit(id: string, depth: number) {
    const item = ids.get(id);
    if (!item || seen.has(id) || depth > 10)
      throw new Error("Missing, repeated or cyclic component");
    seen.add(id);
    for (const child of item.children ?? []) visit(child, depth + 1);
  }
  visit("root", 0);
  if (seen.size !== ids.size) throw new Error("Unreachable component");
  return value as unknown as WorkSurface;
}
