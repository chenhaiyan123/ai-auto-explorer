import React, { useMemo } from 'react';

/**
 * 轻量 Markdown 渲染器（零依赖）。
 * 支持：标题、粗体、斜体、行内代码、代码块、无序/有序列表、引用、链接、分隔线、[[wiki链接]]。
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (s: string): string =>
  s
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-emerald-400 px-1 rounded text-[10px]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-slate-100">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="text-purple-400 border-b border-dotted border-purple-500/50" data-wikilink="$1">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">$1</a>');

export const renderMarkdown = (md: string): string => {
  const lines = escapeHtml(md).split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      closeList();
      if (!inCode) { out.push('<pre class="bg-black/50 border border-slate-700 rounded p-2 text-[10px] text-emerald-400 font-mono overflow-x-auto my-2">'); inCode = true; }
      else { out.push('</pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(raw); continue; }

    const line = raw;
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      const sizes = ['text-base font-bold text-blue-200 mt-3 mb-1', 'text-sm font-bold text-blue-300 mt-3 mb-1', 'text-xs font-bold text-slate-200 mt-2 mb-1', 'text-[11px] font-bold text-slate-300 mt-2 mb-1'];
      out.push(`<div class="${sizes[lvl - 1]}">${inline(h[2])}</div>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr class="border-slate-700 my-3" />'); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul class="list-disc pl-5 space-y-0.5 my-1">'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol class="list-decimal pl-5 space-y-0.5 my-1">'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    const bq = line.match(/^&gt;\s?(.*)/);
    if (bq) { closeList(); out.push(`<div class="border-l-2 border-blue-500/50 pl-3 text-slate-400 italic my-1">${inline(bq[1])}</div>`); continue; }
    closeList();
    if (line.trim() === '') { out.push('<div class="h-2"></div>'); continue; }
    out.push(`<p class="my-0.5">${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</pre>');
  return out.join('\n');
};

const MarkdownView: React.FC<{ source: string; className?: string }> = ({ source, className }) => {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className={`text-[11px] text-slate-300 leading-relaxed break-words ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownView;
