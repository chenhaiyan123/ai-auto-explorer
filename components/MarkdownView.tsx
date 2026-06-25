import React, { useMemo } from 'react';

/**
 * 轻量 Markdown 渲染器（零依赖）。
 * 支持：标题、粗体、斜体、行内代码、代码块、无序/有序列表、引用、链接、分隔线、[[wiki链接]]。
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// resolver(target) 返回 true 表示该 wikilink 已对应到一篇存在的笔记
const inline = (s: string, resolver?: (target: string) => boolean): string =>
  s
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-emerald-400 px-1 rounded text-[10px]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-slate-100">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
      const target = String(inner).split('|')[0].trim();
      const label = String(inner).includes('|') ? String(inner).split('|').slice(1).join('|').trim() : target;
      const exists = resolver ? resolver(target) : true;
      const cls = exists
        ? 'text-purple-400 border-b border-dotted border-purple-500/60 cursor-pointer hover:text-purple-300 hover:bg-purple-500/10 rounded-sm px-0.5'
        : 'text-slate-500 border-b border-dotted border-slate-600 cursor-pointer hover:text-purple-300 italic px-0.5';
      const attr = ` data-wikilink="${target.replace(/"/g, '&quot;')}" data-exists="${exists ? '1' : '0'}" title="${exists ? '打开关联笔记' : '点击创建并关联这篇笔记'}"`;
      return `<span class="${cls}"${attr}>${label}</span>`;
    })
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">$1</a>');

export const renderMarkdown = (md: string, resolver?: (target: string) => boolean, large = false): string => {
  const lines = escapeHtml(md).split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;

  // 大号（笔记阅读区）与默认（卡片/侧栏）两套排版尺寸
  const H = large
    ? ['text-2xl font-bold text-blue-200 mt-5 mb-2', 'text-xl font-bold text-blue-300 mt-5 mb-2', 'text-lg font-bold text-slate-200 mt-4 mb-1.5', 'text-base font-bold text-slate-300 mt-3 mb-1.5']
    : ['text-base font-bold text-blue-200 mt-3 mb-1', 'text-sm font-bold text-blue-300 mt-3 mb-1', 'text-xs font-bold text-slate-200 mt-2 mb-1', 'text-[11px] font-bold text-slate-300 mt-2 mb-1'];
  const PRE = large
    ? 'bg-black/50 border border-slate-700 rounded-lg p-3 text-[13px] text-emerald-400 font-mono overflow-x-auto my-3 leading-relaxed'
    : 'bg-black/50 border border-slate-700 rounded p-2 text-[10px] text-emerald-400 font-mono overflow-x-auto my-2';
  const P = large ? 'my-1.5 leading-7' : 'my-0.5';
  const UL = large ? 'list-disc pl-6 space-y-1 my-2' : 'list-disc pl-5 space-y-0.5 my-1';
  const OL = large ? 'list-decimal pl-6 space-y-1 my-2' : 'list-decimal pl-5 space-y-0.5 my-1';
  const BQ = large ? 'border-l-2 border-blue-500/50 pl-4 text-slate-400 italic my-2 leading-7' : 'border-l-2 border-blue-500/50 pl-3 text-slate-400 italic my-1';
  const HR = large ? 'border-slate-700 my-4' : 'border-slate-700 my-3';
  const SPACER = large ? '<div class="h-3"></div>' : '<div class="h-2"></div>';

  // 大号阅读区把每个标题做成可折叠的「框架」（原生 <details>，点标题折叠/展开）
  const fold = large;
  let openSection = false;
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      closeList();
      if (!inCode) { out.push(`<pre class="${PRE}">`); inCode = true; }
      else { out.push('</pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(raw); continue; }

    const line = raw;
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      if (fold) {
        if (openSection) out.push('</div></details>');
        out.push(`<details open class="border-l-2 border-slate-700/40 pl-3 my-2 rounded">`);
        out.push(`<summary class="${H[lvl - 1]} cursor-pointer select-none marker:text-slate-500 hover:text-blue-300">${inline(h[2], resolver)}</summary>`);
        out.push('<div class="pl-1">');
        openSection = true;
      } else {
        out.push(`<div class="${H[lvl - 1]}">${inline(h[2], resolver)}</div>`);
      }
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push(`<hr class="${HR}" />`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push(`<ul class="${UL}">`); listType = 'ul'; }
      out.push(`<li>${inline(ul[1], resolver)}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push(`<ol class="${OL}">`); listType = 'ol'; }
      out.push(`<li>${inline(ol[1], resolver)}</li>`);
      continue;
    }
    const bq = line.match(/^&gt;\s?(.*)/);
    if (bq) { closeList(); out.push(`<div class="${BQ}">${inline(bq[1], resolver)}</div>`); continue; }
    closeList();
    if (line.trim() === '') { out.push(SPACER); continue; }
    out.push(`<p class="${P}">${inline(line, resolver)}</p>`);
  }
  closeList();
  if (inCode) out.push('</pre>');
  if (openSection) out.push('</div></details>');
  return out.join('\n');
};

interface MarkdownViewProps {
  source: string;
  className?: string;
  /** 返回 true 表示该 [[标题]] 已存在对应笔记（用于区分已创建/未创建链接） */
  linkResolver?: (target: string) => boolean;
  /** 点击 [[标题]] 时触发，exists 表示该笔记当前是否已存在 */
  onWikiLink?: (target: string, exists: boolean) => void;
  /** 大号排版（用于中间笔记阅读区） */
  large?: boolean;
}

const MarkdownView: React.FC<MarkdownViewProps> = ({ source, className, linkResolver, onWikiLink, large }) => {
  const html = useMemo(() => renderMarkdown(source, linkResolver, large), [source, linkResolver, large]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onWikiLink) return;
    const el = (e.target as HTMLElement).closest('[data-wikilink]') as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    onWikiLink(el.getAttribute('data-wikilink') || '', el.getAttribute('data-exists') === '1');
  };

  return (
    <div
      className={`${large ? 'text-[15px]' : 'text-[11px]'} text-slate-300 leading-relaxed break-words ${className || ''}`}
      onClick={onWikiLink ? handleClick : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownView;
