import test from 'node:test';
import assert from 'node:assert/strict';

import {taskKind,activityForThinking,activityAfterTool} from '../src/activity.mjs';
import {TerminalTui} from '../src/tui.mjs';

const usage=()=>({snapshot:()=>({plan:1_000_000,total:0,session:0,daily:{},byModel:{}}),planTokens:1_000_000});

test('task classifier selects semantic initial activity',()=>{
  assert.equal(taskKind('fix broken checkout error'),'bug');
  assert.equal(taskKind('improve navbar responsive UI'),'ui');
  assert.equal(activityForThinking({goal:'fix broken checkout error',step:0}),'Tracing the issue');
  assert.equal(activityForThinking({goal:'improve navbar responsive UI',step:0}),'Assessing the interface');
  assert.equal(activityForThinking({goal:'refactor architecture dependencies',step:0}),'Mapping dependencies');
});

test('thinking activity follows execution state instead of rotating words',()=>{
  assert.equal(activityForThinking({goal:'fix bug',step:2,lastToolName:'search_files'}),'Connecting search findings');
  assert.equal(activityForThinking({goal:'fix bug',step:3,lastToolName:'read_file'}),'Connecting code findings');
  assert.equal(activityForThinking({goal:'fix bug',step:4,mutated:true,verified:false}),'Verifying the change');
  assert.equal(activityForThinking({goal:'fix UI',step:5,mutated:true,verified:true}),'Reviewing evidence');
  assert.equal(activityForThinking({goal:'fix UI',step:5,browserRequired:true,browserVerified:false,mutated:true}),'Checking in browser');
  assert.equal(activityForThinking({goal:'fix bug',step:2,lastToolName:'run_command',lastToolFailed:true}),'Investigating command failure');
});

test('tool completion activity reflects the actual tool result',()=>{
  assert.equal(activityAfterTool({name:'apply_patch'}),'Edit applied');
  assert.equal(activityAfterTool({name:'git_diff'}),'Diff ready');
  assert.equal(activityAfterTool({name:'call_mcp_tool'}),'Browser evidence captured');
  assert.equal(activityAfterTool({name:'run_command',error:true}),'Command failed');
});

test('TUI preserves the last semantic activity when a turn completes',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false});tui.schedule=()=>{};
  tui.setBusy(true);
  tui.setActivity('Reviewing evidence');
  tui.setBusy(false);
  const row=tui.transcript.findLast?.(x=>x.role==='thinking')||[...tui.transcript].reverse().find(x=>x.role==='thinking');
  assert.equal(row.status,'done');
  assert.equal(row.detail,'Reviewing evidence');
});
