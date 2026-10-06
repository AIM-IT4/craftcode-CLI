import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {safePath} from '../src/paths.mjs';
import {isPrivateAddress,fetchUrl} from '../src/web_tools.mjs';

const mk=()=>fs.mkdtempSync(path.join(os.tmpdir(),'craftcode-sec-'));

test('safePath allows normal, nested and not-yet-existing paths',()=>{
  const ws=mk();fs.mkdirSync(path.join(ws,'src'));fs.writeFileSync(path.join(ws,'src','a.txt'),'x');
  assert.equal(safePath(ws,'src/a.txt'),path.join(fs.realpathSync(ws),'src','a.txt').replace(fs.realpathSync(ws),path.resolve(ws)));
  assert.doesNotThrow(()=>safePath(ws,'src/new/deep/file.txt'));
  assert.doesNotThrow(()=>safePath(ws,'.'));
});

test('safePath rejects lexical escapes',()=>{
  const ws=mk();
  assert.throws(()=>safePath(ws,'../outside.txt'),/escapes workspace/);
  assert.throws(()=>safePath(ws,'/etc/passwd'),/escapes workspace/);
});

test('safePath rejects symlinks that point outside the workspace, including for new files beneath them',()=>{
  const ws=mk(),outside=mk();fs.writeFileSync(path.join(outside,'secret.txt'),'s');
  try{fs.symlinkSync(outside,path.join(ws,'link'),'dir');}catch{return;} // symlinks unavailable (e.g. Windows without privileges)
  assert.throws(()=>safePath(ws,'link/secret.txt'),/symlink/);
  assert.throws(()=>safePath(ws,'link/brand-new.txt'),/symlink/);
  assert.throws(()=>safePath(ws,'link'),/symlink/);
});

test('safePath allows symlinks that stay inside the workspace and a symlinked workspace root',()=>{
  const ws=mk();fs.mkdirSync(path.join(ws,'real'));fs.writeFileSync(path.join(ws,'real','f.txt'),'x');
  try{fs.symlinkSync(path.join(ws,'real'),path.join(ws,'alias'),'dir');}catch{return;}
  assert.doesNotThrow(()=>safePath(ws,'alias/f.txt'));
  const rootLink=path.join(mk(),'ws-link');fs.symlinkSync(ws,rootLink,'dir');
  assert.doesNotThrow(()=>safePath(rootLink,'real/f.txt'));
});

test('isPrivateAddress classifies loopback, private, link-local, CGNAT, mapped and public addresses',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','172.31.255.255','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::','fc00::1','fd12:3456::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','[::1]'])
    assert.equal(isPrivateAddress(ip),true,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','172.15.0.1','172.32.0.1','93.184.216.34','2606:4700:4700::1111','::ffff:8.8.8.8'])
    assert.equal(isPrivateAddress(ip),false,ip);
});

test('fetchUrl blocks private targets, obfuscated IPs, and redirects into private networks',async()=>{
  const old=globalThis.fetch;let calls=[];
  try{
    globalThis.fetch=async u=>{calls.push(String(u));return new Response('ok',{status:200,headers:{'content-type':'text/plain'}});};
    for(const bad of ['http://127.0.0.1/','http://localhost:8080/','http://169.254.169.254/latest/meta-data/','http://2130706433/','http://[::ffff:7f00:1]/','http://foo.internal/','file:///etc/passwd'])
      await assert.rejects(()=>fetchUrl(bad),/blocked|Only http/,bad);
    assert.equal(calls.length,0,'no request may be sent to a blocked target');

    calls=[];
    globalThis.fetch=async u=>{calls.push(String(u));return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data/'}});};
    await assert.rejects(()=>fetchUrl('https://8.8.8.8/start'),/blocked/);
    assert.deepEqual(calls,['https://8.8.8.8/start'],'redirect target must not be fetched');

    calls=[];let n=0;
    globalThis.fetch=async u=>{calls.push(String(u));n++;return n<3?new Response(null,{status:301,headers:{location:'/next'+n}}):new Response('done',{status:200,headers:{'content-type':'text/plain'}});};
    const r=await fetchUrl('https://8.8.8.8/a');
    assert.equal(r.text,'done');assert.equal(calls.length,3);

    globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'/loop'}});
    await assert.rejects(()=>fetchUrl('https://8.8.8.8/loop'),/Too many redirects/);
  }finally{globalThis.fetch=old;}
});
