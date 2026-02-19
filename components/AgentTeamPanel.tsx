
import React, { useState, useCallback } from 'react';
import { 
  Agent, 
  AgentTeam, 
  AgentTask,
  TeamAnalysis,
  analyzeTaskRequirements,
  createAgentTeam,
  createTask,
  assignTask,
  executeTask,
  getTaskExecutionOrder,
  integrateTeamOutput,
  addCollaboration
} from '../services/agentService';
import { ProblemNode } from '../types';

// 导出状态类型，供父组件使用
export interface AgentTeamState {
  team: AgentTeam | null;
  analysis: TeamAnalysis | null;
  logs: { time: string; agent: string; message: string }[];
  integratedOutput: string;
  currentTaskIndex: number;
  isWorking: boolean;
}

// 初始状态
export const initialAgentTeamState: AgentTeamState = {
  team: null,
  analysis: null,
  logs: [],
  integratedOutput: '',
  currentTaskIndex: 0,
  isWorking: false
};

interface AgentTeamPanelProps {
  projectId: string;
  projectGoal: string;
  nodes: ProblemNode[];
  // 状态从父组件传入
  state: AgentTeamState;
  onStateChange: (state: AgentTeamState) => void;
  onTeamOutput?: (output: string) => void;
}

const AgentTeamPanel: React.FC<AgentTeamPanelProps> = ({
  projectId,
  projectGoal,
  nodes,
  state,
  onStateChange,
  onTeamOutput
}) => {
  const { team, analysis, logs, integratedOutput, currentTaskIndex, isWorking } = state;
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 更新状态的辅助函数
  const updateState = useCallback((updates: Partial<AgentTeamState>) => {
    onStateChange({ ...state, ...updates });
  }, [state, onStateChange]);

  // 添加日志
  const addLog = useCallback((agent: string, message: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    updateState({ logs: [...logs, { time, agent, message }] });
  }, [logs, updateState]);

  // 分析任务并组建团队
  const handleAnalyzeAndBuildTeam = async () => {
    setIsAnalyzing(true);
    const newLogs = [{ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), agent: '🧠 AI管家', message: '正在分析任务需求...' }];
    updateState({ logs: newLogs });
    
    try {
      const result = await analyzeTaskRequirements(projectGoal, nodes);
      newLogs.push({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), agent: '🧠 AI管家', message: `分析完成！需要角色：${result.requiredRoles.join(', ')}` });
      
      // 创建团队
      const newTeam = createAgentTeam(projectId, result.requiredRoles);
      
      // 创建任务
      let tasksToAdd: AgentTask[] = [];
      result.taskBreakdown.forEach((tb, index) => {
        const task = createTask(
          tb.type,
          `任务${index + 1}: ${tb.description.slice(0, 20)}`,
          tb.description,
          projectGoal,
          undefined,
          index > 0 ? [tasksToAdd[index - 1]?.id].filter(Boolean) : []
        );
        tasksToAdd.push(task);
      });
      
      newTeam.tasks = tasksToAdd;
      
      newLogs.push({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), agent: '🧠 AI管家', message: `团队组建完成！${newTeam.agents.length}名成员，${tasksToAdd.length}个任务` });
      
      updateState({ 
        team: newTeam, 
        analysis: result, 
        logs: newLogs 
      });
      
    } catch (e) {
      newLogs.push({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), agent: '🧠 AI管家', message: '分析失败，请重试' });
      updateState({ logs: newLogs });
    }
    
    setIsAnalyzing(false);
  };

  // 开始团队工作
  const handleStartWork = async () => {
    if (!team || team.tasks.length === 0) return;
    
    updateState({ isWorking: true, currentTaskIndex: 0 });
    
    const orderedTasks = getTaskExecutionOrder(team.tasks);
    let currentTeam = team;
    let currentLogs = [...logs];
    
    for (let i = 0; i < orderedTasks.length; i++) {
      const task = orderedTasks[i];
      updateState({ currentTaskIndex: i });
      
      // 分配任务
      currentTeam = assignTask(currentTeam, task.id);
      updateState({ team: { ...currentTeam } });
      
      const assignedAgent = currentTeam.agents.find(a => a.id === task.assignedAgentId);
      const logTime = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      currentLogs.push({ time: logTime, agent: assignedAgent?.avatar || '🤖', message: `${assignedAgent?.name} 开始执行: ${task.title}` });
      updateState({ logs: [...currentLogs] });
      
      // 执行任务
      const { team: updatedTeam, output } = await executeTask(
        currentTeam,
        task.id,
        { nodes, projectGoal }
      );
      
      currentTeam = updatedTeam;
      updateState({ team: { ...currentTeam } });
      
      const logTime2 = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (output && output !== '执行失败') {
        currentLogs.push({ time: logTime2, agent: assignedAgent?.avatar || '🤖', message: `${assignedAgent?.name} 完成任务 ✓` });
        
        // 如果有评审员，添加协作记录
        const reviewer = currentTeam.agents.find(a => a.role === 'reviewer');
        if (reviewer && assignedAgent) {
          currentTeam = addCollaboration(
            currentTeam,
            assignedAgent.id,
            reviewer.id,
            task.id,
            'handoff',
            '任务完成，提交评审'
          );
        }
      } else {
        currentLogs.push({ time: logTime2, agent: assignedAgent?.avatar || '🤖', message: `${assignedAgent?.name} 任务执行失败` });
      }
      updateState({ logs: [...currentLogs] });
      
      // 短暂延迟
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 整合输出
    const logTime3 = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    currentLogs.push({ time: logTime3, agent: '🧠 AI管家', message: '正在整合团队成果...' });
    updateState({ logs: [...currentLogs] });
    
    const finalOutput = await integrateTeamOutput(currentTeam, projectGoal);
    
    const logTime4 = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    currentLogs.push({ time: logTime4, agent: '🧠 AI管家', message: '团队工作完成！' });
    
    updateState({ 
      integratedOutput: finalOutput, 
      isWorking: false,
      logs: [...currentLogs]
    });
    
    if (onTeamOutput) {
      onTeamOutput(finalOutput);
    }
  };

  // 重置团队
  const handleReset = () => {
    onStateChange(initialAgentTeamState);
  };

  // 渲染Agent卡片
  const renderAgentCard = (agent: Agent) => {
    const statusColors: Record<string, string> = {
      idle: 'bg-slate-600',
      thinking: 'bg-yellow-500',
      working: 'bg-blue-500 animate-pulse',
      reviewing: 'bg-purple-500',
      done: 'bg-green-500',
      error: 'bg-red-500'
    };
    
    const statusText: Record<string, string> = {
      idle: '空闲',
      thinking: '思考中',
      working: '工作中',
      reviewing: '评审中',
      done: '已完成',
      error: '出错'
    };
    
    return (
      <div key={agent.id} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{agent.avatar}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-200 truncate">{agent.name}</div>
            <div className="text-[10px] text-slate-500">{agent.description.slice(0, 15)}...</div>
          </div>
          <div className={`w-2 h-2 rounded-full ${statusColors[agent.status] || 'bg-slate-600'}`} title={statusText[agent.status] || '未知'}></div>
        </div>
        <div className="flex flex-wrap gap-1">
          {agent.capabilities.slice(0, 2).map((cap, i) => (
            <span key={i} className="text-[9px] px-1.5 py-0.5 bg-slate-700/50 rounded text-slate-400">{cap}</span>
          ))}
        </div>
        {agent.completedTasks > 0 && (
          <div className="mt-2 text-[10px] text-green-400">✓ 完成 {agent.completedTasks} 个任务</div>
        )}
      </div>
    );
  };

  // 渲染任务卡片
  const renderTaskCard = (task: AgentTask, index: number) => {
    const statusConfig: Record<string, { color: string; text: string }> = {
      pending: { color: 'bg-slate-600', text: '等待中' },
      assigned: { color: 'bg-yellow-500', text: '已分配' },
      in_progress: { color: 'bg-blue-500 animate-pulse', text: '执行中' },
      completed: { color: 'bg-green-500', text: '已完成' },
      failed: { color: 'bg-red-500', text: '失败' }
    };
    
    const config = statusConfig[task.status] || statusConfig.pending;
    const agent = team?.agents.find(a => a.id === task.assignedAgentId);
    
    return (
      <div key={task.id} className={`p-2 rounded border ${index === currentTaskIndex && isWorking ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700/50 bg-slate-800/30'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${config.color}`}></div>
          <span className="text-xs text-slate-300 flex-1 truncate">{task.title}</span>
          {agent && <span className="text-sm">{agent.avatar}</span>}
        </div>
        {task.output && (
          <div className="mt-1 text-[10px] text-slate-500 truncate">
            {task.output.slice(0, 50)}...
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-200">
      {/* 头部 */}
      <div className="p-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span>🤖</span> Agent 团队协作
          </h3>
          {(team || logs.length > 0) && (
            <button 
              onClick={handleReset}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              重置
            </button>
          )}
        </div>
        
        {!team ? (
          <button
            onClick={handleAnalyzeAndBuildTeam}
            disabled={isAnalyzing}
            className="w-full py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-lg text-sm font-medium disabled:opacity-50 transition-all"
          >
            {isAnalyzing ? '🔄 分析中...' : '🚀 分析任务并组建团队'}
          </button>
        ) : !isWorking && !integratedOutput ? (
          <button
            onClick={handleStartWork}
            className="w-full py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg text-sm font-medium transition-all"
          >
            ▶️ 开始团队协作
          </button>
        ) : isWorking ? (
          <div className="text-center py-2 text-sm text-blue-400">
            ⏳ 团队工作中... ({currentTaskIndex + 1}/{team?.tasks.length || 0})
          </div>
        ) : (
          <div className="text-center py-2 text-sm text-green-400">
            ✅ 团队工作完成
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* 团队分析结果 */}
        {analysis && !team && (
          <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs font-medium text-slate-400 mb-2">📊 任务分析</div>
            <div className="text-[11px] text-slate-300 space-y-1">
              <div>工作流程：{analysis.workflow}</div>
              <div>预计耗时：{analysis.estimatedTime}</div>
            </div>
          </div>
        )}

        {/* Agent 列表 */}
        {team && team.agents.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
              <span>👥</span> 团队成员 ({team.agents.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {team.agents.map(agent => renderAgentCard(agent))}
            </div>
          </div>
        )}

        {/* 任务列表 */}
        {team && team.tasks.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
              <span>📋</span> 任务队列 ({team.tasks.filter(t => t.status === 'completed').length}/{team.tasks.length})
            </div>
            <div className="space-y-1.5">
              {team.tasks.map((task, i) => renderTaskCard(task, i))}
            </div>
          </div>
        )}

        {/* 工作日志 */}
        {logs.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
              <span>📝</span> 工作日志
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2 max-h-40 overflow-auto space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] flex gap-2">
                  <span className="text-slate-600 w-14 flex-shrink-0">{log.time}</span>
                  <span className="w-16 flex-shrink-0">{log.agent}</span>
                  <span className="text-slate-400">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 整合输出 */}
        {integratedOutput && (
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
              <span>📄</span> 团队成果
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3 border border-green-500/30">
              <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                {integratedOutput}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentTeamPanel;
