import { useSyncExternalStore } from "react";
import { Schema } from "effect";
import { ReviewAnswersSchema, ReviewSubmitSchema, ReviewReceiptSchema, type ReviewRecord, type ReviewAnswers } from "@abracode/contracts/web/reviews";

const DraftSchema=Schema.Struct({answers:ReviewAnswersSchema,pending:Schema.optionalKey(ReviewSubmitSchema),receipt:Schema.optionalKey(ReviewReceiptSchema)});
type Draft=typeof DraftSchema.Type & {working?:boolean;error?:string;errors?:Record<string,string>};
type Entry={value:Draft;listeners:Set<()=>void>;};
const entries=new Map<string,Entry>();
function restore(key:string):Draft{try{return Schema.decodeUnknownSync(DraftSchema)(JSON.parse(localStorage.getItem(key)??"null"));}catch{return {answers:{}};}}
function entry(key:string){let value=entries.get(key);if(!value){value={value:restore(key),listeners:new Set()};entries.set(key,value);}return value;}
export function useReviewDraft(record:ReviewRecord){
  const key=`abra-review-${record.session_id}-${record.review.review_id}-${record.revision}-${record.hash}`;
  const store=entry(key);
  const state=useSyncExternalStore(listener=>{
    store.listeners.add(listener);
    const changed=(event:StorageEvent)=>{if(event.key===key&&!store.value.working){store.value=restore(key);for(const notify of store.listeners)notify();}};
    window.addEventListener("storage",changed);
    return ()=>{store.listeners.delete(listener);window.removeEventListener("storage",changed);};
  },()=>store.value);
  function update(next:Partial<Draft>,required=false){
    const value={...store.value,...next};
    let saved=true;
    try{localStorage.setItem(key,JSON.stringify({answers:value.answers,pending:value.pending,receipt:value.receipt}));}
    catch{saved=false;if(required)value.error="Cannot retain submission identity in browser storage. Your draft is preserved; enable storage before sending.";}
    store.value=value;
    for(const notify of store.listeners)notify();
    return saved;
  }
  function change(id:string,value:string|readonly string[]){update({answers:{...store.value.answers,[id]:value} as ReviewAnswers,errors:{},error:undefined});}
  return {state,update,change,current:()=>store.value};
}
