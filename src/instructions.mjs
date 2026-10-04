import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadProjectInstructions(cwd,config={}){
  const files=config.instructions?.files||['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'];
  const max=Math.max(1000,Number(config.instructions?.maxChars||12000));let used=0;const parts=[];
  for(const rel of files){if(used>=max)break;const file=path.join(cwd,rel);try{let txt=await fs.readFile(file,'utf8');const room=max-used;if(txt.length>room)txt=txt.slice(0,room)+`\n[truncated by Craft Code after ${room} chars]`;parts.push({file:rel,text:txt});used+=txt.length;}catch{}}
  return parts;
}
export async function initAgentsFile(cwd){
  const file=path.join(cwd,'AGENTS.md');try{await fs.access(file);return{created:false,file};}catch{}
  const body=`# AGENTS.md\n\n## Project overview\nDescribe what this repository does and the primary architecture.\n\n## Development commands\n- Install: add the project install command\n- Test: add the relevant test command\n- Build: add the production build command\n\n## Coding conventions\n- Make focused changes; do not refactor unrelated code.\n- Follow existing patterns before introducing new abstractions.\n- Add or update tests for behavior changes where practical.\n- Never commit secrets, credentials, generated build output, or local environment files.\n\n## Verification\nRun the narrowest relevant checks first, then broader tests/builds when justified.\n`;
  await fs.writeFile(file,body,'utf8');return{created:true,file};
}
