/*
 * Iluminura: diff de linhas para revisão de alterações externas.
 * Sem dependências e sem DOM.
 */
(function (root) {
  'use strict';

  function lines(text) {
    return String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  }

  function hunks(baseText, remoteText) {
    var base = lines(baseText);
    var remote = lines(remoteText);

    var start = 0;
    while (start < base.length && start < remote.length && base[start] === remote[start]) {
      start++;
    }

    var endBase = base.length - 1;
    var endRemote = remote.length - 1;
    while (endBase >= start && endRemote >= start && base[endBase] === remote[endRemote]) {
      endBase--;
      endRemote--;
    }

    var a = base.slice(start, endBase + 1);
    var b = remote.slice(start, endRemote + 1);

    if (!a.length && !b.length) return [];
    if (!a.length) return [{ baseStart: start, baseLines: [], remoteLines: b.slice() }];
    if (!b.length) return [{ baseStart: start, baseLines: a.slice(), remoteLines: [] }];

    if (a.length * b.length > 2500000) {
      return [{ baseStart: start, baseLines: a.slice(), remoteLines: b.slice() }];
    }

    var width = b.length + 1;
    var dir = new Uint8Array((a.length + 1) * width);
    var previous = new Uint32Array(width);
    var current = new Uint32Array(width);

    for (var i = 1; i <= a.length; i++) {
      for (var j = 1; j <= b.length; j++) {
        var index = i * width + j;

        if (a[i - 1] === b[j - 1]) {
          current[j] = previous[j - 1] + 1;
          dir[index] = 0;
        } else if (previous[j] >= current[j - 1]) {
          current[j] = previous[j];
          dir[index] = 1;
        } else {
          current[j] = current[j - 1];
          dir[index] = 2;
        }
      }

      var swap = previous;
      previous = current;
      current = swap;
    }

    var ops = [];
    var x = a.length;
    var y = b.length;

    while (x > 0 || y > 0) {
      if (x > 0 && y > 0 && dir[x * width + y] === 0) {
        ops.push({ type: 'equal' });
        x--;
        y--;
      } else if (x > 0 && (y === 0 || dir[x * width + y] === 1)) {
        ops.push({ type: 'delete', text: a[x - 1] });
        x--;
      } else {
        ops.push({ type: 'insert', text: b[y - 1] });
        y--;
      }
    }

    ops.reverse();

    var result = [];
    var active = null;
    var basePos = start;

    ops.forEach(function (op) {
      if (op.type === 'equal') {
        if (active) {
          result.push(active);
          active = null;
        }
        basePos++;
        return;
      }

      if (!active) {
        active = { baseStart: basePos, baseLines: [], remoteLines: [] };
      }

      if (op.type === 'delete') {
        active.baseLines.push(op.text);
        basePos++;
      } else {
        active.remoteLines.push(op.text);
      }
    });

    if (active) result.push(active);
    return result;
  }

  function merge(baseText, list, accepted) {
    var base = lines(baseText);
    var output = [];
    var position = 0;

    function append(items) {
      for (var i = 0; i < items.length; i++) output.push(items[i]);
    }

    (list || []).forEach(function (hunk, index) {
      if (hunk.baseStart < position) return;

      append(base.slice(position, hunk.baseStart));

      var take = Array.isArray(accepted) ? accepted[index] : !!accepted[index];
      append(take ? hunk.remoteLines : hunk.baseLines);

      position = hunk.baseStart + hunk.baseLines.length;
    });

    append(base.slice(position));
    return output.join('\n');
  }

  root.IluminuraDiff = {
    lines: lines,
    hunks: hunks,
    merge: merge
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
