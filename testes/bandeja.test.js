'use strict';

/*
 * Iluminura: autoteste da bandeja do sistema.
 * Executa o script PowerShell em uma porta isolada para validar o ciclo
 * de inicio, status, criacao do icone e encerramento do servidor.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform !== 'win32') {
  console.log('BANDEJA IGNORADO: teste exclusivo do Windows.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PORT = 8970 + Math.floor(Math.random() * 20);
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iluminura_bandeja_'));

const result = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', path.join(ROOT, 'bandeja.ps1'),
  '-SelfTest',
  '-Port', String(PORT),
  '-StateDir', STATE_DIR
], {
  encoding: 'utf8',
  timeout: 120000,
  windowsHide: true
});

const output = String(result.stdout || '') + String(result.stderr || '');

if (output.trim()) console.log(output.trim());
if (result.error) console.error(result.error.message);

spawnSync(process.execPath, [path.join(ROOT, 'encerrar.js'), String(PORT)], {
  env: Object.assign({}, process.env, { ILUMINURA_STATE_DIR: STATE_DIR }),
  windowsHide: true,
  timeout: 15000
});

try { fs.rmSync(STATE_DIR, { recursive: true, force: true }); } catch (e) { /* ignora */ }

if (result.status !== 0 || !output.includes('BANDEJA OK')) {
  console.error('BANDEJA FALHOU');
  process.exit(1);
}
