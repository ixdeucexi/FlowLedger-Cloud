import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=process.cwd();
const entry='supabase/functions/flo-chat/index.ts';
const files=new Map();
function collect(relative) {
 if(files.has(relative))return;
 const absolute=path.resolve(root,relative);
 if(!absolute.startsWith(root+path.sep))throw new Error('Dependency outside repository');
 let content=fs.readFileSync(absolute,'utf8');
 files.set(relative,null);
 const imports=ts.preProcessFile(content,true,true).importedFiles;
 const replacements=new Map();
 for(const imported of imports) {
  const name=imported.fileName;
  if(!name.startsWith('.'))continue;
  let resolved=path.resolve(path.dirname(absolute),name);
  let suffix='';
  if(!path.extname(resolved)){suffix='.ts';resolved+=suffix;}
  if(!fs.existsSync(resolved))throw new Error(`Missing relative dependency ${name}`);
  collect(path.relative(root,resolved).replaceAll('\\','/'));
  if(suffix)replacements.set(name,name+suffix);
 }
 const edits=[];
 const source=ts.createSourceFile(relative,content,ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isStringLiteral(node)&&replacements.has(node.text))edits.push({start:node.getStart(source)+1,end:node.end-1,value:replacements.get(node.text)});
  ts.forEachChild(node,visit);
 }
 visit(source);
 // AST string-literal spans include quotes; retain both quote characters.
 for(const edit of edits.sort((a,b)=>b.start-a.start))content=content.slice(0,edit.start)+edit.value+content.slice(edit.end);
 if(ts.createSourceFile(relative,content,ts.ScriptTarget.Latest,true).parseDiagnostics.length)throw new Error(`Invalid packaged TypeScript: ${relative}`);
 files.set(relative,content);
}
collect(entry);
process.stdout.write(JSON.stringify({entrypoint_path:entry,files:[...files].map(([name,content])=>({name,content}))}));
