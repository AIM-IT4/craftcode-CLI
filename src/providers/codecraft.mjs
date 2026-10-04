import {OpenAICompatibleClient} from './openai-compatible.mjs';

const PLAN_BY_RPM=new Map([
  [60,{name:'Free',tokens:1_000_000}],
  [120,{name:'Starter',tokens:30_000_000}],
  [300,{name:'Basic',tokens:100_000_000}],
  [600,{name:'Pro',tokens:200_000_000}],
  [1200,{name:'Scale',tokens:500_000_000}],
  [3000,{name:'Unlimited',tokens:Infinity}],
]);

export class CodeCraftClient extends OpenAICompatibleClient{
  constructor(o={}){super({id:'codecraft',label:'CodeCraft',baseUrl:'https://codecraftapi.com/v1',...o});}
  planHint(){const p=PLAN_BY_RPM.get(this.rateLimits.rpmLimit);return p?{...p,rpm:this.rateLimits.rpmLimit}:null;}
}
