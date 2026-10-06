const clip=(s,n=180)=>{s=String(s??'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n)+'…':s;};
const UI_PATH=/(?:^|\/)(?:app|pages|components?|ui|views?|public|styles?)(?:\/|$)|\.(?:tsx|jsx|vue|svelte|html|css|scss|sass|less)$/i;
const isUiPath=p=>UI_PATH.test(String(p||'').replace(/\\/g,'/'));
const commandKind=command=>{
  const c=String(command||'');
  if(/(?:^|\s)(?:test|tests|pytest|vitest|jest|mocha|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)(?:\s|$)/i.test(c))return'test';
  if(/(?:^|\s)(?:lint|eslint|ruff)(?:\s|$)/i.test(c))return'lint';
  if(/typecheck|type-check|tsc\b/i.test(c))return'typecheck';
  if(/(?:^|\s)(?:build|compile)(?:\s|$)|vite\s+build|next\s+build/i.test(c))return'build';
  if(/(?:^|\s)check(?:\s|$)/i.test(c))return'check';
  return'command';
};
const failedResult=(result,error=false)=>{
  if(error)return true;
  const s=String(result??'');
  return /\(exit\s+[1-9]\d*\)/i.test(s)||/^denied by (?:user|policy)/i.test(s.trim());
};

export class ProofTracker{
  constructor({goal='',mode='build'}={}){this.goal=clip(goal,300);this.mode=mode;this.mutations=[];this.diffReviewed=false;this.discovered=false;this.verifications=[];this.toolErrors=[];this.browserRequired=false;this.browserVerified=false;this.startedAt=Date.now();this.report=null;}
  tool({name,args={},result='',error=false,mutating=false}={}){
    const failed=failedResult(result,error);
    if(mutating&&!failed){const target=clip(args.path||args.from||args.to||'',160);this.mutations.push({tool:name,target});if(isUiPath(target))this.browserRequired=true;}
    if(name==='git_diff')this.diffReviewed=true;
    if(name==='discover_project_commands')this.discovered=true;
    if(name==='call_mcp_tool'&&String(args.server||'').toLowerCase()==='playwright'&&/(?:snapshot|screenshot)/i.test(String(args.tool||''))&&!failed)this.browserVerified=true;
    if(name==='run_command'){
      const kind=commandKind(args.command);
      if(kind!=='command')this.verifications.push({kind,command:clip(args.command,220),passed:!failed});
    }
    if(failed)this.toolErrors.push({tool:name,detail:clip(args.command||args.path||result,180)});
  }
  finish({completed=false,cancelled=false,stalled=false}={}){
    const applicable=this.mode==='build'&&this.mutations.length>0,passed=this.verifications.filter(x=>x.passed),failed=this.verifications.filter(x=>!x.passed);
    let score=null;
    if(applicable){
      score=15;
      if(this.diffReviewed)score+=20;
      if(passed.length)score+=40;
      if(this.discovered)score+=10;
      if(completed&&!cancelled&&!stalled)score+=10;
      if(!this.toolErrors.length)score+=5;
      if(this.browserRequired&&!this.browserVerified)score-=20;
      score=Math.max(0,Math.min(100,score));
    }
    const label=score==null?'not applicable':score>=85?'strong':score>=65?'good':score>=40?'partial':'weak';
    this.report={applicable,score,label,goal:this.goal,changed:this.mutations.length,diffReviewed:this.diffReviewed,discoveredCommands:this.discovered,browserRequired:this.browserRequired,browserVerified:this.browserVerified,verifications:this.verifications,passed:passed.length,failed:failed.length,toolErrors:this.toolErrors.length,completed:!!completed,cancelled:!!cancelled,stalled:!!stalled,durationMs:Date.now()-this.startedAt};
    return this.report;
  }
}

export function formatProof(p){
  if(!p)return'No proof report is available for this turn yet.';
  if(!p.applicable)return `Proof of Change\n\nNo workspace mutation was recorded, so a change-verification score is not applicable.`;
  const checks=(p.verifications||[]).map(x=>`- ${x.passed?'✓':'✗'} ${x.kind}: ${x.command}`).join('\n')||'- No test/lint/typecheck/build command was observed.';
  const gaps=[];if(!p.diffReviewed)gaps.push('diff was not inspected');if(!p.passed)gaps.push('no verification command passed');if(!p.discoveredCommands)gaps.push('project checks were not discovered first');if(p.browserRequired&&!p.browserVerified)gaps.push('browser verification was required but not completed');if(p.toolErrors)gaps.push(`${p.toolErrors} tool error(s) occurred`);
  return `Proof of Change · ${p.score}/100 (${p.label})\n\n- Mutations: ${p.changed}\n- Diff inspected: ${p.diffReviewed?'yes':'no'}\n- Project checks discovered: ${p.discoveredCommands?'yes':'no'}\n- Browser verification: ${p.browserRequired?(p.browserVerified?'passed':'required / missing'):'not required'}\n- Turn completed: ${p.completed?'yes':'no'}\n\nVerification evidence\n${checks}\n\n${gaps.length?`Remaining gaps: ${gaps.join('; ')}.`:'Evidence gate satisfied with no recorded gaps.'}`;
}

export {commandKind,failedResult};
