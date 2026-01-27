/**
 * 意图确认弹窗组件
 * 
 * 在用户输入问题后显示，让用户确认探索模式（研究/构建）
 */

import React, { useState, useEffect } from 'react';
import { IntentAnalysis, ExplorationMode, generateConfirmationData } from '../services/intentService';

interface IntentConfirmModalProps {
  analysis: IntentAnalysis;
  onConfirm: (mode: ExplorationMode, analysis: IntentAnalysis) => void;
  onCancel: () => void;
}

const IntentConfirmModal: React.FC<IntentConfirmModalProps> = ({
  analysis,
  onConfirm,
  onCancel,
}) => {
  const [selectedMode, setSelectedMode] = useState<ExplorationMode>(analysis.mode);
  const [isAnimating, setIsAnimating] = useState(true);
  
  const confirmData = generateConfirmationData(analysis);
  
  useEffect(() => {
    // 入场动画
    const timer = setTimeout(() => setIsAnimating(false), 100);
    return () => clearTimeout(timer);
  }, []);
  
  const handleConfirm = () => {
    onConfirm(selectedMode, analysis);
  };
  
  // 根据选择的模式获取详情
  const getSelectedDetails = () => {
    if (selectedMode === 'research') {
      return {
        icon: '🔬',
        label: '研究模式',
        color: 'blue',
        description: '深度探索，理解问题本质',
        outputs: ['研究报告', '知识图谱', '发现日志', '关联分析'],
        focus: analysis.researchFocus,
      };
    } else {
      return {
        icon: '🔧',
        label: '构建模式',
        color: 'emerald',
        description: '迭代开发，造出可用的东西',
        outputs: ['可运行 Demo', '设计文档', '技术方案', '迭代计划'],
        spec: analysis.buildSpec,
      };
    }
  };
  
  const details = getSelectedDetails();
  const colorClass = details.color === 'blue' ? {
    bg: 'bg-blue-600',
    bgLight: 'bg-blue-600/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    hover: 'hover:bg-blue-600/20',
    ring: 'ring-blue-500',
  } : {
    bg: 'bg-emerald-600',
    bgLight: 'bg-emerald-600/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    hover: 'hover:bg-emerald-600/20',
    ring: 'ring-emerald-500',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div 
        className={`bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-8 shadow-2xl transition-all duration-300 ${
          isAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      >
        {/* 头部 */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">{details.icon}</div>
          <h2 className="text-2xl font-bold text-white mb-2">选择探索模式</h2>
          <p className="text-slate-400 text-sm">
            AI 检测到你的问题偏向 <span className={colorClass.text}>{confirmData.modeDetails.label}</span>
            {analysis.confidence >= 0.7 && <span className="text-slate-500">（置信度 {(analysis.confidence * 100).toFixed(0)}%）</span>}
          </p>
        </div>
        
        {/* 问题预览 */}
        <div className="bg-slate-800/50 rounded-xl p-4 mb-6 border border-slate-700">
          <div className="text-[10px] uppercase text-slate-500 font-bold mb-2">你的问题</div>
          <div className="text-white font-medium">{analysis.suggestedTitle}</div>
          {analysis.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {analysis.keywords.map((kw, i) => (
                <span key={i} className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
        
        {/* 模式选择卡片 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* 研究模式 */}
          <button
            onClick={() => setSelectedMode('research')}
            className={`p-5 rounded-2xl border-2 transition-all text-left ${
              selectedMode === 'research'
                ? 'border-blue-500 bg-blue-600/10 ring-2 ring-blue-500/30'
                : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">🔬</span>
              <div>
                <div className={`font-bold ${selectedMode === 'research' ? 'text-blue-400' : 'text-white'}`}>
                  研究模式
                </div>
                <div className="text-[10px] text-slate-500">好奇心驱动</div>
              </div>
              {analysis.mode === 'research' && (
                <span className="ml-auto text-[9px] bg-blue-600/30 text-blue-400 px-2 py-0.5 rounded-full">
                  推荐
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-3">
              深度探索，理解问题本质，持续积累知识
            </p>
            <div className="flex flex-wrap gap-1">
              {['研究报告', '知识图谱', '发现日志'].map(output => (
                <span key={output} className="text-[9px] bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded">
                  {output}
                </span>
              ))}
            </div>
          </button>
          
          {/* 构建模式 */}
          <button
            onClick={() => setSelectedMode('build')}
            className={`p-5 rounded-2xl border-2 transition-all text-left ${
              selectedMode === 'build'
                ? 'border-emerald-500 bg-emerald-600/10 ring-2 ring-emerald-500/30'
                : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">🔧</span>
              <div>
                <div className={`font-bold ${selectedMode === 'build' ? 'text-emerald-400' : 'text-white'}`}>
                  构建模式
                </div>
                <div className="text-[10px] text-slate-500">想象力驱动</div>
              </div>
              {analysis.mode === 'build' && (
                <span className="ml-auto text-[9px] bg-emerald-600/30 text-emerald-400 px-2 py-0.5 rounded-full">
                  推荐
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-3">
              迭代开发，造出可用的东西，交付实际产品
            </p>
            <div className="flex flex-wrap gap-1">
              {['可运行Demo', '设计文档', '技术方案'].map(output => (
                <span key={output} className="text-[9px] bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded">
                  {output}
                </span>
              ))}
            </div>
          </button>
        </div>
        
        {/* 选中模式的详情预览 */}
        <div className={`rounded-xl p-5 mb-6 border ${colorClass.bgLight} ${colorClass.border}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{details.icon}</span>
            <span className={`font-bold ${colorClass.text}`}>{details.label}详情</span>
          </div>
          
          {selectedMode === 'research' && analysis.researchFocus && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">核心研究问题</div>
                <div className="text-sm text-white">{analysis.researchFocus.mainQuestion}</div>
              </div>
              {analysis.researchFocus.subQuestions.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">初步子问题</div>
                  <ul className="text-xs text-slate-400 space-y-1">
                    {analysis.researchFocus.subQuestions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-blue-500">•</span>
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.researchFocus.knowledgeDomains.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">涉及领域</div>
                  <div className="flex flex-wrap gap-1">
                    {analysis.researchFocus.knowledgeDomains.map((d, i) => (
                      <span key={i} className="text-[10px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {selectedMode === 'build' && analysis.buildSpec && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">目标产品</div>
                <div className="text-sm text-white">{analysis.buildSpec.targetProduct}</div>
              </div>
              {analysis.buildSpec.coreFeatures.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">核心功能</div>
                  <ul className="text-xs text-slate-400 space-y-1">
                    {analysis.buildSpec.coreFeatures.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-500">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.buildSpec.possibleTechStack.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">可能的技术栈</div>
                  <div className="flex flex-wrap gap-1">
                    {analysis.buildSpec.possibleTechStack.map((t, i) => (
                      <span key={i} className="text-[10px] bg-emerald-600/20 text-emerald-400 px-2 py-0.5 rounded-full">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.buildSpec.mvpScope && (
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">MVP 范围</div>
                  <div className="text-xs text-slate-400">{analysis.buildSpec.mvpScope}</div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* AI 判断理由 */}
        {analysis.reasoning && (
          <div className="text-center mb-6">
            <span className="text-[10px] text-slate-500">
              💡 AI 判断理由：{analysis.reasoning}
            </span>
          </div>
        )}
        
        {/* 操作按钮 */}
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition-all border border-slate-700"
          >
            返回修改
          </button>
          <button
            onClick={handleConfirm}
            className={`flex-[2] py-4 ${colorClass.bg} hover:opacity-90 text-white font-bold rounded-xl transition-all shadow-lg`}
          >
            确认，开始{selectedMode === 'research' ? '研究探索' : '构建开发'} →
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntentConfirmModal;
