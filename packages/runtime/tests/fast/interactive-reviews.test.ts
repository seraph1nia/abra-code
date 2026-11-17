import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v1_0";
import { ReviewDefinitionSchema, ReviewPublishSchema, ReviewSubmitSchema, reviewAnswerErrors } from "@abracode/contracts/web/reviews";
import { reviewCatalog, reviewCatalogDocument, reviewSurface } from "@abracode/contracts/web/review-catalog";
import { validateSurface } from "../../src/web/surfaces.ts";
import { Reviews } from "../../src/web/reviews.ts";
import { WebAdmissions } from "../../src/web/gateway.ts";
import { presentationHash } from "../../src/presentation/identity.ts";
import { CrewError } from "../../src/domain.ts";
import { IssueId, MessageId, RelativePath, SessionId } from "../../src/identities.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";

const session = SessionId.make("ses_review"), message = MessageId.make("msg_review");
export function reviewDefinition() {
  return Schema.decodeUnknownSync(ReviewDefinitionSchema)({review_id:"plan-feedback",title:"Choose the first release",source:{kind:"plan",issue_id:IssueId.make("abra-web"),path:RelativePath.make("proposal.md"),generation:0,hash:presentationHash("Plan")},fields:[
    {component:"SingleSelect",id:"direction",label:"Direction",required:true,options:[{value:"simple",label:"Simple"},{value:"complete",label:"Complete"}]},
    {component:"MultiSelect",id:"features",label:"Features",options:[{value:"email",label:"Email login"},{value:"reset",label:"Password reset"}]},
    {component:"CommentField",id:"comments",label:"Comments"},
  ]});
}
function fixture(){
  const store=new MemoryStore(),locks=new TestLocks(); let changed=false,prompts=0,admitted=true;
  const source=()=>changed?Effect.fail(new CrewError("REVIEW_REFUSED","Source changed")):Effect.succeed({text:"Plan"});
  const reviews=new Reviews(store,locks,source);
  const admissions=new WebAdmissions(store,{prompt:()=>Effect.sync(()=>{prompts++;}),promptAdmission:()=>Effect.succeed(admitted?"context" as const:"absent" as const)},locks);
  return {store,locks,reviews,admissions,source,setChanged:()=>{changed=true;},setAbsent:()=>{admitted=false;},prompts:()=>prompts};
}

test("review catalog uses the official complete-surface processor without widening evidence catalogs",()=>{
  assert.equal(Catalog.fromJson(reviewCatalogDocument).functions.size,0);
  const processor=new MessageProcessor([reviewCatalog],undefined,{version:"1.0"});
  try{processor.processMessages(reviewSurface(reviewDefinition()));assert.ok(processor.model.getSurface("plan-feedback"));}
  finally{processor.dispose();}
  assert.throws(()=>validateSurface(reviewSurface(reviewDefinition())));
});

test("review definitions and answers reject unknown, executable, repeated and wrong-shaped values",()=>{
  const review=reviewDefinition();
  for(const invalid of [{...review,callback:"execute"},{...review,fields:[review.fields[0],review.fields[0]]},{...review,fields:[{...review.fields[0],options:[{value:"same",label:"One"},{value:"same",label:"Two"}]}]}])assert.throws(()=>Schema.decodeUnknownSync(ReviewDefinitionSchema,{onExcessProperty:"error"})(invalid));
  assert.ok(reviewAnswerErrors(review,{direction:"invented"}).direction);
  assert.ok(reviewAnswerErrors(review,{direction:["simple"]}).direction);
  assert.ok(reviewAnswerErrors(review,{direction:"simple",features:["email","email"]}).features);
  assert.ok(reviewAnswerErrors(review,{direction:"simple",approve:"yes"}).approve);
  assert.deepEqual(reviewAnswerErrors(review,{direction:"simple",features:["email"],comments:"Use A's navigation"}),{});
  assert.throws(()=>Schema.decodeUnknownSync(ReviewPublishSchema)({review,previews:[{id:"escape",path:"../secret.png"}]}));
});

