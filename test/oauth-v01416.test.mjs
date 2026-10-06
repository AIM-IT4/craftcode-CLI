import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import {PersistentOAuthProvider,preferredCallbackPort,DEFAULT_OAUTH_CALLBACK_PORT} from '../src/oauth.mjs';

const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
const withPort=async(value,fn)=>{const old=process.env.CRAFTCODE_OAUTH_PORT;if(value===undefined)delete process.env.CRAFTCODE_OAUTH_PORT;else process.env.CRAFTCODE_OAUTH_PORT=String(value);try{return await fn();}finally{if(old===undefined)delete process.env.CRAFTCODE_OAUTH_PORT;else process.env.CRAFTCODE_OAUTH_PORT=old;}};

test('callback port defaults to a stable value and honours CRAFTCODE_OAUTH_PORT',()=>{
  assert.equal(preferredCallbackPort({}),DEFAULT_OAUTH_CALLBACK_PORT);
  assert.equal(preferredCallbackPort({CRAFTCODE_OAUTH_PORT:'51000'}),51000);
  assert.equal(preferredCallbackPort({CRAFTCODE_OAUTH_PORT:'0'}),0);
  assert.equal(preferredCallbackPort({CRAFTCODE_OAUTH_PORT:'nope'}),0);
  assert.equal(preferredCallbackPort({CRAFTCODE_OAUTH_PORT:'70000'}),0);
});

test('OAuth callback reuses the same redirect_uri across connects when the port is free',async()=>{
  const port=await freePort();
  await withPort(port,async()=>{
    const a=new PersistentOAuthProvider('oauth-port-a');await a.startCallback();const first=a.redirectUrl;await a.close();
    const b=new PersistentOAuthProvider('oauth-port-b');await b.startCallback();const second=b.redirectUrl;await b.close();
    assert.equal(first,`http://127.0.0.1:${port}/oauth/callback`);
    assert.equal(second,first);
  });
});

test('OAuth callback falls back to an ephemeral port when the preferred one is busy',async()=>{
  const blocker=net.createServer();await new Promise(r=>blocker.listen(0,'127.0.0.1',r));
  const busy=blocker.address().port;
  try{
    await withPort(busy,async()=>{
      const p=new PersistentOAuthProvider('oauth-port-busy');await p.startCallback();
      const port=Number(new URL(p.redirectUrl).port);
      assert.notEqual(port,busy);assert.ok(port>0);
      await p.close();
    });
  }finally{await new Promise(r=>blocker.close(r));}
});

test('cached client registrations pinned to a different redirect_uri are discarded so DCR re-runs',async()=>{
  const p=new PersistentOAuthProvider('oauth-stale-redirect');
  p.callbackUrl='http://127.0.0.1:47831/oauth/callback';
  p.data={
    client:{client_id:'c1',redirect_uris:['http://127.0.0.1:50001/oauth/callback']},
    clients:{'https://issuer':{client_id:'c1',redirect_uris:['http://127.0.0.1:50001/oauth/callback']}}
  };
  assert.equal(await p.clientInformation(),undefined);
  assert.equal(await p.clientInformation({issuer:'https://issuer'}),undefined);
  p.data.clients['https://issuer'].redirect_uris=[p.callbackUrl];
  assert.equal((await p.clientInformation({issuer:'https://issuer'})).client_id,'c1');
});

test('authorization URL is surfaced to the caller so headless setups can open it manually',async()=>{
  const p=new PersistentOAuthProvider('oauth-auth-url');const seen=[];p.onAuthUrl=u=>seen.push(u);
  const old=process.platform;
  // openBrowser spawns a platform opener that may not exist in CI; failures are swallowed by design.
  await p.redirectToAuthorization(new URL('https://example.invalid/authorize?client_id=abc&redirect_uri=x'));
  assert.deepEqual(seen,['https://example.invalid/authorize?client_id=abc&redirect_uri=x']);
  assert.equal(p.lastAuthUrl,seen[0]);
  assert.equal(old,process.platform);
});
