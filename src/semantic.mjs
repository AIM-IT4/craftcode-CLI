import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const SUPPORTED=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs']);
const norm=p=>p.split(path.sep).join('/');

function inside(cwd,p='.'){
  const root=path.resolve(cwd),full=path.resolve(root,p);
  if(full!==root&&!full.startsWith(root+path.sep))throw new Error('Path escapes workspace');
  return full;
}
function kindFor(file){
  switch(path.extname(file).toLowerCase()){
    case '.tsx':return ts.ScriptKind.TSX;
    case '.jsx':return ts.ScriptKind.JSX;
    case '.js':case '.mjs':case '.cjs':return ts.ScriptKind.JS;
    default:return ts.ScriptKind.TS;
  }
}
function declaredName(node){
  if(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node))return node.name;
  return null;
}
function kindName(node){
  if(ts.isFunctionDeclaration(node))return'function';
  if(ts.isClassDeclaration(node))return'class';
  if(ts.isInterfaceDeclaration(node))return'interface';
  if(ts.isTypeAliasDeclaration(node))return'type';
  if(ts.isEnumDeclaration(node))return'enum';
  if(ts.isVariableDeclaration(node))return'variable';
  return'symbol';
}
function isDeclarationIdentifier(node){
  const p=node.parent;
  if(!p)return false;
  if((ts.isFunctionDeclaration(p)||ts.isClassDeclaration(p)||ts.isInterfaceDeclaration(p)||ts.isTypeAliasDeclaration(p)||ts.isEnumDeclaration(p)||ts.isVariableDeclaration(p)||ts.isParameter(p))&&p.name===node)return true;
  return false;
}

export class SemanticIndex{
  constructor({cwd,maxFiles=300,maxItems=300}={}){this.cwd=path.resolve(cwd||process.cwd());this.maxFiles=maxFiles;this.maxItems=maxItems;}
  async _files(input='.'){
    const start=inside(this.cwd,input);
    let st;try{st=await fs.stat(start);}catch(e){if(e.code==='ENOENT')return[];throw e;}
    if(st.isFile())return SUPPORTED.has(path.extname(start).toLowerCase())?[start]:[];
    const out=[];
    const walk=async dir=>{
      if(out.length>=this.maxFiles)return;
      let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
      for(const e of entries){
        if(out.length>=this.maxFiles)break;
        if(e.name==='.git'||e.name==='node_modules'||e.name==='dist'||e.name==='build'||e.name==='coverage')continue;
        const full=path.join(dir,e.name);
        if(e.isDirectory())await walk(full);
        else if(e.isFile()&&SUPPORTED.has(path.extname(e.name).toLowerCase()))out.push(full);
      }
    };
    await walk(start);return out;
  }
  async _source(file){
    const text=await fs.readFile(file,'utf8');
    return{text,source:ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kindFor(file))};
  }
  _loc(file,source,node){
    const p=source.getLineAndCharacterOfPosition(node.getStart(source));
    return{path:norm(path.relative(this.cwd,file)),line:p.line+1,column:p.character+1};
  }
  async symbols(input='.'){
    const files=await this._files(input);
    if(!files.length)return{engine:'unsupported',items:[]};
    const items=[];
    for(const file of files){
      const {source}=await this._source(file);
      for(const stmt of source.statements){
        const name=declaredName(stmt);
        if(name&&ts.isIdentifier(name))items.push({...this._loc(file,source,name),name:name.text,kind:kindName(stmt)});
        if(ts.isVariableStatement(stmt))for(const d of stmt.declarationList.declarations)if(ts.isIdentifier(d.name))items.push({...this._loc(file,source,d.name),name:d.name.text,kind:'variable'});
        if(items.length>=this.maxItems)break;
      }
      if(items.length>=this.maxItems)break;
    }
    return{engine:'typescript-ast',items};
  }
  async definition(symbol,input='.'){
    const r=await this.symbols(input);
    if(r.engine!=='typescript-ast')return r;
    return{engine:r.engine,items:r.items.filter(x=>x.name===symbol).slice(0,this.maxItems)};
  }
  async references(symbol,input='.'){
    const files=await this._files(input);
    if(!files.length)return{engine:'unsupported',items:[]};
    const items=[];
    for(const file of files){
      const {text,source}=await this._source(file);
      const visit=node=>{
        if(items.length>=this.maxItems)return;
        if(ts.isIdentifier(node)&&node.text===symbol){
          const loc=this._loc(file,source,node),lineText=text.split(/\r?\n/)[loc.line-1]||'';
          items.push({...loc,name:symbol,declaration:isDeclarationIdentifier(node),snippet:lineText.trim().slice(0,240)});
        }
        ts.forEachChild(node,visit);
      };
      visit(source);
      if(items.length>=this.maxItems)break;
    }
    return{engine:'typescript-ast',items};
  }
  async query({action='symbols',path:input='.',symbol}={}){
    inside(this.cwd,input);
    if(action==='symbols'||action==='outline')return this.symbols(input);
    if(action==='definition'){if(!symbol)throw new Error('semantic definition requires symbol');return this.definition(symbol,input);}
    if(action==='references'){if(!symbol)throw new Error('semantic references requires symbol');return this.references(symbol,input);}
    throw new Error(`Unknown semantic action: ${action}`);
  }
}
