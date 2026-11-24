import {
  NoticeInventorySchema,
  reportNoticeInputs,
  type NoticeInventory,
} from "@abracode/contracts/presentation/notices";
import { Schema } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NoticeInventoryJSON = Schema.fromJsonString(NoticeInventorySchema);

export function decodeNoticeInventory(text: string): NoticeInventory {
  return Schema.decodeSync(NoticeInventoryJSON, { reportInput: false })(text);
}

/** Only the notices actually embedded by the portable renderer affect its identity. */
export function reportNotices(root: string) {
  const inventory = decodeNoticeInventory(
    readFileSync(resolve(root, "licenses/inventory.json"), "utf8"),
  );
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
