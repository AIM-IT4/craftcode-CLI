import {classifyProviderError,estimateTokens,providerErrorSummary} from '../context.mjs';

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
const unknownCaps=()=>({tools:'unknown',reasoning:'unknown',vision:'unknown',imageGeneration:'unknown',structuredOutput:'unknown',contextWindow:null});
const asList=v=>Array.isArray(v)?v.map(x=>String(x).toLowerCase()):[];
const imageGenerationFromMeta=m=>{
  const explicit=m?.capabilities?.image_generation??m?.capabilities?.imageGeneration??m?.image_generation??m?.imageGeneration;
  if(typeof explicit==='boolean')return explicit;
  const outputs=[...asList(m?.output_modalities),...asList(m?.supported_output_modalities),...asList(m?.architecture?.output_modalities),...asList(m?.modalities?.output)];
  if(outputs.some(x=>/image/.test(x)))return true;
  const id=String(m?.id||m?.name||'').toLowerCase();
  if(/(?:^|[-_/])(gpt-image|dall-e|imagen|flux|stable-diffusion|sdxl)(?:[-_/]|$)/.test(id))return true;
  return'unknown';
};
class ProviderRequestError extends Error{
  constructor(label,status,body,{code=null,contextWindow=null,inputTokens=null}={}){
    const resolved=code||classifyProviderError(status,body);
    super(`${label} ${status||'request'}: ${providerErrorSummary(body)}`);
    this.name='ProviderRequestError';this.status=status||0;this.body=String(body||'');this.code=resolved;this.contextWindow=contextWindow;this.inputTokens=inputTokens;
  }
}

