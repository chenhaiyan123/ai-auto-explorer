/**
 * 多Agent协作系统
 * 
 * 核心概念：
 * - Agent: 具有特定能力的AI角色
 * - Task: 分配给Agent的具体任务
 * - AgentTeam: AI管家组建的团队
 * - Collaboration: Agent之间的协作记录
 */

import { ProblemNode } from '../types';
import { callGemini } from './geminiService';

// ==================== 类型定义 ====================

export type AgentRole = 'commander' | 'researcher' | 'engineer' | 'designer' | 'reviewer' | 'analyst';

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'reviewing' | 'done' | 'error';

export type TaskType = 'research' | 'code' | 'design' | 'review' | 'analyze' | 'plan';

export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

// Agent 定义
export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  avatar: string;
  description: string;
  capabilities: string[];
  status: AgentStatus;
  currentTaskId?: string;
  completedTasks: number;
}

// 任务定义
export interface AgentTask {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  nodeId?: string;           // 关联的探索节点
  assignedAgentId?: string;  // 分配的Agent
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  input: string;             // 任务输入
  output?: string;           // 任务输出
  dependencies: string[];    // 依赖的其他任务ID
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  reviewComments?: string;   // 评审意见
}

// Agent团队
export interface AgentTeam {
  id: string;
  projectId: string;
  agents: Agent[];
  tasks: AgentTask[];
  collaborations: Collaboration[];
  createdAt: number;
}

// 协作记录
export interface Collaboration {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  taskId: string;
  type: 'handoff' | 'review' | 'question' | 'feedback';
  message: string;
  timestamp: number;
}

// 团队分析结果
export interface TeamAnalysis {
  requiredRoles: AgentRole[];
  taskBreakdown: {
    type: TaskType;
    description: string;
    estimatedComplexity: 'simple' | 'medium' | 'complex';
  }[];
  workflow: string;
  estimatedTime: string;
}

// ==================== 预定义 Agents ====================

export const PREDEFINED_AGENTS: Omit<Agent, 'id' | 'status' | 'currentTaskId' | 'completedTasks'>[] = [
  {
    role: 'commander',
    name: 'AI管家',
    avatar: '🧠',
    description: '团队指挥官，负责任务分析、分配和协调',
    capabilities: ['任务分析', '团队组建', '进度协调', '结果整合'],
  },
  {
    role: 'researcher',
    name: '研究员小研',
    avatar: '🔬',
    description: '负责资料调研、知识整理和分析报告',
    capabilities: ['文献调研', '知识整理', '趋势分析', '报告撰写'],
  },
  {
    role: 'engineer',
    name: '工程师小码',
    avatar: '💻',
    description: '负责代码实现、技术方案和Demo开发',
    capabilities: ['代码编写', '技术设计', 'Demo开发', '问题调试'],
  },
  {
    role: 'designer',
    name: '设计师小美',
    avatar: '🎨',
    description: '负责UI设计、流程图和原型设计',
    capabilities: ['界面设计', '流程图', '原型设计', '视觉优化'],
  },
  {
    role: 'reviewer',
    name: '评审员小审',
    avatar: '📋',
    description: '负责审核结果、质量把关和改进建议',
    capabilities: ['质量审核', '问题发现', '改进建议', '标准检查'],
  },
  {
    role: 'analyst',
    name: '分析师小数',
    avatar: '📊',
    description: '负责数据分析、趋势判断和决策建议',
    capabilities: ['数据分析', '趋势预测', '决策建议', '风险评估'],
  },
];

// ==================== 核心服务 ====================

/**
 * 分析任务，确定需要哪些Agent
 */
export const analyzeTaskRequirements = async (
  problemDescription: string,
  nodes: ProblemNode[]
): Promise<TeamAnalysis> => {
  const nodesContext = nodes.slice(0, 5).map(n => `- ${n.title}: ${(n.notes || '').slice(0, 50)}`).join('\n');
  
  const prompt = `作为AI团队指挥官，分析以下问题需要组建什么样的团队：

问题：${problemDescription}

已有探索节点：
${nodesContext || '暂无'}

请分析并返回JSON：
{
  "requiredRoles": ["researcher", "engineer", "designer", "reviewer", "analyst"],
  "taskBreakdown": [
    {"type": "research", "description": "具体任务描述", "estimatedComplexity": "medium"}
  ],
  "workflow": "简述工作流程",
  "estimatedTime": "预计耗时"
}

要求：
1. requiredRoles从以下选择：researcher(研究), engineer(工程), designer(设计), reviewer(评审), analyst(分析)
2. 根据问题性质选择必要的角色，不要全选
3. taskBreakdown要具体可执行
4. workflow描述角色间如何协作`;

  try {
    const result = await callGemini([{ role: 'user', content: prompt }], undefined, 'application/json');
    const clean = result.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('分析任务失败:', e);
    return {
      requiredRoles: ['researcher'],
      taskBreakdown: [{ type: 'research', description: '初步研究', estimatedComplexity: 'medium' }],
      workflow: '研究员进行调研',
      estimatedTime: '约10分钟'
    };
  }
};

