'use strict';

/*
 * Iluminura: encerramento do servidor pela interface.
 * Inicia um servidor isolado, abre o aplicativo no Chrome e confirma o fluxo
 * Ajuda > Encerrar servidor, incluindo o aviso de alterações não salvas.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8940 + Math.floor(Math.random() * 40);
const CDP_PORT = 9365 + Math.floor(Math.random() * 20);
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iluminura_ui_'));
const PROFILE = path.join(os.tmpdir(), 'iluminura_cdp_stop_' + Date.now());
const APP_URL = 'http://127.0.0.1:' + PORT + '/';
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

function httpStatus() {
  return new Promise((resolve) => {
    const request = http.get(APP_URL, { timeout: 2000 }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('timeout', () => { request.destroy(); resolve(0); });
    request.on('error', () => resolve(0));
  });
}

async function waitForServer(timeout) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await httpStatus() === 200) return true;
    await sleep(150);
  }

  return false;
}

async function waitForOffline(timeout) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await httpStatus() === 0) return true;
    await sleep(150);
  }

  return false;
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

async function waitForValue(send, expression, timeout) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await evaluateWith(send, expression)) return true;
    await sleep(200);
  }

  return false;
}

async function main() {
  const chromePath = findChrome();

  if (!chromePath) {
    console.error('Chrome não encontrado. Defina CHROME_PATH.');
    process.exit(2);
  }

  fs.mkdirSync(PROFILE, { recursive: true });

  const env = Object.assign({}, process.env, {
    ILUMINURA_NO_OPEN: '1',
    ILUMINURA_HIDDEN: '1',
    ILUMINURA_STATE_DIR: STATE_DIR
  });

  const server = spawn(process.execPath, [path.join(ROOT, 'servidor.js'), String(PORT)], {
    cwd: ROOT,
    env,
    stdio: 'ignore'
  });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + PROFILE,
    '--remote-debugging-port=' + CDP_PORT,
    '--window-size=1440,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  let ws;

  try {
    if (!await waitForServer(10000)) {
      throw new Error('O servidor isolado não iniciou na porta ' + PORT + '.');
    }

    let target;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
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
    const openHelp = `(() => {
      const button = [...document.querySelectorAll('#menus .menu > button')]
        .find((item) => item.textContent.trim() === 'Ajuda');
      if (!button) return null;
      button.click();
      const item = [...document.querySelectorAll('.menu.open .menu-item')]
        .find((entry) => entry.querySelector('.label') &&
          entry.querySelector('.label').textContent.includes('Encerrar servidor'));
      return item ? { disabled: item.disabled } : null;
    })()`;

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: APP_URL });
    await sleep(2400);

    await waitForValue(send, `(async () => {
      try {
        const response = await fetch('/__iluminura/status', { cache: 'no-store' });
        return response.ok;
      } catch (e) {
        return false;
      }
    })()`, 5000);
    await sleep(300);

    const firstMenu = await evaluate(openHelp);
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('.menu.open .menu-item')]
        .find((entry) => entry.querySelector('.label') &&
          entry.querySelector('.label').textContent.includes('Encerrar servidor'));
      if (item) item.click();
      return true;
    })()`);
    await sleep(300);

    const firstModal = await evaluate(`(() => ({
      open: document.querySelector('#modal-stop-server').classList.contains('on'),
      warningHidden: document.querySelector('#stop-server-warning').hidden
    }))()`);

    await evaluate(`document.querySelector('#modal-stop-server [data-close="modal-stop-server"]').click()`);
    await sleep(200);

    await evaluate(`(() => {
      const editor = document.querySelector('#editor');
      editor.value += '\\n\\nAlteração não salva.\\n';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);

    const dirtyMenu = await evaluate(openHelp);
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('.menu.open .menu-item')]
        .find((entry) => entry.querySelector('.label') &&
          entry.querySelector('.label').textContent.includes('Encerrar servidor'));
      if (item) item.click();
      return true;
    })()`);
    await sleep(300);

    const dirtyModal = await evaluate(`(() => ({
      open: document.querySelector('#modal-stop-server').classList.contains('on'),
      warningHidden: document.querySelector('#stop-server-warning').hidden
    }))()`);

    await evaluate(`document.querySelector('#stop-server-confirm').click()`);

    const stoppedModal = await waitForValue(send,
      `document.querySelector('#modal-server-stopped').classList.contains('on')`, 8000);
    const stoppedState = await evaluate(`(() => ({
      panelOpen: document.querySelector('#modal-server-stopped').classList.contains('on'),
      confirmDisabled: document.querySelector('#stop-server-confirm').disabled,
      confirmText: document.querySelector('#stop-server-confirm').textContent.trim()
    }))()`);

    const offline = await waitForOffline(8000);

    await evaluate(`document.querySelector('#modal-server-stopped [data-close="modal-server-stopped"]').click()`);
    await sleep(200);
    const afterMenu = await evaluate(openHelp);

    const result = {
      firstMenu,
      firstModal,
      dirtyMenu,
      dirtyModal,
      stoppedModal,
      stoppedState,
      offline,
      afterMenu,
      exceptions
    };

    console.log(JSON.stringify(result, null, 2));

    const ok =
      firstMenu && firstMenu.disabled === false &&
      firstModal.open && firstModal.warningHidden &&
      dirtyMenu && dirtyMenu.disabled === false &&
      dirtyModal.open && !dirtyModal.warningHidden &&
      stoppedModal &&
      stoppedState.panelOpen && stoppedState.confirmDisabled &&
      offline &&
      afterMenu && afterMenu.disabled === true &&
      exceptions.length === 0;

    console.log(ok ? '\nSERVIDOR UI OK' : '\nSERVIDOR UI FALHOU');
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ws) try { ws.close(); } catch (e) { /* ignora */ }
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignora */ }
    try { server.kill(); } catch (e) { /* ignora */ }
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignora */ }
    try { fs.rmSync(STATE_DIR, { recursive: true, force: true }); } catch (e) { /* ignora */ }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