export class OpenAICompatibleClient{
  constructor({id='custom',label='OpenAI Compatible',apiKey='',baseUrl,maxOutputTokens=8192,onRateLimit=null,maxRateLimitRetries=4,extraHeaders={},imageGeneration='auto',imageEndpoint='/images/generations',imageModel=''}={}){
    if(!baseUrl)throw new Error(`Provider ${id} has no baseUrl.`);
    this.id=id;this.label=label;this.apiKey=String(apiKey||'').trim().replace(/^(["'])(.*)\1$/,'$2').trim();this.baseUrl=String(baseUrl).replace(/\/$/,'');this.maxOutputTokens=maxOutputTokens;this.onRateLimit=onRateLimit;this.maxRateLimitRetries=maxRateLimitRetries;this.extraHeaders={...extraHeaders};this.imageGeneration=imageGeneration;this.imageEndpoint=String(imageEndpoint||'/images/generations');this.imageModel=String(imageModel||'');this.rateLimits={};this.rateGate=0;this.inFlightEstimatedTokens=0;this.modelMeta=new Map();
  }
  headers(){return{...(this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{}),'Content-Type':'application/json',...this.extraHeaders};}
  captureRateLimits(r){const num=k=>{const v=Number(r.headers.get(k));return Number.isFinite(v)&&v>=0?v:null;};this.rateLimits={rpmLimit:num('x-ratelimit-limit'),rpmRemaining:num('x-ratelimit-remaining'),tpmLimit:num('x-ratelimit-limit-tokens'),tpmRemaining:num('x-ratelimit-remaining-tokens'),reset:r.headers.get('x-ratelimit-reset-tokens')||r.headers.get('x-ratelimit-reset')||null};}
  planHint(){return null;}
  rateProfile(){return{...this.rateLimits,inFlightEstimatedTokens:this.inFlightEstimatedTokens};}
  capabilities(model){const m=typeof model==='string'?this.modelMeta.get(model):model;const detected=imageGenerationFromMeta(m),configured=this.imageGeneration===true?true:this.imageGeneration===false?false:detected;return{...unknownCaps(),imageGeneration:this.imageModel?true:configured,contextWindow:Number(m?.context_length||m?.context_window)||null};}
  async models({signal}={}){const r=await fetch(`${this.baseUrl}/models`,{headers:this.headers(),signal});this.captureRateLimits(r);if(!r.ok){const d=await r.text();if(r.status===401)throw new Error(`${this.label} authentication failed (401). Check the provider API key.`);throw new Error(`${this.label} models API ${r.status}: ${d}`);}const j=await r.json(),models=j.data||j.models||[];this.modelMeta=new Map(models.map(m=>[m.id||m.name,m]).filter(([id])=>id));return models;}
  _resetDelayMs(){return resetMsFromValue(this.rateLimits.reset);}
  _refreshWindowIfElapsed(){const d=this._resetDelayMs();if(d===0&&this.rateLimits.tpmLimit){this.rateLimits.tpmRemaining=this.rateLimits.tpmLimit;if(this.rateLimits.rpmLimit)this.rateLimits.rpmRemaining=this.rateLimits.rpmLimit;}}
  async _waitGate(signal){if(signal?.aborted)throw abortError();const ms=this.rateGate-Date.now();if(ms>0)await sleep(ms,signal);this._refreshWindowIfElapsed();if(signal?.aborted)throw abortError();}
  estimateInputTokens(messages,tools){return estimateTokens(messages||[])+estimateTokens(tools||[]);}
  estimateRequestTokens(messages,tools){return this.estimateInputTokens(messages,tools)+Math.min(this.maxOutputTokens,4096);}
  async _reserveRateBudget(estimated,signal){
    await this._waitGate(signal);const tpm=this.rateLimits.tpmLimit,remaining=this.rateLimits.tpmRemaining;
    if(tpm&&remaining!=null){const available=Math.max(0,remaining-this.inFlightEstimatedTokens),headroom=Math.max(2000,Math.floor(tpm*0.04));if(estimated+headroom>available&&remaining<tpm){const ms=Math.max(750,this._resetDelayMs()??1500);this.rateGate=Math.max(this.rateGate,Date.now()+ms);this.onRateLimit?.({attempt:0,retryMs:ms,tpmLimit:tpm,tpmRemaining:remaining,message:'Proactive TPM pacing',proactive:true,estimatedTokens:estimated,provider:this.id});await this._waitGate(signal);if(this.rateLimits.tpmLimit)this.rateLimits.tpmRemaining=this.rateLimits.tpmLimit;}}
    this.inFlightEstimatedTokens+=estimated;let released=false;return()=>{if(released)return;released=true;this.inFlightEstimatedTokens=Math.max(0,this.inFlightEstimatedTokens-estimated);};
  }
  async generateImage({model,prompt,size='1024x1024',quality='',background='',signal}={}){
    const chosen=this.imageModel||model;if(!chosen)throw new Error(this.label+' image generation requires a model.');
    if(!this.imageModel&&this.capabilities(chosen).imageGeneration!==true)throw new Error(this.label+' model '+chosen+' does not advertise image-generation support.');
    const endpoint=this.imageEndpoint.startsWith('/')?this.imageEndpoint:'/'+this.imageEndpoint;
    const base={model:chosen,prompt:String(prompt||''),n:1,size:String(size||'1024x1024')};if(!base.prompt.trim())throw new Error('Image prompt is required.');
    if(quality)base.quality=quality;if(background)base.background=background;
    const request=body=>fetch(this.baseUrl+endpoint,{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal});
    let r=await request({...base,response_format:'b64_json'});this.captureRateLimits(r);
    if(!r.ok&&r.status===400){const first=await r.text();if(/response[_ -]?format|b64_json/i.test(first)){r=await request(base);this.captureRateLimits(r);}else throw new ProviderRequestError(this.label,r.status,first);}
    if(!r.ok){const body=await r.text();throw new ProviderRequestError(this.label,r.status,body);}
    const j=await r.json(),item=j?.data?.[0]||j?.images?.[0]||j,b64=item?.b64_json||item?.base64||item?.image_base64;
    if(b64)return{bytes:Buffer.from(String(b64).replace(/^data:[^,]+,/i,''),'base64'),mimeType:item?.mime_type||'image/png',model:chosen,revisedPrompt:item?.revised_prompt||''};
    const url=item?.url||item?.image_url;if(!url)throw new Error(this.label+' image API returned neither base64 image data nor a URL.');
    const img=await fetch(url,{signal});if(!img.ok)throw new Error(this.label+' image download failed ('+img.status+').');
    const mimeType=img.headers.get('content-type')||'image/png';if(!/^image\//i.test(mimeType))throw new Error(this.label+' image URL returned unexpected content type '+mimeType+'.');
    return{bytes:Buffer.from(await img.arrayBuffer()),mimeType,model:chosen,revisedPrompt:item?.revised_prompt||'',url};
  }
  async stream({model,messages,tools,onText,signal}){
    const inputTokens=this.estimateInputTokens(messages,tools),contextWindow=this.capabilities(model)?.contextWindow||0,safety=contextWindow?Math.max(512,Math.floor(contextWindow*.02)):0;
    if(contextWindow&&inputTokens>=contextWindow-safety)throw new ProviderRequestError(this.label,0,`Estimated input ${inputTokens} tokens exceeds the ${contextWindow}-token model context window.`,{code:'CONTEXT_LENGTH',contextWindow,inputTokens});
    const outputTokens=contextWindow?Math.max(256,Math.min(this.maxOutputTokens,contextWindow-inputTokens-safety)):this.maxOutputTokens;
    const body={model,messages,stream:true,max_tokens:outputTokens};if(tools?.length){body.tools=tools;body.tool_choice='auto';}
    const estimated=inputTokens+Math.min(outputTokens,4096),release=await this._reserveRateBudget(estimated,signal);let r,last429='';
    try{
      for(let attempt=0;attempt<=this.maxRateLimitRetries;attempt++){
        await this._waitGate(signal);if(signal?.aborted)throw abortError();
        r=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal});this.captureRateLimits(r);
        if(r.status!==429)break;last429=await r.text();if(attempt>=this.maxRateLimitRetries)throw new Error(`${this.label} 429 after ${attempt+1} attempts: ${last429}`);
        const ms=retryMs(r,attempt);this.rateGate=Math.max(this.rateGate,Date.now()+ms);this.onRateLimit?.({attempt:attempt+1,retryMs:ms,tpmLimit:this.rateLimits.tpmLimit,tpmRemaining:this.rateLimits.tpmRemaining,message:last429,proactive:false,estimatedTokens:estimated,provider:this.id});await this._waitGate(signal);if(this.rateLimits.tpmLimit)this.rateLimits.tpmRemaining=this.rateLimits.tpmLimit;
      }
      if(!r.ok){const bodyText=await r.text();throw new ProviderRequestError(this.label,r.status,bodyText);}if(!r.body)throw new Error(`${this.label} returned no stream body`);
      const reader=r.body.getReader(),decoder=new TextDecoder();let buf='',content='',usage=null,finishReason=null;const calls=new Map();
      const consume=line=>{line=line.trim();if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;let c;try{c=JSON.parse(raw);}catch{return;}if(c.usage)usage=c.usage;const choice=c.choices?.[0];if(!choice)return;if(choice.finish_reason)finishReason=choice.finish_reason;const d=choice.delta||{};if(typeof d.content==='string'){content+=d.content;onText?.(d.content);}for(const tc of d.tool_calls||[]){const idx=tc.index??calls.size,cur=calls.get(idx)||{id:'',type:'function',function:{name:'',arguments:''}};if(tc.id)cur.id=tc.id;if(tc.function?.name)cur.function.name+=tc.function.name;if(tc.function?.arguments)cur.function.arguments+=tc.function.arguments;calls.set(idx,cur);}};
      try{while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){consume(buf.slice(0,i));buf=buf.slice(i+1);}}}finally{try{reader.releaseLock();}catch{}}if(buf.trim())consume(buf);
      return{message:{role:'assistant',content:content||null,...(calls.size?{tool_calls:[...calls.values()]}:{})},usage,finishReason};
    }finally{release();}
  }
}

export const OpenAICompatibleProvider=OpenAICompatibleClient;
