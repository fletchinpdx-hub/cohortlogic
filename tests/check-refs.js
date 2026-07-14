#!/usr/bin/env node
// Static reference checker for the Schedule Builder's classic-script bundle.
//
// The app has no build step — every JS file is a plain <script src> that shares
// one global scope. When splitting schedule-grid.js into feature files, the #1
// risk is "forgot to move a helper" (a function call with no definition anywhere
// in the loaded bundle) or "left the same const in two files" (duplicate
// top-level declaration -> SyntaxError at runtime). Neither is caught by
// `node -c` on a single file. This script is the mechanical safety net:
//
//   1. Reads public/schedule-app.html, extracts every local <script src="js/...">
//      tag IN ORDER (this is the real runtime load/scope order).
//   2. Concatenates those files in that order and runs `node --check` on the
//      result — catches parse errors AND duplicate top-level const/let/class
//      redeclarations (a SyntaxError across the concatenation).
//   3. Tokenizes each file (blanking out string/template-literal TEXT and
//      comments, but keeping `${...}` interpolation code and code outside
//      strings) so prose like "Duration (min)" inside an HTML template string
//      never looks like a function call.
//   4. Collects every function declaration (incl. `async function`, any
//      indentation), every const/let/var name (any indentation — nested
//      closures count as "defined somewhere in the bundle"), and every
//      function/arrow parameter name, plus a small allowlist of browser/CDN/
//      JS-builtin globals.
//   5. Scans every file's code-only text for `NAME(` call sites and flags any
//      name that isn't a known JS builtin, not defined anywhere in the bundle,
//      and not a parameter in scope somewhere. Exits non-zero if any are found.
//
// This is a pragmatic bundle-wide check, not a real scope-correct linter: a
// local helper defined in one function satisfies a same-named call elsewhere
// in the bundle even though real JS scoping wouldn't allow it. That's fine for
// this purpose — the risk being guarded against is "the definition doesn't
// exist ANYWHERE after a copy/paste split," not scope leakage.
//
// Run: node tests/check-refs.js

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const HTML_PATH = path.join(PUBLIC, 'schedule-app.html');

