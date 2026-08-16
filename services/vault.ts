import { ProblemNode, LAYER_LABEL } from '../types';

/**
 * 本地 Markdown 库（Vault）工具：把笔记节点与 .md 文件互相转换，
 * 支持单篇导出、整库 .zip 导出（保留文件夹结构）、.md 导入，
 * 以及（受支持的浏览器中）直接保存到本地文件夹。
 * 纯前端、零依赖。
 */

// ---------- 文件名 / 路径 ----------
const sanitize = (s: string): string =>
  (s || '未命名').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名';

/** 节点 → 带 YAML frontmatter 的 Markdown 文本 */
export const noteToMarkdown = (n: ProblemNode): string => {
  const fm: string[] = ['---'];
  fm.push(`title: ${JSON.stringify(n.title || '未命名')}`);
  if (n.folder) fm.push(`folder: ${JSON.stringify(n.folder)}`);
  if (n.tags && n.tags.length) fm.push(`tags: [${n.tags.map(t => JSON.stringify(t)).join(', ')}]`);
  if (n.status) fm.push(`status: ${n.status}`);
  if (n.noteUpdatedAt) fm.push(`updated: ${new Date(n.noteUpdatedAt).toISOString()}`);
  fm.push('---', '');
  const body = (n.fullNote && n.fullNote.trim()) ? n.fullNote : (n.notes || '');
  // 假设与证据写进**正文**而不是 frontmatter：
  // 导出到 Obsidian 后，最重要的东西必须能直接看见，塞进 frontmatter 就被折叠了。
  return fm.join('\n') + body + hypothesisSection(n) + '\n';
};

/** 把「当前赌注」渲染成一段 Markdown，附在正文末尾 */
export const hypothesisSection = (n: ProblemNode): string => {
  const h = n.hypothesis;
  if (!h || !h.statement) return '';
  const belief = h.belief === 'high' ? '高' : h.belief === 'low' ? '低' : '中';
  const lines = ['', '', '## 🎯 当前赌注', '', `> ${h.statement}`, '', `- 信念：${belief}`];
  if (h.unknown) lines.push(`- 最大未知量：${h.unknown}`);
  if (n.validationReason) lines.push(`- 待验证原因：${n.validationReason}`);
  if (h.evidence && h.evidence.length) {
    lines.push('', '### 证据', '');
    for (const e of h.evidence) {
      const mark = e.stance === 'refute' ? '✗' : '✓';
      const from = e.origin === 'ai' ? 'AI 推理' : e.origin === 'probe' ? '探针' : '人工';
      lines.push(`- ${mark} \`${LAYER_LABEL[e.layer]}\` ${e.claim}${e.source ? ` —— ${e.source}` : ''}（${from}）`);
    }
  }
  return lines.join('\n');
};

/** 节点 → 在库中的相对路径，如 "研究方向/材料/某问题.md" */
export const notePath = (n: ProblemNode): string => {
  const dir = (n.folder || '').split('/').map(s => sanitize(s)).filter(Boolean).join('/');
  const file = `${sanitize(n.title)}.md`;
  return dir ? `${dir}/${file}` : file;
};

export interface ParsedNote { title: string; folder?: string; tags?: string[]; body: string; }

