import { SHARED_API } from './sharedModelsClient';

/**
 * Python 沙箱：AI 写的 Python 在用户自己的浏览器里跑（Pyodide / WebAssembly，Web Worker 里隔离）。
 * - 不占服务器、不花钱；跑满 60 秒自动掐断；
 * - 能用 numpy / pandas / matplotlib / scipy / statsmodels / scikit-learn / sympy / networkx / openpyxl；
 * - 用户上传的数据文件放在 /data/ 下；画的图自动收集成 PNG。
 * Pyodide 文件从我们自己的服务器镜像取（国内直连 jsdelivr 太慢）。
 */
export const PYODIDE_VERSION = '0.27.7';
export const pyBase = () => {
  const env = (import.meta as any).env?.VITE_PYODIDE_URL as string | undefined;
  if (env) return env.endsWith('/') ? env : env + '/';
  return SHARED_API ? `${SHARED_API.replace(/\/+$/, '')}/py/v${PYODIDE_VERSION}/` : `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
};

export interface PyFile { name: string; bytes: Uint8Array }
export interface PyResult { ok: boolean; stdout: string; error?: string; images: string[]; ms: number; files?: string[] }

const MAX_OUT = 6000;
export const clipOut = (s: string, n = MAX_OUT) => (s.length > n ? s.slice(0, n / 2) + `\n…（中间省略 ${s.length - n} 字）…\n` + s.slice(-n / 2) : s);
/** 文件名只留安全字符，避免写到 /data 以外 */
export const safeName = (n: string) => (n.split(/[\\/]/).pop() || 'data').replace(/[^\w.\-一-龥]/g, '_').slice(0, 80) || 'data';

/** 从 AI 回复里取出 ```python 代码块（取最长的那段） */
export function extractPython(text: string): string {
  const blocks = Array.from(String(text || '').matchAll(/```(?:python|py)?[ \t]*\n([\s\S]*?)```/gi)).map(m => m[1].trim()).filter(Boolean);
  if (!blocks.length) return '';
  return blocks.sort((a, b) => b.length - a.length)[0];
}

/** 明显不该在沙箱里做的事（联网、动系统）——提前拒绝，省得浪费一次运行 */
export function codeProblem(code: string): string {
  if (!code.trim()) return '没有代码';
  if (code.length > 20000) return '代码太长';
  if (/\b(pyodide\.http|pyfetch|js\.fetch|XMLHttpRequest|urllib\.request|requests\.|socket\.|subprocess|os\.system)\b/.test(code)) return '沙箱里不能联网或调用系统命令';
  return '';
}

// Worker 源码：放在字符串里，用 Blob 启动，不用额外的构建配置
const WORKER = `
let py = null, loading = null;
async function boot(base) {
  if (py) return py;
  if (!loading) loading = (async () => {
    importScripts(base + 'pyodide.js');
    const p = await loadPyodide({ indexURL: base, stdout: () => {}, stderr: () => {} });
    await p.loadPackage(['micropip']).catch(() => {});
    return p;
  })();
  py = await loading; return py;
}
const PRE = \`
import sys, io, os, base64
os.makedirs('/data', exist_ok=True)
os.chdir('/data')
_hx_out = io.StringIO()
sys.stdout = _hx_out; sys.stderr = _hx_out
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as _hx_plt
    _hx_plt.close('all')
    _hx_plt.rcParams['figure.dpi'] = 80
except Exception:
    pass
\`;
const RUN = \`
import traceback as _hx_tb
_hx_err = None
try:
    exec(compile(_hx_code, 'analysis.py', 'exec'), globals())
except BaseException:
    _hx_lines = _hx_tb.format_exc().strip().splitlines()
    _hx_err = '\\\\n'.join([l for l in _hx_lines if 'analysis.py' in l or not l.startswith('  File')][-8:])
\`;
const POST = \`
_hx_imgs = []
try:
    import matplotlib.pyplot as _hx_plt
    for _n in _hx_plt.get_fignums()[:3]:
        _b = io.BytesIO(); _hx_plt.figure(_n).savefig(_b, format='png', dpi=80, bbox_inches='tight'); _hx_imgs.append(base64.b64encode(_b.getvalue()).decode())
    _hx_plt.close('all')
except Exception:
    pass
\`;
self.onmessage = async (ev) => {
  const { id, base, code, files } = ev.data;
  const t0 = Date.now();
  try {
    const p = await boot(base);
    for (const f of files || []) { try { p.FS.mkdirTree('/data'); } catch (e) {} p.FS.writeFile('/data/' + f.name, f.bytes); }
    await p.loadPackagesFromImports(code);
    await p.runPythonAsync(PRE);
    p.globals.set('_hx_code', code);
    await p.runPythonAsync(RUN);
    const err = p.globals.get('_hx_err');
    const error = err ? String(err) : undefined;
    await p.runPythonAsync(POST);
    const stdout = p.globals.get('_hx_out').getvalue();
    const images = p.globals.get('_hx_imgs').toJs();
    let out = []; try { out = p.FS.readdir('/data').filter(n => n !== '.' && n !== '..'); } catch (e) {}
    self.postMessage({ id, ok: !error, stdout, error, images: Array.from(images).map(b => 'data:image/png;base64,' + b), files: out, ms: Date.now() - t0 });
  } catch (e) {
    self.postMessage({ id, ok: false, stdout: '', error: '沙箱启动失败：' + String(e && e.message || e), images: [], ms: Date.now() - t0 });
  }
};
`;

let worker: Worker | null = null;
let warm = false;
const pending = new Map<number, (r: PyResult) => void>();
let seq = 0;
const kill = () => { worker?.terminate(); worker = null; warm = false; pending.forEach(r => r({ ok: false, stdout: '', error: '沙箱已重启', images: [], ms: 0 })); pending.clear(); };
const getWorker = () => {
  if (worker) return worker;
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  worker = new Worker(url);
  worker.onmessage = ev => { const r = pending.get(ev.data.id); if (r) { pending.delete(ev.data.id); warm = true; r(ev.data); } };
  worker.onerror = ev => { const msg = (ev as ErrorEvent).message || '沙箱出错'; pending.forEach(r => r({ ok: false, stdout: '', error: msg, images: [], ms: 0 })); pending.clear(); kill(); };
  return worker;
};
export const sandboxWarm = () => warm;

/** 跑一段 Python。第一次要下载运行环境（约 15–40MB，之后浏览器会缓存），所以首次给的时间更长 */
export function runPython(code: string, files: PyFile[] = [], timeoutMs = 60000): Promise<PyResult> {
  const bad = codeProblem(code);
  if (bad) return Promise.resolve({ ok: false, stdout: '', error: bad, images: [], ms: 0 });
  if (typeof Worker === 'undefined') return Promise.resolve({ ok: false, stdout: '', error: '这个浏览器不支持沙箱', images: [], ms: 0 });
  const id = ++seq;
  const limit = warm ? timeoutMs : timeoutMs + 180000;
  return new Promise(resolve => {
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); kill(); resolve({ ok: false, stdout: '', error: `超过 ${Math.round(limit / 1000)} 秒没跑完，已经掐断（可能是死循环或计算量太大）`, images: [], ms: limit }); } }, limit);
    pending.set(id, r => { clearTimeout(timer); resolve({ ...r, stdout: clipOut(r.stdout || '') }); });
    getWorker().postMessage({ id, base: pyBase(), code, files: files.map(f => ({ name: safeName(f.name), bytes: f.bytes })) });
  });
}

