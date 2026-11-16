import { join } from "node:path";
import { type AbsolutePath, type SessionId } from "../identities.ts";

/** CLI conventions are derived from the native session; no additional resource inventory. */
export const workerBrowser = (home: AbsolutePath, session: SessionId) => ({
  name: `abracode-${session}`,
  directory: join(home, ".abracode/browser", session),
});