/** 解析一段 Markdown（含可选 frontmatter）为笔记字段 */
export const parseMarkdown = (text: string, filename = ''): ParsedNote => {
  let title = filename.replace(/\.md$/i, '').split('/').pop() || '未命名';
  let folder: string | undefined;
  let tags: string[] | undefined;
  let body = text;

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    body = text.slice(fmMatch[0].length);
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1]; let val = m[2].trim();
      if (key === 'title') { try { title = JSON.parse(val); } catch { title = val.replace(/^["']|["']$/g, ''); } }
      else if (key === 'folder') { try { folder = JSON.parse(val); } catch { folder = val.replace(/^["']|["']$/g, ''); } }
      else if (key === 'tags') {
        const inner = val.replace(/^\[|\]$/g, '');
        tags = inner.split(',').map(s => { try { return JSON.parse(s.trim()); } catch { return s.trim().replace(/^["']|["']$/g, ''); } }).filter(Boolean);
      }
    }
  }
  // 若文件名带路径而 frontmatter 无 folder，则用路径推断文件夹
  if (!folder && filename.includes('/')) {
    const dir = filename.replace(/\.md$/i, '').split('/').slice(0, -1).join('/');
    if (dir) folder = dir;
  }
  return { title, folder, tags, body: body.replace(/^\n+/, '') };
};

// ---------- 浏览器下载 ----------
const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** 导出单篇笔记为 .md 文件 */
export const downloadNoteMd = (n: ProblemNode) => {
  triggerDownload(new Blob([noteToMarkdown(n)], { type: 'text/markdown;charset=utf-8' }), `${sanitize(n.title)}.md`);
};

// ---------- 极简 ZIP 编码器（store，无压缩，零依赖） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

interface ZipFile { name: string; data: Uint8Array; crc: number; offset: number; }

/** 把 {path, content} 列表打包成 store 模式的 zip Blob */
export const zipStore = (files: { path: string; content: string }[]): Blob => {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: ZipFile[] = [];
  let offset = 0;

  const pushU16 = (arr: number[], v: number) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF); };
  const pushU32 = (arr: number[], v: number) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); };

  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const h: number[] = [];
    pushU32(h, 0x04034b50); pushU16(h, 20); pushU16(h, 0x0800); pushU16(h, 0); // sig,ver,flag(utf8),method=store
    pushU16(h, 0); pushU16(h, 0);            // mod time/date
    pushU32(h, crc); pushU32(h, data.length); pushU32(h, data.length); // crc, comp, uncomp
    pushU16(h, nameBytes.length); pushU16(h, 0); // name len, extra len
    const header = new Uint8Array(h);
    entries.push({ name: f.path, data, crc, offset });
    chunks.push(header, nameBytes, data);
    offset += header.length + nameBytes.length + data.length;
  }

  const central: number[] = [];
  const centralStart = offset;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    pushU32(central, 0x02014b50); pushU16(central, 20); pushU16(central, 20); pushU16(central, 0x0800); pushU16(central, 0);
    pushU16(central, 0); pushU16(central, 0);
    pushU32(central, e.crc); pushU32(central, e.data.length); pushU32(central, e.data.length);
    pushU16(central, nameBytes.length); pushU16(central, 0); pushU16(central, 0); // name, extra, comment len
    pushU16(central, 0); pushU16(central, 0); pushU32(central, 0); // disk, internal attr, external attr
    pushU32(central, e.offset);
    for (let i = 0; i < nameBytes.length; i++) central.push(nameBytes[i]);
  }
  const centralBytes = new Uint8Array(central);
  offset += centralBytes.length;

  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50); pushU16(eocd, 0); pushU16(eocd, 0);
  pushU16(eocd, entries.length); pushU16(eocd, entries.length);
  pushU32(eocd, centralBytes.length); pushU32(eocd, centralStart); pushU16(eocd, 0);

  chunks.push(centralBytes, new Uint8Array(eocd));
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
};

/** 导出整库为 .zip（保留文件夹结构）。rootDir 指定顶层文件夹（通常=项目名，即「文件夹代表一个项目」） */
export const exportVaultZip = (nodes: ProblemNode[], vaultName = 'AI-Explorer-Vault', rootDir?: string) => {
  const root = rootDir ? sanitize(rootDir) + '/' : '';
  const used = new Map<string, number>();
  const files = nodes.map(n => {
    let path = root + notePath(n);
    // 防重名
    const count = used.get(path) || 0;
    used.set(path, count + 1);
    if (count > 0) path = path.replace(/\.md$/, `_${count}.md`);
    return { path, content: noteToMarkdown(n) };
  });
  triggerDownload(zipStore(files), `${vaultName}.zip`);
};

// ---------- .md 导入 ----------
/** 打开文件选择器，读取一个或多个 .md，返回解析后的笔记 */
export const importMarkdownFiles = (): Promise<ParsedNote[]> => new Promise((resolve) => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.md,text/markdown,.markdown,.txt'; input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    const parsed: ParsedNote[] = [];
    for (const file of files) {
      const text = await file.text();
      parsed.push(parseMarkdown(text, file.name));
    }
    resolve(parsed);
  };
  input.click();
});

// ---------- File System Access：保存到本地文件夹 ----------
export const supportsDirectoryPicker = (): boolean =>
  typeof (window as any).showDirectoryPicker === 'function';

/**
 * 把所有笔记写入用户选择的本地文件夹（保留子文件夹）。
 * 仅在支持 File System Access API 的浏览器（Chrome/Edge）可用。
 */
export const saveVaultToDirectory = async (nodes: ProblemNode[]): Promise<number> => {
  const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  const ensureDir = async (root: any, segs: string[]) => {
    let cur = root;
    for (const seg of segs) cur = await cur.getDirectoryHandle(sanitize(seg), { create: true });
    return cur;
  };
  let count = 0;
  const used = new Set<string>();
  for (const n of nodes) {
    const segs = (n.folder || '').split('/').map(s => s.trim()).filter(Boolean);
    const dir = segs.length ? await ensureDir(dirHandle, segs) : dirHandle;
    let fname = `${sanitize(n.title)}.md`;
    const key = `${segs.join('/')}/${fname}`;
    let i = 1; let unique = key;
    while (used.has(unique)) { fname = `${sanitize(n.title)}_${i}.md`; unique = `${segs.join('/')}/${fname}`; i++; }
    used.add(unique);
    const fileHandle = await dir.getFileHandle(fname, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(noteToMarkdown(n));
    await writable.close();
    count++;
  }
  return count;
};
