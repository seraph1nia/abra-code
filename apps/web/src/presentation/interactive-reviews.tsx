/* oxlint-disable effecttsgo/unstable-api-usage -- Typed HTTP atoms own review reads and response reconciliation. */
import { useEffect, useState, type ComponentProps } from "react";
import { useAtomSet } from "@effect/atom-react";
import { Exit } from "effect";
import { reviewAnswerErrors, type ReviewSelection, type ReviewSource, type ReviewView, type ReviewRecord } from "@abracode/contracts/web/reviews";
import { ReviewSubmitSchema } from "@abracode/contracts/web/reviews";
import { Schema } from "effect";
import { Button } from "@abracode/presentation/ui/button";
import { reviewListQuery, reviewQuery, reviewAssetQuery, submitReview, readReceipt } from "../data.ts";
import { RequestState, requestError } from "../request-state.tsx";
import { useReviewDraft } from "../review-state.ts";
import { deferred } from "../deferred.tsx";

const ReviewControls=deferred<ComponentProps<typeof import("@abracode/presentation/reviews").ReviewControls>>(()=>import("@abracode/presentation/reviews").then(m=>({default:m.ReviewControls})),"Interactive review");
export function ReviewAttachment({target}:{target:ReviewSelection}){
  const [selection,setSelection]=useState(target);
  return <div data-review-reference={`${selection.review_id}/${selection.revision}`}><RequestState query={reviewQuery(selection)}>{view=><ReviewPanel key={view.record.hash} view={view} open={setSelection}/>}</RequestState></div>;
}
function ReviewImage({record,id,label}:{record:ReviewRecord;id:string;label:string}){
  const [failed,setFailed]=useState(false);
  const asset=record.assets.find(a=>a.id===id);
  if(!asset)return <p role="status">Preview unavailable.</p>;
  return <RequestState query={reviewAssetQuery({review_id:record.review.review_id,revision:record.revision},asset.hash)} showRefresh={false}>{image=>failed?<p role="status">This image could not be displayed.</p>:<img alt={label} src={`data:${image.mime};base64,${image.data}`} loading="lazy" onError={()=>setFailed(true)}/>}</RequestState>;
}
function ReviewPanel({view,open}:{view:ReviewView;open:(selection:ReviewSelection)=>void}){
  const {record}=view;
  const draft=useReviewDraft(record);
  const send=useAtomSet(submitReview(record.hash),{mode:"promiseExit"});
  const receiptLookup=useAtomSet(readReceipt,{mode:"promiseExit"});
  const pending=draft.state.pending;
  useEffect(()=>{
    if(!pending)return;
    let mounted=true;
    void receiptLookup(pending.request_id).then(result=>{
      if(!mounted||!Exit.isSuccess(result)||!result.value)return;
      const receipt=result.value;
      if(receipt.status==="admitted")draft.update({pending:undefined,receipt:{...receipt,review_id:pending.review_id,revision:pending.revision,hash:pending.hash},working:false,error:undefined});
    });
    return ()=>{mounted=false;};
  },[pending?.request_id,view,receiptLookup]);
  async function submit(){
    const current=draft.current();
    if(current.working||current.receipt?.status==="admitted")return;
    const errors=reviewAnswerErrors(record.review,current.answers);
    if(Object.keys(errors).length){draft.update({errors});return;}
    let input=current.pending;
    if(!input){
      if(view.unavailable)return;
      const decoded=Schema.decodeUnknownResult(ReviewSubmitSchema)({review_id:record.review.review_id,revision:record.revision,hash:record.hash,request_id:crypto.randomUUID(),answers:current.answers});
      if(decoded._tag==="Failure"){draft.update({error:"Review answers exceed the supported submission limits."});return;}
      input=decoded.success;
    }
    if(!draft.update({pending:input,working:true,error:undefined},true)){draft.update({working:false});return;}
    const result=await send(input);
    if(Exit.isSuccess(result))draft.update({working:false,receipt:result.value,pending:result.value.status==="admitted"?undefined:input,error:result.value.status==="uncertain"?"Submission is uncertain. Reconcile the original response before sending anything else.":undefined});
    else draft.update({working:false,error:requestError(result.cause)});
  }
  const received=draft.state.receipt?.status==="admitted";
  const revised=view.revisions.filter(r=>r.responds_to===draft.state.receipt?.request_id);
  return <section className="interactive-review" aria-label={`Review: ${record.review.title}`}>
    <p className="muted">Review revision {record.revision} · Feedback requests a revision from Abra.</p>
    {view.unavailable&&<p role="status">{view.unavailable}</p>}
    {view.current_revision!==record.revision&&<Button type="button" variant="outline" onClick={()=>open({review_id:record.review.review_id,revision:view.current_revision})}>Open current review</Button>}
    <form onSubmit={event=>{event.preventDefault();void submit();}} noValidate>
      <ReviewControls review={record.review} answers={draft.state.answers} errors={draft.state.errors??{}} disabled={!!(view.unavailable||pending||received||draft.state.working)} change={draft.change} image={(id,label)=><ReviewImage record={record} id={id} label={label}/>}/>
      {draft.state.error&&<p role="alert">{draft.state.error}</p>}
      {received ? <div role="status"><p>Received by Abra. A revision will appear when published.</p>{revised.map(r=><Button type="button" key={`${r.review_id}/${r.revision}`} onClick={()=>open(r)}>Open revision: {r.title}</Button>)}<Button type="button" variant="outline" disabled={!!view.unavailable} onClick={()=>draft.update({receipt:undefined,pending:undefined,error:undefined})}>Write another response</Button></div> : <Button type="submit" disabled={!!draft.state.working||!!view.unavailable&&!pending}>{draft.state.working?"Sending feedback…":pending?"Reconcile response":"Send feedback to Abra"}</Button>}
    </form>
  </section>;
}

export function ReviewsForSource({issue,source}:{issue?:string;source:Partial<ReviewSource>}){
  return <RequestState query={reviewListQuery(issue)} showRefresh={false}>{list=><>
    {list.diagnostics.map((message,index)=><p role="status" key={index}>{message}</p>)}
    {list.reviews.filter(ref=>Object.entries(source).every(([key,value])=>Reflect.get(ref.source,key)===value)).map(ref=><ReviewDisclosure key={`${ref.review_id}/${ref.revision}`} reference={ref}/>)}
  </>}</RequestState>;
}
function ReviewDisclosure({reference}:{reference:ReviewSelection&{title:string}}){
  const [opened,setOpened]=useState(false);
  return <details className="review-disclosure" onToggle={event=>setOpened(event.currentTarget.open)}><summary>Give feedback: {reference.title}</summary>{opened&&<ReviewAttachment target={reference}/>}</details>;
}
