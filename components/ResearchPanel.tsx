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
  isGeneratingReport: boolean;
  onGenerateReport: () => void;
  onCardClick?: (card: KnowledgeCard) => void;
  onFindingClick?: (finding: ResearchFinding) => void;
}

const ResearchPanel: React.FC<ResearchPanelProps> = ({
  nodes,
  knowledgeCards,
  findings,
  isGeneratingReport,
  onGenerateReport,
  onCardClick,
  onFindingClick
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'cards' | 'findings'>('overview');
  const [cardFilter, setCardFilter] = useState<string>('all');
  const [findingSort, setFindingSort] = useState<'importance' | 'time'>('importance');

  const progress = useMemo(() => 
    calculateResearchProgress(nodes, knowledgeCards, findings),
    [nodes, knowledgeCards, findings]
  );

  const filteredCards = useMemo(() => {
    if (cardFilter === 'all') return knowledgeCards;
    return knowledgeCards.filter(c => c.category === cardFilter);
  }, [knowledgeCards, cardFilter]);

  const sortedFindings = useMemo(() => {
    if (findingSort === 'time') {
      return [...findings].sort((a, b) => b.createdAt - a.createdAt);
    }
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...findings].sort((a, b) => order[a.significance || 'medium'] - order[b.significance || 'medium']);
  }, [findings, findingSort]);

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* 标签切换 */}
      <div className="flex border-b border-slate-800">
        {[
          { key: 'overview', label: '总览' },
          { key: 'cards', label: `知识卡片 (${knowledgeCards.length})` },
          { key: 'findings', label: `研究发现 (${findings.length})` }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex-1 py-3 text-xs font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-blue-600/10 text-blue-400 border-b-2 border-blue-500'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="p-4 space-y-4">
            {/* 进度环 */}
            <div className="flex justify-center">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="56"
                    cy="56"
                    r="48"
                    stroke="#1e293b"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="56"
                    cy="56"
                    r="48"
                    stroke="url(#progressGrad)"
                    strokeWidth="8"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${progress.coverageScore * 3.02} 302`}
                    className="transition-all duration-500"
                  />
                  <defs>
                    <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white">{progress.coverageScore}%</span>
                  <span className="text-[9px] text-slate-500">研究覆盖</span>
                </div>
              </div>
            </div>

            {/* 统计指标 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-center">
                <div className="text-2xl font-bold text-white">{progress.answeredQuestions}/{progress.totalQuestions}</div>
                <div className="text-[10px] text-slate-500">已探索/总节点</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-center">
                <div className="text-2xl font-bold text-emerald-400">{progress.knowledgeCards}</div>
                <div className="text-[10px] text-slate-500">知识卡片</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-center">
                <div className="text-2xl font-bold text-yellow-400">{progress.findings}</div>
                <div className="text-[10px] text-slate-500">研究发现</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-center">
                <div className="text-2xl font-bold text-purple-400">{progress.explorationDepth}</div>
                <div className="text-[10px] text-slate-500">探索深度</div>
              </div>
            </div>

            {/* 生成报告按钮 */}
            <button
              onClick={onGenerateReport}
              disabled={isGeneratingReport || progress.answeredQuestions === 0}
              className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                isGeneratingReport || progress.answeredQuestions === 0
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg'
              }`}
            >
              {isGeneratingReport ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  生成中...
                </>
              ) : (
                <>📄 生成研究报告</>
              )}
            </button>
          </div>
        )}

        {activeTab === 'cards' && (
          <div className="p-4">
            {/* 筛选器 */}
            <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
              {['all', 'fact', 'theory', 'insight', 'question', 'method'].map(filter => (
                <button
                  key={filter}
                  onClick={() => setCardFilter(filter)}
                  className={`px-3 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                    cardFilter === filter
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {filter === 'all' ? '全部' :
                   filter === 'fact' ? '事实' :
                   filter === 'theory' ? '理论' :
                   filter === 'insight' ? '洞察' :
                   filter === 'question' ? '问题' : '方法'}
                </button>
              ))}
            </div>

            {/* 卡片列表 */}
            <div className="space-y-2">
              {filteredCards.length === 0 ? (
                <div className="text-center py-8 text-slate-600 text-xs">暂无知识卡片</div>
              ) : (
                filteredCards.map(card => (
                  <div
                    key={card.id}
                    onClick={() => onCardClick?.(card)}
                    className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:bg-slate-700/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-xs font-medium text-slate-200">{card.title}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium ${
                        card.category === 'fact' ? 'bg-blue-900/50 text-blue-400' :
                        card.category === 'theory' ? 'bg-purple-900/50 text-purple-400' :
                        card.category === 'insight' ? 'bg-yellow-900/50 text-yellow-400' :
                        card.category === 'question' ? 'bg-orange-900/50 text-orange-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {card.category || '未分类'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{card.content}</p>
                    <div className="flex items-center gap-2 mt-2 text-[9px] text-slate-600">
                      <span>来源: {card.sourceNodeTitle}</span>
                      <span>·</span>
                      <span>可信度: {Math.round((card.confidence || 0) * 100)}%</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'findings' && (
          <div className="p-4">
            {/* 排序 */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setFindingSort('importance')}
                className={`px-3 py-1 rounded-full text-[10px] font-medium ${
                  findingSort === 'importance' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                按重要性
              </button>
              <button
                onClick={() => setFindingSort('time')}
                className={`px-3 py-1 rounded-full text-[10px] font-medium ${
                  findingSort === 'time' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                按时间
              </button>
            </div>

            {/* 发现列表 */}
            <div className="space-y-2">
              {sortedFindings.length === 0 ? (
                <div className="text-center py-8 text-slate-600 text-xs">暂无研究发现</div>
              ) : (
                sortedFindings.map(finding => (
                  <div
                    key={finding.id}
                    onClick={() => onFindingClick?.(finding)}
                    className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                      finding.significance === 'high'
                        ? 'bg-yellow-600/10 border-yellow-500/30 hover:bg-yellow-600/20'
                        : finding.significance === 'medium'
                          ? 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/20'
                          : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg">
                        {finding.type === 'discovery' ? '🔍' :
                         finding.type === 'contradiction' ? '⚡' :
                         finding.type === 'gap' ? '🕳️' : '🔗'}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-200">{finding.title || finding.insight.slice(0, 30)}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                            finding.significance === 'high' ? 'bg-yellow-600 text-white' :
                            finding.significance === 'medium' ? 'bg-blue-600 text-white' :
                            'bg-slate-600 text-slate-300'
                          }`}>
                            {finding.significance === 'high' ? '重要' :
                             finding.significance === 'medium' ? '一般' : '次要'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">{finding.description || finding.insight}</p>
                        <div className="text-[9px] text-slate-600 mt-1">
                          {finding.type === 'discovery' ? '新发现' :
                           finding.type === 'contradiction' ? '矛盾点' :
                           finding.type === 'gap' ? '知识空白' : '意外关联'}
                          · 来源: {finding.sourceNodeTitle}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResearchPanel;