/**
 * 创建Agent团队
 */
export const createAgentTeam = (
  projectId: string, 
  requiredRoles: AgentRole[]
): AgentTeam => {
  const agents: Agent[] = [];
  
  // 始终包含指挥官
  const commander = PREDEFINED_AGENTS.find(a => a.role === 'commander')!;
  agents.push({
    ...commander,
    id: `agent_commander_${Date.now()}`,
    status: 'idle',
    completedTasks: 0
  });
  
  // 添加所需角色
  requiredRoles.forEach(role => {
    if (role === 'commander') return;
    const template = PREDEFINED_AGENTS.find(a => a.role === role);
    if (template) {
      agents.push({
        ...template,
        id: `agent_${role}_${Date.now()}`,
        status: 'idle',
        completedTasks: 0
      });
    }
  });
  
  return {
    id: `team_${Date.now()}`,
    projectId,
    agents,
    tasks: [],
    collaborations: [],
    createdAt: Date.now()
  };
};

/**
 * 创建任务
 */
export const createTask = (
  type: TaskType,
  title: string,
  description: string,
  input: string,
  nodeId?: string,
  dependencies: string[] = []
): AgentTask => {
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    description,
    nodeId,
    status: 'pending',
    priority: 'medium',
    input,
    dependencies,
    createdAt: Date.now()
  };
};

/**
 * 分配任务给Agent
 */
export const assignTask = (
  team: AgentTeam,
  taskId: string
): AgentTeam => {
  const task = team.tasks.find(t => t.id === taskId);
  if (!task) return team;
  
  // 根据任务类型找到合适的Agent
  const roleMap: Record<TaskType, AgentRole> = {
    research: 'researcher',
    code: 'engineer',
    design: 'designer',
    review: 'reviewer',
    analyze: 'analyst',
    plan: 'commander'
  };
  
  const targetRole = roleMap[task.type];
  const agent = team.agents.find(a => a.role === targetRole && a.status === 'idle');
  
  if (!agent) {
    console.warn(`没有可用的 ${targetRole} Agent`);
    return team;
  }
  
  return {
    ...team,
    tasks: team.tasks.map(t => 
      t.id === taskId ? { ...t, assignedAgentId: agent.id, status: 'assigned' as TaskStatus } : t
    ),
    agents: team.agents.map(a => 
      a.id === agent.id ? { ...a, status: 'working' as AgentStatus, currentTaskId: taskId } : a
    )
  };
};

/**
 * Agent执行任务
 */
export const executeTask = async (
  team: AgentTeam,
  taskId: string,
  context: { nodes: ProblemNode[]; projectGoal: string }
): Promise<{ team: AgentTeam; output: string }> => {
  const task = team.tasks.find(t => t.id === taskId);
  const agent = team.agents.find(a => a.id === task?.assignedAgentId);
  
  if (!task || !agent) {
    return { team, output: '任务或Agent不存在' };
  }
  
  // 更新状态为执行中
  let updatedTeam: AgentTeam = {
    ...team,
    tasks: team.tasks.map(t => t.id === taskId ? { ...t, status: 'in_progress' as TaskStatus, startedAt: Date.now() } : t),
    agents: team.agents.map(a => a.id === agent.id ? { ...a, status: 'working' as AgentStatus } : a)
  };
  
  // 构建Agent专属提示词
  const agentPrompt = buildAgentPrompt(agent, task, context);
  
  try {
    const output = await callGemini([{ role: 'user', content: agentPrompt }], undefined);
    
    // 更新完成状态
    updatedTeam = {
      ...updatedTeam,
      tasks: updatedTeam.tasks.map(t => 
        t.id === taskId ? { 
          ...t, 
          status: 'completed' as TaskStatus, 
          output, 
          completedAt: Date.now() 
        } : t
      ),
      agents: updatedTeam.agents.map(a => 
        a.id === agent.id ? { 
          ...a, 
          status: 'idle' as AgentStatus, 
          currentTaskId: undefined,
          completedTasks: a.completedTasks + 1 
        } : a
      )
    };
    
    return { team: updatedTeam, output };
    
  } catch (e) {
    console.error('Agent执行任务失败:', e);
    
    updatedTeam = {
      ...updatedTeam,
      tasks: updatedTeam.tasks.map(t => 
        t.id === taskId ? { ...t, status: 'failed' as TaskStatus } : t
      ),
      agents: updatedTeam.agents.map(a => 
        a.id === agent.id ? { ...a, status: 'error' as AgentStatus } : a
      )
    };
    
    return { team: updatedTeam, output: '执行失败' };
  }
};

