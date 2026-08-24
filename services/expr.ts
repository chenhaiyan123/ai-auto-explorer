/**
 * 一个很小的算术表达式求值器。
 *
 * 存在的理由只有一个：**让 AI 生成的仿真模型不包含可执行代码。**
 *
 * 做「每个问题都能生成一个仿真实验」这件事，最省事的写法是让模型吐一段 JS，
 * 前端 `eval` 或者塞进 iframe 跑。但用户的模型 API Key 就存在 localStorage 里，
 * 一段能跑的 JS 就是一条把 Key 发出去的路。iframe 沙箱能挡住，代价是要维护
 * 一套跨窗口协议、一个独立页面、一份单独的 CSP，而且沙箱配错一个属性就全漏。
 *
 * 所以换个思路：**不让模型写代码，只让它写公式。**
 * 模型输出的是「参数 + 递推公式」这种声明式的东西，由这里解释执行。
 * 好处有三个，一个比一个重要：
 *   1. 结构上就不可能执行任意代码——这里没有 eval、没有 Function、没有属性访问、
 *      没有任何办法碰到 window / document / fetch。
 *   2. 公式是**人能读的**。仿真最危险的地方是它长得像证据，能把公式摊在用户面前看，
 *      比任何免责声明都有用。
 *   3. 纯函数，可以单测。
 *
 * 支持：数字、标识符、+ - * / % ^、一元负号、比较、&& || !、三元 ?:、括号、白名单函数。
 * 不支持（且是**故意**不支持）：赋值、属性访问 a.b、下标 a[b]、字符串、正则、
 * 函数定义、逗号表达式（除了函数实参）。
 */

// ---------- 错误 ----------

export class ExprError extends Error {}

// ---------- 词法 ----------

type TokKind = 'num' | 'id' | 'op' | 'eof';
interface Tok { kind: TokKind; text: string; pos: number }

/** 表达式最长多少字符。模型偶尔会写出一坨没完没了的东西，先截住。 */
export const MAX_EXPR_LEN = 400;
/** AST 最多多少个节点，防止深层嵌套把求值栈撑爆 */
export const MAX_NODES = 200;

const OPS3 = ['**='];
const OPS2 = ['<=', '>=', '==', '!=', '&&', '||'];
const OPS1 = '+-*/%^()<>?:,!'.split('');

export function tokenize(src: string): Tok[] {
  if (typeof src !== 'string') throw new ExprError('表达式必须是字符串');
  if (src.length > MAX_EXPR_LEN) throw new ExprError(`表达式过长（>${MAX_EXPR_LEN}）`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }

    // 数字（允许 1.5 / .5 / 1e-3）
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`第 ${i} 位不是合法数字`);
      out.push({ kind: 'num', text: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    // 标识符
    if (/[A-Za-z_一-鿿]/.test(c)) {
      const m = /^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*/.exec(src.slice(i))!;
      out.push({ kind: 'id', text: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (OPS3.includes(src.slice(i, i + 3))) throw new ExprError('不支持赋值');
    if (src[i] === '=' && src[i + 1] !== '=') throw new ExprError('不支持赋值');
    if (src[i] === '.') throw new ExprError('不支持属性访问');
    if (src[i] === '[') throw new ExprError('不支持下标');

    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ kind: 'op', text: two, pos: i }); i += 2; continue; }
    if (OPS1.includes(c)) { out.push({ kind: 'op', text: c, pos: i }); i++; continue; }

    throw new ExprError(`不认识的字符「${c}」`);
  }
  out.push({ kind: 'eof', text: '', pos: src.length });
  return out;
}

// ---------- 语法树 ----------

export type Node =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'cond'; c: Node; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

/** 二元运算优先级，数字越大越先算 */
const PREC: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
  '^': 7,
};

/** 白名单函数。只有数学，没有任何能接触外界的东西。 */
export const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, exp: Math.exp,
  pow: Math.pow, sign: Math.sign,
  // log 默认自然对数；给第二个参数就是换底
  log: (x: number, base?: number) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
  // 夹在区间里，写模型时很常用
  clamp: (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
  // 有意不给 random：仿真必须可复现，否则同样的滑块两次跑出两条曲线，没法讨论
};

