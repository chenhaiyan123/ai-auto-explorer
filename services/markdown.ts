/**
 * 轻量 Markdown 渲染器（零依赖，纯函数，可单测）。
 *
 * 支持：标题、粗体、斜体、删除线、行内代码、代码块、无序/有序/嵌套列表、
 * 任务列表、引用、表格、链接、分隔线、[[wiki链接]]。
 *
 * 排版上专门为中文笔记做了几件事：
 * 1. **连续多行合并成一个段落**——按 Markdown 规范，段落内的换行是软换行。
 *    之前一行一个 <p>，长笔记会变成一堆等间距的碎行，读起来就是"挤在一起"。
 * 2. **中文之间不插空格**，中英之间才插——直接 join(' ') 会在中文里塞进多余空格。
 * 3. **空行不再产生占位 div**，纵向节奏完全交给 margin，避免间距忽大忽小。
 * 4. 行距按中文调到 1.9 左右；标题上间距明显大于下间距，让层级一眼看出来。
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 中日韩字符（含全角标点）：用来决定软换行处要不要补空格 */
const CJK = /[⺀-鿿　-〿＀-￯]/;

/**
 * 把段落内的多行拼成一行。
 * 中文↔中文不加空格；涉及英文/数字的两侧加一个空格（符合 Markdown 软换行语义）。
 */
export function joinSoftLines(lines: string[]): string {
  return lines.reduce((acc, cur, i) => {
    if (i === 0) return cur;
    const a = acc.slice(-1);
    const b = cur.slice(0, 1);
    const glue = CJK.test(a) && CJK.test(b) ? '' : ' ';
    return acc + glue + cur;
  }, '');
}

