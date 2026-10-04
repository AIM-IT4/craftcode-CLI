import {normalizeProviderConfig} from '../config.mjs';
import {OpenAICompatibleClient} from './openai-compatible.mjs';
import {CodeCraftClient} from './codecraft.mjs';
import {OpenRouterClient} from './openrouter.mjs';

const LABELS={codecraft:'CodeCraft',openrouter:'OpenRouter'};

export class ProviderRegistry{
  constructor(config={}){this.config=normalizeProviderConfig(config);}
  activeId(){return this.config.provider||'codecraft';}
  get(id=this.activeId()){const x=this.config.providers?.[id];if(!x)throw new Error(`Unknown provider: ${id}`);return{id,...x,label:x.label||LABELS[x.type]||x.label||id};}
  list(){return Object.keys(this.config.providers||{}).map(id=>this.get(id));}
  create(id=this.activeId(),{apiKey='',onRateLimit=null,maxOutputTokens=this.config.maxOutputTokens||8192}={}){
    const p=this.get(id),base={apiKey:p.auth===false?'':apiKey,baseUrl:p.baseUrl,maxOutputTokens,onRateLimit};
    if(p.type==='codecraft')return new CodeCraftClient(base);
    if(p.type==='openrouter')return new OpenRouterClient({...base,appUrl:p.appUrl,appName:p.appName});
    if(p.type==='openai-compatible')return new OpenAICompatibleClient({...base,id,label:p.label||id,extraHeaders:p.headers||{}});
    throw new Error(`Unsupported provider type: ${p.type}`);
  }
}