/** 允许直接写的常量 */
export const CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E };

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  let count = 0;
  const bump = () => { if (++count > MAX_NODES) throw new ExprError('表达式太复杂'); };
  const peek = () => toks[p];
  const eat = (text: string) => {
    if (toks[p].text === text) { p++; return true; }
    return false;
  };
  const expect = (text: string) => {
    if (!eat(text)) throw new ExprError(`第 ${toks[p].pos} 位应该是「${text}」`);
  };

  const primary = (): Node => {
    const t = peek();
    if (t.kind === 'num') { p++; bump(); return { t: 'num', v: parseFloat(t.text) }; }
    // 一元符号绑得比除了 ^ 之外的所有运算都紧，这样 -2^2 = -4（跟数学写法一致），
    // 而 -a + b 仍然是 (-a) + b
    if (t.text === '-') { p++; bump(); return { t: 'un', op: '-', a: binary(PREC['^']) }; }
    if (t.text === '!') { p++; bump(); return { t: 'un', op: '!', a: binary(PREC['^']) }; }
    if (t.text === '+') { p++; return unary(); }
    if (t.text === '(') {
      p++;
      const e = ternary();
      expect(')');
      return e;
    }
    if (t.kind === 'id') {
      p++;
      if (eat('(')) {
        const args: Node[] = [];
        if (!eat(')')) {
          do { args.push(ternary()); } while (eat(','));
          expect(')');
        }
        bump();
        return { t: 'call', name: t.text, args };
      }
      bump();
      return { t: 'id', name: t.text };
    }
    throw new ExprError(`第 ${t.pos} 位出现了意外的「${t.text || '结尾'}」`);
  };

  const unary = (): Node => primary();

  const binary = (minPrec: number): Node => {
    let left = unary();
    for (;;) {
      const op = peek().text;
      const prec = PREC[op];
      if (prec === undefined || prec < minPrec) return left;
      p++;
      // ^ 右结合（2^3^2 = 2^9），其余左结合
      const right = binary(op === '^' ? prec : prec + 1);
      bump();
      left = { t: 'bin', op, a: left, b: right };
    }
  };

  const ternary = (): Node => {
    const c = binary(1);
    if (!eat('?')) return c;
    const a = ternary();
    expect(':');
    const b = ternary();
    bump();
    return { t: 'cond', c, a, b };
  };

  const ast = ternary();
  if (peek().kind !== 'eof') throw new ExprError(`第 ${peek().pos} 位有多余的「${peek().text}」`);
  return ast;
}

/** 表达式里用到的所有标识符（不含函数名、不含内置常量）——用来校验模型有没有瞎编变量 */
export function collectIdents(n: Node, out: Set<string> = new Set()): Set<string> {
  switch (n.t) {
    case 'id': if (!(n.name in CONSTS)) out.add(n.name); break;
    case 'un': collectIdents(n.a, out); break;
    case 'bin': collectIdents(n.a, out); collectIdents(n.b, out); break;
    case 'cond': collectIdents(n.c, out); collectIdents(n.a, out); collectIdents(n.b, out); break;
    case 'call': n.args.forEach(a => collectIdents(a, out)); break;
  }
  return out;
}

/** 表达式里用到的函数名——用来校验模型有没有调不存在的函数 */
export function collectCalls(n: Node, out: Set<string> = new Set()): Set<string> {
  switch (n.t) {
    case 'un': collectCalls(n.a, out); break;
    case 'bin': collectCalls(n.a, out); collectCalls(n.b, out); break;
    case 'cond': collectCalls(n.c, out); collectCalls(n.a, out); collectCalls(n.b, out); break;
    case 'call': out.add(n.name); n.args.forEach(a => collectCalls(a, out)); break;
  }
  return out;
}

// ---------- 求值 ----------

const num = (v: any): number => {
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function evaluate(n: Node, scope: Record<string, number>): number {
  switch (n.t) {
    case 'num': return n.v;
    case 'id': {
      if (n.name in CONSTS) return CONSTS[n.name];
      // 用 hasOwnProperty，不然 'constructor' / 'toString' 这种名字会摸到原型链上的东西
      if (Object.prototype.hasOwnProperty.call(scope, n.name)) return num(scope[n.name]);
      throw new ExprError(`用到了未定义的变量「${n.name}」`);
    }
    case 'un': {
      const a = evaluate(n.a, scope);
      return n.op === '-' ? -a : (a ? 0 : 1);
    }
    case 'cond':
      return evaluate(n.c, scope) ? evaluate(n.a, scope) : evaluate(n.b, scope);
    case 'call': {
      if (!Object.prototype.hasOwnProperty.call(FUNCS, n.name)) {
        throw new ExprError(`没有这个函数「${n.name}」`);
      }
      return num(FUNCS[n.name](...n.args.map(a => evaluate(a, scope))));
    }
    case 'bin': {
      const a = evaluate(n.a, scope);
      // && || 短路，让 `x > 0 && 1/x > 2` 这种写法不至于炸
      if (n.op === '&&') return a ? (evaluate(n.b, scope) ? 1 : 0) : 0;
      if (n.op === '||') return a ? 1 : (evaluate(n.b, scope) ? 1 : 0);
      const b = evaluate(n.b, scope);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? NaN : a / b;   // 除零返回 NaN，不返回 Infinity——曲线上一个 Infinity 会把整张图毁掉
        case '%': return b === 0 ? NaN : a % b;
        case '^': return Math.pow(a, b);
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        default: throw new ExprError(`不认识的运算符「${n.op}」`);
      }
    }
  }
}

// ---------- 对外的两个薄壳 ----------

export interface Compiled {
  src: string;
  ast: Node;
  idents: string[];
  calls: string[];
}

/** 编译一条表达式。语法错、用了不存在的函数，都在这一步就挡掉。 */
export function compile(src: string): Compiled {
  const ast = parse(src);
  const calls = [...collectCalls(ast)];
  const bad = calls.filter(c => !Object.prototype.hasOwnProperty.call(FUNCS, c));
  if (bad.length) throw new ExprError(`没有这些函数：${bad.join('、')}`);
  return { src, ast, idents: [...collectIdents(ast)], calls };
}

/** 编译失败返回 null，不抛。给「模型给的东西不一定对」的场景用。 */
export function tryCompile(src: string): Compiled | null {
  try { return compile(src); } catch { return null; }
}

/** 求值；任何异常都收敛成 NaN，调用方按 NaN 处理即可 */
export function run(c: Compiled, scope: Record<string, number>): number {
  try {
    const v = evaluate(c.ast, scope);
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}
