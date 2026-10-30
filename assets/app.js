/*
 * Iluminura — aplicação
 * JavaScript puro, sem dependências. Licença MIT.
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var Caminhos = window.LeitorCaminhos;
  var Diff = window.IluminuraDiff;

  var APP_VERSION = '1.6.0';
  /* chaves históricas mantidas para preservar preferências e rascunhos */
  var LS_PREFS = 'leitormd.prefs.v1';
  var LS_DRAFT = 'leitormd.draft.v1';
  var LS_RECENT = 'leitormd.recent.v1';
  var LS_DISK_HISTORY = 'iluminura.disk.history.v1';

  var DEFAULTS = {
    theme: 'claro',
    font: 'sans',
    width: '46rem',
    size: 16,
    highlight: true,
    autopair: true,
    autosave: true,
    externalMode: 'review',
    sync: true,
    hardBreak: false,
    mode: 'split',
    sidebar: true,
    splitRatio: 0.5,
    toolbar: true,
    focus: false,
    typewriter: false,
    zoom: 100,
    speed: 240
  };

  var FONTS = {
    sans: '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    mono: 'ui-monospace, "Cascadia Code", Consolas, monospace'
  };

  var state = {
    prefs: Object.assign({}, DEFAULTS),
    text: '',
    savedText: '',
    name: 'sem-titulo.md',
    handle: null,
    dirHandle: null,
    fileTree: null,
    docPath: null,
    renderSeq: 0,
    noticeDismissed: false,
    imageCache: new Map(),
    imagePending: new Map(),
    diskStamp: null,
    diskNoticeKind: null,
    diskNoticeStamp: null,
    diskConflict: false,
    diskHistory: null,
    review: null,
    saving: false,
    dirty: false,
    headings: [],
    lastRender: 0,
    syncing: null,
    find: { matches: [], index: -1 },
    openTab: 'outline',
    search: {
      query: '',
      results: [],
      seq: 0,
      busy: false,
      summary: '',
      truncated: false,
      filesScanned: 0
    }
  };

  var el = {};
  var editor, preview, previewScroll, hlInner, findbar;
  var appliedTheme = null;
  var deferredInstallPrompt = null;
  var diskObserver = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    toast('Iluminura instalado.');
  });
  var diskPollTimer = null;
  var diskCheckBusy = false;

  /* ------------------------------------------------------------------ *
   * preferências
   * ------------------------------------------------------------------ */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(LS_PREFS);
      if (raw) {
        var saved = JSON.parse(raw);
        state.prefs = Object.assign({}, DEFAULTS, saved);

        if (!saved.externalMode) {
          state.prefs.externalMode = saved.autoReload === false ? 'off' : 'review';
        }

        if (['review', 'auto', 'off'].indexOf(state.prefs.externalMode) === -1) {
          state.prefs.externalMode = 'review';
        }

        delete state.prefs.autoReload;
      }
    } catch (e) { /* armazenamento indisponível */ }
  }

  function savePrefs() {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(state.prefs)); } catch (e) {}
  }

  function applyPrefs() {
    var p = state.prefs;
    var root = document.documentElement;
    var themeChanged = appliedTheme !== p.theme;
    appliedTheme = p.theme;

    root.dataset.theme = p.theme;

    var scale = p.zoom / 100;
    root.style.setProperty('--doc-size', (p.size * scale).toFixed(2) + 'px');
    root.style.setProperty('--editor-size', (13.5 * scale).toFixed(2) + 'px');
    root.style.setProperty('--doc-font', FONTS[p.font] || FONTS.sans);
    root.style.setProperty('--content-width', p.width === 'none' ? 'none' : p.width);

    el.app.classList.toggle('hl-source', !!p.highlight);
    el.app.classList.toggle('focusmode', !!p.focus);
    el.app.classList.toggle('sidebar-hidden', !p.sidebar);
    el.app.classList.remove('mode-split', 'mode-read', 'mode-source');
    el.app.classList.add('mode-' + p.mode);

    el.toolbar.classList.toggle('on', !!p.toolbar);
    $('#btn-toolbar').classList.toggle('on', !!p.toolbar);
    $('#btn-sidebar').classList.toggle('on', !!p.sidebar);
    $('#btn-sidebar').setAttribute('aria-pressed', p.sidebar ? 'true' : 'false');
    $('#btn-focus').classList.toggle('on', !!p.focus);
    $('#btn-typewriter').classList.toggle('on', !!p.typewriter);

    $('#theme-select').value = p.theme;
    $('#pref-theme').value = p.theme;
    $('#pref-font').value = p.font;
    $('#pref-width').value = p.width;
    $('#pref-size').value = p.size;
    $('#pref-highlight').checked = p.highlight;
    $('#pref-autopair').checked = p.autopair;
    $('#pref-autosave').checked = p.autosave;
    $('#pref-external-mode').value = p.externalMode;
    $('#pref-sync').checked = p.sync;
    $('#pref-linebreak').checked = p.hardBreak;
    $('#reading-speed').value = String(p.speed);
    $('#stat-zoom').textContent = p.zoom + '%';

    applySplitRatio();
    if (themeChanged && preview && preview.querySelector('.mermaid-block')) {
      scheduleMermaid(state.renderSeq);
    }
    syncToolbarState();
    paintSource();
  }

  function setPref(key, value) {
    state.prefs[key] = value;
    savePrefs();
    applyPrefs();
  }

  /* ------------------------------------------------------------------ *
   * documento e renderização
   * ------------------------------------------------------------------ */

  function renderNow() {
    var seq = ++state.renderSeq;
    var result = LeitorMD.render(state.text, { hardBreak: state.prefs.hardBreak });
    preview.innerHTML = result.html;
    state.headings = result.headings;
    updateStats();
    buildOutline();
    resolveDocImages(seq);
    scheduleMermaid(seq);
  }

  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderNow();
    }, 90);
  }

  function updateStats() {
    var s = LeitorMD.stats(state.text);
    $('#stat-words').textContent = s.words.toLocaleString('pt-BR') + (s.words === 1 ? ' palavra' : ' palavras');
    $('#stat-chars').textContent = s.chars.toLocaleString('pt-BR') + ' caracteres';
    $('#stat-lines').textContent = s.lines.toLocaleString('pt-BR') + ' linhas';
    var minutes = Math.max(1, Math.round(s.words / (state.prefs.speed || 240)));
    $('#stat-reading').textContent = '~' + minutes + ' min de leitura';
  }

  function markDirty(dirty) {
    state.dirty = dirty;
    var st = $('#state');
    if (!dirty) {
      st.textContent = 'salvo';
      st.className = 'state saved';
    } else {
      st.textContent = 'não salvo';
      st.className = 'state dirty';
    }
  }

  function setDoc(text, name, handle, docPath) {
    state.text = text;
    state.savedText = text;
    state.handle = handle || null;
    state.docPath = docPath || null;
    state.noticeDismissed = false;
    state.diskStamp = null;
    state.diskNoticeKind = null;
    state.diskNoticeStamp = null;
    state.diskConflict = false;
    state.diskHistory = null;
    state.review = null;
    state.saving = false;
    if (name) state.name = name;
    editor.value = text;
    editor.setSelectionRange(0, 0);
    markDirty(false);
    document.title = state.name + ' — Iluminura';
    renderNow();
    paintSource();
    syncHeadingSelect();
    editor.scrollTop = 0;
    previewScroll.scrollTop = 0;
    hideDiskNotice();
    resetHistory();
    startDiskWatch();
  }

  /* ------------------------------------------------------------------ *
   * histórico de edição (desfazer / refazer)
   * ------------------------------------------------------------------ */

  var HISTORY_MAX_STEPS = 120;
  var HISTORY_MAX_CHARS = 8 * 1024 * 1024;
  var history = { stack: [], index: -1 };
  var historyTimer = null;

  function historySnapshot() {
    return {
      text: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
      scrollTop: editor.scrollTop,
      previewTop: previewScroll.scrollTop
    };
  }

  function resetHistory() {
    clearTimeout(historyTimer);
    historyTimer = null;
    history.stack = [historySnapshot()];
    history.index = 0;
  }

  function trimHistory() {
    var total = 0;
    history.stack.forEach(function (entry) { total += entry.text.length; });

    while (history.stack.length > 2 && total > HISTORY_MAX_CHARS) {
      total -= history.stack[0].text.length;
      history.stack.shift();
    }
    while (history.stack.length > HISTORY_MAX_STEPS) history.stack.shift();

    history.index = history.stack.length - 1;
  }

  function pushHistory() {
    clearTimeout(historyTimer);
    historyTimer = null;

    var snapshot = historySnapshot();
    var top = history.stack[history.index];

    if (top && top.text === snapshot.text) {
      top.start = snapshot.start;
      top.end = snapshot.end;
      top.scrollTop = snapshot.scrollTop;
      top.previewTop = snapshot.previewTop;
      return;
    }

    if (history.index < history.stack.length - 1) {
      history.stack.length = history.index + 1;
    }

    history.stack.push(snapshot);
    trimHistory();
  }

  function flushHistory() {
    clearTimeout(historyTimer);
    historyTimer = null;

    var top = history.stack[history.index];
    if (top && top.text === editor.value) {
      top.start = editor.selectionStart;
      top.end = editor.selectionEnd;
      top.scrollTop = editor.scrollTop;
      top.previewTop = previewScroll.scrollTop;
      return;
    }

    pushHistory();
  }

  function scheduleHistory() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(function () {
      historyTimer = null;
      pushHistory();
    }, 600);
  }

  function applyHistoryEntry(entry) {
    var max = entry.text.length;
    editor.value = entry.text;
    editor.setSelectionRange(Math.min(entry.start, max), Math.min(entry.end, max));
    editor.scrollTop = entry.scrollTop;

    state.text = entry.text;
    markDirty(entry.text !== state.savedText);
    renderNow();
    paintSource();
    syncHeadingSelect();
    syncOverlayScroll();
    previewScroll.scrollTop = entry.previewTop;

    if (state.prefs.autosave) scheduleDraft();
  }

  function undoEdit() {
    flushHistory();
    if (history.index <= 0) {
      editor.focus();
      return;
    }
    history.index--;
    applyHistoryEntry(history.stack[history.index]);
    editor.focus();
  }

  function redoEdit() {
    flushHistory();
    if (history.index >= history.stack.length - 1) {
      editor.focus();
      return;
    }
    history.index++;
    applyHistoryEntry(history.stack[history.index]);
    editor.focus();
  }

  /* ------------------------------------------------------------------ *
   * imagens relativas e pasta do documento
   * ------------------------------------------------------------------ */

  function getFileHandleFromRoot(root, relPath) {
    var parts = String(relPath || '').split('/').filter(Boolean);
    var name = parts.pop();
    if (!root || !name) return Promise.reject(new Error('Caminho inválido'));

    var chain = Promise.resolve(root);
    parts.forEach(function (part) {
      chain = chain.then(function (d) { return d.getDirectoryHandle(part); });
    });
    return chain.then(function (d) { return d.getFileHandle(name); });
  }

  function getFileFromRoot(root, relPath) {
    return getFileHandleFromRoot(root, relPath).then(function (h) { return h.getFile(); });
  }

  function loadImageUrl(relPath) {
    if (state.imageCache.has(relPath)) return Promise.resolve(state.imageCache.get(relPath));
    if (state.imagePending.has(relPath)) return state.imagePending.get(relPath);

    var root = state.dirHandle;
    var pending = getFileFromRoot(root, relPath).then(function (file) {
      if (root !== state.dirHandle) throw new Error('A pasta mudou durante a leitura');
      var url = URL.createObjectURL(file);
      state.imageCache.set(relPath, url);
      return url;
    });
    pending.then(function () {
      state.imagePending.delete(relPath);
    }, function () {
      state.imagePending.delete(relPath);
    });
    state.imagePending.set(relPath, pending);
    return pending;
  }

  function clearImageCache() {
    state.imageCache.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (e) { /* já revogada */ }
    });
    state.imageCache.clear();
    state.imagePending.clear();
  }

  function missingImageDataUri(label) {
    var cs = getComputedStyle(document.documentElement);
    var bg = cs.getPropertyValue('--bg-soft').trim() || '#f6f7f9';
    var border = cs.getPropertyValue('--border-strong').trim() || '#d0d5db';
    var fg = cs.getPropertyValue('--fg-dim').trim() || '#6b7280';
    var faint = cs.getPropertyValue('--fg-faint').trim() || '#9ca3af';
    var text = String(label || '').replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
    if (text.length > 64) text = text.slice(0, 61) + '…';

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="150" viewBox="0 0 640 150">' +
      '<rect x="1" y="1" width="638" height="148" rx="10" fill="' + bg + '" stroke="' + border + '" stroke-dasharray="8 6"/>' +
      '<text x="320" y="72" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="' + fg + '">Imagem não encontrada</text>' +
      '<text x="320" y="98" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="' + faint + '">' + text + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function markImageMissing(img) {
    if (img.dataset.imgState === 'missing') return;
    img.dataset.imgState = 'missing';
    if (img.dataset.origAlt === undefined) img.dataset.origAlt = img.alt || '';
    img.alt = img.dataset.origAlt
      ? img.dataset.origAlt + ' — imagem não encontrada'
      : 'Imagem não encontrada';
    img.classList.remove('doc-img-loading');
    img.classList.add('doc-img-missing');
    img.src = missingImageDataUri(img.dataset.origSrc || '');
    updateImageNotice();
  }

  function watchImage(img) {
    if (img.complete) {
      if (img.naturalWidth > 0) {
        img.dataset.imgState = 'ok';
      } else {
        markImageMissing(img);
      }
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      function done(ok) {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        if (ok) img.dataset.imgState = 'ok';
        else markImageMissing(img);
        resolve();
      }
      function onLoad() { done(true); }
      function onError() { done(false); }
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
    });
  }

  function resolveDocImages(seq) {
    var imgs = $$('#preview img');
    var relatives = [];

    imgs.forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (!Caminhos || !Caminhos.isRelative(src)) return;
      img.dataset.origSrc = src;
      relatives.push(img);
    });

    if (!relatives.length) {
      updateImageNotice();
      return;
    }

    var tasks = relatives.map(function (img) {
      var path = (state.dirHandle && state.docPath)
        ? Caminhos.resolve(state.docPath, img.dataset.origSrc)
        : null;

      if (!path) return watchImage(img);

      img.loading = 'eager';
      img.removeAttribute('src');
      img.classList.add('doc-img-loading');

      return loadImageUrl(path).then(function (url) {
        if (seq !== state.renderSeq || !img.isConnected) return;
        img.src = url;
        img.dataset.imgState = 'ok';
        img.dataset.docPath = path;
        img.classList.remove('doc-img-loading');
      }, function () {
        if (seq !== state.renderSeq || !img.isConnected) return;
        img.classList.remove('doc-img-loading');
        // fallback: deixa o navegador tentar o caminho relativo original
        img.src = img.dataset.origSrc;
        return watchImage(img);
      });
    });

    Promise.all(tasks).then(function () {
      if (seq === state.renderSeq) updateImageNotice();
    });
    updateImageNotice();
  }

  function updateImageNotice() {
    var notice = $('#doc-notice');
    if (!notice) return;

    var missing = $$('#preview img[data-img-state="missing"]').length;
    if (!missing || state.noticeDismissed) {
      notice.hidden = true;
      return;
    }

    var msg = missing === 1
      ? '1 imagem relativa não foi carregada.'
      : missing + ' imagens relativas não foram carregadas.';
    msg += state.dirHandle
      ? ' Confira se os arquivos estão na pasta aberta.'
      : ' Abra a pasta do documento para carregá-las.';
    $('#doc-notice-text').textContent = msg;

    var action = $('#doc-notice-action');
    if (action) action.textContent = state.dirHandle ? 'Abrir outra pasta…' : 'Abrir pasta do documento…';
    notice.hidden = false;
  }

  function hasRelativeImages() {
    return $$('#preview img').some(function (img) {
      var src = img.dataset.origSrc || img.getAttribute('src') || '';
      return Caminhos && Caminhos.isRelative(src);
    });
  }

  /* ------------------------------------------------------------------ *
   * diagramas Mermaid (biblioteca carregada sob demanda)
   * ------------------------------------------------------------------ */

  var MERMAID_SRC = 'assets/vendor/mermaid.min.js';
  var mermaidLoader = null;
  var mermaidThemeApplied = null;
  var mermaidTimer = null;
  var mermaidRun = 0;

  function mermaidThemeName() {
    if (state.prefs.theme === 'escuro') return 'dark';
    if (state.prefs.theme === 'sepia') return 'neutral';
    return 'default';
  }

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (mermaidLoader) return mermaidLoader;

    mermaidLoader = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = MERMAID_SRC;
      script.async = true;
      script.onload = function () {
        if (window.mermaid) {
          resolve(window.mermaid);
        } else {
          mermaidLoader = null;
          reject(new Error('Mermaid indisponível'));
        }
      };
      script.onerror = function () {
        mermaidLoader = null;
        reject(new Error('Falha ao carregar Mermaid'));
      };
      document.head.appendChild(script);
    });

    return mermaidLoader;
  }

  function initMermaid(mermaid, theme) {
    if (mermaidThemeApplied === theme) return;

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme,
      fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      flowchart: { useMaxWidth: true, htmlLabels: false },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      journey: { useMaxWidth: true },
      class: { useMaxWidth: true },
      state: { useMaxWidth: true },
      er: { useMaxWidth: true }
    });

    mermaidThemeApplied = theme;
  }

  function mermaidErrorText(err) {
    var text = err && err.message ? String(err.message) : 'Erro de sintaxe';
    return text.split('\n')[0].replace(/^Error:\s*/i, '');
  }

  function showMermaidError(block, message) {
    var canvas = block.querySelector('.mermaid-canvas');
    if (!canvas) return;

    var source = block.querySelector('.mermaid-source');
    canvas.textContent = '';

    var pre = document.createElement('pre');
    pre.className = 'mermaid-fallback';
    var code = document.createElement('code');
    code.textContent = source ? source.textContent : '';
    pre.appendChild(code);

    var note = document.createElement('div');
    note.className = 'mermaid-error';
    note.textContent = 'Diagrama Mermaid: ' + message;

    canvas.appendChild(pre);
    canvas.appendChild(note);
  }

  async function renderMermaidBlocks(seq, themeOverride) {
    if (seq !== undefined && seq !== state.renderSeq) return;

    clearTimeout(mermaidTimer);
    mermaidTimer = null;

    var blocks = $$('#preview .mermaid-block');
    if (!blocks.length) return;

    var run = ++mermaidRun;
    var mermaid;

    try {
      mermaid = await loadMermaid();
    } catch (err) {
      blocks.forEach(function (block) {
        if (block.dataset.mermaidState !== 'ready') {
          showMermaidError(block, 'não foi possível carregar a biblioteca.');
        }
      });
      return;
    }

    if (run !== mermaidRun || (seq !== undefined && seq !== state.renderSeq)) return;

    initMermaid(mermaid, themeOverride || mermaidThemeName());

    for (var i = 0; i < blocks.length; i++) {
      if (run !== mermaidRun || (seq !== undefined && seq !== state.renderSeq)) return;

      var block = blocks[i];
      if (!block.isConnected) continue;

      var sourceEl = block.querySelector('.mermaid-source');
      var canvas = block.querySelector('.mermaid-canvas');
      var source = sourceEl ? sourceEl.textContent.trim() : '';
      if (!canvas) continue;

      if (!source) {
        block.dataset.mermaidState = 'error';
        showMermaidError(block, 'diagrama vazio.');
        continue;
      }

      var id = 'mermaid-' + run + '-' + i + '-' + (Date.now() % 100000);
      block.dataset.mermaidState = 'rendering';

      try {
        var result = await mermaid.render(id, source);
        if (run !== mermaidRun || (seq !== undefined && seq !== state.renderSeq) || !block.isConnected) return;

        canvas.innerHTML = result.svg;
        block.dataset.mermaidState = 'ready';

        if (typeof result.bindFunctions === 'function') result.bindFunctions(canvas);
      } catch (err) {
        if (run !== mermaidRun || !block.isConnected) return;

        var stray = document.getElementById(id);
        if (stray) stray.remove();

        block.dataset.mermaidState = 'error';
        showMermaidError(block, mermaidErrorText(err));
      }
    }
  }

  function scheduleMermaid(seq) {
    clearTimeout(mermaidTimer);
    mermaidTimer = null;

    if (!preview.querySelector('.mermaid-block')) return;

    mermaidTimer = setTimeout(function () {
      mermaidTimer = null;
      renderMermaidBlocks(seq);
    }, 180);
  }

  async function findFileByName(root, name, basePath, depth, budget) {
    depth = depth || 0;
    budget = budget || { visited: 0 };
    if (depth > 6 || budget.visited > 3000) return null;

    var dirs = [];
    try {
      for await (var entry of root.values()) {
        if (++budget.visited > 3000) break;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        var path = basePath ? basePath + '/' + entry.name : entry.name;
        if (entry.kind === 'file' && entry.name.toLowerCase() === String(name).toLowerCase()) {
          return { handle: entry, path: path };
        }
        if (entry.kind === 'directory') dirs.push({ handle: entry, path: path });
      }
    } catch (e) {
      return null;
    }

    for (var i = 0; i < dirs.length; i++) {
      var found = await findFileByName(dirs[i].handle, name, dirs[i].path, depth + 1, budget);
      if (found) return found;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * sincronização com alterações externas no arquivo
   * ------------------------------------------------------------------ */

  function diskBound() {
    return !!(state.handle || (state.dirHandle && state.docPath));
  }

  function hasLocalEdits() {
    return state.dirty || (!!editor && editor.value !== state.savedText);
  }

  function stampOf(file) {
    return String(file.lastModified || 0) + ':' + String(file.size || 0);
  }

  async function readDiskSnapshot() {
    if (!diskBound()) return { status: 'unbound' };

    var handle = null;
    var error = null;

    if (state.dirHandle && state.docPath) {
      try {
        handle = await getFileHandleFromRoot(state.dirHandle, state.docPath);
      } catch (e) {
        error = e;
      }
    }

    if (!handle && state.handle) {
      try {
        await state.handle.getFile();
        handle = state.handle;
      } catch (e) {
        if (!error) error = e;
      }
    }

    if (!handle) {
      return {
        status: error && error.name === 'NotFoundError' ? 'missing' : 'error',
        error: error
      };
    }

    try {
      var file = await handle.getFile();
      return { status: 'ok', handle: handle, file: file };
    } catch (e) {
      return {
        status: e && e.name === 'NotFoundError' ? 'missing' : 'error',
        error: e
      };
    }
  }

  async function resolveDiskHandle() {
    var snap = await readDiskSnapshot();
    return snap.status === 'ok' ? snap.handle : null;
  }

  function hideDiskNotice() {
    state.diskNoticeKind = null;
    var notice = $('#disk-notice');
    if (notice) notice.hidden = true;
  }

  /* ------------------------------------------- histórico de versões -- */

  function diskHistoryKey() {
    return state.docPath || state.name || 'documento';
  }

  function loadDiskHistoryMap() {
    try {
      var raw = localStorage.getItem(LS_DISK_HISTORY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveDiskHistoryMap(map) {
    try {
      localStorage.setItem(LS_DISK_HISTORY, JSON.stringify(map));
    } catch (e) {
      /* quota indisponível: o histórico da sessão continua em memória */
    }
  }

  function trimDiskHistoryMap(map) {
    var total = 0;

    Object.keys(map).forEach(function (key) {
      if (!Array.isArray(map[key])) {
        delete map[key];
        return;
      }
      map[key].forEach(function (entry) { total += entry.text.length; });
    });

    while (total > 3000000) {
      var oldestKey = null;
      var oldestIndex = -1;
      var oldestAt = Infinity;

      Object.keys(map).forEach(function (key) {
        map[key].forEach(function (entry, index) {
          if (entry.at < oldestAt) {
            oldestAt = entry.at;
            oldestKey = key;
            oldestIndex = index;
          }
        });
      });

      if (!oldestKey) break;

      total -= map[oldestKey][oldestIndex].text.length;
      map[oldestKey].splice(oldestIndex, 1);
      if (!map[oldestKey].length) delete map[oldestKey];
    }
  }

  function recordDiskVersion(text, stamp) {
    var key = diskHistoryKey();
    var map = loadDiskHistoryMap();
    var list = Array.isArray(map[key]) ? map[key] : [];

    if (list.some(function (entry) { return entry.stamp === stamp; })) {
      state.diskHistory = list;
      return;
    }

    list.unshift({
      at: Date.now(),
      stamp: stamp,
      text: text
    });

    var chars = 0;
    list = list.filter(function (entry, index) {
      if (index >= 20) return false;
      chars += entry.text.length;
      return index === 0 || chars <= 2000000;
    });

    map[key] = list;
    trimDiskHistoryMap(map);
    saveDiskHistoryMap(map);
    state.diskHistory = list;
  }

  function getDiskHistory() {
    var map = loadDiskHistoryMap();
    var list = map[diskHistoryKey()];
    return Array.isArray(list) ? list : (state.diskHistory || []);
  }

  function formatHistoryTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return 'data indisponível';
    }
  }

  function showDiskNotice(kind) {
    var notice = $('#disk-notice');
    if (!notice) return;

    state.diskNoticeKind = kind;
    var text;

    if (kind === 'missing') {
      text = 'O arquivo "' + state.name + '" não foi encontrado no disco.';
    } else if (hasLocalEdits()) {
      text = 'O arquivo "' + state.name + '" mudou no disco. Revise as alterações; suas edições locais continuam no editor.';
    } else {
      text = 'O arquivo "' + state.name + '" mudou no disco. Revise antes de aplicar.';
    }

    $('#disk-notice-text').textContent = text;
    $('#disk-notice-reload').textContent = kind === 'missing' ? 'Salvar como…' : 'Revisar alterações';
    notice.hidden = false;
  }

  function dismissDiskNotice() {
    state.diskNoticeStamp = state.diskNoticeKind === 'missing' ? 'missing' : state.diskStamp;
    hideDiskNotice();
  }

  function applyDiskContent(text, file, handle) {
    var hadFocus = document.activeElement === editor;
    var selStart = editor.selectionStart;
    var selEnd = editor.selectionEnd;
    var editorTop = editor.scrollTop;
    var previewTop = previewScroll.scrollTop;

    if (handle) state.handle = handle;
    clearImageCache();
    setDoc(text, state.name, state.handle, state.docPath);

    state.diskStamp = stampOf(file);
    state.diskNoticeStamp = null;
    state.diskConflict = false;
    hideDiskNotice();

    var max = editor.value.length;
    editor.setSelectionRange(Math.min(selStart, max), Math.min(selEnd, max));
    editor.scrollTop = editorTop;
    previewScroll.scrollTop = previewTop;
    syncOverlayScroll();
    paintSource();
    syncHeadingSelect();
    saveDraftNow();
    if (hadFocus) editor.focus();
  }

  async function refreshDiskStamp() {
    var snap = await readDiskSnapshot();
    if (snap.status !== 'ok') return;
    if (snap.handle) state.handle = snap.handle;
    state.diskStamp = stampOf(snap.file);
    state.diskNoticeStamp = null;
    state.diskConflict = false;
    hideDiskNotice();
  }

  async function checkDiskChange(forceCompare) {
    if (!diskBound() || state.saving || diskCheckBusy) return;
    if ($('#modal-review') && $('#modal-review').classList.contains('on')) return;

    diskCheckBusy = true;
    try {
      var snap = await readDiskSnapshot();

      if (snap.status === 'unbound' || snap.status === 'error') return;

      if (snap.status === 'missing') {
        if (state.diskNoticeStamp === 'missing') return;
        showDiskNotice('missing');
        return;
      }

      var stamp = stampOf(snap.file);

      if (!forceCompare && state.diskStamp !== null && stamp === state.diskStamp) return;

      var text = await snap.file.text();

      if (text === editor.value) {
        state.text = text;
        state.savedText = text;
        state.diskStamp = stamp;
        state.diskNoticeStamp = null;
        state.diskConflict = false;
        if (state.dirty) markDirty(false);
        hideDiskNotice();
        return;
      }

      if (text === state.savedText) {
        state.diskStamp = stamp;
        state.diskNoticeStamp = null;
        state.diskConflict = false;
        hideDiskNotice();
        return;
      }

      state.diskStamp = stamp;
      state.diskConflict = true;
      recordDiskVersion(text, stamp);

      if (!hasLocalEdits() && state.prefs.externalMode === 'auto') {
        applyDiskContent(text, snap.file, snap.handle);
        toast('Documento atualizado do disco.');
        return;
      }

      if (state.diskNoticeStamp === stamp) return;
      state.diskNoticeStamp = null;
      showDiskNotice('changed');
    } finally {
      diskCheckBusy = false;
    }
  }

  async function reloadFromDisk(force) {
    if (!diskBound()) {
      toast('Abra o arquivo ou a pasta do documento para atualizar do disco.');
      return;
    }

    var snap = await readDiskSnapshot();

    if (snap.status === 'missing') {
      showDiskNotice('missing');
      toast('Arquivo não encontrado no disco.');
      return;
    }

    if (snap.status !== 'ok') {
      toast('Não foi possível ler o arquivo do disco.');
      return;
    }

    var text;
    try {
      text = await snap.file.text();
    } catch (e) {
      toast('Não foi possível ler o arquivo do disco.');
      return;
    }

    var stamp = stampOf(snap.file);

    if (text === editor.value) {
      state.text = text;
      state.savedText = text;
      state.diskStamp = stamp;
      state.diskNoticeStamp = null;
      state.diskConflict = false;
      if (state.dirty) markDirty(false);
      hideDiskNotice();
      toast('O documento já está atualizado.');
      return;
    }

    if (hasLocalEdits() && !force) {
      var ok = window.confirm('Há alterações não salvas em "' + state.name + '". Recarregar do disco e descartar essas alterações?');
      if (!ok) return;
    }

    recordDiskVersion(text, stamp);
    applyDiskContent(text, snap.file, snap.handle);
    toast('Documento atualizado do disco.');
  }

  function handleDiskNoticeAction() {
    if (state.diskNoticeKind === 'missing') {
      hideDiskNotice();
      saveDocument(true);
      return;
    }
    openReview();
  }

  /* --------------------------------------------- revisão de alterações -- */

  function reviewLineHtml(text, kind) {
    return '<span class="review-line ' + kind + '"><span class="sign">' +
      (kind === 'del' ? '-' : '+') + '</span>' +
      escapeHtml(text === '' ? ' ' : text) + '</span>';
  }

  function reviewHunkHtml(hunk, index, disabled) {
    var maxLines = 300;
    var removed = hunk.baseLines.slice(0, maxLines).map(function (line) {
      return reviewLineHtml(line, 'del');
    }).join('');
    var added = hunk.remoteLines.slice(0, maxLines).map(function (line) {
      return reviewLineHtml(line, 'add');
    }).join('');
    var more = '';

    if (hunk.baseLines.length > maxLines || hunk.remoteLines.length > maxLines) {
      more = '<div class="review-more">Exibindo as primeiras ' + maxLines + ' linhas de cada lado.</div>';
    }

    return '<div class="review-hunk">' +
      '<div class="review-hunk-head">' +
      '<label><input type="checkbox" data-hunk="' + index + '"' +
      (disabled ? ' disabled' : ' checked') + '> Aceitar trecho ' + (index + 1) + '</label>' +
      '<span>linha ' + (hunk.baseStart + 1) + ' | +' + hunk.remoteLines.length + ' -' + hunk.baseLines.length + '</span>' +
      '</div>' +
      '<div class="review-lines">' + removed + added + more + '</div>' +
      '</div>';
  }

  function updateReviewApplyState() {
    var boxes = $$('#review-diff input[data-hunk]');
    var checked = boxes.filter(function (box) { return box.checked; }).length;
    var apply = $('#review-apply');
    var all = $('#review-select-all');

    if (apply) apply.disabled = !boxes.length || !checked;
    if (all) all.checked = boxes.length > 0 && checked === boxes.length;
  }

  function renderReview() {
    var review = state.review;
    if (!review) return;

    var summary;
    if (!review.hunks.length) {
      summary = review.dirty
        ? 'Nenhuma alteração externa pendente. O editor tem edições locais não salvas.'
        : 'O editor está sincronizado com a versão atual do disco.';
    } else if (review.dirty) {
      summary = 'O arquivo mudou no disco e há alterações locais não salvas. O diff compara a última versão salva com a versão do disco.';
    } else {
      summary = review.hunks.length + (review.hunks.length === 1 ? ' trecho alterado' : ' trechos alterados') +
        ' no disco. Desmarque o que deve permanecer como está.';
    }

    $('#review-summary').textContent = summary;

    var warning = $('#review-warning');
    warning.hidden = !review.dirty || !review.hunks.length;
    warning.textContent = review.dirty && review.hunks.length
      ? 'Suas alterações locais não serão combinadas automaticamente. Para carregar o disco, elas serão descartadas.'
      : '';

    $('#review-toolbar').hidden = review.dirty || !review.hunks.length;
    $('#review-select-all').checked = true;

    $('#review-diff').innerHTML = review.hunks.length
      ? review.hunks.map(function (hunk, index) {
          return reviewHunkHtml(hunk, index, review.dirty);
        }).join('')
      : '<div class="review-empty">Nenhuma diferença pendente.</div>';

    var history = review.history || [];
    $('#review-history-list').innerHTML = history.length
      ? history.map(function (entry, index) {
          var lines = String(entry.text || '').split('\n');
          var preview = '';

          for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim()) { preview = lines[i].trim(); break; }
          }

          if (preview.length > 80) preview = preview.slice(0, 80) + '...';

          return '<div class="review-history-item">' +
            '<div class="review-history-main">' +
            '<span class="review-history-time">' + escapeHtml(formatHistoryTime(entry.at)) + '</span>' +
            (entry.stamp === review.remoteStamp ? ' <span class="review-history-current">atual</span>' : '') +
            '<span class="review-history-preview">' + escapeHtml(preview || '(documento vazio)') + '</span>' +
            '</div>' +
            '<button type="button" class="btn" data-review-history="' + index + '">Restaurar</button>' +
            '</div>';
        }).join('')
      : '<div class="review-empty">Nenhuma versão externa registrada.</div>';

    $('#review-keep').hidden = !review.hunks.length;
    $('#review-apply').hidden = review.dirty || !review.hunks.length;
    $('#review-reload').hidden = !review.dirty;

    updateReviewApplyState();
  }

  async function openReview() {
    if (!diskBound()) {
      toast('Abra o arquivo ou a pasta do documento para revisar o disco.');
      return;
    }

    if (state.saving) {
      toast('Aguarde o salvamento terminar.');
      return;
    }

    var snap = await readDiskSnapshot();

    if (snap.status === 'missing') {
      showDiskNotice('missing');
      toast('Arquivo não encontrado no disco.');
      return;
    }

    if (snap.status !== 'ok') {
      toast('Não foi possível ler o arquivo do disco.');
      return;
    }

    var remoteText;
    try {
      remoteText = await snap.file.text();
    } catch (e) {
      toast('Não foi possível ler o arquivo do disco.');
      return;
    }

    var stamp = stampOf(snap.file);
    var baseText = state.savedText;
    var localText = editor.value;

    if (localText === remoteText) {
      state.text = remoteText;
      state.savedText = remoteText;
      state.diskStamp = stamp;
      state.diskConflict = false;
      state.diskNoticeStamp = null;
      if (state.dirty) markDirty(false);
      hideDiskNotice();
      baseText = remoteText;
    }

    var hunks = Diff ? Diff.hunks(baseText, remoteText) : [];

    if (remoteText !== baseText) {
      recordDiskVersion(remoteText, stamp);
    } else {
      state.diskStamp = stamp;
      state.diskNoticeStamp = null;
      state.diskConflict = false;
      hideDiskNotice();
    }

    state.review = {
      baseText: baseText,
      localText: localText,
      remoteText: remoteText,
      remoteFile: snap.file,
      remoteHandle: snap.handle,
      remoteStamp: stamp,
      hunks: hunks,
      dirty: localText !== baseText,
      history: getDiskHistory()
    };

    renderReview();
    openModal('modal-review');
  }

  function applyReviewedText(text, remoteText, remoteFile, remoteStamp) {
    var hadFocus = document.activeElement === editor;
    var selection = editor.selectionStart;
    var editorTop = editor.scrollTop;
    var previewTop = previewScroll.scrollTop;

    flushHistory();
    clearImageCache();

    editor.value = text;
    editor.setSelectionRange(Math.min(selection, text.length), Math.min(selection, text.length));

    state.savedText = remoteText;
    state.diskStamp = remoteStamp || (remoteFile ? stampOf(remoteFile) : state.diskStamp);
    state.diskConflict = false;
    state.diskNoticeStamp = null;
    hideDiskNotice();

    onInput();
    renderNow();
    editor.scrollTop = editorTop;
    previewScroll.scrollTop = previewTop;
    syncOverlayScroll();
    pushHistory();
    saveDraftNow();

    if (hadFocus) editor.focus();
  }

  function applyReview() {
    var review = state.review;
    if (!review || review.dirty) return;

    var accepted = {};
    $$('#review-diff input[data-hunk]').forEach(function (box) {
      accepted[Number(box.dataset.hunk)] = box.checked;
    });

    var selected = Object.keys(accepted).some(function (key) { return accepted[key]; });
    if (!selected) {
      toast('Selecione ao menos um trecho para aplicar.');
      return;
    }

    var merged = Diff.merge(review.baseText, review.hunks, accepted);
    applyReviewedText(merged, review.remoteText, review.remoteFile, review.remoteStamp);
    closeModal('modal-review');
    toast(merged === review.remoteText ? 'Versão do disco aplicada.' : 'Trechos selecionados aplicados.');
  }

  function keepReviewLocal() {
    var review = state.review;
    if (!review) return;

    if (review.remoteStamp) state.diskStamp = review.remoteStamp;
    state.diskNoticeStamp = state.diskStamp;
    state.diskConflict = true;
    hideDiskNotice();
    closeModal('modal-review');
    toast('Versão externa mantida para revisão. Salvar substitui o disco.');
  }

  function reloadReview() {
    if (!window.confirm('Descartar suas alterações locais e carregar a versão do disco?')) return;
    closeModal('modal-review');
    reloadFromDisk(true);
  }

  function restoreReviewHistory(index) {
    var review = state.review;
    if (!review) return;

    var entry = (review.history || [])[index];
    if (!entry) return;

    if (!window.confirm('Restaurar a versão de ' + formatHistoryTime(entry.at) + ' no editor? O texto será tratado como alteração local.')) {
      return;
    }

    flushHistory();
    clearImageCache();

    editor.value = entry.text;
    editor.setSelectionRange(0, 0);

    state.savedText = review.remoteText;
    state.diskStamp = review.remoteStamp || state.diskStamp;
    state.diskConflict = false;
    state.diskNoticeStamp = null;
    hideDiskNotice();

    onInput();
    renderNow();
    pushHistory();
    saveDraftNow();

    closeModal('modal-review');
    toast('Versão externa restaurada no editor.');
  }


  async function observeCurrentFile() {
    if (!diskObserver) return;
    try { diskObserver.disconnect(); } catch (e) {}

    var snap = await readDiskSnapshot();
    if (snap.status !== 'ok') return;

    try {
      await diskObserver.observe(snap.handle);
    } catch (e) {
      // Observação em tempo real indisponível; a verificação periódica cobre.
    }
  }

  function stopDiskWatch() {
    if (diskPollTimer) {
      clearInterval(diskPollTimer);
      diskPollTimer = null;
    }
    if (diskObserver) {
      try { diskObserver.disconnect(); } catch (e) {}
      diskObserver = null;
    }
  }

  function startDiskWatch() {
    stopDiskWatch();
    if (!diskBound()) return;

    if (typeof window.FileSystemObserver === 'function') {
      try {
        diskObserver = new window.FileSystemObserver(function () {
          checkDiskChange();
        });
        observeCurrentFile();
      } catch (e) {
        diskObserver = null;
      }
    }

    diskPollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') checkDiskChange();
    }, 1000);

    checkDiskChange();
  }

  /* ------------------------------------------------------------------ *
   * realce do código-fonte (textarea + overlay)
   * ------------------------------------------------------------------ */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function hlMarkdownLine(line, fenceState) {
    var escaped = escapeHtml(line);
    if (!escaped) return { html: '\u200b', fence: fenceState.open };

    var fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      fenceState.open = !fenceState.open;
      return { html: '<span class="md-fence">' + escaped + '</span>', fence: fenceState.open };
    }
    if (fenceState.open) {
      return { html: '<span class="md-code">' + escaped + '</span>', fence: true };
    }

    var html = escaped;
    var placeholders = [];

    function stash(cls, text) {
      placeholders.push('<span class="' + cls + '">' + text + '</span>');
      return '\u0000' + (placeholders.length - 1) + '\u0000';
    }

    // código inline
    html = html.replace(/`([^`\n]+)`/g, function (all, inner) { return stash('md-code', '`' + inner + '`'); });
    // links e imagens
    html = html.replace(/(!?\[[^\]\n]*\]\([^)\n]*\))/g, function (all) { return stash('md-link', all); });
    // títulos
    html = html.replace(/^(\s*)(#{1,6})(\s+.*)$/, function (all, sp, marks, rest) {
      return sp + stash('md-mark', marks) + stash('md-h', rest);
    });
    // citação
    html = html.replace(/^(\s*)(&gt;\s?)/, function (all, sp, mark) {
      return sp + stash('md-mark', mark);
    });
    // marcadores de lista e tarefas
    html = html.replace(/^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?/, function (all, sp, mark, ws, task) {
      return sp + stash('md-mark', mark) + ws + (task ? stash('md-kw', task) : '');
    });
    // ênfase
    html = html.replace(/(\*\*\*|\*\*|__|~~|==|`)/g, function (all) { return stash('md-mark', all); });
    // fórmula
    html = html.replace(/(\$[^$\n]+\$)/g, function (all) { return stash('md-kw', all); });
    // bloco horizontal
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html = stash('md-fence', escaped);
    }

    html = html.replace(/\u0000(\d+)\u0000/g, function (m, idx) { return placeholders[Number(idx)]; });
    return { html: html, fence: false };
  }

  function paintSource() {
    if (!state.prefs.highlight) {
      hlInner.innerHTML = '';
      return;
    }
    var text = state.text || '';
    var lines = text.split('\n');

    // proteção: documentos enormes desligam o overlay para manter a digitação fluida
    if (lines.length > 2500) {
      hlInner.innerHTML = '<span class="ln md-fence">Documento muito grande: realce do código-fonte pausado.</span>';
      return;
    }

    var caret = editor.selectionStart || 0;
    var caretLine = text.slice(0, caret).split('\n').length - 1;

    // parágrafo do cursor (para o modo foco)
    var paraStart = caretLine;
    var paraEnd = caretLine;
    if (state.prefs.focus) {
      while (paraStart > 0 && lines[paraStart - 1].trim() !== '') paraStart--;
      while (paraEnd < lines.length - 1 && lines[paraEnd + 1].trim() !== '') paraEnd++;
    }

    var fenceState = { open: false };
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var res;
      if (state.prefs.focus && (i < paraStart || i > paraEnd)) {
        res = { html: escapeHtml(lines[i]) || '\u200b' };
      } else {
        res = hlMarkdownLine(lines[i], fenceState);
      }
      var cls = 'ln';
      if (i === caretLine) cls += ' cur';
      if (state.prefs.focus && i >= paraStart && i <= paraEnd) cls += ' in-focus';
      out.push('<span class="' + cls + '">' + (res.html || '\u200b') + '</span>');
    }
    hlInner.innerHTML = out.join('');
    syncOverlayScroll();
  }

  function syncOverlayScroll() {
    if (!editor) return;
    hlInner.style.transform = 'translate(' + (-editor.scrollLeft) + 'px,' + (-editor.scrollTop) + 'px)';
  }

  /* ------------------------------------------------------------------ *
   * esboço
   * ------------------------------------------------------------------ */

  function buildOutline() {
    if (state.openTab !== 'outline') return;
    var body = $('#sidebar-body');
    if (!state.headings.length) {
      body.innerHTML = '<div class="sidebar-empty">Sem títulos ainda. Use <b>#</b> no começo de uma linha para criar um título.</div>';
      return;
    }
    var html = state.headings.map(function (h, i) {
      return '<button class="outline-item lv' + h.level + '" data-index="' + i + '">' +
        escapeHtml(h.text) + '</button>';
    }).join('');
    body.innerHTML = html;
  }

  function goToHeading(index) {
    var h = state.headings[index];
    if (!h) return;

    var target = document.getElementById(h.id);
    if (target) {
      previewScroll.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
    }

    if (state.prefs.mode !== 'read') {
      var pos = lineToOffset(h.line);
      editor.focus();
      editor.setSelectionRange(pos, pos);
      centerCaret(true);
      paintSource();
    }
  }

  function lineToOffset(line) {
    var lines = (state.text || '').split('\n');
    var sum = 0;
    for (var i = 0; i < line && i < lines.length; i++) sum += lines[i].length + 1;
    return Math.min(sum, state.text.length);
  }

  function offsetToLine(offset) {
    return (state.text || '').slice(0, offset).split('\n').length - 1;
  }

  /* ------------------------------------------------------------------ *
   * arquivos
   * ------------------------------------------------------------------ */

  function supportsFS() {
    return typeof window.showOpenFilePicker === 'function';
  }

  function toast(message) {
    var t = $('#toast');
    t.textContent = message;
    t.classList.add('on');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  function confirmDiscard() {
    if (!state.dirty) return true;
    return window.confirm('Há alterações não salvas em "' + state.name + '". Descartar mesmo assim?');
  }

  function newDocument() {
    if (!confirmDiscard()) return;
    setDoc('', 'sem-titulo.md', null);
    markDirty(false);
    editor.focus();
  }

  async function openFile() {
    if (!confirmDiscard()) return;

    if (supportsFS()) {
      try {
        var handles = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: 'Markdown e texto',
            accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.txt'] }
          }]
        });
        await loadHandle(handles[0]);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // segue para o seletor clássico
      }
    }
    $('#file-input').click();
  }

  async function loadHandle(handle, docPath) {
    try {
      var file = await handle.getFile();
      var text = await file.text();
      setDoc(text, file.name, handle, docPath || null);
      state.diskStamp = stampOf(file);
      state.diskNoticeStamp = null;
      hideDiskNotice();
      addRecent(file.name, text);
      toast('Aberto: ' + file.name);
    } catch (err) {
      toast('Não foi possível abrir o arquivo.');
    }
  }

  async function saveDocument(forceSaveAs) {
    if (!forceSaveAs) {
      if (state.diskConflict) {
        var proceed = window.confirm('O arquivo "' + state.name + '" foi alterado no disco depois que você começou a editar. Salvar agora substitui a versão externa. Continuar?');
        if (!proceed) return;
        state.diskConflict = false;
      }

      var target = await resolveDiskHandle();
      /* arquivo recém-criado pelo seletor pode ainda não ser legível */
      if (!target && state.handle) target = state.handle;
      if (target) {
        state.saving = true;
        var content = state.text;
        try {
          var writable = await target.createWritable();
          await writable.write(new Blob([content], { type: 'text/markdown' }));
          await writable.close();

          state.handle = target;
          state.savedText = content;
          markDirty(state.text !== content);
          addRecent(state.name, content);
          state.saving = false;
          await refreshDiskStamp();
          startDiskWatch();
          toast('Salvo em ' + state.name);
          return;
        } catch (err) {
          state.saving = false;
          if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
            try {
              var perm = await target.requestPermission({ mode: 'readwrite' });
              if (perm === 'granted') return saveDocument(forceSaveAs);
            } catch (e) {}
          }
          toast('Falha ao salvar; exportando uma cópia.');
        }
      }
    }

    if (supportsFS()) {
      try {
        var handle = await window.showSaveFilePicker({
          suggestedName: state.name,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
        });
        state.handle = handle;
        state.name = handle.name;
        state.docPath = null;
        state.diskStamp = null;
        state.diskNoticeStamp = null;
        state.diskConflict = false;
        hideDiskNotice();
        document.title = state.name + ' — Iluminura';
        return saveDocument(false);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    downloadText(state.text, state.name, 'text/markdown;charset=utf-8');
    state.savedText = state.text;
    markDirty(false);
    addRecent(state.name, state.text);
    toast('Arquivo baixado: ' + state.name);
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadText(text, name, mime) {
    downloadBlob(new Blob([text], { type: mime }), name);
  }

  /* --------------------------------------------------- pastas / árvore -- */

  async function openFolder(bindCurrent) {
    if (typeof window.showDirectoryPicker !== 'function') {
      toast('Seu navegador não permite abrir pastas. Use o servidor local ou o Chrome/Edge.');
      return;
    }
    try {
      var previousRoot = state.dirHandle;
      var root = await window.showDirectoryPicker({ mode: 'read' });
      var rootChanged = root !== previousRoot;

      if (rootChanged) {
        state.docPath = null;
        state.noticeDismissed = false;
      }

      state.dirHandle = root;
      state.fileTree = await readDirectory(root, 0, '');
      state.search.seq++;
      state.search.busy = false;
      state.search.results = [];
      state.search.filesScanned = 0;
      state.search.truncated = false;
      switchTab('files');

      var bind = !!bindCurrent || (!state.docPath && hasRelativeImages());
      var bound = false;
      if (bind && state.name) {
        var found = await findFileByName(root, state.name, '');
        if (found) {
          state.docPath = found.path;
          state.noticeDismissed = false;
          bound = true;
          toast('Pasta aberta: ' + root.name + ' — imagens vinculadas a ' + found.path);
        } else {
          toast('Pasta aberta: ' + root.name + ' — documento "' + state.name + '" não encontrado nela.');
        }
      }

      if (rootChanged || bound) {
        clearImageCache();
        renderNow();
      }

      startDiskWatch();

      if (!bound && !bind) toast('Pasta aberta: ' + root.name);
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('Não foi possível abrir a pasta.');
    }
  }

  async function readDirectory(dir, depth, basePath) {
    var items = [];
    try {
      for await (var entry of dir.values()) {
        if (entry.name.startsWith('.')) continue;
        var path = basePath ? basePath + '/' + entry.name : entry.name;
        if (entry.kind === 'directory') {
          items.push({ kind: 'dir', name: entry.name, handle: entry, path: path, depth: depth, open: false, children: null });
        } else if (/\.(md|markdown|mdown|mkd|txt)$/i.test(entry.name)) {
          items.push({ kind: 'file', name: entry.name, handle: entry, path: path, depth: depth });
        }
      }
    } catch (e) {}
    items.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return items;
  }

  function flattenTree(nodes) {
    var out = [];
    (nodes || []).forEach(function (n) {
      out.push(n);
      if (n.kind === 'dir' && n.open && n.children) out = out.concat(flattenTree(n.children));
    });
    return out;
  }

  function renderFiles() {
    var body = $('#sidebar-body');
    var html = '<button class="file-row" data-act="open-folder"><span class="ico">📁</span><span class="nm">Abrir pasta…</span></button>';

    if (state.fileTree) {
      html += '<div class="menu-sep"></div>';
      var nodes = flattenTree(state.fileTree);
      html += nodes.map(function (n, i) {
        var pad = 8 + n.depth * 14;
        var ico = n.kind === 'dir' ? (n.open ? '▾' : '▸') : '·';
        return '<button class="file-row" data-act="tree" data-i="' + i + '" style="padding-left:' + pad + 'px">' +
          '<span class="ico">' + ico + '</span><span class="nm">' + escapeHtml(n.name) + '</span></button>';
      }).join('');
    }

    var recents = getRecents();
    if (recents.length) {
      html += '<div class="menu-sep"></div><div class="sidebar-empty" style="padding-bottom:4px">Recentes</div>';
      html += recents.map(function (r, i) {
        return '<button class="file-row" data-act="recent" data-i="' + i + '">' +
          '<span class="ico">🕘</span><span class="nm" title="' + escapeHtml(r.name) + '">' +
          escapeHtml(r.name) + '</span></button>';
      }).join('');
    }

    body.innerHTML = html;
  }

  /* ---------------------------------------------------------- recentes -- */

  function getRecents() {
    try {
      return JSON.parse(localStorage.getItem(LS_RECENT) || '[]');
    } catch (e) { return []; }
  }

  function addRecent(name, text) {
    if (!text || text.length > 250000) return;
    var list = getRecents().filter(function (r) { return r.name !== name; });
    list.unshift({ name: name, text: text, at: Date.now() });
    list = list.slice(0, 6);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(list)); } catch (e) {
      try { localStorage.setItem(LS_RECENT, JSON.stringify(list.slice(0, 2))); } catch (e2) {}
    }
    if (state.openTab === 'files') renderFiles();
  }

  function openRecent(index) {
    var r = getRecents()[index];
    if (!r) return;
    if (!confirmDiscard()) return;
    setDoc(r.text, r.name, null);
    toast('Recente: ' + r.name + ' (salvar baixará uma cópia)');
  }

  /* ------------------------------------------------------------------ *
   * formatação
   * ------------------------------------------------------------------ */

  function replaceRange(start, end, insertion, selStart, selEnd) {
    flushHistory();

    var value = editor.value;
    editor.value = value.slice(0, start) + insertion + value.slice(end);
    editor.setSelectionRange(
      selStart === undefined ? start + insertion.length : selStart,
      selEnd === undefined ? (selStart === undefined ? start + insertion.length : selEnd) : selEnd
    );
    onInput();
    pushHistory();
  }

  function wrapSelection(before, after, placeholder) {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var selected = editor.value.slice(start, end);
    var body = selected || placeholder || '';
    var text = before + body + after;

    replaceRange(start, end, text, start + before.length, start + before.length + body.length);
    editor.focus();
  }

  function prefixLines(prefix, ordered) {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var value = editor.value;

    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    var block = value.slice(lineStart, lineEnd) || '';
    var lines = block.split('\n');
    var counter = 1;

    var changed = lines.map(function (line) {
      if (ordered) {
        return prefix.replace('{n}', String(counter++)) + line;
      }
      return prefix + line;
    }).join('\n');

    replaceRange(lineStart, lineEnd, changed, lineStart, lineStart + changed.length);
    editor.focus();
  }

  function toggleHeading(level) {
    var start = editor.selectionStart;
    var value = editor.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;
    var line = value.slice(lineStart, lineEnd);

    var m = /^(#{1,6})\s+/.exec(line);
    var newLine;
    if (!level) {
      newLine = line.replace(/^#{1,6}\s+/, '');
    } else if (m && m[1].length === level) {
      newLine = line.replace(/^#{1,6}\s+/, '');
    } else if (m) {
      newLine = line.replace(/^#{1,6}\s+/, '#'.repeat(level) + ' ');
    } else {
      newLine = '#'.repeat(level) + ' ' + line;
    }
    replaceRange(lineStart, lineEnd, newLine, lineStart + newLine.length, lineStart + newLine.length);
    editor.focus();
  }

  function insertBlock(text, selectOffset) {
    var start = editor.selectionStart;
    var value = editor.value;
    var before = value.slice(0, start);
    var needsLeading = before.length > 0 && !/\n\n$/.test(before);
    var prefix = needsLeading ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    var insertion = prefix + text;
    replaceRange(start, editor.selectionEnd, insertion,
      start + prefix.length + (selectOffset || 0),
      start + prefix.length + (selectOffset || 0));
    editor.focus();
  }

  function toggleWrap(marker, placeholder) {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var value = editor.value;
    var selected = value.slice(start, end);

    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2) {
      var inner = selected.slice(marker.length, selected.length - marker.length);
      replaceRange(start, end, inner, start, start + inner.length);
      editor.focus();
      return;
    }
    wrapSelection(marker, marker, placeholder);
  }

  function clearFormat() {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var value = editor.value;

    if (start === end) {
      var lineStart = value.lastIndexOf('\n', start - 1) + 1;
      var lineEnd = value.indexOf('\n', start);
      if (lineEnd === -1) lineEnd = value.length;
      start = lineStart;
      end = lineEnd;
    }

    var block = value.slice(start, end)
      .replace(/^(\s*)#{1,6}\s+/gm, '$1')
      .replace(/^(\s*)>\s?/gm, '$1')
      .replace(/^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/gm, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*\*|\*\*|\*|___|__|~~|==|\$/g, '');

    replaceRange(start, end, block, start, start + block.length);
    editor.focus();
  }

  var COMMANDS = {
    new: newDocument,
    open: openFile,
    openFolder: function () { openFolder(false); },
    openFolderImages: function () { openFolder(true); },
    save: function () { saveDocument(false); },
    saveAs: function () { saveDocument(true); },
    reloadDisk: function () { reloadFromDisk(false); },
    reviewDisk: function () { openReview(); },
    exportHtml: exportHtml,
    exportPdf: function () { printDocument(); },
    exportDocx: function () { exportOffice('docx'); },
    exportEpub: function () { exportOffice('epub'); },
    copyHtml: copyHtml,
    closeDoc: function () { if (confirmDiscard()) newDocument(); },

    undo: undoEdit,
    redo: redoEdit,
    find: function () { openFind(); },
    replace: function () { openFind(true); },
    globalFind: globalFind,
    selectAll: function () { editor.focus(); editor.select(); },

    h1: function () { toggleHeading(1); },
    h2: function () { toggleHeading(2); },
    h3: function () { toggleHeading(3); },
    h4: function () { toggleHeading(4); },
    h5: function () { toggleHeading(5); },
    h6: function () { toggleHeading(6); },
    h0: function () { toggleHeading(0); },
    bold: function () { toggleWrap('**', 'texto'); },
    italic: function () { toggleWrap('*', 'texto'); },
    strike: function () { toggleWrap('~~', 'texto'); },
    highlight: function () { toggleWrap('==', 'texto'); },
    code: function () { toggleWrap('`', 'código'); },
    sub: function () { toggleWrap('~', 'texto'); },
    sup: function () { toggleWrap('^', 'texto'); },
    math: function () { insertBlock('$$\n\n$$', 2); },
    inlineMath: function () { toggleWrap('$', 'x^2'); },
    clearFormat: function () { clearFormat(); },
    link: function () {
      var start = editor.selectionStart;
      var end = editor.selectionEnd;
      var selected = editor.value.slice(start, end) || 'texto';
      var text = '[' + selected + '](url)';
      replaceRange(start, end, text, start + selected.length + 3, start + selected.length + 6);
      editor.focus();
    },
    image: function () {
      var text = '![descrição](caminho/da/imagem.png)';
      insertBlock(text, 2);
    },
    table: function () {
      insertBlock('| Coluna A | Coluna B |\n| --- | --- |\n| valor | valor |\n', 2);
    },
    quote: function () { prefixLines('> '); },
    ul: function () { prefixLines('- '); },
    ol: function () { prefixLines('{n}. ', true); },
    task: function () { prefixLines('- [ ] '); },
    codeblock: function () { insertBlock('```\n\n```', 4); },
    hr: function () { insertBlock('---\n'); },

    modeSplit: function () { setPref('mode', 'split'); },
    modeRead: function () { setPref('mode', state.prefs.mode === 'read' ? 'split' : 'read'); },
    modeSource: function () { setPref('mode', state.prefs.mode === 'source' ? 'split' : 'source'); },
    toggleSidebar: function () { setPref('sidebar', !state.prefs.sidebar); renderSidebar(); },
    toggleToolbar: function () { setPref('toolbar', !state.prefs.toolbar); },
    toggleOutline: function () { setPref('sidebar', true); switchTab('outline'); },
    toggleFocus: function () { setPref('focus', !state.prefs.focus); toast(state.prefs.focus ? 'Modo foco ativado' : 'Modo foco desativado'); },
    toggleTypewriter: function () { setPref('typewriter', !state.prefs.typewriter); toast(state.prefs.typewriter ? 'Modo máquina de escrever ativado' : 'Desativado'); },
    fullscreen: function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    },
    zoomIn: function () { setPref('zoom', Math.min(200, state.prefs.zoom + 10)); },
    zoomOut: function () { setPref('zoom', Math.max(60, state.prefs.zoom - 10)); },
    zoomReset: function () { setPref('zoom', 100); },
    theme: function (value) { setPref('theme', value); },
    prefs: function () { openModal('modal-prefs'); },
    shortcuts: function () { openModal('modal-shortcuts'); },
    installApp: installApp,
    about: function () { openModal('modal-about'); }
  };

  /* --------------------------------------------------------- toolbar -- */

  var TOOL_ICONS = {
    new: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v5h4"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5h6l2 2h9v10h-17z"/></svg>',
    openFolder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5h6l2 2h9v10h-17z"/><path d="M12 13v4M10 15h4"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h11l3 3v14H5z"/><path d="M8.5 3.5v6h7v-6M8.5 20.5v-6h7v6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5v5h-5"/><path d="M4 19v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.4-2.6L20 10"/><path d="M17.9 15a7 7 0 0 1-11.4 2.6L4 14"/></svg>',
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8.5v-5h10v5M5 8.5h14v8h-3M8 20.5h8v-7H8z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H14a5.5 5.5 0 0 1 0 11h-2"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m15 7 4.5 4.5L15 16"/><path d="M19.5 11.5H10a5.5 5.5 0 0 0 0 11h2"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
    replace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13M13 3l4 4-4 4"/><path d="M20 17H7M11 21l-4-4 4-4"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m9.5 14.5 5-5"/><path d="M8 16.5 6 18.5a4.2 4.2 0 0 1-6-6l2-2"/><path d="m16 7.5 2-2a4.2 4.2 0 0 1 6 6l-2 2"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4.5 17 5-5 4 4 2-2 4 4"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M9.5 4.5v15M15 4.5v15"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 15 7-7 5 5-7 7H7z"/><path d="M4 20h16"/></svg>',
    split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
    read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H3z"/><path d="M21 5.5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z"/></svg>',
    source: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 7-5 5 5 5M15 7l5 5-5 5"/></svg>',
    sidebar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
    focus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
    typewriter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 5h19M2.5 19h19"/><rect x="10.5" y="9" width="3" height="6" rx="1.2" fill="currentColor" stroke="none"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    bold: '<span class="tb-glyph tb-strong">B</span>',
    italic: '<span class="tb-glyph tb-italic">I</span>',
    strike: '<span class="tb-glyph tb-strike">S</span>',
    highlight: '<span class="tb-glyph tb-highlight">A</span>',
    code: '<span class="tb-glyph tb-code">&lt;/&gt;</span>',
    sub: '<span class="tb-glyph">X<sub>2</sub></span>',
    sup: '<span class="tb-glyph">X<sup>2</sup></span>',
    quote: '<span class="tb-glyph tb-quote">❝</span>',
    ul: '<span class="tb-glyph tb-list-bullet">•</span>',
    ol: '<span class="tb-glyph tb-list-number">1.</span>',
    task: '<span class="tb-glyph tb-task">☑</span>',
    math: '<span class="tb-glyph tb-math">∑</span>',
    hr: '<span class="tb-glyph tb-hr">—</span>'
  };

  var TOOLBAR_GROUPS = [
    {
      label: 'Arquivo',
      items: [
        { cmd: 'new', icon: 'new', title: 'Novo documento (Ctrl+N)' },
        { cmd: 'open', icon: 'open', title: 'Abrir arquivo (Ctrl+O)' },
        { cmd: 'openFolder', icon: 'openFolder', title: 'Abrir pasta' },
        { cmd: 'save', icon: 'save', title: 'Salvar (Ctrl+S)' },
        { cmd: 'reloadDisk', icon: 'refresh', title: 'Atualizar do disco (F5)' },
        { cmd: 'reviewDisk', icon: 'review', title: 'Revisar alterações externas' },
        { cmd: 'exportPdf', icon: 'print', title: 'Imprimir / PDF (Ctrl+P)' }
      ]
    },
    {
      label: 'Histórico',
      items: [
        { cmd: 'undo', icon: 'undo', title: 'Desfazer (Ctrl+Z)' },
        { cmd: 'redo', icon: 'redo', title: 'Refazer (Ctrl+Y)' },
        { cmd: 'find', icon: 'find', title: 'Localizar (Ctrl+F)' },
        { cmd: 'replace', icon: 'replace', title: 'Localizar e substituir (Ctrl+H)' }
      ]
    },
    {
      label: 'Texto',
      items: [
        { type: 'heading' },
        { cmd: 'bold', icon: 'bold', title: 'Negrito (Ctrl+B)' },
        { cmd: 'italic', icon: 'italic', title: 'Itálico (Ctrl+I)' },
        { cmd: 'strike', icon: 'strike', title: 'Riscado (Alt+Shift+5)' },
        { cmd: 'highlight', icon: 'highlight', title: 'Realçado' },
        { cmd: 'code', icon: 'code', title: 'Código em linha (Ctrl+Shift+E)' },
        { cmd: 'sub', icon: 'sub', title: 'Subscrito' },
        { cmd: 'sup', icon: 'sup', title: 'Sobrescrito' },
        { cmd: 'clearFormat', icon: 'clear', title: 'Limpar formatação' }
      ]
    },
    {
      label: 'Parágrafo',
      items: [
        { cmd: 'quote', icon: 'quote', title: 'Citação (Ctrl+Shift+Q)' },
        { cmd: 'ul', icon: 'ul', title: 'Lista com marcadores (Ctrl+Shift+U)' },
        { cmd: 'ol', icon: 'ol', title: 'Lista numerada (Ctrl+Shift+O)' },
        { cmd: 'task', icon: 'task', title: 'Lista de tarefas (Ctrl+Shift+X)' }
      ]
    },
    {
      label: 'Inserir',
      items: [
        { cmd: 'link', icon: 'link', title: 'Link (Ctrl+K)' },
        { cmd: 'image', icon: 'image', title: 'Imagem (Ctrl+Shift+I)' },
        { cmd: 'table', icon: 'table', title: 'Tabela (Ctrl+T)' },
        { cmd: 'codeblock', icon: 'source', title: 'Bloco de código (Ctrl+Shift+K)' },
        { cmd: 'math', icon: 'math', title: 'Bloco de fórmula (Ctrl+Shift+M)' },
        { cmd: 'inlineMath', icon: 'math', title: 'Fórmula em linha' },
        { cmd: 'hr', icon: 'hr', title: 'Linha horizontal' }
      ]
    },
    {
      label: 'Exibir',
      items: [
        { cmd: 'modeSplit', icon: 'split', title: 'Modo dividido (Ctrl+Alt+1)' },
        { cmd: 'modeRead', icon: 'read', title: 'Somente leitura (Ctrl+Alt+2)' },
        { cmd: 'modeSource', icon: 'source', title: 'Código-fonte (Ctrl+/)' },
        { cmd: 'toggleSidebar', icon: 'sidebar', title: 'Barra lateral (Ctrl+Shift+1)' },
        { cmd: 'toggleFocus', icon: 'focus', title: 'Modo foco (Ctrl+Shift+F)' },
        { cmd: 'toggleTypewriter', icon: 'typewriter', title: 'Modo máquina de escrever' },
        { cmd: 'fullscreen', icon: 'fullscreen', title: 'Tela cheia (F11)' }
      ]
    }
  ];

  function buildToolbar() {
    var bar = el.toolbar;
    if (!bar) return;

    bar.innerHTML = '';

    TOOLBAR_GROUPS.forEach(function (group) {
      var wrap = document.createElement('div');
      wrap.className = 'tool-group';

      var row = document.createElement('div');
      row.className = 'tool-row';

      group.items.forEach(function (item) {
        if (item.type === 'heading') {
          var select = document.createElement('select');
          select.id = 'tb-heading';
          select.className = 'tb-heading';
          select.title = 'Estilo do parágrafo';
          select.setAttribute('aria-label', 'Estilo do parágrafo');

          [['0', 'Parágrafo'], ['1', 'Título 1'], ['2', 'Título 2'], ['3', 'Título 3'],
           ['4', 'Título 4'], ['5', 'Título 5'], ['6', 'Título 6']].forEach(function (opt) {
            var o = document.createElement('option');
            o.value = opt[0];
            o.textContent = opt[1];
            select.appendChild(o);
          });

          row.appendChild(select);
          el.headingSelect = select;
          return;
        }

        var button = document.createElement('button');
        button.type = 'button';
        button.dataset.cmd = item.cmd;
        button.title = item.title;
        button.setAttribute('aria-label', item.title.replace(/\s*\(.*$/, ''));
        button.innerHTML = TOOL_ICONS[item.icon] || item.cmd;
        row.appendChild(button);
      });

      var label = document.createElement('span');
      label.className = 'tool-label';
      label.textContent = group.label;

      wrap.appendChild(row);
      wrap.appendChild(label);
      bar.appendChild(wrap);
    });
  }

  function syncToolbarState() {
    if (!el.toolbar) return;
    var p = state.prefs;
    var active = {
      modeSplit: p.mode === 'split',
      modeRead: p.mode === 'read',
      modeSource: p.mode === 'source',
      toggleSidebar: p.sidebar,
      toggleFocus: p.focus,
      toggleTypewriter: p.typewriter,
      fullscreen: !!document.fullscreenElement
    };

    $$('button[data-cmd]', el.toolbar).forEach(function (button) {
      var on = !!active[button.dataset.cmd];
      button.classList.toggle('on', on);
      if (Object.prototype.hasOwnProperty.call(active, button.dataset.cmd)) {
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
  }

  function syncHeadingSelect() {
    if (!el.headingSelect || !editor) return;
    var start = editor.selectionStart || 0;
    var value = editor.value || '';
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;
    var m = /^(#{1,6})\s+/.exec(value.slice(lineStart, lineEnd));
    el.headingSelect.value = m ? String(m[1].length) : '0';
  }

  /* ------------------------------------------------------------ menus -- */

  function menuDefinition() {
    var recents = getRecents();
    return [
      {
        label: 'Arquivo',
        items: [
          { label: 'Novo', key: 'Ctrl+N', cmd: 'new' },
          { label: 'Abrir…', key: 'Ctrl+O', cmd: 'open' },
          { label: 'Abrir pasta…', cmd: 'openFolder' },
          { label: 'Abrir pasta do documento…', cmd: 'openFolderImages' },
          { sep: true },
          { label: 'Salvar', key: 'Ctrl+S', cmd: 'save' },
          { label: 'Salvar como…', key: 'Ctrl+Shift+S', cmd: 'saveAs' },
          { label: 'Atualizar do disco', key: 'F5', cmd: 'reloadDisk' },
          { label: 'Revisar alterações externas', cmd: 'reviewDisk' },
          { sep: true },
          { label: 'Exportar como HTML', cmd: 'exportHtml' },
          { label: 'Exportar como DOCX', cmd: 'exportDocx' },
          { label: 'Exportar como EPUB', cmd: 'exportEpub' },
          { label: 'Exportar como PDF / imprimir', key: 'Ctrl+P', cmd: 'exportPdf' },
          { label: 'Copiar HTML', cmd: 'copyHtml' },
          { sep: true },
          { label: 'Recentes', header: true },
          recents.length
            ? { label: 'Recarregar último recente', cmd: 'openRecent0' }
            : { label: 'Nenhum documento recente', disabled: true }
        ]
      },
      {
        label: 'Editar',
        items: [
          { label: 'Desfazer', key: 'Ctrl+Z', cmd: 'undo' },
          { label: 'Refazer', key: 'Ctrl+Y', cmd: 'redo' },
          { sep: true },
          { label: 'Localizar…', key: 'Ctrl+F', cmd: 'find' },
          { label: 'Localizar e substituir…', key: 'Ctrl+H', cmd: 'replace' },
          { label: 'Buscar na pasta', key: 'Ctrl+Shift+G', cmd: 'globalFind' },
          { sep: true },
          { label: 'Selecionar tudo', key: 'Ctrl+A', cmd: 'selectAll' }
        ]
      },
      {
        label: 'Formatar',
        items: [
          { label: 'Título 1', key: 'Ctrl+1', cmd: 'h1' },
          { label: 'Título 2', key: 'Ctrl+2', cmd: 'h2' },
          { label: 'Título 3', key: 'Ctrl+3', cmd: 'h3' },
          { label: 'Cabeçalho comum', cmd: 'h0' },
          { sep: true },
          { label: 'Negrito', key: 'Ctrl+B', cmd: 'bold' },
          { label: 'Itálico', key: 'Ctrl+I', cmd: 'italic' },
          { label: 'Riscado', key: 'Alt+Shift+5', cmd: 'strike' },
          { label: 'Realçado', cmd: 'highlight' },
          { label: 'Código', key: 'Ctrl+Shift+E', cmd: 'code' },
          { label: 'Subscrito', cmd: 'sub' },
          { label: 'Sobrescrito', cmd: 'sup' },
          { label: 'Fórmula na linha', cmd: 'inlineMath' },
          { sep: true },
          { label: 'Citação', key: 'Ctrl+Shift+Q', cmd: 'quote' },
          { label: 'Lista', key: 'Ctrl+Shift+U', cmd: 'ul' },
          { label: 'Lista ordenada', key: 'Ctrl+Shift+O', cmd: 'ol' },
          { label: 'Lista de tarefas', key: 'Ctrl+Shift+X', cmd: 'task' },
          { sep: true },
          { label: 'Bloco de código', key: 'Ctrl+Shift+K', cmd: 'codeblock' },
          { label: 'Bloco de fórmula', key: 'Ctrl+Shift+M', cmd: 'math' },
          { label: 'Tabela', key: 'Ctrl+T', cmd: 'table' },
          { label: 'Link', key: 'Ctrl+K', cmd: 'link' },
          { label: 'Imagem', key: 'Ctrl+Shift+I', cmd: 'image' },
          { label: 'Linha horizontal', cmd: 'hr' },
          { sep: true },
          { label: 'Limpar formatação', cmd: 'clearFormat' }
        ]
      },
      {
        label: 'Exibir',
        items: [
          { label: 'Modo dividido', key: 'Ctrl+Alt+1', cmd: 'modeSplit', checked: function () { return state.prefs.mode === 'split'; } },
          { label: 'Somente leitura', key: 'Ctrl+Alt+2', cmd: 'modeRead', checked: function () { return state.prefs.mode === 'read'; } },
          { label: 'Código-fonte', key: 'Ctrl+/', cmd: 'modeSource', checked: function () { return state.prefs.mode === 'source'; } },
          { sep: true },
          { label: 'Barra lateral', key: 'Ctrl+Shift+1', cmd: 'toggleSidebar', checked: function () { return state.prefs.sidebar; } },
          { label: 'Barra de ferramentas', key: 'Ctrl+Shift+T', cmd: 'toggleToolbar', checked: function () { return state.prefs.toolbar; } },
          { label: 'Esboço', cmd: 'toggleOutline' },
          { sep: true },
          { label: 'Modo foco', key: 'Ctrl+Shift+F', cmd: 'toggleFocus', checked: function () { return state.prefs.focus; } },
          { label: 'Modo máquina de escrever', cmd: 'toggleTypewriter', checked: function () { return state.prefs.typewriter; } },
          { sep: true },
          { label: 'Tela cheia', key: 'F11', cmd: 'fullscreen' },
          { label: 'Ampliar', key: 'Ctrl+=', cmd: 'zoomIn' },
          { label: 'Reduzir', key: 'Ctrl+-', cmd: 'zoomOut' },
          { label: 'Tamanho real', key: 'Ctrl+0', cmd: 'zoomReset' },
          { sep: true },
          { label: 'Tema: claro', cmd: 'theme', arg: 'claro', checked: function () { return state.prefs.theme === 'claro'; } },
          { label: 'Tema: escuro', cmd: 'theme', arg: 'escuro', checked: function () { return state.prefs.theme === 'escuro'; } },
          { label: 'Tema: sépia', cmd: 'theme', arg: 'sepia', checked: function () { return state.prefs.theme === 'sepia'; } }
        ]
      },
      {
        label: 'Ajuda',
        items: [
          { label: 'Atalhos de teclado', key: 'F1', cmd: 'shortcuts' },
          { label: 'Preferências…', key: 'Ctrl+,', cmd: 'prefs' },
          { sep: true },
          { label: 'Instalar aplicativo', cmd: 'installApp' },
          { sep: true },
          { label: 'Sobre o Iluminura', cmd: 'about' }
        ]
      }
    ];
  }

  function buildMenus() {
    var nav = $('#menus');
    nav.innerHTML = '';

    menuDefinition().forEach(function (menu) {
      var wrap = document.createElement('div');
      wrap.className = 'menu';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = menu.label;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = wrap.classList.contains('open');
        closeMenus();
        if (!wasOpen) {
          renderMenuPanel(wrap, menu);
          wrap.classList.add('open');
        }
      });

      var panel = document.createElement('div');
      panel.className = 'menu-panel';

      wrap.appendChild(btn);
      wrap.appendChild(panel);
      nav.appendChild(wrap);
    });
  }

  function renderMenuPanel(wrap, menu) {
    var panel = wrap.querySelector('.menu-panel');
    // Recalcula itens dinâmicos (recentes, marcações)
    var fresh = menuDefinition().filter(function (m) { return m.label === menu.label; })[0] || menu;
    panel.innerHTML = '';

    fresh.items.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement('div');
        sep.className = 'menu-sep';
        panel.appendChild(sep);
        return;
      }
      if (item.header) {
        var h = document.createElement('div');
        h.className = 'sidebar-empty';
        h.style.cssText = 'padding:4px 9px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase';
        h.textContent = item.label;
        panel.appendChild(h);
        return;
      }

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      if (item.disabled) b.disabled = true;

      var checked = item.checked ? !!item.checked() : false;
      b.innerHTML = '<span class="check">' + (checked ? '✓' : '') + '</span>' +
        '<span class="label">' + escapeHtml(item.label) + '</span>' +
        (item.key ? '<span class="key">' + escapeHtml(item.key) + '</span>' : '');

      b.addEventListener('click', function () {
        closeMenus();
        if (item.cmd === 'openRecent0') { openRecent(0); return; }
        var fn = COMMANDS[item.cmd];
        if (fn) fn(item.arg);
      });

      panel.appendChild(b);
    });
  }

  function closeMenus() {
    $$('.menu.open').forEach(function (m) { m.classList.remove('open'); });
  }

  /* ------------------------------------------------------------------ *
   * barra lateral
   * ------------------------------------------------------------------ */

  function switchTab(tab) {
    state.openTab = tab;
    $$('.sidebar-tabs button[data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    if (tab === 'outline') buildOutline();
    else if (tab === 'files') renderFiles();
    else renderSearch();

    if (tab === 'search') {
      var input = $('#global-search-input');
      if (input) {
        input.focus();
        input.select();
      }
      if (state.dirHandle && state.search.query.trim().length >= 2 &&
          !state.search.results.length && !state.search.busy && !state.search.filesScanned) {
        runGlobalSearch(state.search.query);
      }
    }
  }

  function renderSidebar() {
    if (state.openTab === 'outline') buildOutline();
    else if (state.openTab === 'files') renderFiles();
    else renderSearch();
  }

  function wireSidebar() {
    $$('.sidebar-tabs button[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    $('#sidebar-body').addEventListener('click', async function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.act === 'open-folder') { openFolder(false); return; }

      if (btn.dataset.act === 'search-clear') {
        var searchInput = $('#global-search-input');
        if (searchInput) searchInput.value = '';
        state.search.seq++;
        state.search.busy = false;
        state.search.query = '';
        state.search.results = [];
        state.search.summary = '';
        state.search.truncated = false;
        renderSearchResults();
        if (searchInput) searchInput.focus();
        return;
      }

      if (btn.dataset.act === 'search-result') {
        openSearchResult(Number(btn.dataset.i));
        return;
      }

      if (btn.dataset.act === 'recent') { openRecent(Number(btn.dataset.i)); return; }

      if (btn.dataset.act === 'tree') {
        var nodes = flattenTree(state.fileTree);
        var node = nodes[Number(btn.dataset.i)];
        if (!node) return;
        if (node.kind === 'dir') {
          if (!node.children) node.children = await readDirectory(node.handle, node.depth + 1, node.path);
          node.open = !node.open;
          renderFiles();
        } else {
          if (!confirmDiscard()) return;
          await loadHandle(node.handle, node.path);
        }
        return;
      }

      if (btn.dataset.index !== undefined && state.openTab === 'outline') {
        goToHeading(Number(btn.dataset.index));
      }
    });

    $('#sidebar-body').addEventListener('input', function (e) {
      if (e.target.id !== 'global-search-input') return;
      state.search.query = e.target.value;
      state.search.seq++;

      if (state.search.query.trim().length < 2) {
        state.search.busy = false;
        state.search.results = [];
        state.search.truncated = false;
      } else {
        state.search.busy = true;
        state.search.results = [];
        state.search.filesScanned = 0;
        state.search.truncated = false;
      }

      renderSearchResults();
      scheduleGlobalSearch();
    });

    $('#sidebar-body').addEventListener('keydown', function (e) {
      if (e.target.id !== 'global-search-input') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.target.value = '';
        state.search.seq++;
        state.search.busy = false;
        state.search.query = '';
        state.search.results = [];
        state.search.summary = '';
        state.search.truncated = false;
        renderSearchResults();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        runGlobalSearch(state.search.query);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * busca global na pasta
   * ------------------------------------------------------------------ */

  var globalSearchTimer = null;
  var SEARCH_LIMIT = 150;
  var SEARCH_MAX_FILES = 800;
  var SEARCH_MAX_BYTES = 24 * 1024 * 1024;
  var SEARCH_FILE_MAX = 2 * 1024 * 1024;

  function foldForSearch(text) {
    var out = '';
    var map = [];

    for (var i = 0; i < text.length; i++) {
      var folded = text[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (var j = 0; j < folded.length; j++) {
        out += folded[j];
        map.push(i);
      }
    }

    return { text: out, map: map };
  }

  function buildLineStarts(text) {
    var starts = [0];
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  }

  function lineIndexAt(starts, offset) {
    var lo = 0;
    var hi = starts.length - 1;

    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }

    return lo;
  }

  function renderSearch() {
    var body = $('#sidebar-body');
    if (!body) return;

    body.innerHTML =
      '<div class="sidebar-search">' +
        '<div class="sidebar-search-box">' +
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3 3"/></svg>' +
          '<input id="global-search-input" type="search" placeholder="Buscar na pasta" autocomplete="off" spellcheck="false" aria-label="Buscar na pasta">' +
          '<button type="button" class="sidebar-search-clear" data-act="search-clear" title="Limpar busca" aria-label="Limpar busca">×</button>' +
        '</div>' +
        '<div class="sidebar-search-status" id="global-search-status"></div>' +
        '<div class="sidebar-search-results" id="global-search-results"></div>' +
      '</div>';

    var input = $('#global-search-input');
    if (input) input.value = state.search.query;
    renderSearchResults();
  }

  function searchResultHtml(results) {
    return results.map(function (r, i) {
      var head = escapeHtml(r.name) +
        '<span>' + (r.line ? 'linha ' + r.line : 'arquivo') + '</span>';
      var path = r.path === r.name
        ? ''
        : '<span class="search-result-path">' + escapeHtml(r.path) + '</span>';
      var snippet = '';

      if (r.kind === 'content') {
        var before = escapeHtml(r.lineText.slice(0, r.matchStart));
        var match = escapeHtml(r.lineText.slice(r.matchStart, r.matchStart + r.matchLength));
        var after = escapeHtml(r.lineText.slice(r.matchStart + r.matchLength));
        snippet = '<span class="search-result-line">' + before + '<mark>' + match + '</mark>' + after + '</span>';
      }

      return '<button type="button" class="search-result" data-act="search-result" data-i="' + i +
        '" data-path="' + escapeHtml(r.path) + '">' +
        '<span class="search-result-head">' + head + '</span>' +
        path +
        snippet +
        '</button>';
    }).join('');
  }

  function renderSearchResults() {
    var status = $('#global-search-status');
    var list = $('#global-search-results');
    if (!status || !list) return;

    var query = state.search.query.trim();

    if (!state.dirHandle) {
      status.textContent = '';
      list.innerHTML = '<div class="search-empty">Abra uma pasta para buscar em vários arquivos.' +
        '<br><button type="button" class="search-action" data-act="open-folder">Abrir pasta</button></div>';
      return;
    }

    if (query.length < 2) {
      status.textContent = 'Digite ao menos 2 caracteres.';
      list.innerHTML = '';
      return;
    }

    var results = state.search.results;

    if (state.search.busy) {
      status.textContent = 'Buscando...' +
        (results.length ? ' ' + results.length + ' resultado' + (results.length === 1 ? '' : 's') + ' até agora' : '');
      list.innerHTML = results.length ? searchResultHtml(results) : '';
      return;
    }

    if (!results.length) {
      status.textContent = state.search.filesScanned
        ? 'Nenhum resultado em ' + state.search.filesScanned + ' arquivo' + (state.search.filesScanned === 1 ? '' : 's') + '.'
        : 'Nenhum arquivo de texto encontrado.';
      list.innerHTML = '';
      return;
    }

    status.textContent = results.length + ' resultado' + (results.length === 1 ? '' : 's') +
      ' em ' + state.search.filesScanned + ' arquivo' + (state.search.filesScanned === 1 ? '' : 's') +
      (state.search.truncated ? ' (busca limitada)' : '');

    list.innerHTML = searchResultHtml(results);
  }

  function scheduleGlobalSearch() {
    clearTimeout(globalSearchTimer);

    var query = state.search.query.trim();
    if (query.length < 2 || !state.dirHandle) return;

    globalSearchTimer = setTimeout(function () {
      globalSearchTimer = null;
      runGlobalSearch(query);
    }, 320);
  }

  async function collectSearchFiles(root, base, depth, budget, out) {
    if (depth > 6 || budget.visited >= SEARCH_MAX_FILES) {
      state.search.truncated = true;
      return;
    }

    var entries = [];
    try {
      for await (var entry of root.values()) entries.push(entry);
    } catch (e) {
      return;
    }

    for (var i = 0; i < entries.length; i++) {
      if (budget.visited >= SEARCH_MAX_FILES) {
        state.search.truncated = true;
        return;
      }

      var item = entries[i];
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;

      budget.visited++;
      var path = base ? base + '/' + item.name : item.name;

      if (item.kind === 'file') {
        if (/\.(md|markdown|mdown|mkd|txt)$/i.test(item.name)) {
          out.push({ handle: item, path: path, name: item.name });
        }
      } else if (item.kind === 'directory') {
        await collectSearchFiles(item, path, depth + 1, budget, out);
      }
    }
  }

  async function runGlobalSearch(rawQuery) {
    var query = String(rawQuery || '').trim();
    if (query.length < 2 || !state.dirHandle) {
      renderSearchResults();
      return;
    }

    clearTimeout(globalSearchTimer);
    globalSearchTimer = null;

    var seq = ++state.search.seq;
    var results = [];

    state.search.busy = true;
    state.search.results = [];
    state.search.filesScanned = 0;
    state.search.truncated = false;
    renderSearchResults();

    var foldedQuery = foldForSearch(query).text;
    if (!foldedQuery) {
      state.search.busy = false;
      renderSearchResults();
      return;
    }

    var files = [];
    var budget = { visited: 0 };

    try {
      await collectSearchFiles(state.dirHandle, '', 0, budget, files);

      if (seq !== state.search.seq) return;

      var totalBytes = 0;

      for (var i = 0; i < files.length; i++) {
        if (seq !== state.search.seq) return;
        if (results.length >= SEARCH_LIMIT) {
          state.search.truncated = true;
          break;
        }

        var item = files[i];
        var file;

        try {
          file = await item.handle.getFile();
        } catch (e) {
          continue;
        }

        if (file.size > SEARCH_FILE_MAX) continue;
        if (totalBytes + file.size > SEARCH_MAX_BYTES) {
          state.search.truncated = true;
          break;
        }
        totalBytes += file.size;

        var text;
        try {
          text = await file.text();
        } catch (e) {
          continue;
        }

        state.search.filesScanned++;

        var folded = foldForSearch(text);
        var nameFolded = foldForSearch(item.name).text;

        if (nameFolded.indexOf(foldedQuery) !== -1) {
          results.push({
            kind: 'file',
            name: item.name,
            path: item.path,
            handle: item.handle,
            line: 0,
            column: 0,
            lineText: '',
            matchStart: 0,
            matchLength: 0,
            term: query
          });
        }

        var starts = buildLineStarts(text);
        var seen = {};
        var idx = folded.text.indexOf(foldedQuery);

        while (idx !== -1 && results.length < SEARCH_LIMIT) {
          var offset = folded.map[idx];
          var lineIndex = lineIndexAt(starts, offset);

          if (!seen[lineIndex]) {
            seen[lineIndex] = true;

            var lineStart = starts[lineIndex];
            var lineEnd = lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : text.length;
            var rawLine = text.slice(lineStart, lineEnd);
            var leading = rawLine.length - rawLine.replace(/^\s+/, '').length;
            var lineText = rawLine.trim();
            var matchStart = offset - lineStart - leading;
            var last = idx + foldedQuery.length - 1;
            var matchLength = (last < folded.map.length ? folded.map[last] + 1 : text.length) - offset;

            if (matchStart < 0) matchStart = 0;

            if (lineText.length > 200) {
              var from = Math.max(0, matchStart - 70);
              lineText = lineText.slice(from, from + 220);
              matchStart -= from;
            }

            results.push({
              kind: 'content',
              name: item.name,
              path: item.path,
              handle: item.handle,
              line: lineIndex + 1,
              column: offset - lineStart,
              lineText: lineText,
              matchStart: matchStart,
              matchLength: Math.max(1, matchLength),
              term: text.slice(offset, offset + Math.max(1, matchLength))
            });
          }

          idx = folded.text.indexOf(foldedQuery, idx + Math.max(1, foldedQuery.length));
        }

        if (i % 10 === 0) {
          state.search.results = results.slice();
          renderSearchResults();
        }
      }
    } finally {
      if (seq === state.search.seq) {
        state.search.busy = false;
        state.search.results = results.slice();
        renderSearchResults();
      }
    }
  }

  async function openSearchResult(index) {
    var result = state.search.results[index];
    if (!result) return;
    if (!confirmDiscard()) return;

    await loadHandle(result.handle, result.path);
    if (!result.line) return;

    var starts = buildLineStarts(editor.value);
    var lineIndex = Math.min(result.line - 1, starts.length - 1);
    var lineStart = starts[lineIndex] || 0;
    var lineEnd = lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : editor.value.length;
    var line = editor.value.slice(lineStart, lineEnd);
    var target = line.toLowerCase().indexOf(String(result.term || '').toLowerCase());
    var offset = target !== -1 ? lineStart + target : lineStart + result.column;

    offset = Math.max(0, Math.min(offset, editor.value.length));
    var length = result.matchLength || (result.term ? result.term.length : 0);

    editor.focus();
    editor.setSelectionRange(offset, Math.min(offset + length, editor.value.length));
    centerCaret();
  }

  function globalFind() {
    if (!state.prefs.sidebar) setPref('sidebar', true);
    switchTab('search');
    var input = $('#global-search-input');
    if (input) {
      input.focus();
      input.select();
    }
  }



  /* ------------------------------------------------------------------ *
   * divisão dos painéis
   * ------------------------------------------------------------------ */

  function splitPanels() {
    return { panes: $('.panes'), splitter: $('#splitter') };
  }

  function splitLimits() {
    var parts = splitPanels();
    var width = parts.panes ? parts.panes.clientWidth : 0;
    var gap = parts.splitter ? parts.splitter.offsetWidth : 0;

    if (width <= gap) return { min: 0.15, max: 0.85 };

    /* cada lado preserva ao menos 280px, ou 35% em janelas estreitas */
    var minPx = Math.min(280, (width - gap) * 0.35);
    return {
      min: minPx / width,
      max: (width - gap - minPx) / width
    };
  }

  function clampSplitRatio(ratio) {
    var limits = splitLimits();
    if (typeof ratio !== 'number' || !isFinite(ratio)) ratio = 0.5;
    return Math.max(limits.min, Math.min(limits.max, ratio));
  }

  function applySplitRatio(ratio) {
    var parts = splitPanels();
    var limits = splitLimits();
    var value = clampSplitRatio(typeof ratio === 'number'
      ? ratio
      : Number(state.prefs.splitRatio));

    if (parts.panes) {
      parts.panes.style.setProperty('--split-left', (value * 100).toFixed(2) + '%');
    }

    if (parts.splitter) {
      parts.splitter.setAttribute('aria-valuenow', String(Math.round(value * 100)));
      parts.splitter.setAttribute('aria-valuemin', String(Math.round(limits.min * 100)));
      parts.splitter.setAttribute('aria-valuemax', String(Math.round(limits.max * 100)));
    }

    return value;
  }

  function saveSplitRatio(ratio) {
    var value = applySplitRatio(ratio);
    state.prefs.splitRatio = value;
    savePrefs();
    return value;
  }

  function ratioFromPointer(e) {
    var parts = splitPanels();
    if (!parts.panes || !parts.splitter) return null;

    var width = parts.panes.clientWidth;
    if (width <= 0) return null;

    var rect = parts.panes.getBoundingClientRect();
    return (e.clientX - rect.left) / width;
  }

  var splitDrag = null;
  var splitResizeTimer = null;

  function startSplitDrag(e) {
    if (state.prefs.mode !== 'split') return;
    if (e.button !== undefined && e.button !== 0) return;

    var parts = splitPanels();
    if (!parts.panes || !parts.splitter) return;

    e.preventDefault();
    splitDrag = { id: e.pointerId, ratio: applySplitRatio() };
    parts.splitter.classList.add('dragging');
    document.body.classList.add('col-resizing');
    parts.splitter.focus();
  }

  function moveSplitDrag(e) {
    if (!splitDrag || e.pointerId !== splitDrag.id) return;
    var ratio = ratioFromPointer(e);
    if (ratio === null) return;
    splitDrag.ratio = applySplitRatio(ratio);
  }

  function endSplitDrag(e) {
    if (!splitDrag) return;
    if (e.pointerId !== undefined && e.pointerId !== splitDrag.id) return;

    var value = splitDrag.ratio;
    splitDrag = null;
    document.body.classList.remove('col-resizing');

    var splitter = $('#splitter');
    if (splitter) splitter.classList.remove('dragging');

    saveSplitRatio(value);
  }

  function onSplitterKeydown(e) {
    var splitter = $('#splitter');
    if (!splitter) return;

    var current = Number(splitter.getAttribute('aria-valuenow')) / 100;
    if (!isFinite(current)) current = 0.5;

    var step = (e.shiftKey ? 5 : 2) / 100;
    var next = null;

    if (e.key === 'ArrowLeft') next = current - step;
    else if (e.key === 'ArrowRight') next = current + step;
    else if (e.key === 'Home') next = splitLimits().min;
    else if (e.key === 'End') next = splitLimits().max;
    else return;

    e.preventDefault();
    saveSplitRatio(next);
  }

  /* ------------------------------------------------------------------ *
   * localizar e substituir
   * ------------------------------------------------------------------ */

  function openFind(withReplace) {
    findbar.classList.add('on');
    var input = $('#find-input');
    input.focus();
    input.select();
    if (withReplace) $('#replace-input').focus();
    computeMatches();
  }

  function closeFind() {
    findbar.classList.remove('on');
    editor.focus();
  }

  function computeMatches() {
    var q = $('#find-input').value;
    state.find.matches = [];
    state.find.index = -1;

    if (q) {
      var hay = editor.value.toLowerCase();
      var needle = q.toLowerCase();
      var idx = hay.indexOf(needle);
      while (idx !== -1) {
        state.find.matches.push(idx);
        idx = hay.indexOf(needle, idx + Math.max(1, needle.length));
      }
    }
    updateFindCount();
  }

  function updateFindCount() {
    var total = state.find.matches.length;
    var pos = state.find.index >= 0 ? state.find.index + 1 : 0;
    $('#find-count').textContent = pos + '/' + total;
  }

  function findNext(dir) {
    var m = state.find.matches;
    if (!m.length) { computeMatches(); m = state.find.matches; }
    if (!m.length) return;

    var current = editor.selectionStart;
    var target;

    if (dir < 0) {
      target = m.filter(function (x) { return x < current; }).pop();
      if (target === undefined) target = m[m.length - 1];
    } else {
      target = m.filter(function (x) { return x > current; })[0];
      if (target === undefined) target = m[0];
    }

    state.find.index = m.indexOf(target);
    editor.focus();
    editor.setSelectionRange(target, target + $('#find-input').value.length);
    centerCaret();
    updateFindCount();
  }

  function replaceOne() {
    var q = $('#find-input').value;
    if (!q) return;
    var start = editor.selectionStart;
    var selected = editor.value.slice(start, editor.selectionEnd);
    var replacement = $('#replace-input').value;

    if (selected.toLowerCase() === q.toLowerCase()) {
      replaceRange(start, editor.selectionEnd, replacement);
    }
    computeMatches();
    findNext(1);
  }

  function replaceAll() {
    var q = $('#find-input').value;
    if (!q) return;
    var replacement = $('#replace-input').value;
    var regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var count = (editor.value.match(regex) || []).length;
    if (!count) {
      computeMatches();
      toast('Nenhuma ocorrência para substituir.');
      return;
    }
    replaceRange(0, editor.value.length, editor.value.replace(regex, replacement), 0, 0);
    computeMatches();
    toast(count + ' substituição(ões).');
  }

  /* ------------------------------------------------------------------ *
   * rolagem sincronizada / cursor
   * ------------------------------------------------------------------ */

  function lineHeightPx() {
    var cs = getComputedStyle(editor);
    var lh = parseFloat(cs.lineHeight);
    if (!isNaN(lh)) return lh;
    return parseFloat(cs.fontSize) * 1.75;
  }

  function editorPaddingTop() {
    return parseFloat(getComputedStyle(editor).paddingTop) || 0;
  }

  function topVisibleLine() {
    var lh = lineHeightPx();
    var y = editor.scrollTop - editorPaddingTop() + 8;
    return Math.max(0, y / lh);
  }

  function topBlocks() {
    return Array.prototype.filter.call(preview.children, function (n) {
      return n.dataset && n.dataset.line !== undefined;
    });
  }

  function syncPreviewFromEditor() {
    if (state.syncing || !state.prefs.sync) return;
    if (state.prefs.mode === 'source' || state.prefs.mode === 'read') return;

    state.syncing = 'e';
    var line = topVisibleLine();
    var blocks = topBlocks();
    if (!blocks.length) { state.syncing = null; return; }

    var chosen = blocks[0];
    for (var i = 0; i < blocks.length; i++) {
      var bl = parseFloat(blocks[i].dataset.line);
      if (bl <= line) chosen = blocks[i];
      else break;
    }
    var startLine = parseFloat(chosen.dataset.line);
    var idx = blocks.indexOf(chosen);
    var next = blocks[idx + 1];
    var span = next ? Math.max(1, parseFloat(next.dataset.line) - startLine) : 1;
    var frac = Math.min(1, Math.max(0, (line - startLine) / span));
    var target = chosen.offsetTop + frac * chosen.offsetHeight - 10;

    previewScroll.classList.add('no-smooth');
    previewScroll.scrollTop = Math.max(0, target);
    setTimeout(function () {
      previewScroll.classList.remove('no-smooth');
      state.syncing = null;
    }, 30);
  }

  function syncEditorFromPreview() {
    if (state.syncing || !state.prefs.sync) return;
    if (state.prefs.mode !== 'split') return;

    state.syncing = 'p';
    var y = previewScroll.scrollTop;
    var blocks = topBlocks();
    if (!blocks.length) { state.syncing = null; return; }

    var chosen = blocks[0];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].offsetTop <= y + 12) chosen = blocks[i];
      else break;
    }
    var idx = blocks.indexOf(chosen);
    var line = parseFloat(chosen.dataset.line);
    var next = blocks[idx + 1];
    if (next) {
      var span = Math.max(1, parseFloat(next.dataset.line) - line);
      var frac = Math.min(1, Math.max(0, (y - chosen.offsetTop) / Math.max(1, chosen.offsetHeight)));
      line += frac * span;
    }

    editor.scrollTop = line * lineHeightPx() + editorPaddingTop() - 8;
    syncOverlayScroll();
    setTimeout(function () { state.syncing = null; }, 30);
  }

  function centerCaret(force) {
    if (!state.prefs.typewriter && !force) return;
    var line = offsetToLine(editor.selectionStart);
    var lh = lineHeightPx();
    var ratio = state.prefs.typewriter ? 0.42 : 0.22;
    var target = line * lh + editorPaddingTop() - editor.clientHeight * ratio;
    editor.scrollTop = Math.max(0, target);
    syncOverlayScroll();
  }

  /* ------------------------------------------------------------------ *
   * edição: entrada, atalhos de digitação
   * ------------------------------------------------------------------ */

  function onInput() {
    state.text = editor.value;
    markDirty(state.text !== state.savedText);
    scheduleRender();
    paintSource();
    syncHeadingSelect();
    if (state.prefs.autosave) scheduleDraft();
    scheduleHistory();
  }

  var draftTimer = null;
  function saveDraftNow() {
    if (!state.prefs.autosave) return;
    clearTimeout(draftTimer);
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({ name: state.name, text: state.text, at: Date.now() }));
    } catch (e) {}
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 800);
  }

  var PAIRS = {
    '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`',
    '*': '*', '_': '_', '~': '~', '$': '$'
  };

  function handleKeydown(e) {
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;

    /* atalhos globais */
    if (mod && e.altKey) {
      if (key === '1') { e.preventDefault(); return COMMANDS.modeSplit(); }
      if (key === '2') { e.preventDefault(); return COMMANDS.modeRead(); }
      return;
    }

    if (mod) {
      var k = key.toLowerCase();

      /* combinações com Shift primeiro, para não colidir com as simples */
      if (e.shiftKey) {
        if (k === 's') { e.preventDefault(); return COMMANDS.saveAs(); }
        if (k === 'f') { e.preventDefault(); return COMMANDS.toggleFocus(); }
        if (k === 'k') { e.preventDefault(); return COMMANDS.codeblock(); }
        if (k === 'e') { e.preventDefault(); return COMMANDS.code(); }
        if (k === 'x') { e.preventDefault(); return COMMANDS.task(); }
        if (k === 'u') { e.preventDefault(); return COMMANDS.ul(); }
        if (k === 'o') { e.preventDefault(); return COMMANDS.ol(); }
        if (k === 'q') { e.preventDefault(); return COMMANDS.quote(); }
        if (k === 'm') { e.preventDefault(); return COMMANDS.math(); }
        if (k === 'i') { e.preventDefault(); return COMMANDS.image(); }
        if (k === 't') { e.preventDefault(); return COMMANDS.toggleToolbar(); }
        if (key === '1') { e.preventDefault(); return COMMANDS.toggleSidebar(); }
      }

      if (k === 's') { e.preventDefault(); return COMMANDS.save(); }
      if (k === 'o') { e.preventDefault(); return COMMANDS.open(); }
      if (k === 'n') { e.preventDefault(); return COMMANDS.new(); }
      if (k === 'p') { e.preventDefault(); return COMMANDS.exportPdf(); }
      if (k === 'f') { e.preventDefault(); return COMMANDS.find(); }
      if (k === 'h') { e.preventDefault(); return COMMANDS.replace(); }
      if (k === ',') { e.preventDefault(); return COMMANDS.prefs(); }
      if (k === '/') { e.preventDefault(); return COMMANDS.modeSource(); }
      if (k === '=' || k === '+') { e.preventDefault(); return COMMANDS.zoomIn(); }
      if (k === '-') { e.preventDefault(); return COMMANDS.zoomOut(); }
      if (key === '0') { e.preventDefault(); return COMMANDS.zoomReset(); }
      if (/^[1-6]$/.test(key)) { e.preventDefault(); return COMMANDS['h' + key](); }
      if (k === 'b') { e.preventDefault(); return COMMANDS.bold(); }
      if (k === 'i') { e.preventDefault(); return COMMANDS.italic(); }
      if (k === 'k') { e.preventDefault(); return COMMANDS.link(); }
      if (k === 't') { e.preventDefault(); return COMMANDS.table(); }
    }

    if (key === 'F1') { e.preventDefault(); return COMMANDS.shortcuts(); }

    /* --- daqui para baixo: apenas dentro do editor --- */
    if (document.activeElement !== editor) return;

    if (key === 'Tab') {
      e.preventDefault();
      applyTab(!e.shiftKey);
      return;
    }

    if (key === 'Enter') {
      if (e.isComposing) return;
      if (smartEnter(e)) return;
    }

    if (key === 'Backspace' && !e.ctrlKey) {
      if (smartBackspace(e)) return;
    }

    if (state.prefs.autopair && key.length === 1 && PAIRS[key]) {
      var start = editor.selectionStart;
      var end = editor.selectionEnd;
      var next = editor.value[end] || '';

      if (start !== end) {
        e.preventDefault();
        var sel = editor.value.slice(start, end);
        replaceRange(start, end, key + sel + PAIRS[key], start + 1 + sel.length, start + 1 + sel.length);
        return;
      }
      if (next && /[A-Za-z0-9_À-ÿ]/.test(next)) return;

      e.preventDefault();
      replaceRange(start, end, key + PAIRS[key], start + 1, start + 1);
      return;
    }
  }

  function applyTab(indent) {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var value = editor.value;
    var step = '    ';

    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    var block = value.slice(lineStart, lineEnd);

    if (block.indexOf('\n') === -1 && start === end) {
      var col = start - lineStart;
      var spaces = indent ? step.length - (col % step.length) : -Math.min(step.length, col - (col % step.length) || step.length);
      if (!indent) {
        var remove = 0;
        while (remove < step.length && value[start - 1 - remove] === ' ') remove++;
        if (!remove) return;
        replaceRange(start - remove, start, '', start - remove, start - remove);
        return;
      }
      replaceRange(start, end, ' '.repeat(spaces), start + spaces, start + spaces);
      return;
    }

    var lines = block.split('\n');
    var changed = lines.map(function (line) {
      if (indent) return step + line;
      return line.replace(/^ {1,4}/, '').replace(/^\t/, '');
    }).join('\n');

    replaceRange(lineStart, lineEnd, changed, lineStart, lineStart + changed.length);
  }

  function smartEnter(e) {
    var start = editor.selectionStart;
    var value = editor.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var line = value.slice(lineStart, start);

    var m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/.exec(line);

    if (!m) {
      // continuação de citação
      if (/^\s*>\s?/.test(line)) {
        e.preventDefault();
        var q = /^(\s*>\s?)/.exec(line)[1];
        replaceRange(start, editor.selectionEnd, '\n' + q);
        return true;
      }
      return false;
    }

    e.preventDefault();
    var indent = m[1];
    var marker = m[2];
    var task = m[3] ? '- [ ] ' : '';
    var content = line.slice(m[0].length);

    if (!content.trim()) {
      // linha vazia: encerra a lista
      replaceRange(lineStart, start, '', lineStart, lineStart);
      return true;
    }

    if (/\d/.test(marker)) {
      var num = parseInt(marker, 10) + 1;
      marker = num + marker.replace(/^\d+/, '');
    }

    var insertion;
    if (m[3]) {
      // nova tarefa nasce desmarcada
      insertion = '\n' + indent + marker + ' [ ] ';
    } else {
      insertion = '\n' + indent + marker + ' ';
    }
    replaceRange(start, editor.selectionEnd, insertion);
    return true;
  }

  function smartBackspace(e) {
    var start = editor.selectionStart;
    if (start !== editor.selectionEnd) return false;
    var value = editor.value;
    var pair = value[start - 1] + (value[start] || '');
    if (pair === '()' || pair === '[]' || pair === '{}' || pair === '""' ||
        pair === "''" || pair === '``' || pair === '**' || pair === '__') {
      e.preventDefault();
      replaceRange(start - 1, start + 1, '', start - 1, start - 1);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * exportação
   * ------------------------------------------------------------------ */

  var EXPORT_CSS = [
    'body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font);font-size:16px;line-height:1.72}',
    '.doc{max-width:46rem;margin:0 auto;padding:48px 24px 80px;overflow-wrap:break-word}',
    '.doc h1,.doc h2,.doc h3,.doc h4,.doc h5,.doc h6{margin:1.6em 0 .6em;line-height:1.3;font-weight:650}',
    '.doc h1{font-size:1.9em}.doc h2{font-size:1.5em;border-bottom:1px solid var(--border);padding-bottom:.25em}',
    '.doc h3{font-size:1.22em}',
    '.doc a{color:var(--accent);text-decoration:none;border-bottom:1px solid var(--accent)}',
    '.doc code{font-family:ui-monospace,Consolas,monospace;font-size:.88em;background:var(--code-bg);padding:.15em .38em;border-radius:4px}',
    '.doc pre{margin:0;padding:14px 16px;overflow:auto;background:var(--code-bg);border-radius:8px;font-size:.86em;line-height:1.6}',
    '.doc pre code{background:none;padding:0}',
    '.doc .code-block{position:relative;margin:0 0 1.15em;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--code-bg)}',
    '.doc .code-lang{position:absolute;top:0;right:0;padding:3px 9px;font-size:.68em;text-transform:uppercase;color:var(--fg-dim);background:var(--bg-soft)}',
    '.doc blockquote{margin:0 0 1.15em;padding:.2em 0 .2em 1.1em;border-left:3px solid var(--border);color:var(--fg-dim)}',
    '.doc table{border-collapse:collapse;font-size:.92em}',
    '.doc th,.doc td{border:1px solid var(--border);padding:.45em .8em;text-align:left}',
    '.doc thead th{background:var(--bg-soft)}',
    '.doc img{max-width:100%;border-radius:6px}',
    '.doc hr{border:0;height:1px;background:var(--border);margin:2em 0}',
    '.doc mark{background:var(--mark-bg);border-radius:3px;padding:0 .12em}',
    '.doc ul.task-list{list-style:none;padding-left:.35em}',
    '.doc .alert{margin:0 0 1.15em;padding:.75em 1em;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:6px}',
    '.doc .alert-title{margin:0 0 .2em;font-weight:650;font-size:.9em}',
    '.doc .math{font-family:"Cambria Math",Georgia,serif}',
    '.doc .math-block{display:block;text-align:center;margin:0 0 1.2em}',
    '.doc .mfrac{display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;margin:0 .18em}',
    '.doc .mfrac .mnum{border-bottom:1px solid currentColor;padding:0 .25em}',
    '.doc .mermaid-block{margin:0 0 1.15em;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-soft);text-align:center;overflow-x:auto}',
    '.doc .mermaid-source{display:none}',
    '.doc .mermaid-block svg{max-width:100%;height:auto}',
    '.doc .mermaid-error{color:#cf222e;font-size:.78em;text-align:left;margin-top:8px}',
    '.doc .mermaid-fallback{margin:0;padding:10px 12px;background:var(--bg-elev);border-radius:6px;text-align:left;overflow-x:auto}',
    '.tok-kw{color:#cf222e}.tok-str{color:#0a7d33}.tok-com{color:#6e7781;font-style:italic}.tok-num{color:#0550ae}.tok-tag{color:#116329}',
    '@media print{body{background:#fff;color:#111}.doc{max-width:none;padding:0}.doc .mermaid-block{background:#fff;border-color:#ddd;break-inside:avoid}}'
  ].join('\n');

  function themeVars() {
    var cs = getComputedStyle(document.documentElement);
    var names = ['--bg', '--bg-soft', '--fg', '--fg-dim', '--border', '--accent', '--accent-soft', '--code-bg', '--mark-bg'];
    return names.map(function (n) {
      return n + ':' + cs.getPropertyValue(n).trim() + ';';
    }).join('');
  }

  function buildExportHtml(fragment) {
    var vars = themeVars() + '--font:' + FONTS[state.prefs.font] + ';';
    var content = fragment === undefined ? preview.innerHTML : fragment;
    return '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(state.name.replace(/\.(md|markdown|txt)$/i, '')) + '</title>\n' +
      '<style>:root{' + vars + '}\n' + EXPORT_CSS + '\n</style>\n</head>\n<body>\n' +
      '<article class="doc">\n' + content + '\n</article>\n</body>\n</html>';
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Falha ao ler imagem')); };
      reader.readAsDataURL(blob);
    });
  }

  async function prepareExportFragment() {
    var clone = preview.cloneNode(true);
    var images = $$('img', clone);

    await Promise.all(images.map(async function (img) {
      var docPath = img.dataset.docPath;
      var src = img.getAttribute('src') || '';
      var orig = img.dataset.origSrc || '';

      if (docPath && state.dirHandle) {
        try {
          var file = await getFileFromRoot(state.dirHandle, docPath);
          img.setAttribute('src', await blobToDataUrl(file));
          return;
        } catch (e) { /* tenta o blob já carregado */ }
      }

      if (/^blob:/i.test(src)) {
        try {
          var response = await fetch(src);
          var blob = await response.blob();
          img.setAttribute('src', await blobToDataUrl(blob));
          return;
        } catch (e) { /* mantém a referência original */ }
      }

      if (img.dataset.imgState === 'missing' && orig) {
        img.setAttribute('src', orig);
      }
    }));

    return clone.innerHTML;
  }

  /* ------------------------------------------------------------------ *
   * impressão
   * ------------------------------------------------------------------ */

  function waitForImage(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();

    return new Promise(function (resolve) {
      var timer = setTimeout(done, 2500);

      function done() {
        clearTimeout(timer);
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        resolve();
      }

      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
  }

  async function printDocument() {
    renderNow();
    var images = $$('#preview img');

    if (images.length) {
      var pending = images.some(function (img) {
        return !img.complete || !img.naturalWidth;
      });

      if (pending) toast('Preparando imagens para impressão…');

      images.forEach(function (img) { img.loading = 'eager'; });

      await Promise.all(images.map(waitForImage));
      await Promise.all(images.map(function (img) {
        return typeof img.decode === 'function'
          ? img.decode().catch(function () {})
          : Promise.resolve();
      }));
    }

    if (preview.querySelector('.mermaid-block')) {
      await renderMermaidBlocks(state.renderSeq, 'default');

      if (state.prefs.theme !== 'claro') {
        window.addEventListener('afterprint', function () {
          renderMermaidBlocks(state.renderSeq, mermaidThemeName());
        }, { once: true });
      }
    }

    window.print();
  }

  async function exportHtml() {
    toast('Preparando HTML autônomo…');
    try {
      renderNow();
      await renderMermaidBlocks(state.renderSeq);
      var fragment = await prepareExportFragment();
      var html = buildExportHtml(fragment);
      var name = state.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.html';
      downloadText(html, name, 'text/html;charset=utf-8');
      toast('HTML exportado: ' + name);
    } catch (e) {
      toast('Não foi possível exportar o HTML.');
    }
  }

  async function copyHtml() {
    try {
      renderNow();
      await renderMermaidBlocks(state.renderSeq);
      var fragment = await prepareExportFragment();
      await navigator.clipboard.writeText(fragment);
      toast('HTML do documento copiado.');
    } catch (e) {
      toast('Não foi possível copiar.');
    }
  }

  async function exportOffice(kind) {
    if (!window.IluminuraExport) {
      toast('Exportação indisponível.');
      return;
    }

    var label = kind === 'docx' ? 'DOCX' : 'EPUB';
    toast('Preparando ' + label + '...');

    try {
      renderNow();
      await renderMermaidBlocks(state.renderSeq);
      var fragment = await prepareExportFragment();
      var base = state.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
      var blob = kind === 'docx'
        ? await window.IluminuraExport.docx(fragment, { title: base })
        : await window.IluminuraExport.epub(fragment, { title: base, headings: state.headings });

      downloadBlob(blob, base + '.' + kind);
      toast(label + ' exportado: ' + base + '.' + kind);
    } catch (e) {
      toast('Não foi possível exportar o ' + label + '.');
    }
  }

  /* ------------------------------------------------------------------ *
   * modais
   * ------------------------------------------------------------------ */

  function openModal(id) {
    $('#' + id).classList.add('on');
  }

  function closeModal(id) {
    $('#' + id).classList.remove('on');
  }

  function installApp() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      toast('O Iluminura já está instalado.');
      return;
    }

    if (!deferredInstallPrompt) {
      toast('Use o menu do navegador para instalar o aplicativo.');
      return;
    }

    var prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    prompt.prompt();

    if (prompt.userChoice && typeof prompt.userChoice.then === 'function') {
      prompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') toast('Instalando Iluminura.');
      });
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  var SHORTCUTS = [
    ['Abrir arquivo', 'Ctrl+O'],
    ['Salvar', 'Ctrl+S'],
    ['Desfazer', 'Ctrl+Z'],
    ['Refazer', 'Ctrl+Y / Ctrl+Shift+Z'],
    ['Novo documento', 'Ctrl+N'],
    ['Localizar', 'Ctrl+F'],
    ['Substituir', 'Ctrl+H'],
    ['Buscar na pasta', 'Ctrl+Shift+G'],
    ['Preferências', 'Ctrl+,'],
    ['Negrito', 'Ctrl+B'],
    ['Itálico', 'Ctrl+I'],
    ['Link', 'Ctrl+K'],
    ['Títulos 1–6', 'Ctrl+1 … Ctrl+6'],
    ['Código-fonte', 'Ctrl+/'],
    ['Modo foco', 'Ctrl+Shift+F'],
    ['Barra lateral', 'Ctrl+Shift+1'],
    ['Divisão dos painéis', 'Foco no divisor + ← / →'],
    ['Barra de ferramentas', 'Ctrl+Shift+T'],
    ['Atualizar do disco', 'F5'],
    ['Zoom', 'Ctrl+= / Ctrl+-'],
    ['Imprimir / PDF', 'Ctrl+P'],
    ['Atalhos', 'F1']
  ];

  function buildShortcutGrid() {
    $('#shortcut-grid').innerHTML = SHORTCUTS.map(function (s) {
      return '<div class="k">' + escapeHtml(s[0]) + '</div><div><kbd>' + escapeHtml(s[1]) + '</kbd></div>';
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * inicialização
   * ------------------------------------------------------------------ */

  function cacheElements() {
    el.app = $('#app');
    el.toolbar = $('#toolbar');
    editor = $('#editor');
    preview = $('#preview');
    previewScroll = $('#preview-scroll');
    hlInner = $('#hl-inner');
    findbar = $('#findbar');
  }

  function wireEvents() {
    editor.addEventListener('input', onInput);

    editor.addEventListener('scroll', function () {
      syncOverlayScroll();
      syncPreviewFromEditor();
    }, { passive: true });

    previewScroll.addEventListener('scroll', syncEditorFromPreview, { passive: true });

    editor.addEventListener('keydown', handleKeydown);

    editor.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
        paintSource();
        centerCaret();
      }
      syncHeadingSelect();
    });

    editor.addEventListener('click', function () {
      paintSource();
      syncHeadingSelect();
    });

    editor.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          e.preventDefault();
          var file = items[i].getAsFile();
          var reader = new FileReader();
          reader.onload = function () {
            var md = '![](' + reader.result + ')';
            replaceRange(editor.selectionStart, editor.selectionEnd, md);
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    });

    editor.addEventListener('dragover', function (e) { e.preventDefault(); });
    editor.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      var files = e.dataTransfer.files;
      if (files && files.length) {
        e.preventDefault();
        var file = files[0];
        if (/^image\//.test(file.type)) {
          var reader = new FileReader();
          reader.onload = function () {
            replaceRange(editor.selectionStart, editor.selectionEnd, '![](' + reader.result + ')');
          };
          reader.readAsDataURL(file);
        } else {
          file.text().then(function (text) {
            if (!confirmDiscard()) return;
            setDoc(text, file.name, null);
          });
        }
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.menu')) closeMenus();
    });

    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;

      if (mod && !e.altKey) {
        var k = e.key.toLowerCase();
        var target = e.target;
        var editable = !!(target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        ));
        var modalOpen = !!$('.modal-backdrop.on');

        if ((k === 'z' || k === 'y') && (!editable || target === editor) && !modalOpen) {
          e.preventDefault();
          if (k === 'y' || (k === 'z' && e.shiftKey)) redoEdit();
          else undoEdit();
          return;
        }

        if (k === 'g' && e.shiftKey && !modalOpen) {
          e.preventDefault();
          globalFind();
          return;
        }
      }

      if (e.key === 'F5' && diskBound() && !$('.modal-backdrop.on') &&
          !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        reloadFromDisk(false);
        return;
      }
      if (e.key === 'Escape') {
        closeMenus();
        if (findbar.classList.contains('on')) closeFind();
        $$('.modal-backdrop.on').forEach(function (m) { m.classList.remove('on'); });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && document.activeElement !== editor) {
        e.preventDefault();
        saveDocument(false);
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (state.dirty && !state.prefs.autosave) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    $('#file-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        setDoc(text, file.name, null);
        addRecent(file.name, text);
        toast('Aberto: ' + file.name + ' (somente leitura do arquivo original)');
      });
      e.target.value = '';
    });

    /* botões do cabeçalho */
    $('#btn-sidebar').addEventListener('click', COMMANDS.toggleSidebar);
    $('#btn-sidebar-collapse').addEventListener('click', function () {
      COMMANDS.toggleSidebar();
      $('#btn-sidebar-restore').focus({ preventScroll: true });
    });
    $('#btn-sidebar-restore').addEventListener('click', function () {
      COMMANDS.toggleSidebar();
      $('#btn-sidebar-collapse').focus({ preventScroll: true });
    });
    $('#btn-focus').addEventListener('click', COMMANDS.toggleFocus);
    $('#btn-typewriter').addEventListener('click', COMMANDS.toggleTypewriter);
    $('#btn-toolbar').addEventListener('click', COMMANDS.toggleToolbar);

    /* divisor entre editor e visualização */
    var splitter = $('#splitter');
    splitter.addEventListener('pointerdown', startSplitDrag);
    splitter.addEventListener('dblclick', function () { saveSplitRatio(0.5); });
    splitter.addEventListener('keydown', onSplitterKeydown);
    window.addEventListener('pointermove', moveSplitDrag);
    window.addEventListener('pointerup', endSplitDrag);
    window.addEventListener('pointercancel', endSplitDrag);
    window.addEventListener('blur', endSplitDrag);
    window.addEventListener('resize', function () {
      clearTimeout(splitResizeTimer);
      splitResizeTimer = setTimeout(function () { applySplitRatio(); }, 120);
    });

    $('#btn-zoom-in').addEventListener('click', COMMANDS.zoomIn);
    $('#btn-zoom-out').addEventListener('click', COMMANDS.zoomOut);

    /* barra de ferramentas */
    el.toolbar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cmd]');
      if (!b) return;
      var fn = COMMANDS[b.dataset.cmd];
      if (fn) fn();
      syncHeadingSelect();
    });

    el.toolbar.addEventListener('change', function (e) {
      if (e.target.id !== 'tb-heading') return;
      var level = Number(e.target.value);
      if (level === 0) COMMANDS.h0();
      else if (COMMANDS['h' + level]) COMMANDS['h' + level]();
      syncHeadingSelect();
    });

    /* aviso de imagens relativas */
    var noticeAction = $('#doc-notice-action');
    if (noticeAction) noticeAction.addEventListener('click', COMMANDS.openFolderImages);
    var noticeClose = $('#doc-notice-close');
    if (noticeClose) {
      noticeClose.addEventListener('click', function () {
        state.noticeDismissed = true;
        var notice = $('#doc-notice');
        if (notice) notice.hidden = true;
      });
    }

    /* aviso de alteração externa no arquivo */
    var diskReload = $('#disk-notice-reload');
    if (diskReload) diskReload.addEventListener('click', handleDiskNoticeAction);
    var diskClose = $('#disk-notice-close');
    if (diskClose) diskClose.addEventListener('click', dismissDiskNotice);

    /* revisão de alterações externas */
    $('#review-apply').addEventListener('click', applyReview);
    $('#review-keep').addEventListener('click', keepReviewLocal);
    $('#review-reload').addEventListener('click', reloadReview);

    $('#review-select-all').addEventListener('change', function (e) {
      $$('#review-diff input[data-hunk]').forEach(function (box) {
        box.checked = e.target.checked;
      });
      updateReviewApplyState();
    });

    $('#review-diff').addEventListener('change', function (e) {
      if (e.target.matches('input[data-hunk]')) updateReviewApplyState();
    });

    $('#review-history-list').addEventListener('click', function (e) {
      var button = e.target.closest('button[data-review-history]');
      if (!button) return;
      restoreReviewHistory(Number(button.dataset.reviewHistory));
    });

    window.addEventListener('focus', function () { checkDiskChange(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkDiskChange();
    });

    document.addEventListener('fullscreenchange', syncToolbarState);

    /* localizar */
    $('#find-input').addEventListener('input', computeMatches);
    $('#find-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    });
    $('#replace-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    });
    $('#find-next').addEventListener('click', function () { findNext(1); });
    $('#find-prev').addEventListener('click', function () { findNext(-1); });
    $('#replace-one').addEventListener('click', replaceOne);
    $('#replace-all').addEventListener('click', replaceAll);
    $('#find-close').addEventListener('click', closeFind);

    /* seletores da barra de status */
    $('#theme-select').addEventListener('change', function (e) { setPref('theme', e.target.value); });
    $('#reading-speed').addEventListener('change', function (e) {
      setPref('speed', Number(e.target.value));
      updateStats();
    });

    /* preferências */
    $('#pref-theme').addEventListener('change', function (e) { setPref('theme', e.target.value); });
    $('#pref-font').addEventListener('change', function (e) { setPref('font', e.target.value); });
    $('#pref-width').addEventListener('change', function (e) { setPref('width', e.target.value); });
    $('#pref-size').addEventListener('change', function (e) {
      setPref('size', Math.min(26, Math.max(12, Number(e.target.value) || 16)));
    });
    $('#pref-highlight').addEventListener('change', function (e) { setPref('highlight', e.target.checked); });
    $('#pref-autopair').addEventListener('change', function (e) { setPref('autopair', e.target.checked); });
    $('#pref-autosave').addEventListener('change', function (e) { setPref('autosave', e.target.checked); });
    $('#pref-external-mode').addEventListener('change', function (e) {
      var mode = e.target.value;
      setPref('externalMode', mode);
      if (mode !== 'off') checkDiskChange(true);

      var messages = {
        review: 'Revisão antes de aplicar ativada.',
        auto: 'Aplicação automática ativada.',
        off: 'Atualização externa automática desativada.'
      };
      toast(messages[mode] || 'Preferência atualizada.');
    });
    $('#pref-sync').addEventListener('change', function (e) { setPref('sync', e.target.checked); });
    $('#pref-linebreak').addEventListener('change', function (e) {
      setPref('hardBreak', e.target.checked);
      renderNow();
    });
    $('#pref-close').addEventListener('click', function () { closeModal('modal-prefs'); });
    $('#pref-reset').addEventListener('click', function () {
      state.prefs = Object.assign({}, DEFAULTS);
      savePrefs();
      applyPrefs();
      renderNow();
      toast('Preferências restauradas.');
    });

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.dataset.close); });
    });

    $$('.modal-backdrop').forEach(function (bd) {
      bd.addEventListener('click', function (e) {
        if (e.target === bd) bd.classList.remove('on');
      });
    });
  }

  function boot() {
    cacheElements();
    loadPrefs();
    buildMenus();
    buildShortcutGrid();
    buildToolbar();
    wireSidebar();
    wireEvents();
    applyPrefs();

    var demo = [
      '# Iluminura',
      '',
      'Leitura e escrita **Markdown** local, visual e sem dependências.',
      '',
      '> Abra um arquivo com `Ctrl+O`, ou arraste um `.md` para esta janela.',
      '',
      '## Comece por aqui',
      '',
      '- [x] Escreva à esquerda',
      '- [x] Leia à direita',
      '- [ ] Pressione `Ctrl+S` para salvar',
      '',
      '| Recurso | Atalho |',
      '| --- | --- |',
      '| Localizar | `Ctrl+F` |',
      '| Desfazer | `Ctrl+Z` |',
      '| Modo foco | `Ctrl+Shift+F` |',
      '| Código-fonte | `Ctrl+/` |',
      '',
      '```js',
      'const iluminura = { nome: "Iluminura", visual: true, livre: true };',
      'console.log(`Olá, ${iluminura.nome}`);',
      '```',
      '',
      '## Diagramas',
      '',
      '```mermaid',
      'graph LR',
      '  A[Markdown] --> B[Iluminura]',
      '  B --> C[SVG]',
      '```',
      '',
      'Fórmula na linha: $E = mc^2$ e um bloco:',
      '',
      '$$',
      '\\frac{a}{b} = c',
      '$$',
      '',
      '---',
      '',
      'Documento de exemplo — substitua pelo seu texto.'
    ].join('\n');

    var draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null');
    } catch (e) {}

    if (draft && draft.text && draft.text.trim()) {
      setDoc(draft.text, draft.name || 'rascunho.md', null);
      markDirty(true);
      toast('Rascunho recuperado do navegador.');
    } else {
      setDoc(demo, 'exemplo.md', null);
      markDirty(false);
    }

    $('#app-version').textContent = APP_VERSION;
    switchTab('outline');
    renderNow();
    paintSource();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
