import { createContext, useContext } from "react";
import { Schema } from "effect";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitContext, type CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";
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
const VerifiedAttachment = createContext<AttachmentProps | undefined>(undefined);
const AttachmentBody = deferred<AttachmentProps>(
  () => import("./attachments.tsx").then((m) => ({ default: m.AttachmentBody })),
  "Retained presentation",
);
function RegisteredAttachment() {
  const props = useContext(VerifiedAttachment);
  return props ? <AttachmentBody {...props} /> : null;
}
export function registerActivities(core: CopilotKitCoreReact) {
  core.setRenderActivityMessages(
    ["surface", "review", "artifact"].map((kind) => ({
      activityType: `abracode.${kind}`,
      content: Schema.toStandardSchemaV1(ActivityReferenceSchema),
      render: RegisteredAttachment,
    })),
  );
}
export function MessageAttachment(props: AttachmentProps) {
  const core = useContext(CopilotKitContext)?.copilotkit;
  const activities = useContext(LiveActivities);
  const expected = presentationActivity(props.attachment);
  // History pages supply their own ownership-verified references outside the live window.
  const message =
    activities.references.get(expected.id) ??
    (activities.recent.has(props.attachment.message_id) ? undefined : expected);
  if (!message) return null;
  const content = message.content;
  if (
    message.activityType !== expected.activityType ||
    content.surface_id !== expected.content.surface_id ||
    content.revision !== expected.content.revision ||
    content.tool_call_id !== expected.content.tool_call_id
  )
    return null;
  const Renderer = core?.renderActivityMessages.find(
    (r) => r.activityType === message.activityType,
  )?.render;
  return Renderer ? (
    <VerifiedAttachment.Provider value={props}>
      <Renderer
        activityType={message.activityType}
        message={message}
        content={content}
        agent={undefined}
      />
    </VerifiedAttachment.Provider>
  ) : null;
}
