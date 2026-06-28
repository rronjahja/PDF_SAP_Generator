'use strict';

/**
 * Tiny safe expression evaluator — no eval(), no Function().
 * Supports: data paths (customer.total), numbers, 'strings', booleans,
 * arithmetic + - * /, comparisons == != > < >= <=, logic && || !, parentheses,
 * and round(x, n) / len(x) helpers.
 *
 * Used for computed bindings ("=net * 0.19") and visibility conditions
 * ("invoice.status == 'paid'").
 */

const TOKEN = /\s*(>=|<=|==|!=|&&|\|\||[()+\-*/<>!,]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w.[\]]*|\d+(?:\.\d+)?)/y;

function tokenize(src) {
  const out = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`Unexpected character at ${pos}: "${src.slice(pos, pos + 8)}"`);
    }
    out.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return out;
}

function resolve(data, path) {
  let cur = data;
  for (const part of path.replace(/\[\]/g, '').split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function evaluate(expr, data) {
  const tokens = tokenize(String(expr));
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t) => { if (next() !== t) throw new Error(`Expected '${t}' in expression`); };

  function primary() {
    const t = next();
    if (t === undefined) throw new Error('Unexpected end of expression');
    if (t === '(') { const v = orExpr(); expect(')'); return v; }
    if (t === '!') return !truthy(primary());
    if (t === '-') return -Number(primary());
    if (/^\d/.test(t)) return Number(t);
    if (t[0] === "'" || t[0] === '"') return t.slice(1, -1).replace(/\\(.)/g, '$1');
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (t === 'round' || t === 'len') {
      expect('(');
      const a = orExpr();
      let b = 0;
      if (peek() === ',') { next(); b = orExpr(); }
      expect(')');
      if (t === 'len') return Array.isArray(a) || typeof a === 'string' ? a.length : 0;
      const f = Math.pow(10, Number(b) || 0);
      return Math.round(Number(a) * f) / f;
    }
    return resolve(data, t); // data path
  }

  function mulExpr() {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = primary();
      v = op === '*' ? Number(v) * Number(r) : Number(v) / Number(r);
    }
    return v;
  }

  function addExpr() {
    let v = mulExpr();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = mulExpr();
      if (op === '+' && (typeof v === 'string' || typeof r === 'string')) v = String(v ?? '') + String(r ?? '');
      else v = op === '+' ? Number(v) + Number(r) : Number(v) - Number(r);
    }
    return v;
  }

  function cmpExpr() {
    let v = addExpr();
    while (['==', '!=', '>', '<', '>=', '<='].includes(peek())) {
      const op = next();
      const r = addExpr();
      switch (op) {
        case '==': v = v == r; break; // eslint-disable-line eqeqeq
        case '!=': v = v != r; break; // eslint-disable-line eqeqeq
        case '>': v = Number(v) > Number(r); break;
        case '<': v = Number(v) < Number(r); break;
        case '>=': v = Number(v) >= Number(r); break;
        case '<=': v = Number(v) <= Number(r); break;
      }
    }
    return v;
  }

  function andExpr() {
    let v = cmpExpr();
    while (peek() === '&&') { next(); const r = cmpExpr(); v = truthy(v) && truthy(r); }
    return v;
  }

  function orExpr() {
    let v = andExpr();
    while (peek() === '||') { next(); const r = andExpr(); v = truthy(v) || truthy(r); }
    return v;
  }

  const result = orExpr();
  if (i < tokens.length) throw new Error(`Unexpected '${tokens[i]}' in expression`);
  return result;
}

function truthy(v) {
  return !(v === undefined || v === null || v === false || v === 0 || v === '');
}

/** True when the condition holds (or is empty/invalid — fail open for visibility). */
function isVisible(condition, data) {
  if (condition === undefined || condition === null || String(condition).trim() === '') return true;
  try {
    return truthy(evaluate(condition, data));
  } catch {
    return true; // a broken condition should not blank out documents silently
  }
}

module.exports = { evaluate, isVisible, truthy };
