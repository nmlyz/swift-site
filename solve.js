// swift-site: a fast drop-in for makefun-site 1.0.0.
// run(input) returns exactly the output tree makefun-site 1.0.0's build
// returns for the same input. Single file, no dependencies.
// Optimisations over the reference: index-based front-matter scanning,
// cached ASCII fast-path slugify, one-pass Markdown rendering (no token
// objects, no per-character regex escapes), and templates compiled once
// per build with includes expanded and loop frames reused.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/;
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const RESERVED = ['posts', 'tags', 'page'];

function byCodeUnits(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function escapeHtml(s) {
  if (!ESC_RE.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const e = ESCAPES[s[i]];
    if (e !== undefined) { out += s.slice(start, i) + e; start = i + 1; }
  }
  return out + s.slice(start);
}

function wordsOf(text) {
  let n = 0, inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 32) inWord = false;
    else if (c < 128) { if (!inWord) { inWord = true; n++; } }
    else if (c === 133 || c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

// ---- slugify (cached per run) ----
function makeSlugify() {
  const cache = new Map();
  function slugify(text) {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    let plain = text;
    let ascii = true;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 128) { ascii = false; break; }
    if (!ascii) {
      plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    } else {
      let out = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '');
      out = out.slice(0, 64);
      let e = out.length;
      while (e > 0 && out[e - 1] === '-') e--;
      out = out.slice(0, e);
      if (out === '') out = 'untitled';
      cache.set(text, out);
      return out;
    }
    let out = '';
    let gap = false;
    for (let i = 0; i < plain.length; i++) {
      const ch = plain[i];
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
    out = out.slice(0, 64);
    let e = out.length;
    while (e > 0 && out[e - 1] === '-') e--;
    out = out.slice(0, e);
    if (out === '') out = 'untitled';
    cache.set(text, out);
    return out;
  }
  return slugify;
}

// ---- front matter ----
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw, key) {
  if (raw.charCodeAt(0) === 34) { // '"'
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: `key "${key}": a quoted string is not closed` };
    let out = '';
    let i = 1;
    const end = raw.length - 1;
    while (i < end) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === end) return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\'` };
        out += n;
        i += 2;
      } else if (c === '"') return { error: `key "${key}": a quoted string holds a stray quote` };
      else { out += c; i++; }
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: `key "${key}": a bare string opens on [` };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary':
      return stringOf(raw, key);
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
      let y = 0, mo = 0, d = 0;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { ok = false; break; }
        }
        if (ok) { y = Number(raw.slice(0, 4)); mo = Number(raw.slice(5, 7)); d = Number(raw.slice(8, 10)); }
      }
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1)
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      let ok = raw.length > 0;
      for (let i = 0; ok && i < raw.length; i++) {
        const c = raw[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) ok = false;
      }
      return ok ? { value: raw } : { error: 'key "layout": not a template name' };
    }
    case 'slug': {
      let ok = raw.length > 0 && raw.length <= 64;
      if (ok) {
        // /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        let prevDash = true; // start must be alnum
        for (let i = 0; i < raw.length; i++) {
          const c = raw[i];
          if (c === '-') { if (prevDash) { ok = false; break; } prevDash = true; }
          else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) prevDash = false;
          else { ok = false; break; }
        }
        if (prevDash) ok = false;
      }
      return ok ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

