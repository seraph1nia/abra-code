import { execFile } from "node:child_process";
import { promisify } from "node:util";

const command = promisify(execFile);

/** Only call with a root allocated by this fixture. GNU rm avoids serializing
 * tens of thousands of supplier unlinks through Node's filesystem worker pool. */
export async function removeFixture(root: string) {
  await command("rm", ["-rf", "--", root]);
}
