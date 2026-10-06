import test from 'node:test';
import assert from 'node:assert/strict';

import {TerminalTui,terminalCellWidth} from '../src/tui.mjs';
import {vercelSpawnSpec,extractVercelApprovalUrl} from '../src/vercel_auth.mjs';

const usage=()=>({snapshot:()=>({plan:1_000_000,total:0,session:0,daily:{},byModel:{}}),planTokens:1_000_000});

test('terminal cell width accounts for ANSI emoji CJK and combining characters',()=>{
  assert.equal(terminalCellWidth('abc'),3);
  assert.equal(terminalCellWidth('\x1b[31mabc\x1b[0m'),3);
  assert.equal(terminalCellWidth('✨'),2);
  assert.equal(terminalCellWidth('🎀'),2);
  assert.equal(terminalCellWidth('界'),2);
  assert.equal(terminalCellWidth('e\u0301'),1);
});

test('composer and long tool rows remain inside the requested terminal width',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false});tui.schedule=()=>{};
  tui.input='verify remote sync '+('✨'.repeat(42));tui.cursor=tui.input.length;
  const composer=tui.renderComposer(90,0);
  for(const line of composer.box)assert.ok(terminalCellWidth(line)<=90,`composer width ${terminalCellWidth(line)}`);
  const id=tui.toolStart({name:'run_command',detail:'git pull --rebase origin/main '+('🎀'.repeat(30)),args:{command:'git status'}});
  tui.toolEnd({cardId:id,result:'ok',durationMs:100,error:false});
  for(const line of tui.transcriptLines(86))assert.ok(terminalCellWidth(line)<=86,`transcript width ${terminalCellWidth(line)}`);
});

test('Windows Vercel auth launches npx.cmd through the command shell',()=>{
  const win=vercelSpawnSpec(['login'],'win32');
  assert.equal(win.command,'npx.cmd');
  assert.equal(win.shell,true);
  assert.deepEqual(win.args,['-y','vercel@latest','login']);
  const unix=vercelSpawnSpec(['whoami'],'linux');
  assert.equal(unix.command,'npx');
  assert.equal(unix.shell,false);
});

test('Vercel device approval URL is extracted from colored CLI output',()=>{
  const text='\x1b[36mVisit https://vercel.com/oauth/device?user_code=ABCD-EFGH to authorize\x1b[0m';
  assert.equal(extractVercelApprovalUrl(text),'https://vercel.com/oauth/device?user_code=ABCD-EFGH');
});


test('authentication modal stays in TUI, updates live, and Escape cancels it',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false});tui.schedule=()=>{};tui.running=true;
  let cancelled=0;
  tui.openAuth('Connect Vercel','Starting…',()=>{cancelled++;});
  assert.equal(tui.modal?.type,'auth');
  tui.updateAuth('Approval URL\nhttps://vercel.com/oauth/device?user_code=TEST');
  assert.match(tui.modal?.text||'',/vercel\.com\/oauth\/device/);
  tui.handleKey('\x1b');
  assert.equal(cancelled,1);
  assert.equal(tui.modal,null);
});

test('authentication modal Q cancels while Enter does not accidentally close it',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false});tui.schedule=()=>{};tui.running=true;
  let cancelled=0;
  tui.openAuth('Connect Vercel','Waiting…',()=>{cancelled++;});
  tui.handleKey('\r');
  assert.equal(tui.modal?.type,'auth');
  assert.equal(cancelled,0);
  tui.handleKey('Q');
  assert.equal(cancelled,1);
  assert.equal(tui.modal,null);
});
