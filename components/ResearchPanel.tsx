/**
 * 研究进度面板组件
 * 
 * 显示研究模式的专属信息：
 * - 研究进度统计
 * - 知识卡片列表
 * - 研究发现
 * - 研究建议
 */

import React, { useState, useMemo } from 'react';
import { ProblemNode, NodeStatus } from '../types';
import { 
  KnowledgeCard, 
  ResearchFinding, 
  ResearchProgress,
  calculateResearchProgress 
} from '../services/researchExplorer';

interface ResearchPanelProps {
  nodes: ProblemNode[];
  knowledgeCards: KnowledgeCard[];
  findings: ResearchFinding[];
  onCardClick?: (card: KnowledgeCard) => void;
  onFindingClick?: (finding: ResearchFinding) => void;
  onGenerateReport?: () => void;
  isGeneratingReport?: boolean;
}

const ResearchPanel: React.FC<ResearchPanelProps> = ({
  nodes,
  knowledgeCards,
  findings,
  onCardClick,
  onFindingClick,
  onGenerateReport,
  isGeneratingReport
}) => {
  const [activeTab, setActiveTab] = useState<'progress' | 'cards' | 'findings'>('progress');
  const [cardFilter, setCardFilter] = useState<string>('all');

  // 计算研究进度
  const progress = useMemo(() => 
    calculateResearchProgress(nodes, knowledgeCards, findings),
    [nodes, knowledgeCards, findings]
  );

  // 过滤知识卡片
  const filteredCards = useMemo(() => {
    if (cardFilter === 'all') return knowledgeCards;
    return knowledgeCards.filter(c => c.category === cardFilter);
  }, [knowledgeCards, cardFilter]);

  // 按重要性排序发现
  const sortedFindings = useMemo(() => {
    const order = { high: 0, medium: 1, low: 2 };
    return [...findings].sort((a, b) => order[a.significance] - order[b.significance]);
  }, [findings]);

  return (
    <div className="h-full flex flex-col bg-slate-950/50">
      {/* 标签栏 */}
      <div className="flex border-b border-slate-800 bg-slate-900/50">
        <button
          onClick={() => setActiveTab('progress')}
          className={`flex-1 py-3 text-xs font-bold transition-all ${
            activeTab === 'progress'
              ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          📊 进度
        </button>
        <button
          onClick={() => setActiveTab('cards')}
          className={`flex-1 py-3 text-xs font-bold transition-all ${
            activeTab === 'cards'
              ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-900/20'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          🗂️ 知识卡片 ({knowledgeCards.length})
        </button>
        <button
          onClick={() => setActiveTab('findings')}
          className={`flex-1 py-3 text-xs font-bold transition-all ${
            activeTab === 'findings'
              ? 'text-yellow-400 border-b-2 border-yellow-400 bg-yellow-900/20'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          💡 发现 ({findings.length})
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4 scroll-hide">
        {/* 进度标签页 */}
        {activeTab === 'progress' && (
          <div className="space-y-4">
            {/* 进度环 */}
            <div className="flex justify-center py-4">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    className="fill-none stroke-slate-800"
                    strokeWidth="12"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    className="fill-none stroke-blue-500"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${progress.coverageScore * 3.52} 352`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white">{progress.coverageScore}%</span>
                  <span className="text-[10px] text-slate-500">研究覆盖</span>
                </div>
              </div>
            </div>

            {/* 统计网格 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                <div className="text-2xl font-bold text-white">{progress.answeredQuestions}/{progress.totalQuestions}</div>
                <div className="text-[10px] text-slate-500 uppercase">问题进度</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                <div className="text-2xl font-bold text-emerald-400">{progress.knowledgeCards}</div>
                <div className="text-[10px] text-slate-500 uppercase">知识卡片</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                <div className="text-2xl font-bold text-yellow-400">{progress.findings}</div>
                <div className="text-[10px] text-slate-500 uppercase">研究发现</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                <div className="text-2xl font-bold text-purple-400">{progress.explorationDepth}</div>
                <div className="text-[10px] text-slate-500 uppercase">探索深度</div>
              </div>
            </div>

            {/* 节点状态分布 */}
            <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700">
              <div className="text-xs font-bold text-slate-400 mb-3">节点状态分布</div>
              <div className="space-y-2">
                {[
                  { status: NodeStatus.SOLVED, label: '已完成', color: 'bg-emerald-500' },
                  { status: NodeStatus.EXPLORING, label: '探索中', color: 'bg-yellow-500' },
                  { status: NodeStatus.UNEXPLORED, label: '待探索', color: 'bg-blue-500' },
                  { status: NodeStatus.NEEDS_REVIEW, label: '待决策', color: 'bg-orange-500' },
                ].map(({ status, label, color }) => {
                  const count = nodes.filter(n => n.status === status).length;
                  const percent = nodes.length > 0 ? (count / nodes.length) * 100 : 0;
                  return (
                    <div key={status} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${color}`} />
                      <span className="text-xs text-slate-400 flex-1">{label}</span>
                      <span className="text-xs text-slate-500">{count}</span>
                      <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 生成报告按钮 */}
            <button
              onClick={onGenerateReport}
              disabled={isGeneratingReport || progress.answeredQuestions === 0}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                isGeneratingReport || progress.answeredQuestions === 0
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg hover:shadow-purple-900/30'
              }`}
            >
              {isGeneratingReport ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  生成报告中...
                </span>
              ) : (
                '📄 生成研究报告'
              )}
            </button>
          </div>
        )}

        {/* 知识卡片标签页 */}
        {activeTab === 'cards' && (
          <div className="space-y-3">
            {/* 过滤器 */}
            <div className="flex gap-1 flex-wrap">
              {[
                { value: 'all', label: '全部' },
                { value: 'fact', label: '📌 事实' },
                { value: 'theory', label: '🔬 理论' },
                { value: 'insight', label: '💡 见解' },
                { value: 'question', label: '❓ 问题' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setCardFilter(value)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                    cardFilter === value
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 卡片列表 */}
            {filteredCards.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                暂无知识卡片
              </div>
            ) : (
              filteredCards.map(card => (
                <div
                  key={card.id}
                  onClick={() => onCardClick?.(card)}
                  className="p-3 bg-slate-800/50 rounded-xl border border-slate-700 hover:border-emerald-500/50 cursor-pointer transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-bold text-slate-200 group-hover:text-emerald-400">
                      {card.title}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                      card.category === 'fact' ? 'bg-blue-900/50 text-blue-400' :
                      card.category === 'theory' ? 'bg-purple-900/50 text-purple-400' :
                      card.category === 'insight' ? 'bg-yellow-900/50 text-yellow-400' :
                      card.category === 'question' ? 'bg-orange-900/50 text-orange-400' :
                      'bg-slate-700 text-slate-400'
                    }`}>
                      {card.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2">{card.content}</p>
                  {card.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {card.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700">
                    <span className="text-[9px] text-slate-500">
                      可信度: {Math.round(card.confidence * 100)}%
                    </span>
                    <span className="text-[9px] text-slate-600">
                      {new Date(card.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 发现标签页 */}
        {activeTab === 'findings' && (
          <div className="space-y-3">
            {sortedFindings.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                暂无研究发现
              </div>
            ) : (
              sortedFindings.map((finding, idx) => (
                <div
                  key={idx}
                  onClick={() => onFindingClick?.(finding)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    finding.significance === 'high'
                      ? 'bg-yellow-900/20 border-yellow-500/50 hover:border-yellow-500'
                      : finding.significance === 'medium'
                      ? 'bg-slate-800/50 border-slate-700 hover:border-blue-500/50'
                      : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-lg">
                      {finding.type === 'discovery' ? '🔍' :
                       finding.type === 'contradiction' ? '⚡' :
                       finding.type === 'gap' ? '🕳️' : '🔗'}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">{finding.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                          finding.significance === 'high' ? 'bg-yellow-600 text-white' :
                          finding.significance === 'medium' ? 'bg-blue-600 text-white' :
                          'bg-slate-600 text-slate-300'
                        }`}>
                          {finding.significance === 'high' ? '重要' :
                           finding.significance === 'medium' ? '一般' : '次要'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{finding.description}</p>
                    </div>
                  </div>
                  <div className="text-[9px] text-slate-500 pl-7">
                    类型: {
                      finding.type === 'discovery' ? '新发现' :
                      finding.type === 'contradiction' ? '矛盾点' :
                      finding.type === 'gap' ? '知识空白' : '意外关联'
                    }
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResearchPanel;
