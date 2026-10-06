import {spawn} from 'node:child_process';

const stripAnsi=s=>String(s??'').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'');

export function vercelSpawnSpec(args=[],platform=process.platform){
  return{
    command:platform==='win32'?'npx.cmd':'npx',
    args:['-y','vercel@latest',...args],
    shell:platform==='win32'
  };
}

export function extractVercelApprovalUrl(text=''){
  const clean=stripAnsi(text),urls=clean.match(/https?:\/\/[^\s<>"']+/g)||[];
  return urls.find(x=>/vercel\.com\/(?:oauth|login|verify|device)/i.test(x))||urls.find(x=>/vercel\.com/i.test(x))||'';
}

export function spawnVercel(args,cwd,options={}){
  const spec=vercelSpawnSpec(args);
  return spawn(spec.command,spec.args,{cwd,windowsHide:true,shell:spec.shell,...options});
}

export function openExternalUrl(url,platform=process.platform){
  if(!/^https:\/\//i.test(String(url||'')))return false;
  try{
    const command=platform==='win32'?'explorer.exe':platform==='darwin'?'open':'xdg-open';
    const p=spawn(command,[url],{detached:true,stdio:'ignore',windowsHide:true,shell:false});
    p.unref();return true;
  }catch{return false;}
}

export async function captureVercel(args,cwd){
  return new Promise(resolve=>{
    let stdout='',stderr='',settled=false;
    const p=spawnVercel(args,cwd,{stdio:['ignore','pipe','pipe']});
    p.stdout?.on('data',b=>stdout+=b);
    p.stderr?.on('data',b=>stderr+=b);
    p.on('error',e=>{if(settled)return;settled=true;resolve({code:-1,stdout,stderr:String(e.message||e)});});
    p.on('exit',code=>{if(settled)return;settled=true;resolve({code:code??-1,stdout,stderr});});
  });
}

function terminateTree(p){
  if(!p||p.exitCode!=null)return;
  try{
    if(process.platform==='win32'&&p.pid){
      const k=spawn('taskkill',['/pid',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});k.unref?.();
    }else p.kill('SIGTERM');
  }catch{try{p.kill();}catch{}}
}

export async function loginVercel(cwd,{signal,onOutput=()=>{},onUrl=()=>{},openUrl=openExternalUrl}={}){
  return new Promise((resolve,reject)=>{
    let combined='',approvalUrl='',settled=false,cancelled=false;
    const p=spawnVercel(['login'],cwd,{stdio:['ignore','pipe','pipe']});
    const finishError=e=>{if(settled)return;settled=true;cleanup();reject(e);};
    const cleanup=()=>signal?.removeEventListener?.('abort',abort);
    const abort=()=>{
      if(settled)return;cancelled=true;terminateTree(p);
      const e=new Error('Vercel browser approval cancelled.');e.name='AbortError';finishError(e);
    };
    if(signal?.aborted)return abort();
    signal?.addEventListener?.('abort',abort,{once:true});
    const inspect=chunk=>{
      const text=String(chunk||'');combined=(combined+text).slice(-16000);onOutput(text,combined);
      if(approvalUrl)return;
      const found=extractVercelApprovalUrl(combined);
      if(found){
        approvalUrl=found;onUrl(found);openUrl(found);
      }
    };
    p.stdout?.on('data',inspect);p.stderr?.on('data',inspect);
    p.on('error',e=>finishError(new Error(`Unable to start Vercel login: ${e.message||e}`)));
    p.on('exit',code=>{
      if(settled)return;settled=true;cleanup();
      if(cancelled)return;
      if(code===0)return resolve({approvalUrl,output:combined});
      reject(new Error(`Vercel login exited with code ${code??'?'}. ${approvalUrl?'Browser approval was shown but the login did not complete.':'No approval URL was emitted. Output: '+stripAnsi(combined).trim().slice(-1200)}`));
    });
  });
}
