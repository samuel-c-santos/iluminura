#!/usr/bin/env node
/*
 * Iluminura: testes E2E no navegador.
 * Uso: node testes/e2e/run.js
 * Requer Node.js 22 ou superior e Chrome ou Edge instalado.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 8799);
const CDP_PORT = PORT + 1;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'iluminura-e2e-'));
const DOWNLOAD = path.join(PROFILE, 'downloads');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(name, condition, detail) {
  const ok = !!condition;
  results.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : ' -> ' + detail));
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

async function waitForServer(timeout) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return true;
    } catch (e) { /* tenta novamente */ }
    await sleep(200);
  }

  return false;
}

function readZip(buffer) {
  const entries = new Map();
  const order = [];
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + size);

    entries.set(name, { name, method, data });
    order.push(name);
    offset = start + size;
  }

  return { entries, order };
}

function pickerTree() {
  return {
    kind: 'directory',
    name: 'projeto',
    children: [
      {
        kind: 'file',
        name: 'projeto.md',
        text: '# Projeto\n\nO código organiza a busca.\n\nO código também aparece aqui.\n'
      },
      {
        kind: 'directory',
        name: 'notas',
        children: [
          { kind: 'file', name: 'ideia.md', text: '# Ideia\n\nUm código pequeno e visual.\n' }
        ]
      },
      { kind: 'file', name: 'leia.txt', text: 'CÓDIGO em maiúsculas.\n' }
    ]
  };
}

