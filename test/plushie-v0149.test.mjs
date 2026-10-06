import test from 'node:test';
import assert from 'node:assert/strict';

import {TerminalTui,terminalCellWidth} from '../src/tui.mjs';

const usage=()=>({snapshot:()=>({plan:1_000_000,total:0,session:0,daily:{},byModel:{}}),planTokens:1_000_000});

test('Spark plushie is right aligned and terminal-width safe',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'on'});tui.schedule=()=>{};
  const lines=tui.plushieLines(100,34);
  assert.equal(lines.length,4);
  for(const line of lines){assert.ok(terminalCellWidth(line)<=100);assert.ok(line.startsWith(' '.repeat(70)));}
  assert.match(lines.join('\n').replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,''),/Spark/);
});

test('Spark auto mode hides only when width, overlays, or vertical room require it',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'auto'});tui.schedule=()=>{};
  assert.equal(tui.plushieLines(80,28).length,0);
  assert.equal(tui.plushieLines(110,36,{blocked:true}).length,0);
  assert.equal(tui.plushieLines(110,36,{availableRows:3}).length,0);
  assert.equal(tui.plushieLines(110,36,{availableRows:4}).length,4);
});

test('Spark stays directly above the composer while slash suggestions are open when room permits',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'auto'});tui.schedule=()=>{};tui.input='/';tui.cursor=1;
  let frame=[];tui.paintFrame=lines=>{frame=lines;};tui.renderChat();
  const plain=frame.map(x=>String(x).replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,''));
  const spark=plain.findIndex(x=>x.includes('Spark')),composer=plain.findIndex(x=>/╭─{20,}╮/.test(x));
  assert.ok(spark>=0,'Spark should remain visible with command suggestions');
  assert.equal(composer,spark+1,'Spark should be anchored immediately above the composer');
});

test('Spark animates while busy and changes expression on completion',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'on'});tui.schedule=()=>{};
  tui.setBusy(true);
  tui.spinnerIndex=0;const a=tui.plushieLines(100,34).join('\n');
  tui.spinnerIndex=1;const b=tui.plushieLines(100,34).join('\n');
  assert.notEqual(a,b);
  tui.setBusy(false);const done=tui.plushieLines(100,34).join('\n').replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'');
  assert.match(done,/\^ ᴗ \^/);
});

test('Spark uses an error face after tool failure and can be disabled',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'on'});tui.schedule=()=>{};
  const id=tui.toolStart({name:'run_command',detail:'npm test',args:{}});
  tui.toolEnd({cardId:id,result:'failed',durationMs:10,error:true});
  const failed=tui.plushieLines(100,34).join('\n').replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'');
  assert.match(failed,/• ︵ •/);
  tui.setMeta({plushie:'off'});
  assert.equal(tui.plushieLines(100,34).length,0);
});
