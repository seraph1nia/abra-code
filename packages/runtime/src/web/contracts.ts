import {
  ScopedMemorySearch,
  ScopedMemoryRead,
  MemoryPage,
  MemoryBody,
  MemoryPublication,
  MemoryReference,
} from "@abracode/contracts/visibility/memory";
import type { PublicationPage, PublicationQuery } from "@abracode/contracts/presentation/contracts";
import type { Submission } from "@abracode/contracts/web/workspace-wire";
import type { AgentCatalog } from "@abracode/contracts/web/agent-settings";
import type {
  ReviewListSchema,
  ReviewView,
  ReviewSelection,
  ReviewAssetQuerySchema,
  ReviewAssetDataSchema,
  ReviewSubmit,
  ReviewReceipt,
  ReviewResponseQuerySchema,
} from "@abracode/contracts/web/reviews";
import type { PrepareDiagramSelection } from "@abracode/contracts/web/diagram-actions";
import type { DiagramPreparation } from "@abracode/contracts/presentation/diagrams";
import type { NativeEventEnvelope } from "../opencode/agui/native-state.ts";
import type { NativeSessionView } from "../opencode/agui/adapter.ts";
import type { ChangeScope } from "@abracode/contracts/web/changes";
import type { Form } from "@opencode/schema/form";
import type { Permission } from "@opencode/schema/permission";
import type { SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";
import type { ResourceSelection } from "./resources.ts";
import type {
  SaveSurfaceSchema,
  ExportDocumentSchema,
  ReadExportSchema,
} from "./report-actions.ts";
import type { ArtifactSummarySchema } from "./wire.ts";

import { type Effect, type Stream } from "effect";
import { type CrewError } from "../domain.ts";
import type { PresentationPageSchema } from "@abracode/contracts/web/workspace-wire";
import type {
  WorkspaceSnapshot,
  TranscriptMessage,
  SurfaceEntry,
} from "@abracode/contracts/web/contracts";
export type {
  WorkspaceSnapshot,
  TranscriptMessage,
  SurfaceEntry,
  SurfaceRecord,
  AttentionForm,
  AttentionPermission,
} from "@abracode/contracts/web/contracts";

import type { WorkReadName, WorkReadInput, WorkReadOutput } from "@abracode/contracts/web/http-api";
export type { WorkReadName } from "@abracode/contracts/web/http-api";
export type WorkQueries = {
  readonly [K in WorkReadName]: (
    input: WorkReadInput<K>,
  ) => Effect.Effect<WorkReadOutput<K>, CrewError>;
};

/** The only browser-facing capability surface. No arbitrary native path or location. */
export interface WebBackend {
  readonly sessionID: string;
  readonly reviews?: {
    receipt(
      selection: typeof ReviewResponseQuerySchema.Type,
    ): Effect.Effect<ReviewReceipt | null, CrewError>;
    list(issue?: string): Effect.Effect<typeof ReviewListSchema.Type, CrewError>;
    read(selection: ReviewSelection): Effect.Effect<ReviewView, CrewError>;
    asset(
      selection: typeof ReviewAssetQuerySchema.Type,
    ): Effect.Effect<typeof ReviewAssetDataSchema.Type, CrewError>;
    submit(input: ReviewSubmit): Effect.Effect<ReviewReceipt, CrewError>;
  };
  prepareDiagrams(input: PrepareDiagramSelection): Effect.Effect<DiagramPreparation, CrewError>;
  readonly agentStatus?: Effect.Effect<{ busy: boolean }, CrewError>;
  readonly memoryEnabled: Effect.Effect<boolean, CrewError>;
  memorySearch(
    input: typeof ScopedMemorySearch.Type,
  ): Effect.Effect<typeof MemoryPage.Type, CrewError>;
  memoryRead(input: typeof ScopedMemoryRead.Type): Effect.Effect<typeof MemoryBody.Type, CrewError>;
  memoryPublish(input: MemoryPublication): Effect.Effect<MemoryReference, CrewError>;
  readonly repositories: Effect.Effect<WorkspaceSnapshot["projects"], CrewError>;
  readonly agents: Effect.Effect<AgentCatalog, CrewError>;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot, CrewError>;
  observe(scope: ChangeScope): Effect.Effect<WorkspaceSnapshot, CrewError>;
  resolve(target: ResourceSelection): Effect.Effect<ResourceSelection, CrewError>;
  publications(
    query: typeof PublicationQuery.Type,
  ): Effect.Effect<typeof PublicationPage.Type, CrewError>;
  surface(id: string, revision: number): Effect.Effect<SurfaceEntry, CrewError>;
  history(cursor: string): Effect.Effect<
    {
      messages: readonly TranscriptMessage[];
      older?: string;
      presentations?: typeof PresentationPageSchema.Type;
    },
    CrewError
  >;
  submit(input: Submission): Effect.Effect<SubmissionReceipt, CrewError>;
  receipt(requestID: string): Effect.Effect<SubmissionReceipt | null, CrewError>;
  readonly stop: Effect.Effect<boolean, CrewError>;
  readonly work: WorkQueries;
  replyForm(input: {
    id: string;
    binding: string;
    answer: Form.Answer;
  }): Effect.Effect<void, CrewError>;
  replyPermission(input: {
    id: string;
    binding: string;
    decision: Permission.Reply;
  }): Effect.Effect<void, CrewError>;
  exportDocument(
    input: typeof ExportDocumentSchema.Type,
  ): Effect.Effect<
    typeof import("../presentation/report-export-contract.ts").ReportExportSchema.Type,
    CrewError
  >;
  readExport(input: typeof ReadExportSchema.Type): Effect.Effect<
    typeof import("../presentation/report-export-contract.ts").ReportExportSchema.Type & {
      html: string;
    },
    CrewError
  >;
  saveSurface(
    input: typeof SaveSurfaceSchema.Type,
  ): Effect.Effect<typeof ArtifactSummarySchema.Type, CrewError>;
  artifact(
    issue: string,
    request: string,
  ): Effect.Effect<
    { readonly html: string; readonly hash: string; readonly bytes: number },
    CrewError
  >;
  completionEvidence?: () => NonNullable<NativeSessionView["completions"]>;
  nativeEvent?: (event: NativeEventEnvelope) => { view?: NativeSessionView; repair?: boolean };
  nativeSnapshot?: () => NativeSessionView | undefined;
  readonly changes: Stream.Stream<
    (ChangeScope & { native?: NativeEventEnvelope }) | void,
    CrewError
  >;
}
