import { type TestContext } from "vite-plus/test";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "@abracode/contracts/identities";
export async function assigned(t: TestContext) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const id = Id.IssueId.make("message-owner");
  const sender = Id.SessionId.make("ses_supervisor");
  f.seed.named(id);
  const e = await run(f.controller.start(id, sender));
  const request = { id: Id.RequestId.make("steer-one"), sender };
  const send = (text = "Continue within the assigned scope") =>
    run(f.controller.control(id, "steer", text, request));
  return { f, e, request, send };
}
