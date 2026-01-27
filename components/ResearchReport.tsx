/**
 * 研究报告展示组件
 * 
 * 展示研究模式生成的最终报告
 * 支持导出、分享等功能
 */

import React, { useState } from 'react';

interface ResearchReportProps {
  report: {
    title: string;
    abstract: string;
    sections: { title: string; content: string }[];
    conclusions: string[];
    openQuestions: string[];
    references: string[];
  };
  onClose: () => void;
  onExport?: () => void;
}

const ResearchReport: React.FC<ResearchReportProps> = ({
  report,
  onClose,
  onExport
}) => {
  const [activeSection, setActiveSection] = useState<number>(0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 sm:p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <header className="p-6 border-b border-slate-800 bg-gradient-to-r from-blue-900/30 to-purple-900/30">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">📄</span>
                <span className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">研究报告</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">{report.title}</h1>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </header>

        {/* 内容区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧导航 */}
          <nav className="w-48 border-r border-slate-800 p-4 overflow-y-auto scroll-hide hidden sm:block">
            <div className="space-y-1">
              <button
                onClick={() => setActiveSection(0)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeSection === 0 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                📝 摘要
              </button>
              {report.sections.map((section, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveSection(idx + 1)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    activeSection === idx + 1 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {section.title}
                </button>
              ))}
              <button
                onClick={() => setActiveSection(report.sections.length + 1)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeSection === report.sections.length + 1 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                🎯 结论
              </button>
              <button
                onClick={() => setActiveSection(report.sections.length + 2)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeSection === report.sections.length + 2 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                ❓ 开放问题
              </button>
            </div>
          </nav>

          {/* 右侧内容 */}
          <main className="flex-1 p-6 overflow-y-auto scroll-hide">
            {/* 摘要 */}
            {activeSection === 0 && (
              <div className="prose prose-invert max-w-none">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <span>📝</span> 摘要
                </h2>
                <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
                  <p className="text-slate-300 text-sm leading-relaxed">{report.abstract}</p>
                </div>
                
                {/* 快速导航卡片 */}
                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div className="bg-emerald-900/20 rounded-xl p-4 border border-emerald-800/50">
                    <div className="text-emerald-400 font-bold text-sm mb-1">🎯 核心结论</div>
                    <div className="text-3xl font-bold text-white">{report.conclusions.length}</div>
                  </div>
                  <div className="bg-orange-900/20 rounded-xl p-4 border border-orange-800/50">
                    <div className="text-orange-400 font-bold text-sm mb-1">❓ 开放问题</div>
                    <div className="text-3xl font-bold text-white">{report.openQuestions.length}</div>
                  </div>
                </div>
              </div>
            )}

            {/* 章节内容 */}
            {activeSection > 0 && activeSection <= report.sections.length && (
              <div className="prose prose-invert max-w-none">
                <h2 className="text-lg font-bold text-white mb-4">
                  {report.sections[activeSection - 1].title}
                </h2>
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {report.sections[activeSection - 1].content}
                </div>
              </div>
            )}

            {/* 结论 */}
            {activeSection === report.sections.length + 1 && (
              <div className="prose prose-invert max-w-none">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <span>🎯</span> 核心结论
                </h2>
                <div className="space-y-3">
                  {report.conclusions.map((conclusion, idx) => (
                    <div 
                      key={idx} 
                      className="flex gap-3 p-4 bg-emerald-900/20 rounded-xl border border-emerald-800/50"
                    >
                      <span className="w-6 h-6 bg-emerald-600 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                      <p className="text-slate-300 text-sm">{conclusion}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 开放问题 */}
            {activeSection === report.sections.length + 2 && (
              <div className="prose prose-invert max-w-none">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <span>❓</span> 值得进一步研究的问题
                </h2>
                <div className="space-y-3">
                  {report.openQuestions.length === 0 ? (
                    <p className="text-slate-500 text-sm">暂无开放问题</p>
                  ) : (
                    report.openQuestions.map((question, idx) => (
                      <div 
                        key={idx} 
                        className="flex gap-3 p-4 bg-orange-900/20 rounded-xl border border-orange-800/50"
                      >
                        <span className="text-orange-400 text-lg">•</span>
                        <p className="text-slate-300 text-sm">{question}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* 参考来源 */}
                {report.references.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-sm font-bold text-slate-400 mb-3">📚 参考来源</h3>
                    <ul className="text-xs text-slate-500 space-y-1">
                      {report.references.map((ref, idx) => (
                        <li key={idx}>[{idx + 1}] {ref}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* 底部操作栏 */}
        <footer className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="text-xs text-slate-500">
            报告生成时间: {new Date().toLocaleString('zh-CN')}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const text = `# ${report.title}\n\n## 摘要\n${report.abstract}\n\n${
                  report.sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n')
                }\n\n## 结论\n${report.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n## 开放问题\n${
                  report.openQuestions.map(q => `- ${q}`).join('\n')
                }`;
                navigator.clipboard.writeText(text);
                alert('已复制到剪贴板');
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-all"
            >
              📋 复制文本
            </button>
            {onExport && (
              <button
                onClick={onExport}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-all"
              >
                📥 导出报告
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ResearchReport;
