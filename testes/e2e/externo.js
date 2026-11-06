'use strict';

/*
 * Iluminura: teste de alterações externas durante o uso.
 * Requer o servidor local em execução (http://127.0.0.1:8731/).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_URL = process.env.ILUMINURA_URL || 'http://127.0.0.1:8731/';
const PORT = 9364;
const PROFILE = path.join(os.tmpdir(), 'iluminura_cdp_externo_' + Date.now());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (e) { return false; }
  });
}

async function evaluateWith(send, expression) {
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
}

async function waitFor(fn, timeout) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await fn()) return true;
    await sleep(250);
  }

  return false;
}

async function main() {
  const chromePath = findChrome();

  if (!chromePath) {
    console.error('Chrome não encontrado. Defina CHROME_PATH.');
    process.exit(2);
  }

  try {
    const response = await fetch(APP_URL, { signal: AbortSignal.timeout(4000) });
    if (response.status !== 200) throw new Error('HTTP ' + response.status);
  } catch (e) {
    console.error('Servidor local indisponível em ' + APP_URL + '. Inicie com iniciar.bat.');
    process.exit(2);
  }

  fs.mkdirSync(PROFILE, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + PROFILE,
    '--remote-debugging-port=' + PORT,
    '--window-size=1440,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  let ws;

  try {
    let target;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        target = list.find((item) => item.type === 'page');
        if (target) break;
      } catch (e) { /* aguarda o navegador */ }
      await sleep(200);
    }

    if (!target) throw new Error('Não foi possível conectar ao Chrome.');

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
        const job = pending.get(message.id);
        pending.delete(message.id);

        if (message.error) job.reject(new Error(JSON.stringify(message.error)));
        else job.resolve(message.result);
      }
    };

    const send = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });

    const evaluate = (expression) => evaluateWith(send, expression);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: APP_URL });
    await sleep(2400);

    const initial = await evaluate(`(() => {
      return {
        status: document.querySelector('#disk-status').textContent.trim(),
        noticeHidden: document.querySelector('#disk-notice').hidden
      };
    })()`);

    await evaluate(`(async () => {
      const root = await navigator.storage.getDirectory();

      const write = async (name, text) => {
        const handle = await root.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
      };

      await write('externo.md', '# Externo\\n\\nVersao inicial.\\n');
      await write('corrida.md', '# Corrida\\n\\nVersao local.\\n');

      window.__writeOpfs = async (name, text) => {
        const handle = await root.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
      };

      window.__handleOf = async (name) => root.getFileHandle(name);

      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => root
      });

      window.confirm = () => true;
      return true;
    })()`);

    await evaluate(`(async () => {
      const handle = await window.__handleOf('externo.md');
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [handle]
      });
      return true;
    })()`);

    await evaluate(`document.querySelector('#toolbar button[data-cmd="open"]').click()`);
    await sleep(900);

    const opened = await evaluate(`(() => {
      return {
        status: document.querySelector('#disk-status').textContent.trim(),
        isOn: document.querySelector('#disk-status').classList.contains('on'),
        title: document.querySelector('#disk-status').title
      };
    })()`);

    await evaluate(`window.__writeOpfs('externo.md', '# Externo\\n\\nVersao do agente.\\n')`);

    const noticed = await waitFor(async () => {
      return evaluate(`!document.querySelector('#disk-notice').hidden`);
    }, 9000);

    const notice = await evaluate(`(() => {
      return {
        hidden: document.querySelector('#disk-notice').hidden,
        text: document.querySelector('#disk-notice-text').textContent.trim(),
        editor: document.querySelector('#editor').value
      };
    })()`);

    await evaluate(`document.querySelector('#disk-notice-reload').click()`);
    await sleep(500);

    const review = await evaluate(`(() => {
      return {
        open: document.querySelector('#modal-review').classList.contains('on'),
        summary: document.querySelector('#review-summary').textContent.trim(),
        diff: document.querySelector('#review-diff').textContent.replace(/\\s+/g, ' ').trim()
      };
    })()`);

    await evaluate(`document.querySelector('#modal-review [data-close="modal-review"]').click()`);
    await sleep(300);

    await evaluate(`(async () => {
      const handle = await window.__handleOf('corrida.md');
      window.__corridaHandle = handle;
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [handle]
      });
      return true;
    })()`);

    await evaluate(`document.querySelector('#toolbar button[data-cmd="open"]').click()`);
    await sleep(900);

    await evaluate(`(async () => {
      const handle = window.__corridaHandle;
      const original = handle.createWritable.bind(handle);

      Object.defineProperty(handle, 'createWritable', {
        configurable: true,
        value: async function () {
          const writable = await original();
          const close = writable.close.bind(writable);

          writable.close = async function () {
            await close();
            await window.__writeOpfs('corrida.md', '# Corrida\\n\\nVersao gravada pelo agente.\\n');
            window.__raceDone = true;
          };

          return writable;
        }
      });

      return true;
    })()`);

    await evaluate(`document.querySelector('#toolbar button[data-cmd="save"]').click()`);

    const raced = await waitFor(async () => {
      return evaluate(`window.__raceDone === true || !document.querySelector('#disk-notice').hidden`);
    }, 9000);

    await sleep(700);

    const race = await evaluate(`(() => {
      return {
        done: window.__raceDone === true,
        noticeHidden: document.querySelector('#disk-notice').hidden,
        noticeText: document.querySelector('#disk-notice-text').textContent.trim(),
        editor: document.querySelector('#editor').value,
        status: document.querySelector('#disk-status').textContent.trim()
      };
    })()`);

    const result = { initial, opened, noticed, notice, review, raced, race, exceptions };
    console.log(JSON.stringify(result, null, 2));

    const ok =
      initial.status === 'sem vínculo' && initial.noticeHidden &&
      opened.status === 'vínculo: arquivo' && opened.isOn &&
      noticed &&
      notice.text.includes('mudou no disco') &&
      notice.editor.includes('Versao inicial') &&
      review.open && review.diff.includes('agente') &&
      raced &&
      race.done &&
      !race.noticeHidden &&
      race.noticeText.includes('mudou no disco') &&
      race.editor.includes('Versao local') &&
      race.status === 'vínculo: arquivo' &&
      exceptions.length === 0;

    console.log(ok ? '\nEXTERNO OK' : '\nEXTERNO FALHOU');
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ws) try { ws.close(); } catch (e) { /* ignora */ }
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignora */ }
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignora */ }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