// Parse front matter from normalised text. Returns {data, body} or {error}.
// Scans lines by index (no whole-text split).
function parseFrontMatter(text) {
  // first line
  let nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  if (first !== '---') return { error: 'no front matter' };
  // find closing line
  let pos = nl === -1 ? text.length : nl + 1;
  let closeStart = -1, closeEnd = -1;
  while (pos < text.length) {
    const e = text.indexOf('\n', pos);
    const lineEnd = e === -1 ? text.length : e;
    if (lineEnd - pos === 3 && text[pos] === '-' && text[pos + 1] === '-' && text[pos + 2] === '-') {
      closeStart = pos; closeEnd = lineEnd; break;
    }
    if (e === -1) break;
    pos = e + 1;
  }
  // also handle the case where the closing line is the last line without \n: covered above.
  // and where text is exactly "---\n---" etc: covered.
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let lineNo = 1; // 1-based, opening --- is line 1; next line is 2
  pos = nl === -1 ? text.length : nl + 1;
  while (pos < closeStart) {
    const e = text.indexOf('\n', pos);
    const lineEnd = e === -1 ? text.length : e;
    lineNo++;
    const line = text.slice(pos, lineEnd);
    // blank (spaces/tabs only) or comment
    let blank = true;
    for (let i = 0; i < line.length; i++) { if (line[i] !== ' ' && line[i] !== '\t') { blank = false; break; } }
    if (!blank && line.charCodeAt(0) !== 35) { // '#'
      // LINE: /^([a-z_]+):(?: (.*))?$/
      let i = 0;
      while (i < line.length && ((line[i] >= 'a' && line[i] <= 'z') || line[i] === '_')) i++;
      const key = line.slice(0, i);
      let raw;
      if (i === 0 || i >= line.length || line[i] !== ':') return { error: `line ${lineNo} is not "key: value"` };
      if (i + 1 === line.length) raw = '';
      else if (line[i + 1] === ' ') raw = line.slice(i + 2);
      else return { error: `line ${lineNo} is not "key: value"` };
      // trailing spaces/tabs dropped
      let rEnd = raw.length;
      while (rEnd > 0 && (raw[rEnd - 1] === ' ' || raw[rEnd - 1] === '\t')) rEnd--;
      raw = raw.slice(0, rEnd);
      if (key !== 'title' && key !== 'date' && key !== 'tags' && key !== 'draft' && key !== 'layout' && key !== 'slug' && key !== 'summary')
        return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (e === -1) break;
    pos = e + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === text.length ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ---- templates ----
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    let standalone = true;
    for (let j = lineStart; j < open; j++) { const c = src[j]; if (c !== ' ' && c !== '\t') { standalone = false; break; } }
    if (standalone) for (let j = end; j < lineEnd; j++) { const c = src[j]; if (c !== ' ' && c !== '\t') { standalone = false; break; } }
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// Expand includes (depth-limited to 8, as renderNodes does) and clone nodes
// so each for-node owns a reusable frame object.
function expandNodes(nodes, templates, depth) {
  const out = [];
  for (const n of nodes) {
    if (n.kind === 'include') {
      const t = templates.get(n.name);
      if (t !== undefined && depth < 8) {
        const sub = expandNodes(t, templates, depth + 1);
        for (let i = 0; i < sub.length; i++) out.push(sub[i]);
      }
    } else if (n.kind === 'for') {
      const c = { kind: 'for', name: n.name, path: n.path, body: expandNodes(n.body, templates, depth) };
      c.frame = {}; c.loop = { index: 1, first: true, last: false, length: 0 }; c.frame.loop = c.loop;
      out.push(c);
    } else if (n.kind === 'if') {
      out.push({ kind: 'if', not: n.not, path: n.path, then: expandNodes(n.then, templates, depth), else: n.else === null ? null : expandNodes(n.else, templates, depth) });
    } else {
      out.push(n); // text / var / raw are immutable
    }
  }
  return out;
}

function lookup(frames, path) {
  let v;
  let found = false;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (Object.hasOwn(f, path[0])) { v = f[path[0]]; found = true; break; }
  }
  if (!found) return undefined;
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

// Compile an expanded template tree to a JS function. Scopes are lexical
// (includes are already expanded), so each path resolves statically to the
// innermost loop frame that binds its root, else to the root vars object R.
// Returns null when Function construction is unavailable; the caller then
// falls back to the interpreter (renderList).
function compileTemplate(nodes) {
  let code = '';
  let idc = 0;
  const scopes = [];
  function pathExpr(path) {
    let base;
    for (let i = scopes.length - 1; i >= 0; i--) {
      const v = scopes[i].get(path[0]);
      if (v !== undefined) { base = v; break; }
    }
    if (base === undefined) base = 'R.' + path[0];
    for (let k = 1; k < path.length; k++) base += '?.' + path[k];
    return base;
  }
  function gen(list) {
    for (const n of list) {
      if (n.kind === 'text') { code += 'out.push(' + JSON.stringify(n.text) + ');'; continue; }
      if (n.kind === 'var') { code += 'out.push(esc(textOf(' + pathExpr(n.path) + ')));'; continue; }
      if (n.kind === 'raw') { code += 'out.push(textOf(' + pathExpr(n.path) + '));'; continue; }
      if (n.kind === 'if') {
        code += 'if (' + (n.not ? '!' : '') + 'truthy(' + pathExpr(n.path) + ')) {';
        gen(n.then);
        code += '}';
        if (n.else !== null) { code += 'else {'; gen(n.else); code += '}'; }
        continue;
      }
      // for
      const id = idc++;
      const xs = '$x' + id, k = '$k' + id, v = '$v' + id, lp = '$l' + id;
      code += '{const ' + xs + '=' + pathExpr(n.path) + ';if(Array.isArray(' + xs + ')){const ' + lp +
        '={index:0,first:false,last:false,length:' + xs + '.length};for(let ' + k + '=0;' + k + '<' + xs + '.length;' + k +
        '++){const ' + v + '=' + xs + '[' + k + '];' + lp + '.index=' + k + '+1;' + lp + '.first=' + k + '===0;' + lp + '.last=' + k + '===' + xs + '.length-1;';
      const frame = new Map();
      frame.set(n.name, v);
      frame.set('loop', lp);
      scopes.push(frame);
      gen(n.body);
      scopes.pop();
      code += '}}}';
    }
  }
  gen(nodes);
  try { return new Function('R', 'out', 'esc', 'textOf', 'truthy', code); }
  catch (e) { return null; }
}

function renderList(nodes, frames, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.kind === 'text') { out.push(n.text); continue; }
    if (n.kind === 'var') { out.push(escapeHtml(textOf(lookup(frames, n.path)))); continue; }
    if (n.kind === 'raw') { out.push(textOf(lookup(frames, n.path))); continue; }
    if (n.kind === 'if') {
      const v = truthy(lookup(frames, n.path));
      const branch = v !== n.not ? n.then : n.else;
      if (branch !== null) renderList(branch, frames, out);
      continue;
    }
    // for
    const xs = lookup(frames, n.path);
    if (!Array.isArray(xs)) continue;
    const fr = n.frame, lp = n.loop;
    lp.length = xs.length;
    frames.push(fr);
    for (let k = 0; k < xs.length; k++) {
      fr[n.name] = xs[k];
      lp.index = k + 1; lp.first = k === 0; lp.last = k === xs.length - 1;
      renderList(n.body, frames, out);
    }
    frames.pop();
  }
}

// ---- Markdown ----
function isBlank(line) {
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c !== ' ' && c !== '\t') return false; }
  return true;
}
function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return line.slice(a, b);
}
// fence open: returns lang or null; fence close: boolean
function fenceLang(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3, lang = '';
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-') { lang += c; i++; }
    else break;
  }
  while (i < line.length) { const c = line[i]; if (c !== ' ' && c !== '\t') return null; i++; }
  return lang;
}
function isFenceClose(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let i = 3; i < line.length; i++) { const c = line[i]; if (c !== ' ' && c !== '\t') return false; }
  return true;
}
function headingOf(line) {
  let h = 0;
  while (h < line.length && line[h] === '#') h++;
  if (h === 0 || h > 6) return null;
  if (h >= line.length || (line[h] !== ' ' && line[h] !== '\t')) return null;
  let a = h;
  while (a < line.length && (line[a] === ' ' || line[a] === '\t')) a++;
  let b = line.length;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  if (b === a) return null;
  return { depth: h, text: line.slice(a, b) };
}
function isHR(line) {
  if (line.length < 3) return false;
  const c = line[0];
  if (c !== '-' && c !== '*') return false;
  if (line[1] !== c || line[2] !== c) return false;
  for (let i = 3; i < line.length; i++) { const ch = line[i]; if (ch !== ' ' && ch !== '\t') return false; }
  return true;
}
function endsParagraph(line) {
  const c = line[0];
  if (c === undefined) return true;
  if (c === ' ' || c === '\t') return isBlank(line);
  if (c === '`') return fenceLang(line) !== null;
  if (c === '#') return headingOf(line) !== null;
  if (c === '-' || c === '*') return isHR(line);
  return false;
}
function listMarker(line) {
  // returns {ordered, start, text} or null; text is the raw item text after the marker
  const c0 = line[0];
  if ((c0 === '-' || c0 === '*') && line[1] === ' ') return { ordered: false, start: 1, text: line.slice(2) };
  if (c0 >= '0' && c0 <= '9') {
    let i = 0;
    while (i < line.length && line[i] >= '0' && line[i] <= '9') i++;
    if (i > 9 || i === 0) return null;
    if (line[i] === '.' && line[i + 1] === ' ') return { ordered: true, start: Number(line.slice(0, i)), text: line.slice(i + 2) };
  }
  return null;
}
function isContinued(line) {
  if (line[0] !== ' ' || line[1] !== ' ') return false;
  const c = line[2];
  if (c === undefined) return false;
  return !/\s/.test(c);
}

