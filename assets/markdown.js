/*
 * leitor_md — motor Markdown
 * Implementação própria, sem dependências, sem build.
 * Licença MIT.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * utilidades
   * ------------------------------------------------------------------ */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      return '&quot;';
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function sanitizeUrl(url, allowData) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif);/i.test(u)) {
      return allowData ? u : '';
    }
    if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) {
      return /^(https?:|mailto:|tel:)/i.test(u) ? u : '';
    }
    return u;
  }

  function countRun(s, i, ch) {
    var n = 0;
    while (s[i + n] === ch) n++;
    return n;
  }

  function slugify(text, seen) {
    var base = String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (!base) base = 'secao';
    var n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : base + '-' + n;
  }

  function plainInline(text) {
    return String(text)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/\*\*\*|\*\*|\*|___|__|~~|==/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------ *
   * matemática (subconjunto de TeX)
   * ------------------------------------------------------------------ */

  var TEX_SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
    equiv: '≡', sim: '∼', propto: '∝', infty: '∞', partial: '∂', nabla: '∇',
    sum: '∑', prod: '∏', int: '∫', oint: '∮', sqrt: '√',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
    forall: '∀', exists: '∃', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
    cup: '∪', cap: '∩', emptyset: '∅', neg: '¬', land: '∧', lor: '∨',
    ldots: '…', cdots: '⋯', prime: '′', degree: '°',
    quad: '\u2003', qquad: '\u2003\u2003'
  };

  function texToHtml(source) {
    var s = escapeHtml(String(source).trim());

    // \frac{a}{b} e \sqrt{x}, com repetição para aninhamento simples
    for (var pass = 0; pass < 3; pass++) {
      var before = s;
      s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
        '<span class="mfrac"><span class="mnum">$1</span><span class="mden">$2</span></span>');
      s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g,
        '<span class="msqrt">√<span class="mrad">$1</span></span>');
      if (s === before) break;
    }

    s = s.replace(/\\text\s*\{([^{}]*)\}/g, '<span class="mtext">$1</span>');
    s = s.replace(/\\mathrm\s*\{([^{}]*)\}/g, '<span class="mtext">$1</span>');

    // símbolos nomeados
    s = s.replace(/\\\\([a-zA-Z]+)/g, function (all, name) {
      return Object.prototype.hasOwnProperty.call(TEX_SYMBOLS, name) ? TEX_SYMBOLS[name] : all;
    });
    s = s.replace(/\\([a-zA-Z]+)/g, function (all, name) {
      return Object.prototype.hasOwnProperty.call(TEX_SYMBOLS, name) ? TEX_SYMBOLS[name] : '\\' + name;
    });

    // expoentes e índices
    s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
    s = s.replace(/\^([A-Za-z0-9+\-])/g, '<sup>$1</sup>');
    s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
    s = s.replace(/_([A-Za-z0-9+\-])/g, '<sub>$1</sub>');

    return s;
  }

  function mathInline(tex) {
    return '<span class="math math-inline">' + texToHtml(tex) + '</span>';
  }

  function mathBlock(tex) {
    return '<div class="math math-block">' + texToHtml(tex) + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * destaque de código
   * ------------------------------------------------------------------ */

  var KEYWORDS = {
    js: 'const let var function return if else for while do switch case default break continue class extends new this super import export from as async await try catch finally throw typeof instanceof void delete in of yield static get set true false null undefined NaN Infinity',
    ts: 'const let var function return if else for while do switch case default break continue class extends implements interface type enum namespace import export from as async await try catch finally throw typeof instanceof void delete in of yield static public private protected readonly true false null undefined',
    py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda global nonlocal yield assert del in is not and or None True False async await print self',
    go: 'package import func var const type struct interface map chan go defer return if else for range switch case default break continue fallthrough select nil true false make new len cap append string int int64 float64 bool error',
    rs: 'fn let mut const static struct enum impl trait pub use mod crate self super return if else match for while loop break continue where async await move ref dyn unsafe true false Some None Ok Err',
    java: 'public private protected class interface extends implements new return if else for while do switch case default break continue try catch finally throw throws import package static final void int long double float boolean char String true false null this super abstract synchronized',
    c: 'int char float double void long short unsigned signed struct union enum typedef static const volatile extern return if else for while do switch case default break continue goto sizeof include define ifdef ifndef endif true false NULL',
    sh: 'if then else elif fi for while do done case esac function return local export echo cd exit set unset source sudo rm cp mv mkdir curl wget grep sed awk',
    sql: 'select from where insert into values update set delete create table drop alter add index join left right inner outer on group by order having limit offset as and or not null distinct union all case when then else end primary key foreign references default',
    css: 'important media supports keyframes import charset font-face from to and not only screen print all',
    json: 'true false null'
  };

  var LANG_ALIASES = {
    javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
    typescript: 'ts', tsx: 'ts',
    python: 'py', py3: 'py',
    golang: 'go', rust: 'rs',
    bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh',
    postgres: 'sql', mysql: 'sql', sqlite: 'sql',
    scss: 'css', less: 'css',
    htm: 'html', xml: 'html', svg: 'html', vue: 'html',
    cpp: 'c', 'c++': 'c', h: 'c', csharp: 'java', cs: 'java', kotlin: 'java',
    yml: 'yaml', toml: 'yaml', ini: 'yaml',
    markdown: 'md'
  };

  function rulesFor(lang) {
    var key = LANG_ALIASES[lang] || lang;
    var rules = [];

    if (key === 'html') {
      rules.push({ t: 'com', re: /<!--[\s\S]*?-->/y });
      rules.push({ t: 'tag', re: /<\/?[a-zA-Z][^>]*>/y });
      return { rules: rules, keywords: null, key: key };
    }
    if (key === 'md') {
      rules.push({ t: 'kw', re: /^#{1,6}[^\n]*/my });
      rules.push({ t: 'str', re: /`[^`\n]*`/y });
      rules.push({ t: 'com', re: /<!--[\s\S]*?-->/y });
      return { rules: rules, keywords: null, key: key };
    }

    if (key === 'py' || key === 'sh' || key === 'yaml') {
      rules.push({ t: 'com', re: key === 'yaml' ? /#[^\n]*/y : /#[^\n]*/y });
    } else {
      rules.push({ t: 'com', re: /\/\/[^\n]*/y });
      rules.push({ t: 'com', re: /\/\*[\s\S]*?\*\//y });
    }
    if (key === 'sql') rules.push({ t: 'com', re: /--[^\n]*/y });

    rules.push({ t: 'str', re: /"(?:\\.|[^"\\\n])*"/y });
    rules.push({ t: 'str', re: /'(?:\\.|[^'\\\n])*'/y });
    if (key === 'js' || key === 'ts') rules.push({ t: 'str', re: /`(?:\\.|[^`\\])*`/y });
    rules.push({ t: 'num', re: /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y });

    var kw = KEYWORDS[key];
    return { rules: rules, keywords: kw ? new RegExp('(?:' + kw.trim().split(/\s+/).join('|') + ')\\b', 'y') : null, key: key };
  }

  function highlight(code, lang) {
    var cfg = rulesFor(String(lang || '').toLowerCase());
    var out = [];
    var i = 0;
    var plain = '';
    var n = code.length;

    function flush() {
      if (plain) { out.push(escapeHtml(plain)); plain = ''; }
    }

    while (i < n) {
      var matched = false;

      for (var r = 0; r < cfg.rules.length; r++) {
        var rule = cfg.rules[r];
        rule.re.lastIndex = i;
        var m = rule.re.exec(code);
        if (m && m.index === i && m[0].length) {
          flush();
          out.push('<span class="tok-' + rule.t + '">' + escapeHtml(m[0]) + '</span>');
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      if (cfg.keywords) {
        cfg.keywords.lastIndex = i;
        var k = cfg.keywords.exec(code);
        if (k && k.index === i) {
          var prev = i > 0 ? code[i - 1] : '';
          if (!/[A-Za-z0-9_$]/.test(prev)) {
            flush();
            out.push('<span class="tok-kw">' + escapeHtml(k[0]) + '</span>');
            i += k[0].length;
            continue;
          }
        }
      }

      plain += code[i];
      i++;
    }
    flush();
    return out.join('');
  }

  /* ------------------------------------------------------------------ *
   * inline
   * ------------------------------------------------------------------ */

  function inline(text, ctx) {
    var s = String(text);
    var out = '';
    var i = 0;
    var n = s.length;

    function emit(x) { out += x; }

    while (i < n) {
      var c = s[i];

      // escape
      if (c === '\\' && i + 1 < n && /[\\`*_{}\[\]()#+\-.!~=|<>$^]/.test(s[i + 1])) {
        emit(escapeHtml(s[i + 1]));
        i += 2;
        continue;
      }

      // código inline
      if (c === '`') {
        var run = countRun(s, i, '`');
        var close = s.indexOf('`'.repeat(run), i + run);
        if (close > i) {
          emit('<code>' + escapeHtml(s.slice(i + run, close)) + '</code>');
          i = close + run;
          continue;
        }
      }

      // matemática inline
      if (c === '$') {
        var mm = /^\$([^$\n]+)\$/.exec(s.slice(i));
        if (mm && !/^\s/.test(mm[1]) && !/\s$/.test(mm[1])) {
          emit(mathInline(mm[1]));
          i += mm[0].length;
          continue;
        }
      }

      // imagem
      if (c === '!' && s[i + 1] === '[') {
        var im = /^!\[([^\]\n]*)\]\(\s*([^)\s]*)(?:\s+&quot;([^"]*)&quot;)?\s*\)/.exec(s.slice(i)) ||
                 /^!\[([^\]\n]*)\]\(\s*([^)\s]*)(?:\s+"([^"]*)")?\s*\)/.exec(s.slice(i));
        if (im) {
          var src = sanitizeUrl(im[2], true);
          if (src) {
            emit('<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(im[1]) + '"' +
              (im[3] ? ' title="' + escapeAttr(im[3]) + '"' : '') + ' loading="lazy">');
          } else {
            emit(escapeHtml(im[0]));
          }
          i += im[0].length;
          continue;
        }
      }

      // links, notas de rodapé e referências
      if (c === '[') {
        var fn = /^\[\^([^\]\n]+)\]/.exec(s.slice(i));
        if (fn && ctx.footnotes.has(fn[1])) {
          emit(ctx.footnoteRef(fn[1]));
          i += fn[0].length;
          continue;
        }

        var lk = /^\[([^\]\n]*)\]\(\s*([^)\s]*)(?:\s+"([^"]*)")?\s*\)/.exec(s.slice(i));
        if (lk) {
          var href = sanitizeUrl(lk[2], false);
          if (!href && lk[2]) {
            // esquema perigoso (javascript:, data:, vbscript:…): mantém como texto
            emit(escapeHtml(lk[0]));
            i += lk[0].length;
            continue;
          }
          emit('<a href="' + escapeAttr(href) + '"' + (lk[3] ? ' title="' + escapeAttr(lk[3]) + '"' : '') +
            (href && !href.startsWith('#') ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
            inline(lk[1], ctx) + '</a>');
          i += lk[0].length;
          continue;
        }

        var rf = /^\[([^\]\n]+)\]\[([^\]\n]*)\]/.exec(s.slice(i));
        if (rf) {
          var id = (rf[2] || rf[1]).trim().toLowerCase();
          var def = ctx.refs.get(id);
          if (def) {
            var rhref = sanitizeUrl(def.url, false);
            emit('<a href="' + escapeAttr(rhref) + '"' +
              (def.title ? ' title="' + escapeAttr(def.title) + '"' : '') +
              (rhref && !rhref.startsWith('#') ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
              inline(rf[1], ctx) + '</a>');
            i += rf[0].length;
            continue;
          }
        }
      }

      // autolinks e HTML cru
      if (c === '<') {
        var al = /^<((?:https?|mailto):[^>\s]+)>/.exec(s.slice(i));
        if (al) {
          emit('<a href="' + escapeAttr(al[1]) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(al[1]) + '</a>');
          i += al[0].length;
          continue;
        }
        emit('&lt;');
        i++;
        continue;
      }

      // ênfase
      if (c === '*' || c === '_') {
        var rl = countRun(s, i, c);
        var prev = i > 0 ? s[i - 1] : ' ';
        var next = s[i + rl];

        if (c === '_' && /[A-Za-z0-9]/.test(prev)) {
          emit(c);
          i++;
          continue;
        }
        if (next === undefined || /\s/.test(next)) {
          emit(escapeHtml(c.repeat(rl)));
          i += rl;
          continue;
        }

        var done = false;
        var tries = [3, 2, 1];
        for (var t = 0; t < tries.length && !done; t++) {
          var k2 = tries[t];
          if (k2 > rl) continue;
          var delim = c.repeat(k2);
          var closeAt = s.indexOf(delim, i + k2);
          if (closeAt <= i + k2) continue;
          var inner = s.slice(i + k2, closeAt);
          if (/[\s]$/.test(inner)) continue;
          if (c === '_' && /[A-Za-z0-9]/.test(s[closeAt + k2] || '')) continue;
          var ih = inline(inner, ctx);
          if (k2 === 3) emit('<strong><em>' + ih + '</em></strong>');
          else if (k2 === 2) emit('<strong>' + ih + '</strong>');
          else emit('<em>' + ih + '</em>');
          i = closeAt + k2;
          done = true;
        }
        if (done) continue;
        emit(escapeHtml(c.repeat(rl)));
        i += rl;
        continue;
      }

      // riscado e subscrito
      if (c === '~') {
        if (s[i + 1] === '~') {
          var dc = s.indexOf('~~', i + 2);
          if (dc > i + 2) {
            emit('<del>' + inline(s.slice(i + 2, dc), ctx) + '</del>');
            i = dc + 2;
            continue;
          }
        } else {
          var sc = s.indexOf('~', i + 1);
          if (sc > i + 1 && !/[\s~]/.test(s.slice(i + 1, sc))) {
            emit('<sub>' + inline(s.slice(i + 1, sc), ctx) + '</sub>');
            i = sc + 1;
            continue;
          }
        }
      }

      // realce
      if (c === '=' && s[i + 1] === '=') {
        var hc = s.indexOf('==', i + 2);
        if (hc > i + 2) {
          emit('<mark>' + inline(s.slice(i + 2, hc), ctx) + '</mark>');
          i = hc + 2;
          continue;
        }
      }

      // sobrescrito
      if (c === '^' && s[i + 1] !== '^') {
        var uc = s.indexOf('^', i + 1);
        if (uc > i + 1 && !/[\s]/.test(s.slice(i + 1, uc))) {
          emit('<sup>' + inline(s.slice(i + 1, uc), ctx) + '</sup>');
          i = uc + 1;
          continue;
        }
      }

      // URL solta
      if (c === 'h' && (i === 0 || /[\s(]/.test(s[i - 1]))) {
        var au = /^https?:\/\/[^\s<>"')]+/.exec(s.slice(i));
        if (au) {
          var clean = au[0].replace(/[.,;:!?]+$/, '');
          emit('<a href="' + escapeAttr(clean) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(clean) + '</a>');
          i += clean.length;
          continue;
        }
      }

      if (c === '\n') {
        if (ctx.hardBreak) {
          emit('<br>');
        } else if (/ {2,}$/.test(out)) {
          out = out.replace(/ +$/, '');
          emit('<br>');
        } else {
          emit('\n');
        }
        i++;
        continue;
      }

      emit(escapeHtml(c));
      i++;
    }

    return out;
  }

  /* ------------------------------------------------------------------ *
   * blocos
   * ------------------------------------------------------------------ */

  function Parser(src, options) {
    this.lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    this.options = options || {};
    this.headings = [];
    this.refs = new Map();
    this.footnotes = new Map();
    this.footnoteOrder = [];
    this.slugs = new Map();
    this.lineMap = [];
  }

  Parser.prototype.preprocess = function () {
    var keep = [];
    var self = this;

    for (var i = 0; i < this.lines.length; i++) {
      var line = this.lines[i];
      var fn = /^\[\^([^\]\n]+)\]:\s*(.*)$/.exec(line);
      if (fn) {
        this.footnotes.set(fn[1], fn[2]);
        keep.push('');
        continue;
      }
      var ref = /^\[([^\]\n]+)\]:\s*<?([^\s>]+)>?(?:\s+"([^"]*)")?\s*$/.exec(line);
      if (ref && !ref[1].startsWith('^')) {
        this.refs.set(ref[1].trim().toLowerCase(), { url: ref[2], title: ref[3] || '' });
        keep.push('');
        continue;
      }
      keep.push(line);
    }

    // front matter YAML
    var start = 0;
    while (start < keep.length && keep[start].trim() === '') start++;
    if (keep[start] === '---') {
      for (var j = start + 1; j < keep.length; j++) {
        if (keep[j] === '---' || keep[j] === '...') {
          for (var k = start; k <= j; k++) keep[k] = '';
          break;
        }
      }
    }

    this.lines = keep;
  };

  Parser.prototype.parse = function () {
    this.preprocess();
    var self = this;

    var ctx = {
      refs: this.refs,
      footnotes: this.footnotes,
      hardBreak: !!this.options.hardBreak,
      footnoteRef: function (id) {
        var idx = self.footnoteOrder.indexOf(id);
        if (idx === -1) {
          self.footnoteOrder.push(id);
          idx = self.footnoteOrder.length - 1;
        }
        var num = idx + 1;
        return '<sup class="fn-ref"><a href="#fn-' + escapeAttr(id) + '" id="fnref-' + escapeAttr(id) +
          '">' + num + '</a></sup>';
      }
    };
    this.ctx = ctx;

    var html = this.blocks(0, this.lines.length);

    if (this.footnoteOrder.length) {
      var items = this.footnoteOrder.map(function (id, idx) {
        return '<li id="fn-' + escapeAttr(id) + '">' +
          inline(self.footnotes.get(id), ctx) +
          ' <a class="fn-back" href="#fnref-' + escapeAttr(id) + '" aria-label="voltar">↩</a></li>';
      }).join('');
      html += '<section class="footnotes"><hr><ol>' + items + '</ol></section>';
    }

    return { html: html, headings: this.headings };
  };

  function isFence(line) {
    return /^\s{0,3}(`{3,}|~{3,})/.test(line);
  }

  function isHr(line) {
    return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
  }

  function isHeading(line) {
    return /^\s{0,3}#{1,6}\s+/.test(line);
  }

  function isQuote(line) {
    return /^\s{0,3}>/.test(line);
  }

  function isList(line) {
    return /^\s{0,4}(?:[-*+]|\d{1,9}[.)])\s+/.test(line);
  }

  function isTableStart(lines, i) {
    if (!/\|/.test(lines[i] || '')) return false;
    var next = lines[i + 1] || '';
    return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(next) ||
      /^\s*\|?\s*:?-{1,}:?\s*\|?\s*$/.test(next);
  }

  function isIndentedCode(line) {
    return /^(?:    |\t)/.test(line);
  }

  Parser.prototype.blocks = function (from, to) {
    var lines = this.lines;
    var out = [];
    var i = from;

    while (i < to) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      var startLine = i;

      /* código cercado */
      if (isFence(line)) {
        var fm = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)[^\n]*$/.exec(line);
        var mark = fm ? fm[1] : '```';
        var lang = fm && fm[2] ? fm[2] : '';
        var body = [];
        i++;
        while (i < to && !new RegExp('^\\s{0,3}' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}\\s*$').test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        if (i < to) i++;
        var code = body.join('\n');
        var label = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
        out.push('<div class="code-block" data-line="' + startLine + '">' + label +
          '<pre><code class="language-' + escapeAttr(lang || 'texto') + '">' +
          highlight(code, lang) + '</code></pre></div>');
        continue;
      }

      /* bloco de matemática */
      if (/^\s{0,3}\$\$\s*$/.test(line)) {
        var mb = [];
        i++;
        while (i < to && !/^\s{0,3}\$\$\s*$/.test(lines[i])) { mb.push(lines[i]); i++; }
        if (i < to) i++;
        out.push('<div data-line="' + startLine + '">' + mathBlock(mb.join('\n')) + '</div>');
        continue;
      }

      /* bloco de matemática em uma única linha */
      var singleMath = /^\s{0,3}\$\$([\s\S]+?)\$\$\s*$/.exec(line);
      if (singleMath) {
        out.push('<div data-line="' + startLine + '">' + mathBlock(singleMath[1]) + '</div>');
        i++;
        continue;
      }

      /* título ATX */
      if (isHeading(line)) {
        var hm = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        var level = hm[1].length;
        var text = hm[2];
        var id = slugify(plainInline(text), this.slugs);
        this.headings.push({ level: level, text: plainInline(text), id: id, line: startLine });
        out.push('<h' + level + ' id="' + escapeAttr(id) + '" data-line="' + startLine + '">' +
          inline(text, this.ctx) + '</h' + level + '>');
        i++;
        continue;
      }

      /* título setext */
      if (i + 1 < to && /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1]) && line.trim() && !isList(line)) {
        var lv = lines[i + 1].trim()[0] === '=' ? 1 : 2;
        var sid = slugify(plainInline(line), this.slugs);
        this.headings.push({ level: lv, text: plainInline(line), id: sid, line: startLine });
        out.push('<h' + lv + ' id="' + escapeAttr(sid) + '" data-line="' + startLine + '">' +
          inline(line.trim(), this.ctx) + '</h' + lv + '>');
        i += 2;
        continue;
      }

      /* linha horizontal */
      if (isHr(line)) {
        out.push('<hr data-line="' + startLine + '">');
        i++;
        continue;
      }

      /* citação / alerta */
      if (isQuote(line)) {
        var quote = [];
        var first = true;
        while (i < to && (isQuote(lines[i]) || (lines[i].trim() !== '' && !isHeading(lines[i]) && !isFence(lines[i]) && !isQuote(lines[i]) && quote.length && /^\s{0,3}>/.test(quote[quote.length - 1] || '')))) {
          var qm = /^\s{0,3}>\s?(.*)$/.exec(lines[i]);
          quote.push(qm ? qm[1] : lines[i]);
          first = false;
          i++;
        }
        var alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/.exec(quote[0] || '');
        if (alert) {
          var kind = alert[1].toLowerCase();
          var titles = { note: 'Nota', tip: 'Dica', important: 'Importante', warning: 'Atenção', caution: 'Cuidado' };
          quote.shift();
          out.push('<div class="alert alert-' + kind + '" data-line="' + startLine + '">' +
            '<p class="alert-title">' + titles[kind] + '</p>' +
            this.blocksFrom(quote) + '</div>');
        } else {
          out.push('<blockquote data-line="' + startLine + '">' + this.blocksFrom(quote) + '</blockquote>');
        }
        continue;
      }

      /* tabela */
      if (isTableStart(lines, i)) {
        var head = splitRow(lines[i]);
        var align = splitRow(lines[i + 1]).map(function (cell) {
          var c = cell.trim();
          var left = c.startsWith(':');
          var right = c.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return '';
        });
        i += 2;
        var rows = [];
        while (i < to && /\|/.test(lines[i]) && lines[i].trim() !== '') {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var thead = head.map(function (c, ci) {
          return '<th' + (align[ci] ? ' style="text-align:' + align[ci] + '"' : '') + '>' +
            inline(c.trim(), this.ctx) + '</th>';
        }, this).join('');
        var tbody = rows.map(function (row) {
          var tds = row.map(function (c, ci) {
            return '<td' + (align[ci] ? ' style="text-align:' + align[ci] + '"' : '') + '>' +
              inline(c.trim(), this.ctx) + '</td>';
          }, this).join('');
          return '<tr>' + tds + '</tr>';
        }, this).join('');
        out.push('<div class="table-wrap" data-line="' + startLine + '"><table><thead><tr>' +
          thead + '</tr></thead><tbody>' + tbody + '</tbody></table></div>');
        continue;
      }

      /* listas */
      if (isList(line)) {
        var res = this.parseList(i, to);
        out.push(res.html);
        i = res.next;
        continue;
      }

      /* código indentado */
      if (isIndentedCode(line)) {
        var ic = [];
        while (i < to && (isIndentedCode(lines[i]) || lines[i].trim() === '')) {
          ic.push(lines[i].replace(/^(?:    |\t)/, ''));
          i++;
        }
        out.push('<div class="code-block" data-line="' + startLine + '"><pre><code>' +
          escapeHtml(ic.join('\n').replace(/\n+$/, '')) + '</code></pre></div>');
        continue;
      }

      /* parágrafo */
      var para = [line];
      i++;
      while (i < to && lines[i].trim() !== '' &&
             !isHeading(lines[i]) && !isFence(lines[i]) && !isHr(lines[i]) &&
             !isQuote(lines[i]) && !isList(lines[i]) && !isTableStart(lines, i)) {
        para.push(lines[i]);
        i++;
      }
      out.push('<p data-line="' + startLine + '">' + inline(para.join('\n').trim(), this.ctx) + '</p>');
    }

    return out.join('\n');
  };

  Parser.prototype.blocksFrom = function (arr) {
    var sub = new Parser(arr.join('\n'), this.options);
    sub.refs = this.refs;
    sub.footnotes = this.footnotes;
    sub.footnoteOrder = this.footnoteOrder;
    sub.slugs = this.slugs;
    sub.ctx = this.ctx;
    sub.lines = arr;
    return sub.blocks(0, arr.length);
  };

  function splitRow(line) {
    var s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    var cells = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (s[i] === '|') { cells.push(cur); cur = ''; continue; }
      cur += s[i];
    }
    cells.push(cur);
    return cells;
  }

  Parser.prototype.parseList = function (start, to) {
    var lines = this.lines;
    var first = /^(\s{0,4})([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[start]);
    var baseIndent = first[1].length;
    var ordered = /\d/.test(first[2]);
    var startNum = ordered ? parseInt(first[2], 10) : 1;
    var items = [];
    var i = start;

    while (i < to) {
      var m = /^(\s{0,4})([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i]);
      if (!m) break;
      var indent = m[1].length;
      var thisOrdered = /\d/.test(m[2]);
      if (indent !== baseIndent || thisOrdered !== ordered) break;

      var content = m[3];
      var itemStart = i;
      i++;

      while (i < to) {
        var l = lines[i];
        if (/^\s*$/.test(l)) {
          if (i + 1 < to && /^\s{0,10}\S/.test(lines[i + 1]) && /^(\s{2,}|\s*[-*+]|\s*\d)/.test(lines[i + 1])) {
            content += '\n';
            i++;
            continue;
          }
          break;
        }
        var nm = /^(\s{0,4})([-*+]|\d{1,9}[.)])\s+/.exec(l);
        if (nm && nm[1].length === baseIndent) break;
        var lead = /^(\s*)/.exec(l)[1].length;
        if (lead > baseIndent) {
          content += '\n' + l.replace(new RegExp('^\\s{0,' + (lead) + '}'), '');
          i++;
          continue;
        }
        break;
      }

      items.push({ content: content, line: itemStart });
    }

    var html = [];
    var isTask = false;

    for (var k = 0; k < items.length; k++) {
      var c = items[k].content;
      var task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(c);

      if (task) {
        isTask = true;
        var checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
        html.push('<li class="task-item"><input type="checkbox" class="task" disabled' + checked + '> ' +
          inline(task[2], this.ctx) + '</li>');
        continue;
      }

      var body = this.blocksFrom(c.split('\n'));
      body = body.replace(/^<p([^>]*)>([\s\S]*)<\/p>$/, function (all, attrs, inner) {
        return inner.indexOf('<p') === -1 ? inner : all;
      });
      html.push('<li>' + body + '</li>');
    }

    var tag = ordered ? 'ol' : 'ul';
    var attrs = ordered && startNum !== 1 ? ' start="' + startNum + '"' : '';
    if (isTask) attrs += ' class="task-list"';

    return {
      html: '<' + tag + attrs + ' data-line="' + start + '">' + html.join('') + '</' + tag + '>',
      next: i
    };
  };

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  function render(src, options) {
    var p = new Parser(src || '', options || {});
    var res = p.parse();
    return {
      html: res.html,
      headings: res.headings,
      wordCount: stats(src || '').words
    };
  }

  function stats(text) {
    var t = String(text || '');
    var cjkMatches = t.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || [];
    var latin = t.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ');
    latin = latin
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~=`|-]/g, ' ');
    var words = (latin.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*/g) || []).length + cjkMatches.length;
    var lines = t ? t.split('\n').length : 0;
    return {
      words: words,
      chars: t.length,
      charsNoSpace: t.replace(/\s/g, '').length,
      lines: lines,
      paragraphs: t.split(/\n\s*\n/).filter(function (x) { return x.trim(); }).length
    };
  }

  global.LeitorMD = {
    render: render,
    stats: stats,
    highlight: highlight,
    escapeHtml: escapeHtml,
    texToHtml: texToHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
