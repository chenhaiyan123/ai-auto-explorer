import { createAwakening } from '../services/awakening';
import { collectWaits, heartbeatAction } from '../services/problemHeartbeat';
export function decisionFixture() {
 let n=0;const id=()=>`demo-${++n}`;const at=Date.UTC(2026,9,19,1);
 let s=createAwakening({projectId:'demo',branchId:'main',scopeId:'root',question:'遮阳能否让房间午后降温至少 2°C？',background:'构造演示，非真实测量',agents:{},facts:[{id:'sample',claim:'演示数据：单次对照温差 1.2°C，尚未达到目标',source:'演示数据表，并非真实外部来源',excerpt:'同一天 14:00，两组温度差 1.2°C',scope:'仅一次采样，不能排除天气及房间差异',status:'confirmed'}]},at);
 s=collectWaits(s,[{kind:'decision',title:'先做小样对照',detail:'建立基线',condition:'用户确认',owner:'用户',source:'演示'}],at,id);
 s=heartbeatAction(s,{action:'reply',id:s.problemHeartbeat!.waits[0].id,decision:'approve',answer:'先看测量证据，不购买设备'},at+1000,id);
 s.events.push({id:'measurement',kind:'evidence',title:'收到一次温度对照数据（演示）',body:'1.2°C 是单次差值，不能据此确认长期效果。',source:'演示测量表',at:at+2000,status:'consumed'});
 s=collectWaits(s,[{kind:'decision',title:'是否安排三天同条件复测？',detail:'现有单次测量不足，继续需要你安排时间和测量人员。',condition:'确认三天的时间安排与执行人后，等待实际数据',owner:'用户',source:'演示研究计划',decisionBrief:{recommendation:'先做三天同条件复测，暂不购买设备。',rationale:'只有一次温差，低于目标且存在混杂因素；重复对照能检验效果是否稳定。',risks:'需要每天约15分钟人工记录；额外费用未报价，不包含采购授权。',alternative:'暂缓研究，等有可靠历史数据再分析。',evidenceIds:['sample']}}],at+3000,id);
 return s;
}