/**
 * 构建Agent专属提示词
 */
const buildAgentPrompt = (
  agent: Agent,
  task: AgentTask,
  context: { nodes: ProblemNode[]; projectGoal: string }
): string => {
  const rolePrompts: Record<AgentRole, string> = {
    commander: `你是AI团队指挥官，负责统筹协调。`,
    researcher: `你是研究员，擅长资料调研和知识整理。请深入分析，提供有价值的见解和参考资料。`,
    engineer: `你是工程师，擅长技术实现和代码开发。请提供可执行的技术方案或代码示例。`,
    designer: `你是设计师，擅长UI设计和视觉呈现。请提供设计思路、布局建议或流程图描述。`,
    reviewer: `你是评审员，负责质量把关。请严格审核，指出问题并给出改进建议。`,
    analyst: `你是分析师，擅长数据分析和趋势判断。请提供数据支持的分析和决策建议。`
  };
  
  const nodesContext = context.nodes.slice(0, 3).map(n => 
    `- ${n.title}: ${(n.notes || '').slice(0, 100)}`
  ).join('\n');
  
  return `${rolePrompts[agent.role]}

【项目目标】
${context.projectGoal}

【相关背景】
${nodesContext || '暂无'}

【你的任务】
${task.title}

【任务说明】
${task.description}

【输入信息】
${task.input}

请以专业的角度完成任务，输出要：
1. 结构清晰
2. 内容具体可执行
3. 标注你的角色身份（${agent.name}）`;
};

/**
 * 添加协作记录
 */
export const addCollaboration = (
  team: AgentTeam,
  fromAgentId: string,
  toAgentId: string,
  taskId: string,
  type: Collaboration['type'],
  message: string
): AgentTeam => {
  const collaboration: Collaboration = {
    id: `collab_${Date.now()}`,
    fromAgentId,
    toAgentId,
    taskId,
    type,
    message,
    timestamp: Date.now()
  };
  
  return {
    ...team,
    collaborations: [...team.collaborations, collaboration]
  };
};

/**
 * 获取任务执行顺序（考虑依赖关系）
 */
export const getTaskExecutionOrder = (tasks: AgentTask[]): AgentTask[] => {
  const completed = new Set<string>();
  const result: AgentTask[] = [];
  const pending = [...tasks];
  
  while (pending.length > 0) {
    const ready = pending.filter(t => 
      t.dependencies.every(depId => completed.has(depId))
    );
    
    if (ready.length === 0 && pending.length > 0) {
      // 有循环依赖，强制取第一个
      ready.push(pending[0]);
    }
    
    ready.forEach(t => {
      result.push(t);
      completed.add(t.id);
      const idx = pending.findIndex(p => p.id === t.id);
      if (idx !== -1) pending.splice(idx, 1);
    });
  }
  
  return result;
};

/**
 * 整合团队输出
 */
export const integrateTeamOutput = async (
  team: AgentTeam,
  projectGoal: string
): Promise<string> => {
  const completedTasks = team.tasks.filter(t => t.status === 'completed' && t.output);
  
  if (completedTasks.length === 0) {
    return '团队尚未产出任何结果';
  }
  
  const taskOutputs = completedTasks.map(t => {
    const agent = team.agents.find(a => a.id === t.assignedAgentId);
    return `【${agent?.name || '未知'}的工作成果 - ${t.title}】\n${t.output}`;
  }).join('\n\n---\n\n');
  
  const prompt = `作为AI团队指挥官，请整合团队成员的工作成果：

【项目目标】
${projectGoal}

【团队成果】
${taskOutputs}

请整合输出一份完整的报告，包括：
1. 总结概述
2. 主要发现/成果
3. 下一步建议

要求简洁清晰，突出重点。`;

  try {
    return await callGemini([{ role: 'user', content: prompt }], undefined);
  } catch (e) {
    return taskOutputs; // 失败则直接返回原始输出
  }
};
