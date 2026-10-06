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

export async function loginVercel(cwd,{stdout=process.stdout,stderr=process.stderr,openUrl=openExternalUrl}={}){
  return new Promise((resolve,reject)=>{
    let combined='',approvalUrl='',settled=false;
    const p=spawnVercel(['login'],cwd,{stdio:['inherit','pipe','pipe']});
    const inspect=chunk=>{
      combined=(combined+String(chunk||'')).slice(-12000);
      if(approvalUrl)return;
      const found=extractVercelApprovalUrl(combined);
      if(found){
        approvalUrl=found;
        stdout.write(`\n\nCraft Code → Vercel approval link\n${found}\n\n`);
        openUrl(found);
      }
    };
    p.stdout?.on('data',b=>{stdout.write(b);inspect(b);});
    p.stderr?.on('data',b=>{stderr.write(b);inspect(b);});
    p.on('error',e=>{if(settled)return;settled=true;reject(new Error(`Unable to start Vercel login: ${e.message||e}`));});
    p.on('exit',code=>{
      if(settled)return;settled=true;
      if(code===0)return resolve({approvalUrl});
      reject(new Error(`Vercel login exited with code ${code??'?'}. ${approvalUrl?'Complete the browser approval and retry /connect vercel.':'No approval URL was emitted.'}`));
    });
  });
}