// ── 1. Extract script load order from the HTML ─────────────────────────────
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scriptRe = /<script\s+src="(js\/[^"?]+)(?:\?[^"]*)?"\s*><\/script>/g;
const relPaths = [];
let m;
while ((m = scriptRe.exec(html))) relPaths.push(m[1]);

if (!relPaths.length) {
  console.error(`‼ No local <script src="js/..."> tags found in ${HTML_PATH}`);
  process.exit(1);
}

console.log('=== Script load order (from schedule-app.html) ===');
relPaths.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
console.log('');

const files = relPaths.map(rel => {
  const abs = path.join(PUBLIC, rel);
  if (!fs.existsSync(abs)) {
    console.error(`‼ Script referenced in HTML but missing on disk: ${abs}`);
    process.exit(1);
  }
  return { rel, abs, src: fs.readFileSync(abs, 'utf8') };
});

// ── 2. Syntax + duplicate-declaration check on the concatenation ───────────
const concatPath = path.join(os.tmpdir(), `schedule-bundle-check-${Date.now()}.js`);
const concatSrc = files.map(f => `// ── ${f.rel} ──\n${f.src}`).join('\n\n');
fs.writeFileSync(concatPath, concatSrc);

let syntaxOk = true;
try {
  execFileSync('node', ['--check', concatPath], { stdio: 'pipe' });
  console.log('✓ Concatenated bundle parses cleanly (node --check)');
} catch (e) {
  syntaxOk = false;
  console.error('‼ Bundle failed node --check (parse error OR duplicate top-level declaration):');
  console.error(e.stderr ? e.stderr.toString() : e.message);
} finally {
  fs.unlinkSync(concatPath);
}

// ── 3. Tokenizer: blank out string/template TEXT and comments, keep code ───
// Preserves newlines everywhere (for accurate line numbers) and preserves the
// code inside `${...}` template interpolations (real JS that can contain real
// calls). Blanks (replaces with spaces) comment bodies and string/template
// literal text. Handles escaped quotes and one level of `${...}` nesting depth
// tracking (sufficient for this codebase — no template-literal-within-
// template-literal-within-string patterns observed).
function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = ch => (ch === '\n' ? '\n' : ' ');

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += blank(src[i]); i++; }
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    // Regex literal vs division: classic ambiguity. A `/` starts a regex when
    // the previous significant token puts us in "value position" (start of
    // file/statement, an operator/punctuator, or certain keywords) rather than
    // "after a value" (identifier, number, `)`, `]`). Without this, a regex
    // like /"/g (used in escHtml) reads as a stray `"` that opens a fake string
    // and swallows/blanks everything up to the NEXT literal quote in the file —
    // silently hiding real code (including function declarations) in between.
    if (ch === '/') {
      const trimmed = out.replace(/[ \t\n]+$/, '');
      const lastCh = trimmed[trimmed.length - 1];
      let regexContext;
      if (lastCh === undefined) {
        regexContext = true;
      } else if (/[A-Za-z0-9_$]/.test(lastCh)) {
        const wordMatch = trimmed.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
        const word = wordMatch ? wordMatch[0] : '';
        const KEYWORDS_BEFORE_REGEX = new Set([
          'return', 'typeof', 'case', 'in', 'of', 'new', 'instanceof', 'yield',
          'delete', 'void', 'throw', 'do', 'else', 'await',
        ]);
        regexContext = KEYWORDS_BEFORE_REGEX.has(word);
      } else {
        regexContext = /[([{,;:!&|?=+\-*%^~<>]/.test(lastCh);
      }
      if (regexContext) {
        out += ' '; i++;
        let inClass = false;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\' && i + 1 < n) { out += blank(src[i]) + blank(src[i + 1]); i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { out += ' '; i++; break; }
          out += blank(src[i]); i++;
        }
        while (i < n && /[a-zA-Z]/.test(src[i])) { out += ' '; i++; } // flags
        continue;
      }
    }
    // Single/double-quoted string
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ' '; i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) { out += blank(src[i]) + blank(src[i + 1]); i += 2; continue; }
        out += blank(src[i]); i++;
      }
      if (i < n) { out += ' '; i++; }
      continue;
    }
    // Template literal — blank the literal text, keep ${...} expression code
    if (ch === '`') {
      out += ' '; i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\' && i + 1 < n) { out += blank(src[i]) + blank(src[i + 1]); i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          out += '  '; i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { out += ' '; i++; break; } }
            // Recurse into nested strings/templates within the expression by
            // just copying real code through (rare in this codebase to nest
            // quotes inside ${...} beyond simple cases; good-enough here).
            out += src[i]; i++;
          }
          continue;
        }
        out += blank(src[i]); i++;
      }
      if (i < n) { out += ' '; i++; }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

// ── 4. Collect defined names across the bundle ──────────────────────────────
// Any indentation (nested closures count as "defined somewhere"), including
// `async function NAME(`.
const FUNC_DECL_RE = /(?:^|[^.\w$])(?:async\s+)?function\s*\*?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
const VAR_DECL_RE = /(?:^|[^.\w$])(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;

// Parameter names: `(a, b, c) =>`, `function(a, b)`, `function name(a, b)`,
// single-arg arrow without parens `x =>`, and `async (a, b) =>` / `async x =>`.
// Destructured/default params are reduced to their bound identifiers on a
// best-effort basis (good enough — false negatives here just mean a real name
// gets flagged as missing, which is a rare, easily-triaged edge case).
function collectParamNames(codeSrc, into) {
  const paren = /\(([^()]*)\)\s*=>/g;
  const bare  = /(?:^|[^.\w$])(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
  const fnParen = /function\s*\*?\s*[A-Za-z_$]*\s*\(([^()]*)\)/g;

  const addList = list => {
    list.split(',').forEach(part => {
      // Strip default values, destructuring braces/brackets, rest/spread.
      let p = part.split('=')[0].trim();
      p = p.replace(/^\.\.\./, '').replace(/^[{[]|[}\]]$/g, '');
      const idm = p.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
      if (idm) idm.forEach(id => into.add(id));
    });
  };

  let mm;
  paren.lastIndex = 0;
  while ((mm = paren.exec(codeSrc))) addList(mm[1]);
  fnParen.lastIndex = 0;
  while ((mm = fnParen.exec(codeSrc))) addList(mm[1]);
  bare.lastIndex = 0;
  while ((mm = bare.exec(codeSrc))) into.add(mm[1]);
}

const defined = new Set();
const fileCode = files.map(f => ({ ...f, code: codeOnly(f.src) }));
fileCode.forEach(f => {
  let mm;
  FUNC_DECL_RE.lastIndex = 0;
  while ((mm = FUNC_DECL_RE.exec(f.code))) defined.add(mm[1]);
  VAR_DECL_RE.lastIndex = 0;
  while ((mm = VAR_DECL_RE.exec(f.code))) defined.add(mm[1]);
  collectParamNames(f.code, defined);
});

// JS builtins + browser/CDN globals the app relies on. Anything NOT in this
// list and NOT in `defined` is flagged as a possibly-missing reference.
const ALLOWLIST = new Set([
  // JS language / runtime builtins
  'Object', 'Array', 'Math', 'JSON', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy',
  'Reflect', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError',
  'ReferenceError', 'URIError', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'structuredClone', 'Function', 'Intl', 'BigInt',
  // Browser globals
  'window', 'document', 'navigator', 'console', 'localStorage', 'sessionStorage',
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm', 'prompt',
  'FileReader', 'Blob', 'File', 'URL', 'URLSearchParams', 'CustomEvent', 'Event',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle',
  'requestIdleCallback', 'matchMedia', 'history', 'location', 'crypto',
  'performance', 'atob', 'btoa', 'AbortController', 'DOMParser', 'Image',
  // CDN libraries loaded before the local scripts
  'XLSX', 'supabase',
]);

const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'in', 'of', 'new', 'delete', 'void', 'instanceof', 'yield', 'await', 'do',
  'else', 'try', 'finally', 'throw', 'let', 'const', 'var', 'class', 'super',
  'async', 'static', 'get', 'set', 'this', 'null', 'true', 'false', 'undefined',
]);

