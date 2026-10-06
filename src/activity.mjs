const lower=s=>String(s||'').toLowerCase();

export function taskKind(goal=''){
  const g=lower(goal);
  if(/\b(ui|ux|frontend|front-end|css|style|layout|page|component|button|modal|screen|responsive|design)\b/.test(g))return'ui';
  if(/\b(bug|fix|broken|error|exception|fail|failed|failure|issue|regression|stuck|crash|wrong|incorrect)\b/.test(g))return'bug';
  if(/\b(refactor|architecture|architect|redesign|restructure|dependency|dependencies|migration|migrate)\b/.test(g))return'architecture';
  if(/\b(test|verify|verification|validate|qa|quality|check)\b/.test(g))return'verification';
  if(/\b(deploy|deployment|release|publish|ci|pipeline|production|vercel)\b/.test(g))return'delivery';
  if(/\b(research|search|find|investigate|compare|explain|understand|analy[sz]e)\b/.test(g))return'research';
  return'general';
}

export function activityForThinking(x={}){
  const kind=taskKind(x.goal),step=Number(x.step||0),last=String(x.lastToolName||''),failed=!!x.lastToolFailed;

  if(failed){
    if(last==='run_command')return'Investigating command failure';
    if(last==='call_mcp_tool')return'Reassessing browser evidence';
    return'Reassessing the approach';
  }

  if(x.browserRequired&&!x.browserVerified)return'Checking in browser';
  if(x.mutated&&!x.verified)return'Verifying the change';
  if(x.mutated&&x.verified)return'Reviewing evidence';

  if(last){
    if(last==='search_files'||last==='repo_map')return'Connecting search findings';
    if(last==='read_file'||last==='read_many_files'||last==='semantic_code')return'Connecting code findings';
    if(last==='apply_patch'||last==='replace_in_file'||last==='write_file')return'Checking the edit';
    if(last==='git_diff')return'Reviewing the change';
    if(last==='run_command')return'Interpreting command output';
    if(last==='call_mcp_tool')return'Inspecting browser evidence';
    if(last==='discover_project_commands')return'Choosing the right checks';
    if(last.startsWith('git_'))return'Checking repository state';
    if(last.startsWith('process_'))return'Checking the running process';
  }

  if(step===0){
    if(kind==='bug')return'Tracing the issue';
    if(kind==='ui')return'Assessing the interface';
    if(kind==='architecture')return'Mapping dependencies';
    if(kind==='verification')return'Planning verification';
    if(kind==='delivery')return'Checking release state';
    if(kind==='research')return'Scoping the search';
    return'Understanding the request';
  }

  if(kind==='bug')return'Narrowing the cause';
  if(kind==='ui')return'Refining the UI approach';
  if(kind==='architecture')return'Refining the design';
  if(kind==='verification')return'Checking the evidence';
  if(kind==='delivery')return'Preparing the next release step';
  if(kind==='research')return'Synthesizing findings';
  return'Planning the next step';
}

export function activityAfterTool(x={}){
  const n=String(x.name||''),failed=!!x.error;
  if(failed){
    if(n==='run_command')return'Command failed';
    if(n==='call_mcp_tool')return'Browser check failed';
    return'Reassessing';
  }
  if(n==='search_files'||n==='repo_map')return'Found relevant code';
  if(n==='read_file'||n==='read_many_files'||n==='semantic_code')return'Code inspected';
  if(n==='apply_patch'||n==='replace_in_file'||n==='write_file')return'Edit applied';
  if(n==='run_command')return'Command finished';
  if(n==='git_diff')return'Diff ready';
  if(n==='call_mcp_tool')return'Browser evidence captured';
  return'Reviewing result';
}
