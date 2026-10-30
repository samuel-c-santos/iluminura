/*
 * leitor_md — resolução de caminhos relativos
 * JavaScript puro, sem dependências. Licença MIT.
 *
 * Este módulo isola a lógica de caminhos usada para localizar imagens
 * relativas dentro de uma pasta aberta pela File System Access API.
 */
(function (root) {
  'use strict';

  function isRelative(src) {
    var s = String(src == null ? '' : src).trim();
    if (!s) return false;
    // Esquemas como http:, data:, blob: e file: não são caminhos relativos.
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return false;
    // Caminhos absolutos (raiz do servidor ou do disco) ficam a cargo do navegador.
    if (s.charAt(0) === '/' || s.charAt(0) === '\\') return false;
    return true;
  }

  function normalize(path) {
    var out = [];
    var parts = String(path == null ? '' : path).replace(/\\/g, '/').split('/');
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (!out.length) return null; // tentou escapar da raiz
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return out.join('/');
  }

  function dirname(path) {
    var p = String(path == null ? '' : path).replace(/\\/g, '/');
    var i = p.lastIndexOf('/');
    return i === -1 ? '' : p.slice(0, i);
  }

  function basename(path) {
    var p = String(path == null ? '' : path).replace(/\\/g, '/');
    return p.slice(p.lastIndexOf('/') + 1);
  }

  function resolve(baseFilePath, src) {
    if (!isRelative(src)) return null;

    var clean = String(src).trim().split('#')[0].split('?')[0];
    try {
      clean = decodeURIComponent(clean);
    } catch (e) { /* mantém o texto original se a codificação for inválida */ }

    var base = dirname(baseFilePath);
    return normalize((base ? base + '/' : '') + clean);
  }

  root.LeitorCaminhos = {
    isRelative: isRelative,
    normalize: normalize,
    dirname: dirname,
    basename: basename,
    resolve: resolve
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
