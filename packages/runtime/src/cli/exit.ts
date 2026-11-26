import { Data, Runtime } from "effect";

/** The command has already emitted its diagnostic or forwarded the child's output. */
export class CommandExit extends Data.TaggedError("CommandExit")<{ readonly status: number }> {
  readonly [Runtime.errorReported] = false;
  get [Runtime.errorExitCode]() {
    return this.status;
  }
}
