import { Clock, Effect, Schema } from "effect";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Form } from "@opencode/schema/form";
import { Project } from "@opencode/schema/project";
import { Model } from "@opencode/schema/model";
import { Provider } from "@opencode/schema/provider";
import { Agent } from "@opencode/schema/agent";
export { AbsolutePath, RelativePath } from "@opencode/schema/schema";

export const Identifier = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/),
);
export const IssueId = Identifier.pipe(Schema.brand("abracode/IssueId"));
export type IssueId = typeof IssueId.Type;
export const RepositoryId = Identifier.pipe(Schema.brand("abracode/RepositoryId"));
export type RepositoryId = typeof RepositoryId.Type;
export const ExecutionId = Identifier.pipe(Schema.brand("abracode/ExecutionId"));
export type ExecutionId = typeof ExecutionId.Type;
export const RequestId = Identifier.pipe(Schema.brand("abracode/RequestId"));
export type RequestId = typeof RequestId.Type;
export const LeadId = Identifier.pipe(Schema.brand("abracode/LeadId"));
export type LeadId = typeof LeadId.Type;
export const DispatchProfileId = Identifier.pipe(Schema.brand("abracode/DispatchProfileId"));
export type DispatchProfileId = typeof DispatchProfileId.Type;
export const OperationId = Identifier.pipe(Schema.brand("abracode/OperationId"));
export type OperationId = typeof OperationId.Type;
export const ObligationKey = Identifier.pipe(Schema.brand("abracode/ObligationKey"));
export type ObligationKey = typeof ObligationKey.Type;
export const ReportId = Identifier.pipe(Schema.brand("abracode/ReportId"));
export type ReportId = typeof ReportId.Type;
export const IncidentId = Identifier.pipe(Schema.brand("abracode/IncidentId"));
export type IncidentId = typeof IncidentId.Type;
export const RoundId = Identifier.pipe(Schema.brand("abracode/RoundId"));
export type RoundId = typeof RoundId.Type;
export const ChangeName = Identifier.pipe(Schema.brand("abracode/ChangeName"));
export type ChangeName = typeof ChangeName.Type;
export const ArtifactId = Identifier.pipe(Schema.brand("abracode/ArtifactId"));
export type ArtifactId = typeof ArtifactId.Type;
const objectId = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/));
export const Commit = objectId.pipe(Schema.brand("abracode/Commit"));
export type Commit = typeof Commit.Type;
export const GitTree = objectId.pipe(Schema.brand("abracode/GitTree"));
export type GitTree = typeof GitTree.Type;
export const Fingerprint = Schema.NonEmptyString.pipe(Schema.brand("abracode/Fingerprint"));
export type Fingerprint = typeof Fingerprint.Type;
export const ContentHash = objectId.pipe(Schema.brand("abracode/ContentHash"));
export type ContentHash = typeof ContentHash.Type;
export const BranchName = Schema.NonEmptyString.pipe(Schema.brand("abracode/BranchName"));
export type BranchName = typeof BranchName.Type;
export const GitRemote = Schema.NonEmptyString.pipe(Schema.brand("abracode/GitRemote"));
export type GitRemote = typeof GitRemote.Type;
export const RemoteIdentity = Schema.NonEmptyString.pipe(Schema.brand("abracode/RemoteIdentity"));
export type RemoteIdentity = typeof RemoteIdentity.Type;
export const PullRequestUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/)).pipe(
  Schema.brand("abracode/PullRequestUrl"),
);
export type PullRequestUrl = typeof PullRequestUrl.Type;
export const FindingId = Schema.NonEmptyString.pipe(Schema.brand("abracode/FindingId"));
export type FindingId = typeof FindingId.Type;
export const ActivityId = Schema.NonEmptyString.pipe(Schema.brand("abracode/ActivityId"));
export type ActivityId = typeof ActivityId.Type;
const utcInstant = Schema.String.check(
  Schema.makeFilter((value) => {
    const match = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?(?:Z|\+00:00)$/.exec(value);
    if (!match) return "Expected a UTC timestamp";
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return "Expected a valid timestamp";
    return (
      new Date(milliseconds).toISOString() ===
        `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0")}Z` ||
      "Invalid calendar timestamp"
    );
  }),
);
export const Timestamp = utcInstant.pipe(Schema.brand("abracode/Timestamp"));
export type Timestamp = typeof Timestamp.Type;
export const timestampAt = (milliseconds: number) =>
  Timestamp.make(new Date(milliseconds).toISOString());
export const timestamp = Clock.currentTimeMillis.pipe(Effect.map(timestampAt));
// Reuse native brands so adapters never invent a competing identity for a host resource.
export const SessionId = Session.ID;
export type SessionId = Session.ID;
export const MessageId = SessionMessage.ID;
export type MessageId = SessionMessage.ID;
export const FormId = Form.ID;
export type FormId = Form.ID;
export const NativeProjectId = Project.ID;
export type NativeProjectId = Project.ID;
export const ProviderId = Provider.ID;
export type ProviderId = Provider.ID;
export const ModelId = Model.ID;
export type ModelId = Model.ID;
export const ModelVariant = Model.VariantID;
export type ModelVariant = Model.VariantID;
export const AgentId = Agent.ID;
export type AgentId = Agent.ID;

export const StorageKey = Schema.NonEmptyString.pipe(Schema.brand("abracode/StorageKey"));
export type StorageKey = typeof StorageKey.Type;
export const StoragePrefix = Schema.String.pipe(Schema.brand("abracode/StoragePrefix"));
export type StoragePrefix = typeof StoragePrefix.Type;
export const LockKey = Identifier.pipe(Schema.brand("abracode/LockKey"));
export type LockKey = typeof LockKey.Type;
export const ToolName = Schema.NonEmptyString.pipe(Schema.brand("abracode/ToolName"));
export type ToolName = typeof ToolName.Type;
export const ErrorCode = Schema.NonEmptyString.pipe(Schema.brand("abracode/ErrorCode"));
export type ErrorCode = typeof ErrorCode.Type;
export const RepositorySlug = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/),
).pipe(Schema.brand("abracode/RepositorySlug"));
export type RepositorySlug = typeof RepositorySlug.Type;
export const CheckName = Schema.NonEmptyString.pipe(Schema.brand("abracode/CheckName"));
export type CheckName = typeof CheckName.Type;
export const SpecSchemaName = Schema.NonEmptyString.pipe(Schema.brand("abracode/SpecSchemaName"));
export type SpecSchemaName = typeof SpecSchemaName.Type;
export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("abracode/TaskId"));
export type TaskId = typeof TaskId.Type;
export const QuestionIdentity = Schema.NonEmptyString.pipe(
  Schema.brand("abracode/QuestionIdentity"),
);
export type QuestionIdentity = typeof QuestionIdentity.Type;
export const Executable = Schema.NonEmptyString.pipe(Schema.brand("abracode/Executable"));
export type Executable = typeof Executable.Type;
export const ViewKey = Schema.NonEmptyString.pipe(Schema.brand("abracode/ViewKey"));
export type ViewKey = typeof ViewKey.Type;

export const OperationAction = Schema.NonEmptyString.pipe(Schema.brand("abracode/OperationAction"));
export type OperationAction = typeof OperationAction.Type;
