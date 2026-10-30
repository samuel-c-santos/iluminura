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
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8731);

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

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('Requisição inválida');
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  const target = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''));

  // impede sair da pasta do projeto
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Acesso negado');
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
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} já está em uso. Tente: node servidor.js ${PORT + 1}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log('\n  Iluminura');
  console.log('  ─────────────────────────────');
  console.log('  Aberto em: ' + url);
  console.log('  (Ctrl+C encerra o servidor)\n');

  const opener = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;

  if (process.env.ILUMINURA_NO_OPEN === '1') return;
  exec(opener, () => {});
});
