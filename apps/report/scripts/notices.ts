import { reportNoticeInputs, type NoticeInventory } from "@abracode/contracts/presentation/notices";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Only the notices actually embedded by the portable renderer affect its identity. */
export function reportNotices(root: string) {
  const inventory = JSON.parse(
    readFileSync(resolve(root, "licenses/inventory.json"), "utf8"),
  ) as NoticeInventory;
  return {
    project: readFileSync(resolve(root, "LICENSE"), "utf8"),
    shadcn: readFileSync(resolve(root, "licenses/shadcn-ui.txt"), "utf8"),
    dependencies: reportNoticeInputs(inventory).map((item) => ({
      id: item.id,
      license: item.license,
      author: item.author,
      notices: item.evidence.map((sha) =>
        readFileSync(resolve(root, `licenses/texts/${sha}.txt`), "utf8"),
      ),
    })),
  };
}
