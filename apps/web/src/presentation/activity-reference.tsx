import { createContext, useContext } from "react";
import { Schema } from "effect";
import type { AbstractAgent } from "@ag-ui/client";

import {
  ActivityReferenceSchema,
  presentationActivity,
  type PresentationAttachmentSchema,
} from "@abracode/contracts/presentation/contracts";
import { deferred } from "@abracode/presentation/deferred";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";

type ActivityMessage = Extract<AbstractAgent["messages"][number], { role: "activity" }>;
export const LiveActivities = createContext<{
  recent: ReadonlySet<string>;
  references: ReadonlyMap<string, ActivityMessage>;
}>({ recent: new Set(), references: new Map() });
type AttachmentProps = {
  attachment: typeof PresentationAttachmentSchema.Type;
  work: readonly WebWorkItem[];
  inspect: Inspect;
};

const AttachmentBody = deferred<AttachmentProps>(
  () => import("./attachments.tsx").then((m) => ({ default: m.AttachmentBody })),
  "Retained presentation",
);
export function MessageAttachment(props: AttachmentProps) {
  const activities = useContext(LiveActivities);
  const expected = presentationActivity(props.attachment);
  // History pages supply their own ownership-verified references outside the live window.
  const message =
    activities.references.get(expected.id) ??
    (activities.recent.has(props.attachment.message_id) ? undefined : expected);
  if (!message) return null;
  const decoded = Schema.decodeUnknownOption(ActivityReferenceSchema)(message.content);
  if (decoded._tag === "None") return null;
  const content = decoded.value;
  if (
    message.activityType !== expected.activityType ||
    content.surface_id !== expected.content.surface_id ||
    content.revision !== expected.content.revision ||
    content.tool_call_id !== expected.content.tool_call_id
  )
    return null;
  return <AttachmentBody {...props} />;
}
