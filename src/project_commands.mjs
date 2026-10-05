import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function json(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}

export async function discoverProjectCommands(cwd=process.cwd()){
  const root=path.resolve(cwd),rows=[],seen=new Set();
  const add=(kind,command,source)=>{if(seen.has(kind))return;seen.add(kind);rows.push({kind,command,source});};
  const pkg=await json(path.join(root,'package.json'));
  if(pkg?.scripts){
    const scripts=pkg.scripts;
    if(scripts.test)add('test','npm test','package.json');
    if(scripts.lint)add('lint','npm run lint','package.json');
    const tc=scripts.typecheck?'typecheck':scripts['type-check']?'type-check':scripts.check&&/tsc|type/i.test(String(scripts.check))?'check':'';
    if(tc)add('typecheck',`npm run ${tc}`,'package.json');
    if(scripts.build)add('build','npm run build','package.json');
    if(scripts.dev)add('dev','npm run dev','package.json');
    else if(scripts.start)add('dev','npm start','package.json');
  }
  if(await exists(path.join(root,'go.mod'))){add('test','go test ./...','go.mod');add('build','go build ./...','go.mod');}
  if(await exists(path.join(root,'Cargo.toml'))){add('test','cargo test','Cargo.toml');add('typecheck','cargo check','Cargo.toml');add('build','cargo build','Cargo.toml');}
  const pyproject=path.join(root,'pyproject.toml');
  if(await exists(pyproject)){
    const text=await fs.readFile(pyproject,'utf8').catch(()=> '');
    if(/pytest|tool\.pytest/i.test(text)||await exists(path.join(root,'pytest.ini')))add('test','python -m pytest','pyproject.toml');
    if(/\[tool\.ruff\]|ruff/i.test(text))add('lint','python -m ruff check .','pyproject.toml');
  }else if(await exists(path.join(root,'pytest.ini')))add('test','python -m pytest','pytest.ini');
  return rows;
}
