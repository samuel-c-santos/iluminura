'use strict';

/*
 * Iluminura: ciclo de vida do servidor local.
 * Inicia em uma porta isolada, valida o controle de encerramento e confere
 * que um PID estranho no arquivo de estado nao e encerrado.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 80);
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iluminura_estado_'));
const PID_FILE = path.join(STATE_DIR, '.iluminura.pid');
const TOKEN_FILE = path.join(STATE_DIR, '.iluminura.token');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const baseEnv = Object.assign({}, process.env, {
  ILUMINURA_NO_OPEN: '1',
  ILUMINURA_HIDDEN: '1',
  ILUMINURA_STATE_DIR: STATE_DIR
});

function request(method, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method,
      headers: headers || {},
      timeout: 2500
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function waitUntilReady(timeout) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    try {
      const res = await request('GET', '/');
      if (res.status === 200 && res.body.includes('Iluminura')) return true;
    } catch (e) { /* servidor ainda iniciando */ }
    await sleep(150);
  }

  return false;
}

async function waitUntilOffline(timeout) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    try {
      await request('GET', '/');
    } catch (e) {
      return true;
    }
    await sleep(150);
  }

  return false;
}

function runStopper() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'encerrar.js'), String(PORT)], {
      cwd: ROOT,
      env: baseEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function main() {
  const checks = [];

  function check(name, ok, detail) {
    checks.push({ name, ok, detail: detail === undefined ? '' : String(detail) });
  }

  let server = null;

  try {
    server = spawn(process.execPath, [path.join(ROOT, 'servidor.js'), String(PORT)], {
      cwd: ROOT,
      env: baseEnv,
      stdio: 'ignore'
    });

    const ready = await waitUntilReady(10000);
    check('servidor inicia e responde', ready);
    if (!ready) throw new Error('servidor nao iniciou');

    const pid = fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8').trim() : '';
    check('arquivo de PID registrado', pid === String(server.pid), pid);
    const token = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
    check('token de encerramento registrado', /^[a-f0-9]{48}$/.test(token), token.length);

    const index = await request('GET', '/');
    check('pagina principal servida', index.status === 200 && index.body.includes('Iluminura'), index.status);

    const status = await request('GET', '/__iluminura/status');
    let statusData = {};
    try { statusData = JSON.parse(status.body); } catch (e) { /* resposta invalida */ }
    check('status identifica o servidor', status.status === 200 && statusData.app === 'iluminura' && statusData.stoppable === true, status.status);

    const tokenNoHeader = await request('GET', '/__iluminura/stop-token');
    check('token exige cabecalho do aplicativo', tokenNoHeader.status === 403, tokenNoHeader.status);

    const tokenWrongOrigin = await request('GET', '/__iluminura/stop-token', {
      'X-Iluminura-Client': 'app',
      'Origin': 'http://malicioso.test'
    });
    check('token recusa origem externa', tokenWrongOrigin.status === 403, tokenWrongOrigin.status);

    const tokenWrongHost = await request('GET', '/__iluminura/stop-token', {
      'X-Iluminura-Client': 'app',
      'Host': 'malicioso.test'
    });
    check('token recusa host externo', tokenWrongHost.status === 403, tokenWrongHost.status);

    const tokenResponse = await request('GET', '/__iluminura/stop-token', {
      'X-Iluminura-Client': 'app'
    });
    let tokenData = {};
    try { tokenData = JSON.parse(tokenResponse.body); } catch (e) { /* resposta invalida */ }
    check('token disponivel para a interface', tokenResponse.status === 200 && tokenData.token === token, tokenResponse.status);

    const getStop = await request('GET', '/__iluminura/stop');
    check('GET na rota de parada recusado', getStop.status === 405, getStop.status);

    const wrong = await request('POST', '/__iluminura/stop', { 'X-Iluminura-Stop': 'errado' });
    check('token invalido recusado', wrong.status === 403, wrong.status);

    const dotfile = await request('GET', '/.iluminura.token');
    check('arquivo de controle nao e servido', dotfile.status === 404, dotfile.status);

    const stopped = await runStopper();
    check('encerrar.js encerra o servidor', stopped.code === 0 && stopped.output.includes('encerrado'), stopped.code);

    const offline = await waitUntilOffline(8000);
    check('servidor fica offline', offline);
    check('arquivos de controle removidos', !fs.existsSync(PID_FILE) && !fs.existsSync(TOKEN_FILE));

    fs.writeFileSync(PID_FILE, String(process.pid) + '\n');
    const stale = await runStopper();
    check('PID estranho nao e encerrado', stale.code === 1 && stale.output.includes('nao esta em execucao'), stale.code);
    check('processo do teste continua ativo', true);

    server = null;
  } catch (error) {
    check('execucao sem excecoes', false, error.message);
  } finally {
    if (server) {
      try { server.kill(); } catch (e) { /* ignora */ }
    }
    try { fs.rmSync(STATE_DIR, { recursive: true, force: true }); } catch (e) { /* ignora */ }
  }

  for (const item of checks) {
    console.log((item.ok ? '  ok   ' : '  FAIL ') + item.name + (item.detail ? ' -> ' + item.detail : ''));
  }

  const failures = checks.filter((item) => !item.ok);
  console.log('');
  console.log(checks.length - failures.length + ' de ' + checks.length + ' verificações passaram.');

  if (failures.length) {
    console.log('Falhas: ' + failures.map((item) => item.name).join(', '));
    process.exitCode = 1;
  } else {
    console.log('SERVIDOR OK');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
