import { Data } from "effect";

export class AgentDefinitionError extends Data.TaggedError("AgentDefinitionError")<{
  readonly code: string;
  readonly definition: string;
  readonly source?: string;
  readonly message: string;
}> {}
export class AgentRegistrationError extends Data.TaggedError("AgentRegistrationError")<{
  readonly code: string;
  readonly message: string;
}> {}
