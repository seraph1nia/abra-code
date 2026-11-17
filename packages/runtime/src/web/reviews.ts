import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { ReviewPublishSchema, ReviewRecordSchema, ReviewSelectionSchema, ReviewSubmitSchema, ReviewAssetDataSchema, reviewAnswerErrors, reviewReference, type ReviewSource, type ReviewRecord, type ReviewSelection, type ReviewSubmit } from "@abracode/contracts/web/reviews";
import type { SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";
import { AbsolutePath, ContentHash, LockKey, MessageId, SessionId, StorageKey, StoragePrefix, timestamp } from "../identities.ts";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { within } from "../visibility/documents.ts";
import { canonicalJSON, presentationHash } from "../presentation/identity.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
import { committedScope } from "../visibility/invalidations.ts";

const digest = (bytes: Uint8Array) => ContentHash.make(createHash("sha256").update(bytes).digest("hex"));
const fail = (message: string) => new CrewError("REVIEW_REFUSED", message);
const HeadSchema = Schema.Struct({ current: ReviewSelectionSchema, pending: Schema.optionalKey(Schema.Struct({ record: ReviewRecordSchema, input_hash: ContentHash })) });
const PublicationSchema = Schema.Struct({ record: ReviewRecordSchema, input_hash: ContentHash });
const ResponseSchema = Schema.Struct({ input: ReviewSubmitSchema, text: Schema.String.check(Schema.isMaxLength(32768)) });
const key = (session: string, suffix: string) => StorageKey.make(`web/review/${session}/${suffix}`);
const recordHash = (record: Omit<ReviewRecord, "hash">) => presentationHash(record);
const unsigned = ({hash: _hash, ...record}: ReviewRecord) => record;
export type ReviewSourceReader = (session: SessionId, source: ReviewSource) => Effect.Effect<{ text: string; root?: AbsolutePath }, CrewError>;
export interface ReviewAdmissions {
  submit(session: SessionId, input: { request_id: string; text: string; delivery: "queue" | "steer" }): Effect.Effect<SubmissionReceipt, CrewError>;
}

/** Immutable reviews, assets and response reservations; observation never writes. */
export class Reviews {
  constructor(private store: Store, private locks: Locks, private source: ReviewSourceReader) {}
  private immutable(id: StorageKey, value: unknown) {
    return Effect.gen({self:this}, function*(){
      const old = yield* this.store.get(id);
      if (old !== undefined && canonicalJSON(old) !== canonicalJSON(value)) return yield* fail("Retained review identity conflicts with existing content");
      if (old === undefined) yield* this.store.set(id, value);
    });
  }
  private publication(value: unknown) {
    return Effect.gen(function*(){
      const saved = yield* decode(PublicationSchema, value, "Review publication");
      if (recordHash(unsigned(saved.record)) !== saved.record.hash) return yield* fail("Review integrity check failed");
      return saved;
    });
  }
  private commit(saved: typeof PublicationSchema.Type) {
    return Effect.gen({self:this}, function*(){
      const r=saved.record, id=r.review.review_id;
      yield* this.immutable(key(r.session_id,`call/${presentationHash([r.message_id,r.call_id])}`),saved);
      yield* this.immutable(key(r.session_id,`record/${id}/${r.revision}`),saved);
      yield* new PresentationAssociations(this.store,this.locks).associate({session_id:r.session_id,message_id:r.message_id,tool_call_id:r.call_id,source:"tool",target:{kind:"review",review_id:id,revision:r.revision}});
      yield* this.store.set(key(r.session_id,`head/${id}`),{current:{review_id:id,revision:r.revision}});
      yield* committedScope({presentations:true});
    });
  }
  recover(session: SessionId) {
    return this.locks.with(LockKey.make("web-reviews"),()=>Effect.gen({self:this},function*(){
      const rows=yield* this.store.entries(StoragePrefix.make(`web/review/${session}/head/`));
      for(const row of rows){
        yield* Effect.gen({self:this},function*(){
          const head=yield* decode(HeadSchema,row.value,"Review head");
          if(head.pending){
            const saved=yield* this.publication(head.pending);
            if(saved.record.session_id!==session || row.key!==key(session,`head/${saved.record.review.review_id}`)) return yield* fail("Foreign review reservation");
            yield* this.commit(saved);
          }
        }).pipe(Effect.result);
      }
    }));
  }
  private capture(session: SessionId, root: AbsolutePath | undefined, previews: NonNullable<typeof ReviewPublishSchema.Type.previews>) {
    return Effect.gen({self:this},function*(){
      if(previews.length && !root) return yield* fail("Design images require an owned source worktree");
      const assets: ReviewRecord["assets"][number][]=[];
      let total=0;
      for(const preview of previews){
        if(assets.some((a)=>a.id===preview.id)) return yield* fail("Preview identifiers must be unique");
        const bytes=yield* Effect.tryPromise({try:async()=>{
          const tree=AbsolutePath.make(await realpath(root!));
          const original=resolve(tree,preview.path), canonical=AbsolutePath.make(await realpath(original));
          if(!within(tree,canonical) || canonical!==original) throw fail("Preview must be a regular, non-symlink file inside its owned worktree");
          const handle=await open(canonical,constants.O_RDONLY|constants.O_NOFOLLOW);
          try{
            const stat=await handle.stat();
            if(!stat.isFile() || stat.size>2*1024*1024) throw fail("Preview exceeds 2 MiB or is not a regular file");
            const buffer=Buffer.alloc(2*1024*1024+1);
            const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
            if(bytesRead>2*1024*1024) throw fail("Preview exceeds 2 MiB");
            return buffer.subarray(0,bytesRead);
          }finally{await handle.close();}
        },catch:CrewError.from});
        total+=bytes.length;
        if(total>8*1024*1024) return yield* fail("Review previews exceed 8 MiB");
        const mime=bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" as const : bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 ? "image/jpeg" as const : bytes.length>=12 && bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP" ? "image/webp" as const : undefined;
        if(!mime) return yield* fail("Preview must be PNG, JPEG or WebP raster content");
        const asset={id:preview.id,hash:digest(bytes),mime,bytes:bytes.length};
        // Asset content is immutable and independent of the worktree lifecycle.
        yield* this.immutable(key(session,`asset/${asset.hash}`),{hash:asset.hash,mime,bytes:asset.bytes,data:bytes.toString("base64")});
        assets.push(asset);
      }
      return assets;
    });
  }
  publish(session: SessionId, message: MessageId, call: string, input: typeof ReviewPublishSchema.Type) {
    return this.locks.with(LockKey.make("web-reviews"),()=>domainEffect(Effect.gen({self:this},function*(){
      const value=yield* decode(ReviewPublishSchema,input,"Review input");
      const id=value.review.review_id, inputHash=presentationHash(value), callKey=key(session,`call/${presentationHash([message,call])}`);
      const old=yield* this.store.get(callKey);
      if(old!==undefined){
        const saved=yield* this.publication(old);
        if(saved.input_hash!==inputHash || saved.record.session_id!==session || saved.record.message_id!==message || saved.record.call_id!==call) return yield* fail("Native call is already bound to different review input");
        // Never roll a current head back when an older native call is retried.
        const head=yield* this.store.get(key(session,`head/${id}`));
        if(head===undefined || (yield* decode(HeadSchema,head,"Review head")).current.revision<=saved.record.revision) yield* this.commit(saved);
        return reviewReference(saved.record);
      }
      const headKey=key(session,`head/${id}`), raw=yield* this.store.get(headKey);
      let head=raw===undefined ? undefined : yield* decode(HeadSchema,raw,"Review head");
      if(head?.pending){
        const pending=yield* this.publication(head.pending);
        yield* this.commit(pending);
        if(pending.record.message_id===message && pending.record.call_id===call){
          if(pending.input_hash!==inputHash) return yield* fail("Reserved call input conflicts");
          return reviewReference(pending.record);
        }
        head={current:head.current};
      }
      if(!head && (yield* this.store.entries(StoragePrefix.make(`web/review/${session}/head/`))).length>=32) return yield* fail("At most 32 review identities per Abra conversation");
      const source=yield* this.source(session,value.review.source);
      const assets=yield* this.capture(session,source.root,value.previews??[]);
      const referenced=value.review.fields.flatMap((f)=>f.component==="DesignChoiceGroup" ? f.options.map((o)=>o.preview) : []);
      if(referenced.some((id)=>!assets.some((a)=>a.id===id)) || assets.some((a)=>!referenced.includes(a.id))) return yield* fail("Design choices must reference exactly the supplied preview assets");
      if(value.review.responds_to){
        const response=yield* this.store.get(key(session,`response/${value.review.responds_to}`));
        if(response===undefined) return yield* fail("Follow-up review requires a retained submitted response");
        yield* decode(ResponseSchema,response,"Review response");
      }
      const record={schema_version:1 as const,session_id:session,message_id:message,call_id:call,revision:(head?.current.revision??0)+1,at:yield* timestamp,review:value.review,source_text:source.text,assets};
      const saved={record:{...record,hash:recordHash(record)},input_hash:inputHash};
      yield* decode(ReviewRecordSchema,saved.record,"Published review");
      yield* this.store.set(headKey,{current:{review_id:id,revision:saved.record.revision},pending:saved});
      yield* this.commit(saved);
      return reviewReference(saved.record);
    })));
  }
  private record(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({self:this},function*(){
      yield* decode(ReviewSelectionSchema,{review_id:selection.review_id,revision:selection.revision},"Review selection");
      const saved=yield* this.publication(yield* this.store.get(key(session,`record/${selection.review_id}/${selection.revision}`)));
      if(saved.record.session_id!==session || saved.record.review.review_id!==selection.review_id || saved.record.revision!==selection.revision) return yield* fail("Review belongs to another selection");
      return saved.record;
    });
  }
  list(session: SessionId, issue?: string) {
    return Effect.gen({self:this},function*(){
      const rows=yield* this.store.entries(StoragePrefix.make(`web/review/${session}/head/`));
      const reviews: ReturnType<typeof reviewReference>[]=[]; const diagnostics:string[]=[];
      for(const row of rows.slice(0,32)){
        const observed=yield* Effect.gen({self:this},function*(){
          const head=yield* decode(HeadSchema,row.value,"Review head");
          if(row.key!==key(session,`head/${head.current.review_id}`)) return yield* fail("Foreign review head");
          const record=yield* this.record(session,head.current);
          const source=record.review.source;
          if(!issue || ("issue_id" in source && source.issue_id===issue)) return reviewReference(record);
        }).pipe(Effect.result);
        if(observed._tag==="Failure") diagnostics.push("A retained review is unavailable; its evidence was preserved.");
        else if(observed.success) reviews.push(observed.success);
      }
      return {reviews,diagnostics};
    });
  }
  read(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({self:this},function*(){
      const record=yield* this.record(session,selection);
      const head=yield* decode(HeadSchema,yield* this.store.get(key(session,`head/${selection.review_id}`)),"Review head");
      const source=yield* this.source(session,record.review.source).pipe(Effect.result);
      const unavailable=head.current.revision!==selection.revision ? "This review was superseded. Open the current review; your earlier draft is preserved." : source._tag==="Failure" ? "The reviewed source changed or is unavailable. Ask Abra for an updated review; your draft is preserved." : undefined;
      const all=yield* this.list(session);
      return {record,current_revision:head.current.revision,...(unavailable?{unavailable}:{}),revisions:all.reviews};
    });
  }
  asset(session: SessionId, selection: ReviewSelection & {hash:ContentHash}) {
    return Effect.gen({self:this},function*(){
      const record=yield* this.record(session,selection);
      const asset=record.assets.find((a)=>a.hash===selection.hash);
      if(!asset) return yield* fail("Image does not belong to this review");
      const raw=yield* this.store.get(key(session,`asset/${asset.hash}`));
      const data=yield* decode(Schema.Record(Schema.String,Schema.Json),raw,"Retained image data");
      const value=yield* decode(ReviewAssetDataSchema,{...data,id:asset.id},"Review image");
      const bytes=Buffer.from(value.data,"base64");
      if(bytes.length!==asset.bytes || digest(bytes)!==asset.hash || value.mime!==asset.mime) return yield* fail("Retained image integrity check failed");
      return value;
    });
  }
  submit(session: SessionId, input: ReviewSubmit, admissions: ReviewAdmissions) {
    return domainEffect(Effect.gen({self:this},function*(){
      const reserved=yield* this.locks.with(LockKey.make("web-reviews"),()=>Effect.gen({self:this},function*(){
        const value=yield* decode(ReviewSubmitSchema,input,"Review response");
        const responseKey=key(session,`response/${value.request_id}`), prior=yield* this.store.get(responseKey);
        if(prior!==undefined){
          const saved=yield* decode(ResponseSchema,prior,"Retained response");
          if(canonicalJSON(saved.input)!==canonicalJSON(value)) return yield* fail("Response identity is already bound to different answers");
          return saved;
        }
        const view=yield* this.read(session,value);
        if(view.unavailable) return yield* fail(view.unavailable);
        const record=view.record;
        if(record.hash!==value.hash) return yield* fail("Review hash does not match the reviewed version");
        const errors=reviewAnswerErrors(record.review,value.answers);
        if(Object.keys(errors).length) return yield* fail(Object.values(errors).join("; "));
        const answers=record.review.fields.map((f)=>({question:f.label,field_id:f.id,answer:value.answers[f.id]??null, ...("options" in f ? {selected_options:f.options.filter((o)=>{const v=value.answers[f.id];return Array.isArray(v)?v.includes(o.value):v===o.value;}).map((o)=>({value:o.value,label:o.label}))}: {})}));
        const text=`Please revise the reviewed plan or respond to this report using my feedback. This is review input, not plan or merge approval. Follow the existing controller checkpoints. Read the retained review with abra_review_ui action read for captured source content. Publish a follow-up review with responds_to ${value.request_id} when a revision is available.\n\n${JSON.stringify({review_id:value.review_id,revision:value.revision,hash:value.hash,source:record.review.source,title:record.review.title,answers},null,2)}`;
        if(text.length>32768) return yield* fail("Review response exceeds admission limits");
        const saved={input:value,text};
        yield* this.immutable(responseKey,saved);
        return saved;
      }));
      const receipt=yield* admissions.submit(session,{request_id:reserved.input.request_id,text:reserved.text,delivery:"queue"});
      return {...receipt,review_id:reserved.input.review_id,revision:reserved.input.revision,hash:reserved.input.hash};
    }));
  }
}
