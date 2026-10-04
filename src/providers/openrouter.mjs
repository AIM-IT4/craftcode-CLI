import {OpenAICompatibleClient} from './openai-compatible.mjs';

export class OpenRouterClient extends OpenAICompatibleClient{
  constructor({apiKey='',baseUrl='https://openrouter.ai/api/v1',appUrl='https://github.com/AIM-IT4/craftcode-CLI',appName='Craft Code',...rest}={}){
    const extraHeaders={...(appUrl?{'HTTP-Referer':appUrl}:{}),...(appName?{'X-Title':appName}:{}),...(rest.extraHeaders||{})};
    delete rest.extraHeaders;
    super({id:'openrouter',label:'OpenRouter',apiKey,baseUrl,extraHeaders,...rest});
  }
  capabilities(model){
    const m=typeof model==='string'?this.modelMeta.get(model):model,p=new Set(m?.supported_parameters||[]);
    return{tools:m?p.has('tools'):'unknown',reasoning:m?p.has('reasoning'):'unknown',vision:'unknown',structuredOutput:m?(p.has('response_format')||p.has('structured_outputs')):'unknown',contextWindow:Number(m?.context_length)||null};
  }
}
