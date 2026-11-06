#!/usr/bin/env node
/*
 * Iluminura: servidor estático mínimo (sem dependências)
 * Uso: node servidor.js [porta]
 * Necessário apenas para recursos que exigem contexto seguro
 * (abrir/salvar arquivos e pastas via File System Access API).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8731);
const HIDDEN = process.env.ILUMINURA_HIDDEN === '1';
const STATE_DIR = process.env.ILUMINURA_STATE_DIR || ROOT;

const PID_FILE = path.join(STATE_DIR, '.iluminura.pid');
const TOKEN_FILE = path.join(STATE_DIR, '.iluminura.token');
const LOG_FILE = path.join(STATE_DIR, '.iluminura.log');
const STOP_TOKEN = crypto.randomBytes(24).toString('hex');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

let shuttingDown = false;

function log(message) {
  if (!HIDDEN) {
    console.log(message);
    return;
  }

  try {
    fs.appendFileSync(LOG_FILE, message + '\n');
  } catch (e) { /* log indisponível */ }
}

function logError(message) {
  if (!HIDDEN) {
    console.error(message);
    return;
  }

  try {
    fs.appendFileSync(LOG_FILE, message + '\n');
  } catch (e) { /* log indisponível */ }
}

function psString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function notifyFailure(message) {
  logError(message);
  if (!HIDDEN) return;

  const script = 'Add-Type -AssemblyName PresentationFramework; ' +
    '[System.Windows.MessageBox]::Show(' + psString(message) + ', ' + psString('Iluminura') + ') | Out-Null';

  try {
    spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  } catch (e) { /* aviso visual indisponível */ }
}

function sameToken(value) {
  if (typeof value !== 'string') return false;
  const received = Buffer.from(value);
  const expected = Buffer.from(STOP_TOKEN);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function removeRuntimeFile(file, expected) {
  try {
    if (expected !== undefined) {
      const current = fs.readFileSync(file, 'utf8').trim();
      if (current !== expected) return;
    }
    fs.unlinkSync(file);
  } catch (e) { /* arquivo já removido */ }
}

function removeRuntimeFiles() {
  removeRuntimeFile(PID_FILE, String(process.pid));
  removeRuntimeFile(TOKEN_FILE, STOP_TOKEN);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  removeRuntimeFiles();

  try {
    server.close(function () { process.exit(typeof code === 'number' ? code : 0); });
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  } catch (e) {
    process.exit(typeof code === 'number' ? code : 0);
  }

  setTimeout(function () {
    process.exit(typeof code === 'number' ? code : 0);
  }, 1500).unref();
}

function isInsideRoot(target) {
  return target === ROOT || target.startsWith(ROOT + path.sep);
}

function hasHiddenSegment(relativePath) {
  return relativePath.split(/[\\/]/).some(function (part) {
    return part.startsWith('.');
  });
}

function serveStatic(pathname, res) {
  const relativePath = path.normalize(pathname).replace(/^([/\\])+/, '');
  const target = path.join(ROOT, relativePath);

  if (!isInsideRoot(target)) {
    res.writeHead(403).end('Acesso negado');
    return;
  }

  if (hasHiddenSegment(relativePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Arquivo não encontrado: ' + pathname);
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado: ' + pathname);
      return;
    }

    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('Requisição inválida');
    return;
  }

  if (pathname === '/__iluminura/stop') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'POST' });
      res.end('Método não permitido');
      return;
    }

    if (!sameToken(req.headers['x-iluminura-stop'])) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acesso negado');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end('{"ok":true}');
    setTimeout(function () { shutdown(0); }, 150);
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  serveStatic(pathname, res);
});

function openBrowser(url) {
  if (process.env.ILUMINURA_NO_OPEN === '1') return;

  const opener = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;

  exec(opener, (err) => {
    if (err) logError('Não foi possível abrir o navegador. Acesse: ' + url);
  });
}

function isIluminura(url, callback) {
  let done = false;

  function finish(value) {
    if (done) return;
    done = true;
    callback(value);
  }

  const request = http.get(url, { timeout: 1800 }, (response) => {
    let body = '';
    response.setEncoding('utf8');

    response.on('data', (chunk) => {
      body += chunk;

      if (body.length > 8192) {
        finish(response.statusCode === 200 && body.includes('Iluminura'));
        request.destroy();
      }
    });

    response.on('end', () => {
      finish(response.statusCode === 200 && body.includes('Iluminura'));
    });
  });

  request.on('timeout', () => {
    request.destroy();
    finish(false);
  });
  request.on('error', () => finish(false));
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${PORT}/`;

    isIluminura(url, (running) => {
      if (running) {
        log('\n  Iluminura já está em execução.');
        log('  Aberto em: ' + url);
        log('  Abrindo o navegador...\n');
        openBrowser(url);
        setTimeout(() => process.exit(0), 600);
        return;
      }

      notifyFailure(`A porta ${PORT} está em uso por outro programa.\n\n` +
        `Encerre o outro programa ou use: node servidor.js ${PORT + 1}`);
      process.exit(1);
    });
  } else {
    notifyFailure(err.message || String(err));
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;

  try {
    fs.writeFileSync(PID_FILE, String(process.pid) + '\n', { mode: 0o600 });
    fs.writeFileSync(TOKEN_FILE, STOP_TOKEN + '\n', { mode: 0o600 });
  } catch (e) {
    logError('Não foi possível registrar o controle do servidor: ' + e.message);
  }

  log('\n  Iluminura');
  log('  ─────────────────────────────');
  log('  Aberto em: ' + url);
  log('  Para encerrar: parar.bat ou Encerrar Iluminura no Menu Iniciar\n');

  openBrowser(url);
});

if (HIDDEN) {
  try { fs.writeFileSync(LOG_FILE, ''); } catch (e) { /* log indisponível */ }
}

process.on('exit', removeRuntimeFiles);
process.on('SIGINT', function () { shutdown(0); });
process.on('SIGTERM', function () { shutdown(0); });