// Is position j of s escaped by a backslash (odd run of backslashes before it)?
function isEscaped(s, j) {
  let k = j - 1, n = 0;
  while (k >= 0 && s[k] === '\\') { n++; k--; }
  return (n & 1) === 1;
}
function findUnescaped(s, what, from) {
  if (what.length === 1) {
    let j = s.indexOf(what, from);
    while (j !== -1) {
      if (!isEscaped(s, j)) return j;
      j = s.indexOf(what, j + 1);
    }
    return -1;
  }
  let j = s.indexOf(what, from);
  while (j !== -1) {
    if (!isEscaped(s, j)) return j;
    j = s.indexOf(what, j + 1);
  }
  return -1;
}
function findSingleStar(s, from) {
  let j = s.indexOf('*', from);
  while (j !== -1) {
    if (!isEscaped(s, j)) {
      if (s[j + 1] === '*') { j = s.indexOf('*', j + 2); continue; }
      return j;
    }
    j = s.indexOf('*', j + 1);
  }
  return -1;
}

const SPECIAL_RE = /[\\`*\[&<>"']/g;

function inlineTo(s, env, out) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    SPECIAL_RE.lastIndex = i;
    const m = SPECIAL_RE.exec(s);
    if (m === null) { out.push(s.slice(i)); break; }
    const j = m.index;
    if (j > i) out.push(s.slice(i, j));
    const c = s[j];
    if (c === '\\') {
      if (j + 1 < n && ESCAPABLE.has(s[j + 1])) { out.push(s[j + 1]); i = j + 2; }
      else { out.push('\\'); i = j + 1; }
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        out.push('<code>', escapeHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
      } else { out.push('`'); i = j + 1; }
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          out.push('<strong>');
          inlineTo(s.slice(j + 2, k), env, out);
          out.push('</strong>');
          i = k + 2;
        } else { out.push('**'); i = j + 2; }
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        out.push('<em>');
        inlineTo(s.slice(j + 1, k), env, out);
        out.push('</em>');
        i = k + 1;
      } else { out.push('*'); i = j + 1; }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', j + 1);
      if (k !== -1 && s[k + 1] === '(') {
        const mm = s.indexOf(')', k + 2);
        const target = mm === -1 ? '' : s.slice(k + 2, mm);
        if (target !== '' && !/\s/.test(target)) {
          out.push('<a href="', escapeHtml(env.link(target)), '">');
          inlineTo(s.slice(j + 1, k), env, out);
          out.push('</a>');
          i = mm + 1;
          continue;
        }
      }
      out.push('['); i = j + 1;
      continue;
    }
    out.push(ESCAPES[c]);
    i = j + 1;
  }
}