function pickerSource(tree) {
  return `
(() => {
  const DATA = ${JSON.stringify(tree)};

  function makeTree(node) {
    const entries = [];
    const handle = {
      kind: 'directory',
      name: node.name,
      async *values() {
        for (const entry of entries) yield entry;
      },
      async getDirectoryHandle(name) {
        const found = entries.find((entry) => entry.kind === 'directory' && entry.name === name);
        if (!found) throw new DOMException('Diretório não encontrado', 'NotFoundError');
        return found;
      },
      async getFileHandle(name) {
        const found = entries.find((entry) => entry.kind === 'file' && entry.name === name);
        if (!found) throw new DOMException('Arquivo não encontrado', 'NotFoundError');
        return found;
      }
    };

    for (const child of node.children) {
      if (child.kind === 'directory') {
        entries.push(makeTree(child));
      } else {
        entries.push({
          kind: 'file',
          name: child.name,
          async getFile() {
            return new File([child.text || ''], child.name, { type: 'text/plain' });
          }
        });
      }
    }

    return handle;
  }

  const root = makeTree(DATA);
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
  window.confirm = () => true;
})();
`;
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('Chrome ou Edge não encontrado. Defina CHROME_PATH.');
    process.exit(1);
  }

  if (typeof WebSocket !== 'function') {
    console.error('Este teste requer Node.js 22 ou superior.');
    process.exit(1);
  }

  fs.mkdirSync(DOWNLOAD, { recursive: true });

  const server = spawn(process.execPath, [path.join(ROOT, 'servidor.js'), String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { ILUMINURA_NO_OPEN: '1' }),
    stdio: 'ignore'
  });

  let chrome;
  let ws;

  try {
    if (!await waitForServer(15000)) throw new Error('Servidor local não iniciou na porta ' + PORT);

    chrome = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + PROFILE,
      '--remote-debugging-port=' + CDP_PORT,
      '--window-size=1440,1100',
      'about:blank'
    ], { stdio: 'ignore' });

    let target = null;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
        target = list.find((entry) => entry.type === 'page');
        if (target) break;
      } catch (e) { /* aguarda */ }
      await sleep(200);
    }
    if (!target) throw new Error('Chrome não abriu a porta de depuração');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let nextId = 1;
    const pending = new Map();
    const exceptions = [];

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        exceptions.push(message.params.exceptionDetails.text + ' ' +
          ((message.params.exceptionDetails.exception || {}).description || ''));
      }
      if (message.id && pending.has(message.id)) {
        const promise = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
        else promise.resolve(message.result);
      }
    };

    const send = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text + ' ' +
          ((result.exceptionDetails.exception || {}).description || ''));
      }
      return result.result.value;
    };

    const waitFor = async (predicate, timeout) => {
      const start = Date.now();
      let value;

      while (Date.now() - start < timeout) {
        value = await predicate();
        if (value) return value;
        await sleep(250);
      }

      return value;
    };

    const parseXmlInPage = (xmlText, mime) => evaluate(`(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(xmlText)}, ${JSON.stringify(mime)});
      const error = doc.querySelector('parsererror');
      return error ? error.textContent.trim().slice(0, 200) : 'ok';
    })()`);

    const clickMenu = async (menuLabel, itemLabel) => evaluate(`(() => {
      const menu = [...document.querySelectorAll('#menus button')]
        .find((button) => button.textContent.trim() === ${JSON.stringify(menuLabel)});
      if (!menu) return false;
      menu.click();
      const item = [...document.querySelectorAll('.menu-panel button')]
        .find((button) => button.textContent.includes(${JSON.stringify(itemLabel)}));
      if (!item) return false;
      item.click();
      return true;
    })()`);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.navigate', { url: BASE });
    await sleep(2500);

    console.log('\n[1] Inicialização, identidade e PWA');
    const boot = await evaluate(`(() => ({
      title: document.title,
      brand: document.querySelector('.brand') ? document.querySelector('.brand').textContent.trim() : null,
      version: document.querySelector('#app-version') ? document.querySelector('#app-version').textContent : null,
      manifest: document.querySelector('link[rel="manifest"]') ? document.querySelector('link[rel="manifest"]').href : null,
      editor: !!document.querySelector('#editor'),
      preview: !!document.querySelector('.document'),
      serviceWorker: 'serviceWorker' in navigator
    }))()`);

    check('título com Iluminura', boot.title.endsWith('Iluminura'), boot.title);
    check('marca Iluminura', boot.brand === 'Iluminura', boot.brand);
    check('versão 1.7.0', boot.version === '1.7.0', boot.version);
    check('manifesto PWA', !!boot.manifest && boot.manifest.endsWith('/manifest.webmanifest'), boot.manifest);
    check('editor e pré-visualização', boot.editor && boot.preview);

    const sw = await evaluate(`Promise.race([
      navigator.serviceWorker.ready.then((registration) => ({ scope: registration.scope, active: !!registration.active })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 7000))
    ])`);
    check('service worker ativo', !!sw.scope && sw.active === true, JSON.stringify(sw));

    const cached = await evaluate(`caches.keys().then(async (keys) => {
      const paths = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        paths.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
      }
      return paths;
    })`);
    check('cache offline essencial', cached.includes('/index.html') && cached.includes('/assets/app.js') &&
      cached.includes('/assets/exportar.js'));

    const demoDiagram = await waitFor(() => evaluate(`(() => {
      const block = document.querySelector('.mermaid-block');
      const svg = block ? block.querySelector('svg') : null;
      return block && block.dataset.mermaidState === 'ready' && svg ? {
        state: block.dataset.mermaidState,
        width: Math.round(svg.getBoundingClientRect().width),
        text: svg.textContent.replace(/\s+/g, ' ').trim()
      } : null;
    })()`), 15000);
    check('Mermaid no documento inicial', demoDiagram && demoDiagram.width > 100 &&
      demoDiagram.text.includes('Iluminura'), JSON.stringify(demoDiagram));

    console.log('\n[2] Desfazer e refazer');
    await evaluate(`(() => {
      const editor = document.querySelector('#editor');
      editor.focus();
      editor.setSelectionRange(0, 0);
      return true;
    })()`);
    await send('Input.insertText', { text: 'E2E ' });
    await sleep(850);
    const typed = await evaluate(`document.querySelector('#editor').value.slice(0, 20)`);
    check('texto inserido', typed.startsWith('E2E '), typed);

    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', modifiers: 2, key: 'z', code: 'KeyZ',
      windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ',
      windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90
    });
    await sleep(250);
    const undone = await evaluate(`document.querySelector('#editor').value.slice(0, 20)`);
    check('Ctrl+Z desfaz', !undone.startsWith('E2E '), undone);

    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', modifiers: 2, key: 'y', code: 'KeyY',
      windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: 2, key: 'y', code: 'KeyY',
      windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89
    });
    await sleep(250);
    const redone = await evaluate(`document.querySelector('#editor').value.slice(0, 20)`);
    check('Ctrl+Y refaz', redone.startsWith('E2E '), redone);

    console.log('\n[3] Busca global na pasta');
    await evaluate(pickerSource(pickerTree()));
    await evaluate(`document.querySelector('#toolbar button[data-cmd="openFolder"]').click()`);
    await sleep(900);
    await evaluate(`document.querySelector('.sidebar-tabs button[data-tab="search"]').click()`);
    await sleep(200);
    await evaluate(`(() => {
      const input = document.querySelector('#global-search-input');
      input.value = 'codigo';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

    const search = await waitFor(() => evaluate(`(() => {
      const status = document.querySelector('#global-search-status');
      const results = [...document.querySelectorAll('.search-result')].map((button) => ({
        path: button.dataset.path,
        head: button.querySelector('.search-result-head') ? button.querySelector('.search-result-head').textContent : '',
        text: button.textContent
      }));
      return status && !status.textContent.startsWith('Buscando') && results.length >= 4
        ? { status: status.textContent, results }
        : null;
    })()`), 15000);
    check('busca sem acento encontra 4 linhas', search && search.results.length === 4,
      search ? JSON.stringify(search.results) : 'sem resultado');
    check('busca inclui subpasta e maiúsculas', search && search.results.some((item) => item.path === 'notas/ideia.md') &&
      search.results.some((item) => item.path === 'leia.txt' && item.text.includes('CÓDIGO')));

    if (search && search.results.length) {
      await evaluate(`document.querySelector('.search-result[data-act="search-result"]').click()`);
      await sleep(900);
      const opened = await evaluate(`(() => {
        const editor = document.querySelector('#editor');
        return {
          title: document.title,
          selection: editor.value.slice(editor.selectionStart, editor.selectionEnd),
          tab: document.querySelector('.sidebar-tabs button.active[data-tab]')
            ? document.querySelector('.sidebar-tabs button.active[data-tab]').dataset.tab : null
        };
      })()`);
      check('resultado abre o arquivo e seleciona o trecho',
        opened.title.startsWith('projeto.md') && opened.selection.toLowerCase().includes('código') &&
        opened.tab === 'search', JSON.stringify(opened));
    }

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'g', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }))`);
    await sleep(250);
    const shortcut = await evaluate(`document.activeElement ? document.activeElement.id : null`);
    check('Ctrl+Shift+G foca a busca', shortcut === 'global-search-input', shortcut);

    console.log('\n[4] Exportação DOCX e EPUB');
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';
    const exportDoc = [
      '# Exportação E2E',
      '',
      'Parágrafo com **negrito**, *itálico*, `código` e [link](https://example.com).',
      '',
      '- item um',
      '- item dois',
      '',
      '| Nome | Valor |',
      '| --- | --- |',
      '| Alfa | 1 |',
      '',
      '```js',
      'const valor = 42;',
      '```',
      '',
      '```mermaid',
      'graph LR',
      '  A[Entrada] --> B[Saída]',
      '```',
      '',
      '![pixel](data:image/png;base64,' + pixel + ')'
    ].join('\n');

    await evaluate(`(() => {
      const editor = document.querySelector('#editor');
      editor.value = ${JSON.stringify(exportDoc)};
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(2500);

    await send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD,
      eventsEnabled: true
    });

    const waitFile = async (extension) => {
      for (let i = 0; i < 80; i++) {
        const files = fs.readdirSync(DOWNLOAD).filter((name) => name.endsWith(extension));
        if (files.length) return path.join(DOWNLOAD, files[0]);
        await sleep(250);
      }
      return null;
    };

    check('menu DOCX disponível', await clickMenu('Arquivo', 'Exportar como DOCX'));
    const docxPath = await waitFile('.docx');
    check('arquivo DOCX gerado', !!docxPath, docxPath || 'não gerado');

    check('menu EPUB disponível', await clickMenu('Arquivo', 'Exportar como EPUB'));
    const epubPath = await waitFile('.epub');
    check('arquivo EPUB gerado', !!epubPath, epubPath || 'não gerado');

    if (docxPath) {
      const zip = readZip(fs.readFileSync(docxPath));
      const documentEntry = zip.entries.get('word/document.xml');
      const documentXml = documentEntry ? documentEntry.data.toString('utf8') : '';
      const media = zip.order.filter((name) => name.startsWith('word/media/'));
      const documentParse = documentEntry ? await parseXmlInPage(documentXml, 'application/xml') : 'ausente';

      check('DOCX com partes OOXML', zip.order.includes('[Content_Types].xml') &&
        zip.order.includes('word/styles.xml') && !!zip.entries.get('_rels/.rels'));
      check('DOCX com imagens embutidas', media.length >= 2, JSON.stringify(media));
      check('DOCX com estrutura e formatação', documentXml.includes('<w:tbl') &&
        documentXml.includes('<w:hyperlink') && documentXml.includes('<w:drawing') &&
        documentXml.includes('Exportação E2E'));
      check('DOCX XML válido', documentParse === 'ok', documentParse);
    }

    if (epubPath) {
      const zip = readZip(fs.readFileSync(epubPath));
      const chapter = zip.entries.get('OEBPS/chapter.xhtml');
      const chapterXml = chapter ? chapter.data.toString('utf8') : '';
      const mimetype = zip.entries.get('mimetype');
      const chapterParse = chapter ? await parseXmlInPage(chapterXml, 'application/xhtml+xml') : 'ausente';
      const opf = zip.entries.get('OEBPS/content.opf');
      const opfParse = opf ? await parseXmlInPage(opf.data.toString('utf8'), 'application/xml') : 'ausente';

      check('EPUB com mimetype correto', zip.order[0] === 'mimetype' && !!mimetype &&
        mimetype.method === 0 && mimetype.data.toString('utf8') === 'application/epub+zip');
      check('EPUB com capítulo, navegação e CSS', zip.order.includes('OEBPS/nav.xhtml') &&
        zip.order.includes('OEBPS/style.css') && !!chapter);
      check('EPUB com SVG e imagem', chapterXml.includes('<svg') && chapterXml.includes('<img src="images/'));
      check('EPUB XML válido', chapterParse === 'ok' && opfParse === 'ok',
        chapterParse + ' / ' + opfParse);
    }

    console.log('\n[5] Impressão');
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(500);
    const print = await evaluate(`(() => {
      const style = (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).display : 'ausente';
      };
      return {
        editor: style('.pane-editor'),
        sidebar: style('.sidebar'),
        toolbar: style('.toolbar'),
        document: style('.document'),
        diagram: document.querySelectorAll('.mermaid-block svg').length,
        documentWidth: Math.round(document.querySelector('.document').getBoundingClientRect().width)
      };
    })()`);
    await send('Emulation.setEmulatedMedia', { media: '' });
    check('impressão oculta a interface', print.editor === 'none' && print.sidebar === 'none' &&
      print.toolbar === 'none', JSON.stringify(print));
    check('impressão mantém documento e diagrama', print.document === 'block' &&
      print.documentWidth > 300 && print.diagram >= 1, JSON.stringify(print));

    console.log('\n[6] Revisão de alterações externas');

    const reviewContent = [
      '# Documento',
      '',
      'Parágrafo A original.',
      '',
      'Parágrafo B original.',
      '',
      '```mermaid',
      'graph LR',
      '  X[Um] --> Y[Dois]',
      '```',
      ''
    ].join('\n');

    const reviewV2 = reviewContent
      .replace('Parágrafo A original.', 'Parágrafo A novo.')
      .replace('Parágrafo B original.', 'Parágrafo B novo.');

    const writeOpfs = (text, filePath) => evaluate(`(async () => {
      const parts = ${JSON.stringify(filePath || 'artigo.md')}.split('/');
      const name = parts.pop();
      let dir = await navigator.storage.getDirectory();
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(${JSON.stringify(text)});
      await writable.close();
      return true;
    })()`);

    await evaluate(`(() => {
      window.confirm = () => true;
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => navigator.storage.getDirectory()
      });
      return true;
    })()`);
    await writeOpfs(reviewContent);

    await evaluate(`document.querySelector('#toolbar button[data-cmd="openFolder"]').click()`);
    await sleep(900);
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('#sidebar-body .file-row')]
        .find((button) => button.textContent.includes('artigo.md'));
      if (row) row.click();
      return !!row;
    })()`);
    await sleep(900);

    const reviewInitial = await evaluate(`document.querySelector('#editor').value`);
    check('arquivo de revisão aberto', reviewInitial.includes('Parágrafo A original'), reviewInitial.slice(0, 80));

    await writeOpfs(reviewV2);
    await sleep(2800);
    const reviewNotice = await evaluate(`(() => {
      const notice = document.querySelector('#disk-notice');
      return {
        hidden: notice.hidden,
        text: document.querySelector('#disk-notice-text').textContent,
        action: document.querySelector('#disk-notice-reload').textContent
      };
    })()`);
    check('aviso de revisão externa', reviewNotice.hidden === false &&
      reviewNotice.text.includes('mudou no disco') &&
      reviewNotice.action === 'Revisar alterações', JSON.stringify(reviewNotice));

    await evaluate(`document.querySelector('#disk-notice-reload').click()`);
    await sleep(500);
    const reviewModal = await evaluate(`(() => ({
      open: document.querySelector('#modal-review').classList.contains('on'),
      hunks: document.querySelectorAll('.review-hunk').length,
      boxes: document.querySelectorAll('#review-diff input[data-hunk]').length
    }))()`);
    check('modal com diff por trecho', reviewModal.open && reviewModal.hunks === 2 &&
      reviewModal.boxes === 2, JSON.stringify(reviewModal));

    await evaluate(`(() => {
      const boxes = [...document.querySelectorAll('#review-diff input[data-hunk]')];
      if (boxes[1]) {
        boxes[1].checked = false;
        boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()`);
    await evaluate(`document.querySelector('#review-apply').click()`);
    await sleep(600);
    const reviewApplied = await evaluate(`document.querySelector('#editor').value`);
    check('aceitar um trecho e manter o outro', reviewApplied.includes('Parágrafo A novo') &&
      reviewApplied.includes('Parágrafo B original') &&
      !reviewApplied.includes('Parágrafo B novo'), reviewApplied.slice(0, 120));

    const reviewHistory = await evaluate(`(() => {
      try {
        const map = JSON.parse(localStorage.getItem('iluminura.disk.history.v1') || '{}');
        return Object.keys(map).map((key) => map[key].length);
      } catch (e) {
        return [];
      }
    })()`);
    check('histórico externo registrado', reviewHistory.length > 0 &&
      reviewHistory[0] >= 1, JSON.stringify(reviewHistory));

    console.log('\n[7] Fila de revisão do projeto');

    await writeOpfs('# A\n\nTexto A.\n', 'a.md');
    await writeOpfs('Texto C.\n', 'sub/c.txt');

    await evaluate(`document.querySelector('.sidebar-tabs button[data-tab="reviews"]').click()`);
    await sleep(300);

    const projectQueue = await waitFor(() => evaluate(`(() => {
      const badge = document.querySelector('#review-count');
      const items = [...document.querySelectorAll('.project-change')].map((button) => button.dataset.path);
      return items.length === 2 ? {
        badgeHidden: badge ? badge.hidden : null,
        badgeText: badge ? badge.textContent : null,
        items: items
      } : null;
    })()`), 15000);

    check('fila reúne os arquivos alterados', !!projectQueue &&
      projectQueue.badgeHidden === false && projectQueue.badgeText === '2' &&
      projectQueue.items.includes('a.md') && projectQueue.items.includes('sub/c.txt'),
      JSON.stringify(projectQueue));

    await evaluate(`document.querySelector('.project-change[data-path="a.md"]').click()`);
    await sleep(700);
    const projectReview = await evaluate(`(() => ({
      open: document.querySelector('#modal-review').classList.contains('on'),
      editor: document.querySelector('#editor').value,
      hunks: document.querySelectorAll('.review-hunk').length
    }))()`);
    check('fila abre o arquivo e o diff', projectReview.open && projectReview.editor === '' &&
      projectReview.hunks === 1, JSON.stringify(projectReview));

    await evaluate(`document.querySelector('#review-apply').click()`);
    await sleep(700);
    const projectAfter = await evaluate(`(() => {
      const badge = document.querySelector('#review-count');
      return {
        badgeHidden: badge.hidden,
        badgeText: badge.textContent,
        items: [...document.querySelectorAll('.project-change')].map((button) => button.dataset.path),
        editor: document.querySelector('#editor').value
      };
    })()`);
    check('aplicar resolve o item da fila', projectAfter.badgeHidden === false &&
      projectAfter.badgeText === '1' && projectAfter.items.includes('sub/c.txt') &&
      !projectAfter.items.includes('a.md') && projectAfter.editor.includes('Texto A.'),
      JSON.stringify(projectAfter));

    await evaluate(`document.querySelector('.sidebar-tabs button[data-tab="files"]').click()`);
    await sleep(200);
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('#sidebar-body .file-row')]
        .find((button) => button.textContent.includes('artigo.md'));
      if (row) row.click();
      return !!row;
    })()`);
    await sleep(1000);
    await evaluate(`(() => {
      const editor = document.querySelector('#editor');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(1000);

    console.log('\n[8] PWA offline');
    await evaluate(`navigator.serviceWorker.ready`);
    await send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    await sleep(300);
    await send('Page.reload');
    await sleep(2500);
    const offline = await evaluate(`(() => ({
      title: document.title,
      brand: document.querySelector('.brand') ? document.querySelector('.brand').textContent.trim() : null,
      app: !!document.querySelector('#app'),
      editor: !!document.querySelector('#editor')
    }))()`);

    const offlineDiagram = await waitFor(() => evaluate(`(() => {
      const block = document.querySelector('.mermaid-block');
      return !!block && block.dataset.mermaidState === 'ready' && !!block.querySelector('svg');
    })()`), 12000);

    check('aplicação abre offline', offline.app && offline.editor &&
      offline.brand === 'Iluminura' && offline.title.endsWith('Iluminura'), JSON.stringify(offline));
    check('Mermaid disponível offline', offlineDiagram === true, String(offlineDiagram));

    await send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });

    check('sem exceções JavaScript', exceptions.length === 0, exceptions.join(' | '));

    const failures = results.filter((item) => !item.ok);
    console.log('\n' + (results.length - failures.length) + ' de ' + results.length + ' verificações passaram.');
    if (failures.length) {
      console.log('Falhas: ' + failures.map((item) => item.name).join(', '));
      process.exitCode = 1;
    } else {
      console.log('E2E OK');
    }
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    if (chrome) {
      if (process.platform === 'win32') {
        try {
          const killer = spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
          killer.on('error', () => {});
        } catch (e) { /* ignora */ }
      } else {
        try { chrome.kill('SIGTERM'); } catch (e) { /* ignora */ }
      }
    }
    try { server.kill(); } catch (e) { /* ignora */ }
    await sleep(700);
    for (let i = 0; i < 3; i++) {
      try {
        fs.rmSync(PROFILE, { recursive: true, force: true });
        break;
      } catch (e) {
        await sleep(400);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
