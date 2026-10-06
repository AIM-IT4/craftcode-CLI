import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {OpenAICompatibleClient} from '../src/providers/openai-compatible.mjs';
import {SkillRegistry} from '../src/skills.mjs';
import {ToolRegistry} from '../src/tools.mjs';
import {ProofTracker} from '../src/proof.mjs';

const deps=()=>({
  plugins:{toolEntries:()=>[],list:()=>[]},
  mcp:{list:()=>[],tools:async()=>[],call:async()=>({ok:true})},
  skills:{list:()=>[],load:async()=>({})}
});

test('provider discovers a separate image model from the same API catalog',()=>{
  const c=new OpenAICompatibleClient({baseUrl:'https://example.test/v1'});
  c.modelMeta=new Map([
    ['craft-code',{id:'craft-code',output_modalities:['text']}],
    ['craft-image',{id:'craft-image',output_modalities:['image']}]
  ]);
  const caps=c.capabilities('craft-code');
  assert.equal(caps.imageGeneration,true);
  assert.equal(caps.imageModel,'craft-image');
  assert.equal(c.imageModelFor('craft-code'),'craft-image');
});

test('image generation accepts base64 OpenAI-compatible responses without putting image bytes in model context',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{b64_json:Buffer.from('fake-png').toString('base64'),revised_prompt:'clean'}]}),{status:200,headers:{'content-type':'application/json'}});
  try{
    const c=new OpenAICompatibleClient({baseUrl:'https://example.test/v1',imageModel:'craft-image'});
    const out=await c.generateImage({model:'text-model',prompt:'draw a chart'});
    assert.equal(out.model,'craft-image');
    assert.equal(out.bytes.toString(),'fake-png');
    assert.equal(out.revisedPrompt,'clean');
  }finally{globalThis.fetch=old;}
});

test('automatic skill router selects only relevant skills inside the token budget',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-auto-skill-'));
  try{
    const mk=async(name,description,body)=>{
      const d=path.join(dir,'.craftcli','skills',name);await fs.mkdir(d,{recursive:true});
      await fs.writeFile(path.join(d,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
    };
    await mk('browser-testing','Playwright browser testing for frontend UI changes','Use snapshots and console checks.');
    await mk('database-migrations','Postgres schema migration workflow','Inspect migrations carefully.');
    const registry=await new SkillRegistry(dir).scan();
    const r=await registry.autoSelect('verify this React UI change in browser with Playwright',{maxSkills:1,maxTokens:1000,minScore:2});
    assert.equal(r.selected.length,1);
    assert.equal(r.selected[0].name,'browser-testing');
    assert.ok(r.estimatedTokens<=1000);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('generate_image tool is exposed only for an image-capable active API and writes inside workspace',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-image-tool-')),d=deps();
  const unsupported={capabilities:()=>({imageGeneration:false})};
  const supported={capabilities:()=>({imageGeneration:true}),generateImage:async()=>({bytes:Buffer.from('img'),mimeType:'image/png',model:'image-model'})};
  try{
    let runtime={client:unsupported,model:'text'};
    const registry=new ToolRegistry({cwd:dir,config:{permissions:{write:'allow',shell:'deny',mcp:'deny'},tokenGuard:{},shell:{sandbox:'host'}},...d,getModelClient:()=>runtime});
    assert.equal(registry.definitions('build').some(x=>x.function.name==='generate_image'),false);
    runtime={client:supported,model:'text'};
    assert.equal(registry.definitions('build').some(x=>x.function.name==='generate_image'),true);
    const r=await registry.execute('generate_image',{prompt:'logo',path:'assets/logo.png'},'build');
    assert.equal(r.path,'assets/logo.png');
    assert.equal((await fs.readFile(path.join(dir,'assets','logo.png'))).toString(),'img');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('UI edits require browser proof and Playwright snapshot satisfies the gate',()=>{
  const p=new ProofTracker({goal:'change navbar',mode:'build'});
  p.tool({name:'write_file',args:{path:'src/components/Nav.tsx'},result:'Wrote src/components/Nav.tsx',mutating:true});
  p.tool({name:'discover_project_commands',result:[]});
  p.tool({name:'git_diff',result:'diff'});
  p.tool({name:'run_command',args:{command:'npm test'},result:'ok'});
  let r=p.finish({completed:true});
  assert.equal(r.browserRequired,true);
  assert.equal(r.browserVerified,false);
  assert.ok(r.score<=80,r.score);
  p.tool({name:'call_mcp_tool',args:{server:'playwright',tool:'browser_snapshot'},result:'page snapshot'});
  r=p.finish({completed:true});
  assert.equal(r.browserVerified,true);
  assert.equal(r.score,100);
});

test('read-only Playwright checks are automatic only for safe operations and localhost navigation',()=>{
  const d=deps(),registry=new ToolRegistry({cwd:process.cwd(),config:{permissions:{mcp:'deny'},agentRuntime:{autoBrowserVerify:true},tokenGuard:{},shell:{sandbox:'host'}},...d});
  assert.equal(registry._safeBrowserRead({server:'playwright',tool:'browser_snapshot',arguments:{}}),true);
  assert.equal(registry._safeBrowserRead({server:'playwright',tool:'browser_navigate',arguments:{url:'http://localhost:3000'}}),true);
  assert.equal(registry._safeBrowserRead({server:'playwright',tool:'browser_navigate',arguments:{url:'https://example.com'}}),false);
  assert.equal(registry._safeBrowserRead({server:'playwright',tool:'browser_click',arguments:{}}),false);
});