/** 给 AI 看的数据预览：文本类文件取前几行，表格文件只给文件名和大小 */
export function previewFile(f: PyFile): string {
  const kb = Math.round(f.bytes.length / 1024);
  if (/\.(csv|tsv|txt|json|md)$/i.test(f.name)) {
    const text = new TextDecoder().decode(f.bytes.slice(0, 4000));
    return `/data/${safeName(f.name)}（${kb}KB），前几行：\n${text.split('\n').slice(0, 12).join('\n')}`;
  }
  return `/data/${safeName(f.name)}（${kb}KB，${/\.xlsx?$/i.test(f.name) ? 'Excel，用 pandas.read_excel 读' : '二进制文件'}）`;
}

/** 让 AI 写代码的提示词 */
export function buildCodeMessages(opts: { goal: string; ask: string; context?: string; files: PyFile[]; previous?: { code: string; error: string } }) {
  const data = opts.files.length ? opts.files.map(previewFile).join('\n\n') : '（用户没有上传数据文件）';
  return [
    { role: 'system', content: `你是数据分析工程师。写一段能直接运行的 Python 来回答用户的问题。运行环境是浏览器里的 Pyodide（Python 3.12）：
- 可用：numpy、pandas、matplotlib、scipy、statsmodels、scikit-learn、sympy、networkx、openpyxl 和标准库；
- 不能联网、不能装别的包、不能调系统命令；
- 数据文件在当前目录（/data/）下，按文件名直接读；
- 结论用 print 打印出来（中文），关键数字要打印；
- 需要画图就用 matplotlib 画（最多 3 张），图上的标题和坐标轴用英文（沙箱里没有中文字体），不要调用 plt.show()；
- 没有真实数据时，可以按题目给的参数做计算、估算或数值模拟，但要在输出里写明「这是按假设参数算的，不是实测数据」；
- 代码控制在 80 行内，60 秒内跑完。
只返回一个 \`\`\`python 代码块。` },
    { role: 'user', content: `项目：${opts.goal.slice(0, 300)}
${opts.context ? `相关背景：\n${opts.context.slice(0, 1500)}\n` : ''}
数据：
${data}

要做的：${opts.ask.slice(0, 1500)}${opts.previous ? `

上次写的代码报错了，改好它：
\`\`\`python
${opts.previous.code.slice(0, 4000)}
\`\`\`
报错：
${opts.previous.error.slice(0, 1500)}` : ''}` },
  ];
}

/** 用户这句话是不是要「算 / 分析 / 画图」 */
export const wantsCompute = (text: string, hasFile: boolean) =>
  (hasFile && /分析|统计|看看|画|图|算|总结|处理|清洗|对比|趋势|规律|相关/.test(text)) ||
  /(帮我|来|先|跑|用代码|用\s*python|写段代码).{0,12}(算|计算|分析|画图|作图|拟合|回归|模拟|仿真计算|统计|估算)|计算一下|算一下|算算|画个图|画张图|画一下|做个图表|拟合一下|回归分析|蒙特卡洛|python/i.test(text);
