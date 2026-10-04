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
const retryMs=r=>{const raw=r.headers.get('retry-after');if(!raw)return 60_000;const n=Number(raw);if(Number.isFinite(n))return Math.max(1000,n*1000);const d=Date.parse(raw);return Number.isFinite(d)?Math.max(1000,d-Date.now()):60_000;};
export class CodeCraftClient{
 constructor({apiKey,baseUrl,maxOutputTokens=8192,onRateLimit=null,maxRateLimitRetries=4}){this.apiKey=String(apiKey||'').trim().replace(/^(["'])(.*)\1$/,'$2').trim();this.baseUrl=baseUrl.replace(/\/$/,'');this.maxOutputTokens=maxOutputTokens;this.rateLimits={};this.onRateLimit=onRateLimit;this.maxRateLimitRetries=maxRateLimitRetries;this.rateGate=0;}
 headers(){return{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'};}
 captureRateLimits(r){const num=k=>{const v=Number(r.headers.get(k));return Number.isFinite(v)&&v>=0?v:null;};this.rateLimits={rpmLimit:num('x-ratelimit-limit'),rpmRemaining:num('x-ratelimit-remaining'),tpmLimit:num('x-ratelimit-limit-tokens'),tpmRemaining:num('x-ratelimit-remaining-tokens'),reset:r.headers.get('x-ratelimit-reset')||r.headers.get('x-ratelimit-reset-tokens')||null};}
 planHint(){const p=PLAN_BY_RPM.get(this.rateLimits.rpmLimit);return p?{...p,rpm:this.rateLimits.rpmLimit}:null;}
 async models({signal}={}){const r=await fetch(`${this.baseUrl}/models`,{headers:this.headers(),signal});this.captureRateLimits(r);if(!r.ok){const d=await r.text();if(r.status===401)throw new Error('CodeCraft authentication failed (401). Rotate/re-copy the API key, then verify it with GET /v1/models.');throw new Error(`Models API ${r.status}: ${d}`);}const j=await r.json();return j.data||j.models||[];}
 async _waitGate(signal){if(signal?.aborted)throw abortError();const ms=this.rateGate-Date.now();if(ms>0)await sleep(ms,signal);if(signal?.aborted)throw abortError();}
 async stream({model,messages,tools,onText,signal}){
   const body={model,messages,stream:true,max_tokens:this.maxOutputTokens};if(tools?.length){body.tools=tools;body.tool_choice='auto';}
   let r,last429='';
   for(let attempt=0;attempt<=this.maxRateLimitRetries;attempt++){
     await this._waitGate(signal);if(signal?.aborted)throw abortError();
     r=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal});this.captureRateLimits(r);
     if(r.status!==429)break;
     last429=await r.text();if(attempt>=this.maxRateLimitRetries)throw new Error(`CodeCraft 429 after ${attempt+1} attempts: ${last429}`);
     const ms=retryMs(r);this.rateGate=Math.max(this.rateGate,Date.now()+ms);this.onRateLimit?.({attempt:attempt+1,retryMs:ms,tpmLimit:this.rateLimits.tpmLimit,tpmRemaining:this.rateLimits.tpmRemaining,message:last429});await this._waitGate(signal);
   }
   if(!r.ok)throw new Error(`CodeCraft ${r.status}: ${await r.text()}`);if(!r.body)throw new Error('CodeCraft returned no stream body');
   const reader=r.body.getReader(),decoder=new TextDecoder();let buf='',content='',usage=null,finishReason=null;const calls=new Map();const consume=line=>{line=line.trim();if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;let c;try{c=JSON.parse(raw);}catch{return;}if(c.usage)usage=c.usage;const choice=c.choices?.[0];if(!choice)return;if(choice.finish_reason)finishReason=choice.finish_reason;const d=choice.delta||{};if(typeof d.content==='string'){content+=d.content;onText?.(d.content);}for(const tc of d.tool_calls||[]){const idx=tc.index??calls.size,cur=calls.get(idx)||{id:'',type:'function',function:{name:'',arguments:''}};if(tc.id)cur.id=tc.id;if(tc.function?.name)cur.function.name+=tc.function.name;if(tc.function?.arguments)cur.function.arguments+=tc.function.arguments;calls.set(idx,cur);}};
   try{while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){consume(buf.slice(0,i));buf=buf.slice(i+1);}}}finally{try{reader.releaseLock();}catch{}}if(buf.trim())consume(buf);return{message:{role:'assistant',content:content||null,...(calls.size?{tool_calls:[...calls.values()]}:{})},usage,finishReason};
 }
}
