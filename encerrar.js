#!/usr/bin/env node
/*
 * Iluminura: encerra o servidor local iniciado por iniciar.vbs.
 * Usa o token gravado em .iluminura.token e, se necessário, encerra o PID
 * registrado em .iluminura.pid após conferir que ele pertence ao servidor.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8731);
const STATE_DIR = process.env.ILUMINURA_STATE_DIR || ROOT;
const PID_FILE = path.join(STATE_DIR, '.iluminura.pid');
const TOKEN_FILE = path.join(STATE_DIR, '.iluminura.token');

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* já removido */ }
  try { fs.unlinkSync(TOKEN_FILE); } catch (e) { /* já removido */ }
}

function requestStop(token) {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: '/__iluminura/stop',
      method: 'POST',
      headers: { 'X-Iluminura-Stop': token },
      timeout: 1800
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode === 200));
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
    request.end();
  });
}

function processCommandLine(pid) {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });

    return String(output || '').trim();
  } catch (e) {
    return '';
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function findServerPid(port) {
  if (process.platform !== 'win32') return 0;

  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | ' +
        'Select-Object -First 1).OwningProcess'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });

    const pid = Number(String(output || '').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch (e) {
    return 0;
  }
}

async function main() {
  const token = read(TOKEN_FILE);
  const filePid = Number(read(PID_FILE));

  if (token && await requestStop(token)) {
    cleanup();
    console.log('Iluminura encerrado.');
    return 0;
  }

  const candidates = [];

  if (Number.isInteger(filePid) && filePid > 0) {
    candidates.push(filePid);
  }

  const listeningPid = findServerPid(PORT);

  if (listeningPid && !candidates.includes(listeningPid)) {
    candidates.push(listeningPid);
  }

  let unknown = 0;

  for (const candidate of candidates) {
    const command = processCommandLine(candidate).toLowerCase();

    if (command.includes('servidor.js') && command.includes('node')) {
      try {
        process.kill(candidate);
        cleanup();
        console.log('Iluminura encerrado (processo ' + candidate + ').');
        return 0;
      } catch (e) { /* processo já encerrado */ }
    }

    if (!command && isAlive(candidate)) {
      unknown = candidate;
    }
  }

  if (unknown) {
    console.log('O Iluminura parece estar em execucao, mas nao respondeu ao encerramento.');
    console.log('Feche a janela do servidor ou encerre o processo ' + unknown + ' manualmente.');
    return 2;
  }

  cleanup();
  console.log('O Iluminura nao esta em execucao.');
  return 1;
}

main().then(function (code) {
  process.exitCode = code;
}).catch(function () {
  process.exitCode = 1;
});
