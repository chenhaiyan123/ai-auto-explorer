import React, { useMemo } from 'react';
import { renderMarkdown } from '../services/markdown';

// 渲染逻辑在 services/markdown.ts（纯函数、可单测），这里只负责挂到 DOM 上
export { renderMarkdown };

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  const html = useMemo(() => {
    try {
      return renderMarkdown(source, linkResolver, large);
    } catch (e) {
      console.error('[MarkdownView] 渲染失败，回退为纯文本', e);
      return `<pre style="white-space:pre-wrap">${escapeHtml(source || '')}</pre>`;
    }
  }, [source, linkResolver, large]);

  return (
    <div
      className={
        // 首个块去掉上外边距，免得正文顶部空一大块；
        // 长英文/URL 才断词，中文按正常规则排（break-all 会把中文断得很难看）
        `${large ? 'text-[15px]' : 'text-[11px]'} text-slate-300 ` +
        '[overflow-wrap:anywhere] [&>*:first-child]:!mt-0 [&_details>div>*:first-child]:!mt-0 ' +
        `${className || ''}`
      }
      onClick={onWikiLink ? (e => {
        const el = (e.target as HTMLElement).closest('[data-wikilink]') as HTMLElement | null;
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        onWikiLink(el.getAttribute('data-wikilink') || '', el.getAttribute('data-exists') === '1');
      }) : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownView;
