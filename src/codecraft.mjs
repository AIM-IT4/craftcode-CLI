const PLAN_BY_RPM = new Map([
  [60,{name:'Free',tokens:1_000_000}],
  [120,{name:'Starter',tokens:30_000_000}],
  [300,{name:'Basic',tokens:100_000_000}],
  [600,{name:'Pro',tokens:200_000_000}],
  [1200,{name:'Scale',tokens:500_000_000}],
  [3000,{name:'Unlimited',tokens:Infinity}],
]);
const abortError=()=>new DOMException('Aborted','AbortError');
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(abortError());const t=setTimeout(done,ms);function done(){signal?.removeEventListener?.('abort',stop);resolve();}function stop(){clearTimeout(t);reject(abortError());}signal?.addEventListener?.('abort',stop,{once:true});});
const resetMsFromValue=raw=>{
  if(raw==null||raw==='')return null;
  const n=Number(raw);
  if(Number.isFinite(n)){
    if(n>1e12)return Math.max(0,n-Date.now()+150);
    if(n>1e9)return Math.max(0,n*1000-Date.now()+150);
    return Math.max(0,n*1000);
  }
  const d=Date.parse(raw);return Number.isFinite(d)?Math.max(0,d-Date.now()+150):null;
};
const retryMs=(r,attempt=0)=>{
  const retry=resetMsFromValue(r.headers.get('retry-after'));
  if(retry!=null)return Math.max(750,retry);
  const reset=resetMsFromValue(r.headers.get('x-ratelimit-reset-tokens')||r.headers.get('x-ratelimit-reset'));
  if(reset!=null)return Math.max(750,reset);
  return Math.min(15_000,1500*(2**attempt));
};
export class CodeCraftClient{
 constructor({apiKey,baseUrl,maxOutputTokens=8192,onRateLimit=null,maxRateLimitRetries=4}){this.apiKey=String(apiKey||'').trim().replace(/^(["'])(.*)\1$/,'$2').trim();this.baseUrl=baseUrl.replace(/\/$/,'');this.maxOutputTokens=maxOutputTokens;this.rateLimits={};this.onRateLimit=onRateLimit;this.maxRateLimitRetries=maxRateLimitRetries;this.rateGate=0;this.inFlightEstimatedTokens=0;}
 headers(){return{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'};}
 captureRateLimits(r){const num=k=>{const v=Number(r.headers.get(k));return Number.isFinite(v)&&v>=0?v:null;};const next={rpmLimit:num('x-ratelimit-limit'),rpmRemaining:num('x-ratelimit-remaining'),tpmLimit:num('x-ratelimit-limit-tokens'),tpmRemaining:num('x-ratelimit-remaining-tokens'),reset:r.headers.get('x-ratelimit-reset-tokens')||r.headers.get('x-ratelimit-reset')||null};this.rateLimits=next;}
 planHint(){const p=PLAN_BY_RPM.get(this.rateLimits.rpmLimit);return p?{...p,rpm:this.rateLimits.rpmLimit}:null;}
 rateProfile(){return{...this.rateLimits,inFlightEstimatedTokens:this.inFlightEstimatedTokens};}
 async models({signal}={}){const r=await fetch(`${this.baseUrl}/models`,{headers:this.headers(),signal});this.captureRateLimits(r);if(!r.ok){const d=await r.text();if(r.status===401)throw new Error('CodeCraft authentication failed (401). Rotate/re-copy the API key, then verify it with GET /v1/models.');throw new Error(`Models API ${r.status}: ${d}`);}const j=await r.json();return j.data||j.models||[];}
 _resetDelayMs(){return resetMsFromValue(this.rateLimits.reset);}
 _refreshWindowIfElapsed(){const d=this._resetDelayMs();if(d===0&&this.rateLimits.tpmLimit){this.rateLimits.tpmRemaining=this.rateLimits.tpmLimit;if(this.rateLimits.rpmLimit)this.rateLimits.rpmRemaining=this.rateLimits.rpmLimit;}}
 async _waitGate(signal){if(signal?.aborted)throw abortError();const ms=this.rateGate-Date.now();if(ms>0)await sleep(ms,signal);this._refreshWindowIfElapsed();if(signal?.aborted)throw abortError();}
 estimateRequestTokens(messages,tools){const chars=JSON.stringify(messages||[]).length+JSON.stringify(tools||[]).length;return Math.max(1,Math.ceil(chars/4)+Math.min(this.maxOutputTokens,4096));}
 async _reserveRateBudget(estimated,signal){
   await this._waitGate(signal);
   const tpm=this.rateLimits.tpmLimit,remaining=this.rateLimits.tpmRemaining;
   if(tpm&&remaining!=null){
     const available=Math.max(0,remaining-this.inFlightEstimatedTokens),headroom=Math.max(2000,Math.floor(tpm*0.04));
     if(estimated+headroom>available&&remaining<tpm){
       const ms=Math.max(750,this._resetDelayMs()??1500);
       this.rateGate=Math.max(this.rateGate,Date.now()+ms);
       this.onRateLimit?.({attempt:0,retryMs:ms,tpmLimit:tpm,tpmRemaining:remaining,message:'Proactive TPM pacing',proactive:true,estimatedTokens:estimated});
       await this._waitGate(signal);
       if(this.rateLimits.tpmLimit)this.rateLimits.tpmRemaining=this.rateLimits.tpmLimit;
     }
   }
   this.inFlightEstimatedTokens+=estimated;
   let released=false;return()=>{if(released)return;released=true;this.inFlightEstimatedTokens=Math.max(0,this.inFlightEstimatedTokens-estimated);};
 }
 async stream({model,messages,tools,onText,signal}){
   const body={model,messages,stream:true,max_tokens:this.maxOutputTokens};if(tools?.length){body.tools=tools;body.tool_choice='auto';}
   const estimated=this.estimateRequestTokens(messages,tools),release=await this._reserveRateBudget(estimated,signal);
   let r,last429='';
   try{
     for(let attempt=0;attempt<=this.maxRateLimitRetries;attempt++){
       await this._waitGate(signal);if(signal?.aborted)throw abortError();
       r=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal});this.captureRateLimits(r);
       if(r.status!==429)break;
       last429=await r.text();if(attempt>=this.maxRateLimitRetries)throw new Error(`CodeCraft 429 after ${attempt+1} attempts: ${last429}`);
       const ms=retryMs(r,attempt);this.rateGate=Math.max(this.rateGate,Date.now()+ms);this.onRateLimit?.({attempt:attempt+1,retryMs:ms,tpmLimit:this.rateLimits.tpmLimit,tpmRemaining:this.rateLimits.tpmRemaining,message:last429,proactive:false,estimatedTokens:estimated});await this._waitGate(signal);
       if(this.rateLimits.tpmLimit)this.rateLimits.tpmRemaining=this.rateLimits.tpmLimit;
     }
     if(!r.ok)throw new Error(`CodeCraft ${r.status}: ${await r.text()}`);if(!r.body)throw new Error('CodeCraft returned no stream body');
     const reader=r.body.getReader(),decoder=new TextDecoder();let buf='',content='',usage=null,finishReason=null;const calls=new Map();const consume=line=>{line=line.trim();if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;let c;try{c=JSON.parse(raw);}catch{return;}if(c.usage)usage=c.usage;const choice=c.choices?.[0];if(!choice)return;if(choice.finish_reason)finishReason=choice.finish_reason;const d=choice.delta||{};if(typeof d.content==='string'){content+=d.content;onText?.(d.content);}for(const tc of d.tool_calls||[]){const idx=tc.index??calls.size,cur=calls.get(idx)||{id:'',type:'function',function:{name:'',arguments:''}};if(tc.id)cur.id=tc.id;if(tc.function?.name)cur.function.name+=tc.function.name;if(tc.function?.arguments)cur.function.arguments+=tc.function.arguments;calls.set(idx,cur);}};
     try{while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){consume(buf.slice(0,i));buf=buf.slice(i+1);}}}finally{try{reader.releaseLock();}catch{}}if(buf.trim())consume(buf);return{message:{role:'assistant',content:content||null,...(calls.size?{tool_calls:[...calls.values()]}:{})},usage,finishReason};
   }finally{release();}
 }
}
