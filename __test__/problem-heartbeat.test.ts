import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAwakening } from '../services/awakening';
import { heartbeatOf, collectWaits, heartbeatAction, recordJudgments, maintainHeartbeat, matchWaitingSources, attentionLevel } from '../services/problemHeartbeat';
let n = 0; const id = () => `hb-${++n}`; const now = Date.UTC(2026, 8, 10);
const state = () => { const s = createAwakening({ projectId:'p', branchId:'b', scopeId:'root', question:'Cooling a west-facing room?',background:'',agents:{}, facts:[{id:'f1',claim:'Night ventilation depends on outdoor conditions',source:'https://www.energy.gov',excerpt:'Cool outdoor air',scope:'General guidance',status:'confirmed'}],language:'en'}, now);s.policy.enabled=true; return s; };
const wait = {kind:'data',title:'Temperature log',detail:'Provide indoor and outdoor readings',condition:'A paired reading log',source:'Thermometers',owner:'You'};
test('waiting list deduplicates; one response resumes once and does not confirm facts',()=>{
 let s=collectWaits(state(),[wait],now,id);s=collectWaits(s,[wait],now+1,id);assert.equal(s.problemHeartbeat!.waits.length,1);assert.equal(s.problemHeartbeat!.updates.length,1);
 const body={action:'reply',id:s.problemHeartbeat!.waits[0].id,decision:'provide',answer:'No real readings yet'};s=heartbeatAction(s,body,now+2,id);
 assert.equal(s.problemHeartbeat!.waits[0].status,'received');assert.equal(s.events.length,1);assert.equal(s.context.facts.length,1);assert.throws(()=>heartbeatAction(s,body,now+3,id));
});
test('permission requests cannot be satisfied by an ordinary reply or stale approval',()=>{
 const s=collectWaits(state(),[{...wait,kind:'permission'}],now,id), wid=s.problemHeartbeat!.waits[0].id;
 assert.throws(()=>heartbeatAction(s,{action:'reply',id:wid,decision:'provide',answer:'yes'},now,id));
 assert.throws(()=>heartbeatAction({...s,contextVersion:2},{action:'reply',id:wid,decision:'approve',answer:'Allow this test only'},now,id));
 const out=heartbeatAction(s,{action:'reply',id:wid,decision:'decline',answer:'Do not spend'},now,id);assert.equal(out.problemHeartbeat!.waits[0].status,'declined');
});
test('judgments require verified sources; accepting rechecks exact evidence and prior version',()=>{
 const proposal={subject:'Ventilation',after:'Only ventilate when conditions permit',reason:'Source narrows the claim',evidenceIds:['f1']};
 let s=recordJudgments(state(),[proposal],'run1',now,id);assert.equal(s.problemHeartbeat!.judgments[0].status,'proposed');
 assert.throws(()=>recordJudgments(state(),[{...proposal,evidenceIds:['fake']}],'r',now,id));
 const action={action:'judgment',id:s.problemHeartbeat!.judgments[0].id,status:'accepted'};
 const changed=structuredClone(s);changed.context.facts[0].excerpt='Changed evidence';assert.throws(()=>heartbeatAction(changed,action,now,id));
 s=heartbeatAction(s,action,now+1,id);assert.equal(s.problemHeartbeat!.lastMeaningfulAt,now+1);
 s=recordJudgments(s,[{...proposal,after:'A second view'}],'run2',now+2,id);assert.equal(s.problemHeartbeat!.judgments[1].before,proposal.after);
});
test('30 quiet days produce one stagnation update, not 30 daily reports',()=>{
 let s=maintainHeartbeat(state(),now,id);for(let d=1;d<=40;d++)s=maintainHeartbeat(s,now+d*86400000,id);
 assert.equal(s.problemHeartbeat!.lifecycle,'dormant');assert.equal(s.problemHeartbeat!.updates.length,1);
 s=heartbeatAction(s,{action:'read',ids:s.problemHeartbeat!.updates.map(u=>u.id)},now+41*86400000,id);assert.equal(s.problemHeartbeat!.updates.filter(u=>!u.readAt).length,0);
 s=maintainHeartbeat(s,now+42*86400000,id);assert.equal(s.problemHeartbeat!.updates.length,1);
});
test('source conditions require the exact host and all keywords; matches are not verified facts',()=>{
 let s=collectWaits(state(),[{...wait,kind:'observation',trigger:{type:'source_match',sourceHost:'www.energy.gov',keywords:['ventilation','cool']}}],now,id);
 const event={id:'e',kind:'paper' as const,title:'Ventilation',body:'cool air',source:'https://www.energy.gov.evil.test/',at:now,status:'pending' as const};
 s=matchWaitingSources(s,[event],now);assert.equal(s.problemHeartbeat!.waits[0].status,'waiting');
 s=matchWaitingSources(s,[{...event,source:'https://www.energy.gov/article'}],now);assert.equal(s.problemHeartbeat!.waits[0].status,'received');assert.equal(s.context.facts.length,1);
});
test('required decisions remain visible in quiet mode; reopening never resumes a paused executor',()=>{
 let s=state();let h=heartbeatOf(s,now);h.preference='quiet';assert.equal(attentionLevel({importance:0,novelty:0,confidence:0,actionNeeded:true},h),'now');
 assert.equal(attentionLevel({importance:1,novelty:1,confidence:1},h),'silent');
 s=heartbeatAction(s,{action:'lifecycle',lifecycle:'resolved'},now,id);assert.equal(s.policy.enabled,false);
 s=heartbeatAction(s,{action:'lifecycle',lifecycle:'watching'},now,id);assert.equal(s.policy.enabled,false);
});

