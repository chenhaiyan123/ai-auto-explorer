// Apply the explicit UI dictionary only to rendered labels, never to user content, identifiers or prompts.
const ts = require('typescript'); const fs = require('fs'); const path = require('path');
const dictionaryFile = fs.readFileSync('services/translations.en.ts','utf8');
const dictSF = ts.createSourceFile('dict.ts',dictionaryFile,99,true);
const keys=new Set(); function collect(n){ if(ts.isPropertyAssignment(n)&&ts.isStringLiteral(n.name))keys.add(n.name.text); ts.forEachChild(n,collect); } collect(dictSF);
const files=['App.tsx',...fs.readdirSync('components').filter(f=>f.endsWith('.tsx')).map(f=>'components/'+f)];
let translated=0; const missing={};
for(const file of files){
 const source=fs.readFileSync(file,'utf8');const sf=ts.createSourceFile(file,source,99,true,4);let edits=[];let absent=new Set();
 function renderLiteral(n){
  let p=n.parent;
  if(ts.isJsxAttribute(p))return ['title','placeholder','aria-label','alt'].includes(p.name.text);
  if(ts.isConditionalExpression(p)) { if(p.condition===n)return false; p=p.parent; }
  if(ts.isBinaryExpression(p)) {if(![ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)||p.right!==n)return false;p=p.parent;}
  return ts.isJsxExpression(p);
 }
 function visit(n){
  if(ts.isJsxText(n)){
   const label=n.text.replace(/\s+/g,' ').trim();
   if(/[\u4e00-\u9fff]/.test(label)){
    if(keys.has(label)){edits.push([n.pos,n.end,`{ui(${JSON.stringify(label)})}`]);}else absent.add(label);
   }
  }else if(ts.isStringLiteral(n)&&/[\u4e00-\u9fff]/.test(n.text)&&renderLiteral(n)){
   if(keys.has(n.text)){ const code=`ui(${JSON.stringify(n.text)})`;edits.push([n.getStart(sf),n.end,ts.isJsxAttribute(n.parent)?`{${code}}`:code]); }else absent.add(n.text);
  }
  ts.forEachChild(n,visit);
 }
 visit(sf);
 if(edits.length){let next=source;for(const [a,b,v]of edits.sort((a,b)=>b[0]-a[0]))next=next.slice(0,a)+v+next.slice(b);const module=file==='App.tsx'?'./services/language':'../services/language';if(!source.includes('t as ui'))next=`import { t as ui } from '${module}';\n`+next;fs.writeFileSync(file,next);translated+=edits.length;}
 if(absent.size)missing[file]=[...absent];
}
fs.writeFileSync('/tmp/hiexplore-untranslated.json',JSON.stringify(missing,null,2));console.log('Localized labels:',translated);
