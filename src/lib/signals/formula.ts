// Безопасный вычислитель формул для составных метрик скринера (БЕЗ eval). Выражения над факторами панели:
// числа, ссылки на факторы в параметрическом виде momentum[252] (или momentum_252), операторы + − × ÷,
// скобки, унарный минус и функции avg/min/max/sum (≥1 арг) и abs (1 арг).
// Пример: avg(momentum[21], momentum[63], momentum[126]) или (momentum[21]+momentum[63]+momentum[126])/3.
//
// Семантика null: любой неопределённый фактор (нет данных) → вся метрика null (как базовый фактор —
// условие тогда не подтверждается). Деление на 0 → null.

export type Getter = (name: string) => number | null;
type Node = (get: Getter) => number | null;
export type Compiled = { refs: string[]; eval: (get: Getter) => number | null };

const FUNCS = new Set(['avg', 'min', 'max', 'sum', 'abs']);

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' } | { t: 'lb' } | { t: 'rb' } | { t: 'comma' };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === '[') { out.push({ t: 'lb' }); i++; continue; }
    if (c === ']') { out.push({ t: 'rb' }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma' }); i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/') { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '×') { out.push({ t: 'op', v: '*' }); i++; continue; }
    if (c === '÷') { out.push({ t: 'op', v: '/' }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Некорректное число: «${s.slice(i, j)}»`);
      out.push({ t: 'num', v: num }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    throw new Error(`Недопустимый символ: «${c}»`);
  }
  return out;
}

// Рекурсивный спуск: expr := add; add := mul (('+'|'-') mul)*; mul := unary (('*'|'/') unary)*;
// unary := ('-'|'+') unary | primary; primary := num | id | id'('args')' | '(' expr ')'.
export function compileFormula(src: string): Compiled {
  const toks = tokenize(src);
  if (!toks.length) throw new Error('Пустая формула.');
  let p = 0;
  const refs = new Set<string>();
  const peek = () => toks[p];
  const eat = () => toks[p++];

  function bin(op: string, a: Node, b: Node): Node {
    return (g) => {
      const x = a(g), y = b(g);
      if (x == null || y == null) return null;
      if (op === '+') return x + y;
      if (op === '-') return x - y;
      if (op === '*') return x * y;
      return y === 0 ? null : x / y; // деление на 0 → null
    };
  }

  function parseArgs(): Node[] {
    const args: Node[] = [];
    if (peek()?.t === 'rp') return args;
    args.push(parseAdd());
    while (peek()?.t === 'comma') { eat(); args.push(parseAdd()); }
    return args;
  }

  function parsePrimary(): Node {
    const tk = peek();
    if (!tk) throw new Error('Неожиданный конец формулы.');
    if (tk.t === 'num') { eat(); return () => (tk as any).v; }
    if (tk.t === 'lp') { eat(); const e = parseAdd(); if (peek()?.t !== 'rp') throw new Error('Не закрыта скобка.'); eat(); return e; }
    if (tk.t === 'id') {
      eat();
      let name = tk.v;
      if (peek()?.t === 'lp') { // вызов функции
        const fn = name.toLowerCase();
        if (!FUNCS.has(fn)) throw new Error(`Неизвестная функция: «${name}». Доступны: avg, min, max, sum, abs.`);
        eat(); const args = parseArgs();
        if (peek()?.t !== 'rp') throw new Error(`Не закрыта скобка функции «${name}».`); eat();
        if (!args.length) throw new Error(`Функция «${name}» требует хотя бы один аргумент.`);
        if (fn === 'abs' && args.length !== 1) throw new Error('abs принимает ровно один аргумент.');
        return (g) => {
          const vs = args.map((a) => a(g));
          if (vs.some((v) => v == null)) return null;
          const n = vs as number[];
          if (fn === 'abs') return Math.abs(n[0]);
          if (fn === 'min') return Math.min(...n);
          if (fn === 'max') return Math.max(...n);
          if (fn === 'sum') return n.reduce((a, b) => a + b, 0);
          return n.reduce((a, b) => a + b, 0) / n.length; // avg
        };
      }
      if (peek()?.t === 'lb') { // параметрическая ссылка: momentum[252] → колонка momentum_252
        eat();
        const nt = peek();
        if (!nt || nt.t !== 'num' || !Number.isInteger(nt.v)) throw new Error(`Ожидался целый период: ${name}[N].`);
        eat();
        if (peek()?.t !== 'rb') throw new Error(`Не закрыта скобка […] у «${name}».`);
        eat();
        name = `${name}_${nt.v}`;
      }
      refs.add(name); // ссылка на колонку-фактор (factor_period)
      return (g) => g(name);
    }
    throw new Error('Неожиданный токен в формуле.');
  }

  function parseUnary(): Node {
    const tk = peek();
    if (tk?.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      eat(); const inner = parseUnary();
      return tk.v === '-' ? (g) => { const v = inner(g); return v == null ? null : -v; } : inner;
    }
    return parsePrimary();
  }

  function parseMul(): Node {
    let left = parseUnary();
    while (peek()?.t === 'op' && ((peek() as any).v === '*' || (peek() as any).v === '/')) {
      const op = (eat() as any).v; left = bin(op, left, parseUnary());
    }
    return left;
  }

  function parseAdd(): Node {
    let left = parseMul();
    while (peek()?.t === 'op' && ((peek() as any).v === '+' || (peek() as any).v === '-')) {
      const op = (eat() as any).v; left = bin(op, left, parseMul());
    }
    return left;
  }

  const node = parseAdd();
  if (p !== toks.length) throw new Error('Лишние символы в конце формулы.');
  return { refs: [...refs], eval: node } as Compiled;
}