test('resolved action alerts are read; changed evidence is not reusable as accepted knowledge', async()=>{
 const { judgmentSupported }=await import('../services/problemHeartbeat');
 let s=collectWaits(state(),[wait],now,id);const wid=s.problemHeartbeat!.waits[0].id;
 s=heartbeatAction(s,{action:'reply',id:wid,decision:'provide',answer:'Here is the requested log'},now+1,id);assert.equal(s.problemHeartbeat!.updates.filter(u=>!u.readAt).length,0);
 s=recordJudgments(s,[{subject:'Ventilation',after:'Conditions matter',reason:'Narrow scope',evidenceIds:['f1']}],'r',now,id);
 const j=s.problemHeartbeat!.judgments[0];assert.equal(judgmentSupported(s,j),true);s.context.facts[0].status='disputed';assert.equal(judgmentSupported(s,j),false);
});
test('a later experiment data request does not block a supported desk analysis now',async()=>{
 const {runWake}=await import('../services/wakeRunner');let s=state();s.events=[{id:'new',kind:'input',title:'Analyze available guidance',body:'Analyze now; design later experiment',source:'user',at:now,status:'pending'}];const calls:string[]=[];
 await runWake({read:async()=>s,update:async fn=>(s=fn(s)),now:()=>now,id,collect:async()=>[],model:async role=>{calls.push(role);return JSON.stringify(role==='manager'?{decision:'research',reason:'Enough guidance for analysis now',task:'Analyze the source',role:'thinker',stopCondition:'One scoped conclusion',waits:[wait]}:role==='thinker'?{summary:'Conditions constrain ventilation',findings:[{claim:'Outdoor conditions matter',kind:'limitation',evidenceIds:['f1']}]}:role==='verifier'?{summary:'Supported by f1',problems:[]}:{verdict:'progress',summary:'A scoped limitation, not a measured result',next:'Collect readings',acceptedIndexes:[0],waits:[wait]});}});
 assert.deepEqual(calls,['manager','thinker','verifier','auditor']);assert.equal(s.status,'needs_user');assert.equal(s.runs[0].outcome,'progress');assert.equal(s.problemHeartbeat!.judgments.length,0);
});
