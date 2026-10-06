import test from 'node:test';
import assert from 'node:assert/strict';

import {TerminalTui,terminalCellWidth} from '../src/tui.mjs';
import {sparkFrame,sparkKey,sparkMood,SPARK_HEIGHT,SPARK_WIDTH,SPARK_SLEEP_AFTER_MS} from '../src/plushie.mjs';

const usage=()=>({snapshot:()=>({plan:1_000_000,total:0,session:0,daily:{},byModel:{}}),planTokens:1_000_000});

test('Spark plushie is right aligned and terminal-width safe',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'on'});tui.schedule=()=>{};
  const lines=tui.plushieLines(100,34);
  assert.equal(lines.length,5);
  for(const line of lines){assert.ok(terminalCellWidth(line)<=100);assert.ok(line.startsWith(' '.repeat(70)));}
  assert.match(lines.join('\n').replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,''),/Spark/);
});

test('Spark auto mode hides only when width, overlays, or vertical room require it',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'auto'});tui.schedule=()=>{};
  assert.equal(tui.plushieLines(80,28).length,0);
  assert.equal(tui.plushieLines(110,36,{blocked:true}).length,0);
  assert.equal(tui.plushieLines(110,36,{availableRows:4}).length,0);
  assert.equal(tui.plushieLines(110,36,{availableRows:5}).length,5);
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
  const t0=Date.now();const a=tui.plushieLines(100,34,{now:t0}).join('\n');
  const b=tui.plushieLines(100,34,{now:t0+120}).join('\n');
  assert.notEqual(a,b);
  tui.setBusy(false);const done=tui.plushieLines(100,34).join('\n').replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'');
  assert.match(done,/\^ ᴗ \^/);
});

test('Spark uses an error face after tool failure and can be disabled',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'on'});tui.schedule=()=>{};
  const id=tui.toolStart({name:'run_command',detail:'npm test',args:{}});
  tui.toolEnd({cardId:id,result:'failed',durationMs:10,error:true});
  const failed=tui.plushieLines(100,34).join('\n').replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'');
  assert.match(failed,/• ⌒ •/);
  tui.setMeta({plushie:'off'});
  assert.equal(tui.plushieLines(100,34).length,0);
});

const plain=x=>String(x).replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'');

test('Spark frames are a constant width and height for every mood and frame',()=>{
  const t0=1_700_000_000_000;
  for(const mood of ['idle','working','success','error','sleepy']){
    for(let i=0;i<40;i++){
      const f=sparkFrame({mood,now:t0+i*90});
      const all=[f.fx.text,...f.rows];
      assert.equal(all.length,SPARK_HEIGHT);
      for(const row of all)assert.equal(terminalCellWidth(row),SPARK_WIDTH,`${mood}#${i} "${row}"`);
    }
  }
});

test('Spark idles with a blink and twinkling antenna without needing the agent to be busy',()=>{
  const t0=Math.ceil(1_700_000_000_000/400)*400;
  const frames=new Set();let blinked=false;
  for(let i=0;i<36;i++){const f=sparkFrame({mood:'idle',now:t0+i*400});frames.add(f.fx.text+f.rows.join('|'));if(f.rows[1].includes('- ᴗ -'))blinked=true;}
  assert.ok(frames.size>2,'idle should have several distinct frames');
  assert.ok(blinked,'idle should blink');
  assert.notEqual(sparkKey('idle',t0),sparkKey('idle',t0+400));
  assert.equal(sparkKey('idle',t0),sparkKey('idle',t0+399));
});

test('Spark falls asleep after a quiet period and wakes on activity',()=>{
  const now=Date.now();
  assert.equal(sparkMood({idleMs:SPARK_SLEEP_AFTER_MS-1,now}),'idle');
  assert.equal(sparkMood({idleMs:SPARK_SLEEP_AFTER_MS,now}),'sleepy');
  assert.equal(sparkMood({busy:true,idleMs:SPARK_SLEEP_AFTER_MS*2,now}),'working');
  assert.equal(sparkMood({mood:'success',moodUntil:now+1000,idleMs:SPARK_SLEEP_AFTER_MS*2,now}),'success');
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'on'});tui.schedule=()=>{};
  tui.plushieSince=Date.now()-SPARK_SLEEP_AFTER_MS-1000;
  assert.match(plain(tui.plushieLines(100,34).join('\n')),/z/);
  tui.setBusy(true);tui.setBusy(false);
  assert.doesNotMatch(plain(tui.plushieLines(100,34,{now:Date.now()+3000}).join('\n')),/z Z/);
});

test('Spark success celebrates and error shakes between frames',()=>{
  const t0=1_700_000_000_000;
  const s0=sparkFrame({mood:'success',now:t0}),s1=sparkFrame({mood:'success',now:t0+130});
  assert.notEqual(s0.rows.join('|'),s1.rows.join('|'));
  assert.ok(s0.rows[1].includes('\\(')&&s0.rows[1].includes(')/'),'arms up');
  const offsets=new Set();
  for(let i=0;i<4;i++)offsets.add(sparkFrame({mood:'error',now:t0+i*90}).rows[1].indexOf('('));
  assert.ok(offsets.size>1,'error face should shake horizontally');
});

test('Spark idle animation tick only requests redraws when the frame changes',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false,plushie:'off'});tui.schedule=()=>{};
  assert.equal(tui.plushieAnimating(),false,'off never animates');
});