// ---- build ----
export function run(input) {
  const slugify = makeSlugify();
  const base = input.site.base_url.replace(/\/+$/, '');
  const report = [];
  const templates = new Map();
  const names = Object.keys(input.templates).sort(byCodeUnits);
  const parsed = new Map();
  for (const name of names) {
    try {
      parsed.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  for (const name of names) {
    if (parsed.has(name)) templates.set(name, expandNodes(parsed.get(name), parsed, 0));
  }

  // 1. sources, sorted by path
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // 2. front matter
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) { report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = undefined;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) { report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push(`draft ${s.path}`); continue; }
    kept.push(s);
  }

  // 3. permalinks
  const taken = new Map();
  const bySource = new Map();
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); };
  const nextNum = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? RESERVED : []); taken.set(dir, set); }
    const baseSlug = s.data.slug ?? slugify(s.data.title);
    let slug = baseSlug;
    if (set.has(slug)) {
      const numKey = dir + '\n' + baseSlug;
      let nn = nextNum.get(numKey) ?? 2;
      while (set.has(`${baseSlug}-${nn}`)) nn++;
      slug = `${baseSlug}-${nn}`;
      nextNum.set(numKey, nn + 1);
    }
    set.add(slug);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. markdown
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const broken = new Set();
  const linkCache = new Map();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const dirParts = dir === '' ? [] : dir.split('/');
    const env = {
      link: (target) => {
        if (target.startsWith('/') || target.startsWith('#')) return target;
        // scheme? [A-Za-z][A-Za-z0-9+.-]*:
        const c0 = target.charCodeAt(0);
        if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
          let i = 1;
          while (i < target.length) {
            const ch = target[i];
            if (ch === ':') return target;
            if (!((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '+' || ch === '-' || ch === '.')) break;
            i++;
          }
        }
        const cacheKey = dir + '\n' + target;
        const hit = linkCache.get(cacheKey);
        if (hit !== undefined) return hit;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        let path = null;
        if (rel !== '') {
          const parts = dirParts.slice();
          let bad = false;
          let start = 0;
          while (start <= rel.length) {
            const slash = rel.indexOf('/', start);
            const seg = slash === -1 ? rel.slice(start) : rel.slice(start, slash);
            if (seg === '' || seg === '.') { /* skip */ }
            else if (seg === '..') { if (parts.length === 0) { bad = true; break; } parts.pop(); }
            else parts.push(seg);
            if (slash === -1) break;
            start = slash + 1;
          }
          path = bad ? null : parts.join('/');
        }
        let out;
        if (path !== null && bySource.has(path)) { out = `${bySource.get(path).url}${frag}`; linkCache.set(cacheKey, out); }
        else if (path !== null && staticPaths.has(path)) { out = `${base}/${path}${frag}`; linkCache.set(cacheKey, out); }
        else { broken.add(`broken-link ${s.path} -> ${target}`); out = target; }
        return out;
      },
    };
    const md = renderMarkdown(s.body, env, slugify);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. collections
  const posts = [];
  for (const s of kept) if (s.post) posts.push(s);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags ?? [];
    for (const name of tags) {
      const slug = slugify(name);
      if (!seen.has(slug)) { seen.add(slug); out.push(name); }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) { tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] }; bySlug.set(slug, tag); }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // cards / pages
  const linkOf = (s) => s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
  for (const s of kept) {
    s.card = {
      title: s.data.title, url: s.url, date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '', excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    s.pageObj = {
      title: s.card.title, url: s.card.url, date: s.card.date, date_long: s.card.date_long,
      summary: s.card.summary, excerpt: s.card.excerpt, reading_minutes: s.card.reading_minutes, tags: s.card.tags,
      slug: s.slug, content: s.html, toc: s.toc,
      newer: s.post ? linkOf(s.newer) : null, older: s.post ? linkOf(s.older) : null, is_post: s.post,
    };
  }
  const cards = new Map();
  for (const p of posts) cards.set(p, p.card);

  // 7. layouts
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const rootVars = { site, tags: allTags, recent, page: undefined, posts: undefined, pager: undefined, tag: undefined };
  const frames = [rootVars];
  const compiled = new Map();
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    rootVars.page = vars.page;
    rootVars.posts = vars.posts;
    rootVars.pager = vars.pager;
    rootVars.tag = vars.tag;
    const out = [];
    let fn = compiled.get(name);
    if (fn === undefined) { fn = compileTemplate(nodes); compiled.set(name, fn); }
    if (fn !== null) fn(rootVars, out, escapeHtml, textOf, truthy);
    else renderList(nodes, frames, out);
    return out.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: s.pageObj });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. report
  const lines = [...report, ...broken].sort(byCodeUnits);
  let pageCount = 0;
  for (const s of kept) if (!s.post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}