test("immutable publication recovers interrupted associations, supersedes and never rolls heads back",async()=>{
  const f=fixture(),review=reviewDefinition();
  const original=f.store.set.bind(f.store);let interrupted=true;
  f.store.set=(key,value)=>key.startsWith("web/presentation/")&&interrupted?(interrupted=false,Effect.fail(new CrewError("INTERRUPTED","Lost publication"))):original(key,value);
  await assert.rejects(Effect.runPromise(f.reviews.publish(session,message,"first",{review})));
  const restarted=new Reviews(f.store,f.locks,f.source);
  await Effect.runPromise(restarted.recover(session));
  const first=await Effect.runPromise(restarted.publish(session,message,"first",{review}));
  assert.equal(first.revision,1);
  const second=await Effect.runPromise(restarted.publish(session,MessageId.make("msg_later"),"second",{review:{...review,title:"Updated choices"}}));
  assert.equal(second.revision,2);
  await Effect.runPromise(restarted.publish(session,message,"first",{review}));
  const old=await Effect.runPromise(restarted.read(session,first));
  assert.equal(old.current_revision,2);assert.match(old.unavailable!,/superseded/);
  await assert.rejects(Effect.runPromise(restarted.publish(session,message,"first",{review:{...review,title:"Conflicting retry"}})));
  await assert.rejects(Effect.runPromise(restarted.read(SessionId.make("ses_foreign"),first)));
  assert.equal((await Effect.runPromise(restarted.list(session))).reviews[0]?.revision,2);
});

test("feedback validates source and answers and reuses original admission after source change and restart",async()=>{
  const f=fixture(),ref=await Effect.runPromise(f.reviews.publish(session,message,"publish",{review:reviewDefinition()}));
  const input=Schema.decodeUnknownSync(ReviewSubmitSchema)({review_id:ref.review_id,revision:ref.revision,hash:ref.hash,request_id:"feedback-one",answers:{direction:"simple",features:["email"],comments:"Keep this focused"}});
  await assert.rejects(Effect.runPromise(f.reviews.submit(session,{...input,answers:{direction:"bad"}},f.admissions)));
  assert.equal(f.prompts(),0);
  const receipt=await Effect.runPromise(f.reviews.submit(session,input,f.admissions));
  assert.equal(receipt.status,"admitted");assert.equal(f.prompts(),1);assert.match(receipt.text,/not plan or merge approval/);assert.match(receipt.text,/Email login/);
  f.setChanged();
  const restarted=new Reviews(f.store,f.locks,f.source);
  assert.deepEqual(await Effect.runPromise(restarted.submit(session,input,f.admissions)),receipt);
  assert.equal(f.prompts(),1);
  await assert.rejects(Effect.runPromise(restarted.submit(session,{...input,request_id:"new-after-change"},f.admissions)));
  await assert.rejects(Effect.runPromise(restarted.submit(session,{...input,answers:{direction:"complete"}},f.admissions)));
});

test("unconfirmed native admissions remain uncertain without replaying a prompt",async()=>{
  const f=fixture();let prompts=0;
  const admissions=new WebAdmissions(f.store,{prompt:()=>{prompts++;return Effect.fail(new CrewError("LOST","Lost native response"));},promptAdmission:()=>Effect.succeed("absent" as const)},f.locks);
  const ref=await Effect.runPromise(f.reviews.publish(session,message,"publish",{review:reviewDefinition()}));
  const input=Schema.decodeUnknownSync(ReviewSubmitSchema)({review_id:ref.review_id,revision:ref.revision,hash:ref.hash,request_id:"uncertain",answers:{direction:"simple"}});
  assert.equal((await Effect.runPromise(f.reviews.submit(session,input,admissions))).status,"uncertain");
  assert.equal((await Effect.runPromise(f.reviews.submit(session,input,admissions))).status,"uncertain");
  assert.equal(prompts,1);
});
