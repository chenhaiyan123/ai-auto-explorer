import assert from 'node:assert/strict';
import {testLLMConnection, loadLLMSettings, saveLLMSettings, type LLMSettings} from '../services/llmProvider';
const store = new Map<string,string>();
(globalThis as any).localStorage = {getItem:(k:string)=>store.get(k),setItem:(k:string,v:string)=>store.set(k,v)};
const saved: LLMSettings={provider:'openai-compatible',baseUrl:'https://saved.example/v1',apiKey:'',model:'saved'};
const draft: LLMSettings={...saved,baseUrl:'https://draft.example/v1',model:'draft'};
const original=globalThis.fetch;
try {
 saveLLMSettings(saved);
 globalThis.fetch=async (url,init)=>{assert.match(String(url),/draft.example/); assert.equal(JSON.parse(String(init?.body)).model,'draft'); assert.deepEqual(loadLLMSettings(),saved); return Response.json({choices:[{message:{content:'OK'}}]});};
 assert.equal((await testLLMConnection(draft)).ok,true);assert.deepEqual(loadLLMSettings(),saved);
 globalThis.fetch=async()=>Response.json({error:{message:'invalid'}},{status:401});
 assert.equal((await testLLMConnection(draft)).ok,false);assert.deepEqual(loadLLMSettings(),saved);
 const newer={...saved,model:'newer'};
 globalThis.fetch=async()=>{saveLLMSettings(newer);throw new Error('timeout');};
 assert.equal((await testLLMConnection(draft)).ok,false);assert.deepEqual(loadLLMSettings(),newer);
 console.log('Model draft tests passed: success/failure do not save; concurrent save survives.');
} finally {globalThis.fetch=original;}