function renderMarkdown(src, env, slugify) {
  const lines = src.split('\n');
  const ids = new Set();
  const parts = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const c0 = line[0];
    if (c0 === undefined) { i++; continue; }
    if (c0 === ' ' || c0 === '\t') {
      if (isBlank(line)) { i++; continue; }
    } else if (c0 === '`') {
      const lang = fenceLang(line);
      if (lang !== null) {
        parts.push(`<pre><code${lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`}>`);
        i++;
        while (i < lines.length && !isFenceClose(lines[i])) { parts.push(escapeHtml(lines[i]), '\n'); i++; }
        i++;
        parts.push('</code></pre>', '\n');
        continue;
      }
    } else if (c0 === '#') {
      const heading = headingOf(line);
      if (heading !== null) {
        const baseSlug = slugify(heading.text);
        let id = baseSlug;
        if (ids.has(id)) {
          let n = 2;
          while (ids.has(`${baseSlug}-${n}`)) n++;
          id = `${baseSlug}-${n}`;
        }
        ids.add(id);
        const start = parts.length;
        parts.push(`<h${heading.depth} id="${id}">`);
        inlineTo(heading.text, env, parts);
        parts.push(`</h${heading.depth}>`, '\n');
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: parts.slice(start + 1, parts.length - 2).join('') });
        i++;
        continue;
      }
    } else if (c0 === '>') {
      const body = [];
      while (i < lines.length && lines[i][0] === '>') {
        const l = lines[i++];
        body.push(trimLine(l[1] === ' ' ? l.slice(2) : l.slice(1)));
      }
      const keptLines = body.filter((l) => l !== '');
      if (keptLines.length === 0) parts.push('<blockquote>\n</blockquote>', '\n');
      else {
        parts.push('<blockquote>\n<p>');
        inlineTo(keptLines.join('\n'), env, parts);
        parts.push('</p>\n</blockquote>', '\n');
      }
      continue;
    } else if (c0 === '-' || c0 === '*' || (c0 >= '0' && c0 <= '9')) {
      if (isHR(line)) { parts.push('<hr>', '\n'); i++; continue; }
      const marker = listMarker(line);
      if (marker !== null) {
        const isOrdered = marker.ordered;
        const items = [];
        while (i < lines.length) {
          const m = listMarker(lines[i]);
          if (m !== null && m.ordered === isOrdered) { items.push([trimLine(m.text)]); i++; }
          else if (isContinued(lines[i])) { items[items.length - 1].push(trimLine(lines[i])); i++; }
          else break;
        }
        const tag = isOrdered ? 'ol' : 'ul';
        parts.push(isOrdered && marker.start !== 1 ? `<ol start="${marker.start}">` : `<${tag}>`, '\n');
        for (let j = 0; j < items.length; j++) {
          parts.push('<li>');
          inlineTo(items[j].join('\n'), env, parts);
          parts.push('</li>\n');
        }
        parts.push(`</${tag}>`, '\n');
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < lines.length && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const start = parts.length;
    parts.push('<p>');
    inlineTo(body.join('\n'), env, parts);
    parts.push('</p>', '\n');
    if (excerpt === null) excerpt = parts.slice(start + 1, parts.length - 2).join('');
  }
  return { html: parts.join(''), toc, excerpt: excerpt ?? '' };
}
