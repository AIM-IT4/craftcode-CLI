import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve `p` inside `cwd` and refuse anything that escapes the workspace, either
 * lexically (`../x`) or through a symlink (the deepest existing ancestor is resolved
 * with realpath, so a link inside the workspace cannot point at files outside it).
 */
export function safePath(cwd,p='.'){
  const root=path.resolve(cwd),full=path.resolve(root,p);
  if(full!==root&&!full.startsWith(root+path.sep))throw new Error('Path escapes workspace');
  let realRoot;try{realRoot=fs.realpathSync(root);}catch{realRoot=root;}
  let probe=full;
  for(;;){
    let real;
    try{real=fs.realpathSync(probe);}
    catch{const parent=path.dirname(probe);if(parent===probe)break;probe=parent;continue;}
    const target=path.join(real,path.relative(probe,full));
    if(target!==realRoot&&!target.startsWith(realRoot+path.sep))throw new Error('Path escapes workspace via symlink');
    break;
  }
  return full;
}
