/*
 * Testes do diff de linhas: node testes/diff.test.js
 */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'assets', 'diff.js'));
const Diff = globalThis.IluminuraDiff;

function acceptedAll(list) {
  return list.map(() => true);
}

function acceptedNone(list) {
  return list.map(() => false);
}

const cases = {};

const base = '# Título\n\nPrimeiro parágrafo.\n\nSegundo parágrafo.\n';
const remote = '# Título\n\nPrimeiro parágrafo alterado.\n\nSegundo parágrafo.\n';

const multipleBase = '# Título\n\nA original.\n\nB original.\n';
const multipleRemote = '# Título\n\nA novo.\n\nB novo.\n';

const change = Diff.hunks(base, remote);
const multiple = Diff.hunks(multipleBase, multipleRemote);

cases['sem alterações'] = Diff.hunks(base, base).length === 0;
cases['alteração única'] = change.length === 1;
cases['aceitar tudo reproduz o disco'] = Diff.merge(base, change, acceptedAll(change)) === remote;
cases['rejeitar tudo mantém a base'] = Diff.merge(base, change, acceptedNone(change)) === base;
cases['duas alterações separadas'] = multiple.length === 2;
cases['aceitar parcial'] = (() => {
  const onlyFirst = [true, false];
  const merged = Diff.merge(multipleBase, multiple, onlyFirst);
  return merged.includes('A novo.') && merged.includes('B original.') && !merged.includes('B novo.');
})();
cases['aceitar todas as separadas'] = Diff.merge(multipleBase, multiple, acceptedAll(multiple)) === multipleRemote;
cases['rejeitar todas as separadas'] = Diff.merge(multipleBase, multiple, acceptedNone(multiple)) === multipleBase;

cases['adição no início'] = (() => {
  const before = 'linha um\nlinha dois\n';
  const after = 'nova linha\nlinha um\nlinha dois\n';
  const list = Diff.hunks(before, after);
  return list.length === 1 && Diff.merge(before, list, [true]) === after;
})();

cases['remoção no fim'] = (() => {
  const before = 'linha um\nlinha dois\nlinha três\n';
  const after = 'linha um\nlinha dois\n';
  const list = Diff.hunks(before, after);
  return list.length === 1 && Diff.merge(before, list, [true]) === after;
})();

cases['arquivo vazio para conteúdo'] = (() => {
  const list = Diff.hunks('', 'novo\n');
  return list.length === 1 && Diff.merge('', list, [true]) === 'novo\n';
})();

cases['conteúdo para arquivo vazio'] = (() => {
  const list = Diff.hunks('antigo\n', '');
  return list.length === 1 && Diff.merge('antigo\n', list, [true]) === '';
})();

cases['documento longo com uma alteração'] = (() => {
  const before = Array.from({ length: 1200 }, (_, index) => 'linha ' + index).join('\n') + '\n';
  const after = before.replace('linha 600', 'linha 600 alterada');
  const list = Diff.hunks(before, after);
  return list.length === 1 && Diff.merge(before, list, [true]) === after;
})();

cases['diff grande usa bloco único'] = (() => {
  const before = Array.from({ length: 1600 }, (_, index) => 'a ' + index + ' ' + 'x'.repeat(20)).join('\n');
  const after = Array.from({ length: 1600 }, (_, index) => 'b ' + index + ' ' + 'y'.repeat(20)).join('\n');
  const list = Diff.hunks(before, after);
  return list.length === 1 && list[0].baseLines.length === 1600 && list[0].remoteLines.length === 1600;
})();

cases['quebra de linha final preservada'] = (() => {
  const before = 'um\ndois\n';
  const after = 'um\ndois';
  const list = Diff.hunks(before, after);
  return Diff.merge(before, list, [true]) === after;
})();

const failures = Object.entries(cases).filter(([, ok]) => !ok);

console.log(failures.length
  ? `\n${failures.length} de ${Object.keys(cases).length} falharam: ${failures.map(([name]) => name).join(' | ')}`
  : `\nOK: ${Object.keys(cases).length} verificações passaram`);

process.exit(failures.length ? 1 : 0);
