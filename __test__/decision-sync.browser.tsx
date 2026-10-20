import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ProblemHeartbeatPanel from '../components/ProblemHeartbeatPanel';
import {decisionFixture} from './decision-sync.fixture';
import {heartbeatAction} from '../services/problemHeartbeat';
function Demo(){const [s,setS]=useState(decisionFixture);const [message,setMessage]=useState('');return <main className="max-w-3xl mx-auto p-5 space-y-4"><h1 className="text-xl">认知同步 · 隔离演示</h1><p className="text-sm text-amber-200">构造数据，仅演示决策流程。不会发送请求、付款或修改真实项目。</p><div className="flex gap-3"><button className="border rounded p-2" onClick={()=>setS(old=>({...old,context:{...old.context,facts:old.context.facts.map(f=>({...f,status:'disputed'}))}}))}>模拟证据被质疑</button><button className="border rounded p-2" onClick={()=>{setS(decisionFixture());setMessage('');}}>重置演示</button></div><p role="status">{message}</p><ProblemHeartbeatPanel state={s} busy={false} act={async(body)=>{try{setS(heartbeatAction(s,body,Date.now(),()=>crypto.randomUUID()));setMessage('本地演示操作完成');return true;}catch(e){setMessage(String(e));return false;}}}/></main>};createRoot(document.getElementById('root')!).render(<Demo/>);
