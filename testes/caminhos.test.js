/*
 * Testes da resolução de caminhos relativos.
 * Execute com: node testes/caminhos.test.js
 */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'assets', 'caminhos.js'));
const C = globalThis.LeitorCaminhos;

const casos = {
  'imagem na mesma pasta': C.resolve('artigo.md', 'full_scan.png') === 'full_scan.png',
  'documento em subpasta': C.resolve('docs/artigo.md', 'img/foto.png') === 'docs/img/foto.png',
  'retroceder uma pasta': C.resolve('docs/artigo.md', '../assets/foto.png') === 'assets/foto.png',
  'ponto explícito': C.resolve('docs/artigo.md', './foto.png') === 'docs/foto.png',
  'barra invertida': C.resolve('docs\\artigo.md', '..\\assets\\foto.png') === 'assets/foto.png',
  'codificação percentual': C.resolve('docs/artigo.md', 'minha%20foto.png') === 'docs/minha foto.png',
  'consulta e âncora removidas': C.resolve('artigo.md', 'foto.png?v=2#topo') === 'foto.png',
  'fora da raiz bloqueado': C.resolve('artigo.md', '../fora.png') === null,
  'http não é relativo': C.isRelative('https://exemplo.com/foto.png') === false,
  'data URL não é relativa': C.isRelative('data:image/png;base64,abc') === false,
  'blob URL não é relativa': C.isRelative('blob:http://localhost/abc') === false,
  'raiz absoluta não é relativa': C.isRelative('/imagens/foto.png') === false,
  'caminho vazio não é relativo': C.isRelative('') === false,
  'dirname': C.dirname('a/b/c.md') === 'a/b',
  'basename': C.basename('a/b/c.md') === 'c.md'
};

let falhas = 0;
for (const [nome, ok] of Object.entries(casos)) {
  if (!ok) { console.log('FALHOU  ' + nome); falhas++; }
}

console.log(falhas === 0
  ? `\nOK — ${Object.keys(casos).length} verificações passaram`
  : `\n${falhas} de ${Object.keys(casos).length} falharam`);

process.exit(falhas ? 1 : 0);