// ── 5. Scan for call sites and flag anything undefined ──────────────────────
const CALL_RE = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

// Names guarded by `typeof NAME === 'function'` (or `!== 'undefined'`) anywhere
// in the bundle are intentionally-optional call sites — a common, legitimate JS
// idiom for "call this if it exists." These are reported separately as
// warnings, not hard failures, so the gate doesn't block on a deliberate
// runtime-optional call.
const TYPEOF_GUARD_RE = /typeof\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:===?|!==?)\s*['"](?:function|undefined)['"]/g;
const guarded = new Set();
fileCode.forEach(f => {
  // Scan the RAW source, not the code-only text — the 'function'/'undefined'
  // string literal this guard checks against is exactly what codeOnly() blanks.
  let mm;
  TYPEOF_GUARD_RE.lastIndex = 0;
  while ((mm = TYPEOF_GUARD_RE.exec(f.src))) guarded.add(mm[1]);
});

const missing = new Map();  // name -> [{file, line}] — hard failures
const optional = new Map(); // name -> [{file, line}] — typeof-guarded, warn only
fileCode.forEach(f => {
  const lines = f.code.split('\n');
  lines.forEach((line, idx) => {
    let mm;
    CALL_RE.lastIndex = 0;
    while ((mm = CALL_RE.exec(line))) {
      const name = mm[1];
      if (RESERVED.has(name)) continue;
      if (defined.has(name) || ALLOWLIST.has(name)) continue;
      const bucket = guarded.has(name) ? optional : missing;
      if (!bucket.has(name)) bucket.set(name, []);
      bucket.get(name).push({ file: f.rel, line: idx + 1 });
    }
  });
});

console.log('');
if (optional.size) {
  console.log(`ℹ ${optional.size} typeof-guarded (intentionally optional) reference(s) — not defined anywhere, but the call site checks for it first, so this is a warning, not a failure:`);
  for (const [name, sites] of optional) {
    console.log(`  - ${name}  (${sites.length} call site${sites.length > 1 ? 's' : ''})`);
    sites.slice(0, 3).forEach(s => console.log(`      ${s.file}:${s.line}`));
  }
  console.log('');
}

if (missing.size) {
  console.error(`‼ ${missing.size} possibly-undefined reference(s):`);
  for (const [name, sites] of missing) {
    console.error(`  - ${name}  (${sites.length} call site${sites.length > 1 ? 's' : ''})`);
    sites.slice(0, 3).forEach(s => console.error(`      ${s.file}:${s.line}`));
    if (sites.length > 3) console.error(`      … and ${sites.length - 3} more`);
  }
} else {
  console.log(`✓ Every call site resolves to a defined name or known global (${defined.size} names defined across ${files.length} files)`);
}

console.log('');
if (!syntaxOk || missing.size) {
  console.error('❌  REFERENCE CHECK FAILED');
  process.exit(1);
} else {
  console.log('✅  REFERENCE CHECK PASSED');
  process.exit(0);
}