// resolver(target) 返回 true 表示该 wikilink 已对应到一篇存在的笔记
const inline = (s: string, resolver?: (target: string) => boolean): string =>
  s
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-emerald-400 px-1.5 py-0.5 rounded mx-0.5 text-[0.9em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-slate-100">$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del class="text-slate-500">$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em class="text-slate-200">$2</em>')
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
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline underline-offset-2 hover:text-blue-300">$1</a>');

/** 两套排版尺寸：大号=笔记阅读区，小号=侧栏/聊天气泡 */
const theme = (large: boolean) => ({
  // 标题：上间距明显大于下间距，层级才立得住
  H: large
    ? [
      'text-[26px] font-bold text-blue-200 mt-9 mb-3 pb-2 border-b border-slate-700/50 leading-snug',
      'text-[20px] font-bold text-blue-300 mt-8 mb-3 leading-snug',
      'text-[17px] font-bold text-slate-200 mt-6 mb-2 leading-snug',
      'text-[15px] font-bold text-slate-300 mt-5 mb-2 leading-snug',
    ]
    : [
      'text-[15px] font-bold text-blue-200 mt-5 mb-2 leading-snug',
      'text-[13px] font-bold text-blue-300 mt-4 mb-1.5 leading-snug',
      'text-[12px] font-bold text-slate-200 mt-3 mb-1.5 leading-snug',
      'text-[11px] font-bold text-slate-300 mt-3 mb-1 leading-snug',
    ],
  P: large ? 'my-4 leading-[1.9]' : 'my-2.5 leading-[1.75]',
  UL: large ? 'list-disc pl-6 my-4 space-y-2 marker:text-slate-500' : 'list-disc pl-5 my-2.5 space-y-1.5 marker:text-slate-600',
  OL: large ? 'list-decimal pl-6 my-4 space-y-2 marker:text-slate-500' : 'list-decimal pl-5 my-2.5 space-y-1.5 marker:text-slate-600',
  LI: large ? 'leading-[1.85] pl-1' : 'leading-[1.7]',
  BQ: large
    ? 'border-l-[3px] border-blue-500/50 bg-blue-500/5 pl-4 pr-3 py-2 my-4 text-slate-400 rounded-r leading-[1.9]'
    : 'border-l-2 border-blue-500/50 pl-3 py-1 my-2.5 text-slate-400 leading-[1.7]',
  PRE: large
    ? 'bg-black/50 border border-slate-700 rounded-lg p-4 my-4 text-[13px] text-emerald-400 font-mono overflow-x-auto leading-[1.7]'
    : 'bg-black/50 border border-slate-700 rounded p-2.5 my-2.5 text-[10px] text-emerald-400 font-mono overflow-x-auto leading-[1.6]',
  HR: large ? 'border-slate-700 my-8' : 'border-slate-700 my-4',
  TABLE_WRAP: large ? 'my-5 overflow-x-auto rounded-lg border border-slate-700' : 'my-3 overflow-x-auto rounded border border-slate-700',
  TABLE: large ? 'w-full text-[14px] border-collapse' : 'w-full text-[11px] border-collapse',
  TH: large
    ? 'bg-slate-800/70 px-4 py-2.5 text-left font-bold text-slate-200 border-b border-slate-700 whitespace-nowrap'
    : 'bg-slate-800/70 px-2.5 py-1.5 text-left font-bold text-slate-200 border-b border-slate-700 whitespace-nowrap',
  TD: large
    ? 'px-4 py-2.5 border-b border-slate-800 text-slate-300 align-top leading-[1.8]'
    : 'px-2.5 py-1.5 border-b border-slate-800 text-slate-300 align-top',
  TASK: 'mr-1.5 align-[-1px] accent-emerald-500',
});

const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
const isTableSep = (s: string) => /^\s*\|[\s:|-]+\|\s*$/.test(s) && s.includes('-');
const splitRow = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export const renderMarkdown = (md: string, resolver?: (target: string) => boolean, large = false): string => {
  const T = theme(large);
  const lines = escapeHtml(md ?? '').split('\n');
  const out: string[] = [];

  // 段落缓冲：连续非空行合并成一个 <p>
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p class="${T.P}">${inline(joinSoftLines(para), resolver)}</p>`);
    para = [];
  };

  // 列表栈：按缩进支持嵌套
  type Lvl = { type: 'ul' | 'ol'; indent: number };
  const stack: Lvl[] = [];
  const closeLists = (toIndent = -1) => {
    while (stack.length && stack[stack.length - 1].indent > toIndent) {
      out.push(`</${stack.pop()!.type}>`);
    }
  };

  // 大号阅读区把标题做成可折叠区块（原生 <details>，点标题折叠/展开）
  const fold = large;
  let openSection = false;
  const closeSection = () => {
    if (openSection) { out.push('</div></details>'); openSection = false; }
  };

  let inCode = false;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];

    // ---- 代码块 ----
    if (raw.trim().startsWith('```')) {
      if (!inCode) { flushPara(); closeLists(); out.push(`<pre class="${T.PRE}">`); inCode = true; }
      else { out.push('</pre>'); inCode = false; }
      i++; continue;
    }
    if (inCode) { out.push(raw); i++; continue; }

    // ---- 空行：段落分隔（不再产生占位 div，节奏交给 margin）----
    if (raw.trim() === '') { flushPara(); i++; continue; }

    // ---- 表格 ----
    if (isTableRow(raw) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara(); closeLists();
      const head = splitRow(raw);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(`<div class="${T.TABLE_WRAP}"><table class="${T.TABLE}"><thead><tr>`);
      head.forEach(c => out.push(`<th class="${T.TH}">${inline(c, resolver)}</th>`));
      out.push('</tr></thead><tbody>');
      rows.forEach(r => {
        out.push('<tr>');
        head.forEach((_, ci) => out.push(`<td class="${T.TD}">${inline(r[ci] ?? '', resolver)}</td>`));
        out.push('</tr>');
      });
      out.push('</tbody></table></div>');
      continue;
    }

    // ---- 标题 ----
    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara(); closeLists();
      const lvl = h[1].length;
      if (fold) {
        closeSection();
        out.push('<details open class="my-1 border-l-2 border-slate-700/40 pl-4">');
        out.push(`<summary class="${T.H[lvl - 1]} cursor-pointer select-none marker:text-slate-600 hover:text-blue-300">${inline(h[2], resolver)}</summary>`);
        out.push('<div>');
        openSection = true;
      } else {
        out.push(`<div class="${T.H[lvl - 1]}">${inline(h[2], resolver)}</div>`);
      }
      i++; continue;
    }

    // ---- 分隔线 ----
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flushPara(); closeLists();
      out.push(`<hr class="${T.HR}" />`);
      i++; continue;
    }

    // ---- 列表（支持缩进嵌套 + 任务列表）----
    const li = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    if (li) {
      flushPara();
      const indent = li[1].replace(/\t/g, '  ').length;
      const type: 'ul' | 'ol' = /^\d/.test(li[2]) ? 'ol' : 'ul';
      let body = li[3];

      // 同层但类型变了（无序换有序）：关掉重开
      const top = stack[stack.length - 1];
      if (top && top.indent === indent && top.type !== type) {
        out.push(`</${stack.pop()!.type}>`);
      } else {
        closeLists(indent);
      }
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        out.push(`<${type} class="${type === 'ul' ? T.UL : T.OL}">`);
        stack.push({ type, indent });
      }

      // 任务列表 - [ ] / - [x]
      const task = body.match(/^\[([ xX])\]\s+(.*)/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        body = `<input type="checkbox" disabled ${checked ? 'checked' : ''} class="${T.TASK}" />` +
          `<span class="${checked ? 'text-slate-500 line-through' : ''}">${inline(task[2], resolver)}</span>`;
        out.push(`<li class="${T.LI} list-none -ml-5">${body}</li>`);
      } else {
        out.push(`<li class="${T.LI}">${inline(body, resolver)}</li>`);
      }
      i++; continue;
    }

    // ---- 引用 ----
    const bq = raw.match(/^\s*&gt;\s?(.*)/);
    if (bq) {
      flushPara(); closeLists();
      // 连续的引用行合并成一段，不要一行一个框
      const buf = [bq[1]];
      i++;
      while (i < lines.length) {
        const m = lines[i].match(/^\s*&gt;\s?(.*)/);
        if (!m) break;
        buf.push(m[1]); i++;
      }
      out.push(`<div class="${T.BQ}">${inline(joinSoftLines(buf.filter(Boolean)), resolver)}</div>`);
      continue;
    }

    // ---- 普通正文：先攒着，等空行/其它块再合并输出 ----
    closeLists();
    para.push(raw.trim());
    i++;
  }

  flushPara();
  closeLists();
  if (inCode) out.push('</pre>');
  closeSection();
  return out.join('\n');
};
