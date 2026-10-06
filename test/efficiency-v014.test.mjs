import test from 'node:test';
import assert from 'node:assert/strict';
import {outputBudgetForTask} from '../src/efficiency.mjs';

test('adaptive output budget is bounded',()=>{
  const r=outputBudgetForTask({text:'small typo fix',mode:'build',effort:'high',maxOutputTokens:8192});
  assert.equal(r.tokens,2048);
});
