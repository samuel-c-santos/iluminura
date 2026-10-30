/*
 * Iluminura: exportação DOCX e EPUB.
 * Gera os pacotes no navegador, sem dependências externas.
 */
(function (global) {
  'use strict';

  var encoder = new TextEncoder();
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var EPUB_MIME = 'application/epub+zip';

  function xml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function xmlId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_') || 'item';
  }

  function mimeToExt(mime) {
    var map = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/avif': 'avif'
    };
    return map[String(mime || '').toLowerCase()] || 'bin';
  }

  function parseDataUrl(src) {
    var match = /^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/i.exec(String(src || ''));
    if (!match) return null;

    var mime = match[1].toLowerCase();
    var meta = match[2] || '';
    var payload = match[3];
    var bytes;

    if (/;base64/i.test(meta)) {
      var binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = encoder.encode(decodeURIComponent(payload));
    }

    return { mime: mime, ext: mimeToExt(mime), bytes: bytes };
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Falha ao ler imagem')); };
      reader.readAsDataURL(blob);
    });
  }

  function svgPlainLabels(svg) {
    var objects = Array.from(svg.querySelectorAll('foreignObject'));

    objects.forEach(function (object) {
      var text = (object.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        object.remove();
        return;
      }

      var x = parseFloat(object.getAttribute('x') || '0');
      var y = parseFloat(object.getAttribute('y') || '0');
      var width = parseFloat(object.getAttribute('width') || '0');
      var height = parseFloat(object.getAttribute('height') || '0');

      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x + width / 2));
      label.setAttribute('y', String(y + height / 2 + 4));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', 'Segoe UI, sans-serif');
      label.setAttribute('font-size', '12');
      label.setAttribute('fill', '#333333');
      label.textContent = text;

      object.parentNode.replaceChild(label, object);
    });
  }

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;

    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    return {
      time: ((date.getHours() & 31) << 11) |
        ((date.getMinutes() & 63) << 5) |
        ((date.getSeconds() >> 1) & 31),
      date: (((date.getFullYear() - 1980) & 127) << 9) |
        (((date.getMonth() + 1) & 15) << 5) |
        (date.getDate() & 31)
    };
  }

  function zip(entries, mime) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    var stamp = dosDateTime(new Date());

    entries.forEach(function (entry) {
      var name = encoder.encode(entry.name);
      var data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      locals.push(local, data);

      var central = new Uint8Array(46 + name.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);

      centrals.push(central);
      offset += local.length + data.length;
    });

    var centralOffset = offset;
    var centralSize = centrals.reduce(function (total, part) { return total + part.length; }, 0);

    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);

    return new Blob(locals.concat(centrals, [end]), { type: mime || 'application/zip' });
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function documentTitle(options) {
    return options && options.title ? String(options.title) : 'Documento';
  }

  /* ------------------------------------------------------------- DOCX -- */

  function createDocxContext() {
    return {
      media: [],
      links: [],
      imageId: 0,
      linkId: 0,
      drawingId: 0
    };
  }

  function addDocxImage(ctx, data, width, height) {
    ctx.imageId++;
    var name = 'image' + ctx.imageId + '.' + data.ext;
    var relId = 'rIdImg' + ctx.imageId;

    var maxWidth = 5943600;
    var maxHeight = 8001000;
    var cx = Math.max(1, Math.round((width || 600) * 9525));
    var cy = Math.max(1, Math.round((height || 400) * 9525));

    if (cx > maxWidth) {
      cy = Math.round(cy * maxWidth / cx);
      cx = maxWidth;
    }
    if (cy > maxHeight) {
      cx = Math.round(cx * maxHeight / cy);
      cy = maxHeight;
    }

    ctx.media.push({
      name: name,
      relId: relId,
      mime: data.mime || 'image/png',
      bytes: data.bytes
    });

    return { relId: relId, name: name, cx: cx, cy: cy, id: ctx.imageId };
  }

  function imageDimensions(img) {
    var width = parseFloat(img.dataset.exportWidth || '') || img.naturalWidth || 600;
    var height = parseFloat(img.dataset.exportHeight || '') || img.naturalHeight || 400;
    return { width: width, height: height };
  }

  function docxRun(text, style) {
    var props = '';

    if (style.bold) props += '<w:b/>';
    if (style.italic) props += '<w:i/>';
    if (style.strike) props += '<w:strike/>';
    if (style.sub) props += '<w:vertAlign w:val="subscript"/>';
    if (style.sup) props += '<w:vertAlign w:val="superscript"/>';
    if (style.highlight) props += '<w:highlight w:val="yellow"/>';
    if (style.link) props += '<w:color w:val="2F6FEB"/><w:u w:val="single"/>';
    if (style.code) {
      props += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' +
        '<w:shd w:val="clear" w:fill="F2F3F5"/>';
    }

    return '<w:r>' + (props ? '<w:rPr>' + props + '</w:rPr>' : '') +
      '<w:t xml:space="preserve">' + xml(text) + '</w:t></w:r>';
  }

  function docxDrawing(image, ctx) {
    ctx.drawingId++;
    var id = ctx.drawingId;

    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + image.cx + '" cy="' + image.cy + '"/>' +
      '<wp:docPr id="' + id + '" name="Imagem ' + id + '"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + xml(image.name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + image.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + image.cx + '" cy="' + image.cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  function docxImage(img, ctx) {
    var data = parseDataUrl(img.getAttribute('src') || img.dataset.origSrc || '');
    if (!data || data.mime.indexOf('image/') !== 0) return null;

    var size = imageDimensions(img);
    return docxDrawing(addDocxImage(ctx, data, size.width, size.height), ctx);
  }

  function docxLink(ctx, url) {
    for (var i = 0; i < ctx.links.length; i++) {
      if (ctx.links[i].url === url) return ctx.links[i].id;
    }

    ctx.linkId++;
    var id = 'rIdLink' + ctx.linkId;
    ctx.links.push({ id: id, url: url });
    return id;
  }

  function docxRuns(node, style, ctx) {
    var out = '';

    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];

      if (child.nodeType === 3) {
        if (child.nodeValue) out += docxRun(child.nodeValue, style);
        continue;
      }

      if (child.nodeType !== 1) continue;

      var tag = child.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') continue;
      if (child.classList && (child.classList.contains('mermaid-source') ||
          child.classList.contains('code-lang'))) continue;

      if (tag === 'br') {
        out += '<w:r><w:br/></w:r>';
        continue;
      }

      if (tag === 'img') {
        var drawing = docxImage(child, ctx);
        if (drawing) out += drawing;
        continue;
      }

      if (tag === 'input') continue;

      var next = {
        bold: !!style.bold,
        italic: !!style.italic,
        strike: !!style.strike,
        code: !!style.code,
        highlight: !!style.highlight,
        sub: !!style.sub,
        sup: !!style.sup,
        link: !!style.link
      };

      if (tag === 'strong' || tag === 'b') next.bold = true;
      if (tag === 'em' || tag === 'i') next.italic = true;
      if (tag === 'del' || tag === 's' || tag === 'strike') next.strike = true;
      if (tag === 'code' || tag === 'kbd' || tag === 'samp') next.code = true;
      if (tag === 'mark') next.highlight = true;
      if (tag === 'sub') next.sub = true;
      if (tag === 'sup') next.sup = true;

      if (tag === 'a') {
        var href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) {
          next.link = true;
          out += '<w:hyperlink r:id="' + docxLink(ctx, href) + '">' +
            docxRuns(child, next, ctx) + '</w:hyperlink>';
          continue;
        }
      }

      out += docxRuns(child, next, ctx);
    }

    return out;
  }

  function docxParagraph(inline, options) {
    options = options || {};
    var props = '';

    if (options.style) props += '<w:pStyle w:val="' + options.style + '"/>';
    if (options.indent) props += '<w:ind w:left="' + options.indent + '"/>';
    if (options.align) props += '<w:jc w:val="' + options.align + '"/>';
    if (options.bottomBorder) {
      props += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D5DB"/></w:pBdr>';
    }

    return '<w:p>' + (props ? '<w:pPr>' + props + '</w:pPr>' : '') + (inline || '') + '</w:p>';
  }

  function docxCode(el, ctx) {
    var code = el.textContent.replace(/\n+$/, '');
    if (!code) return '';

    var lines = code.split('\n');
    var inline = lines.map(function (line, index) {
      return docxRun(line, { code: true }) + (index < lines.length - 1 ? '<w:r><w:br/></w:r>' : '');
    }).join('');

    return docxParagraph(inline, { style: 'Code' });
  }

  function docxList(list, ctx, level) {
    var ordered = list.tagName.toLowerCase() === 'ol';
    var items = Array.from(list.children).filter(function (child) {
      return child.tagName.toLowerCase() === 'li';
    });
    var out = '';

    items.forEach(function (item, index) {
      var checkbox = item.querySelector('input[type="checkbox"]');
      var prefix = ordered ? (index + 1) + '. ' : '• ';
      if (checkbox) prefix = checkbox.checked ? '[x] ' : '[ ] ';

      var clone = item.cloneNode(true);
      clone.querySelectorAll('ul, ol, input').forEach(function (node) { node.remove(); });

      out += docxParagraph(
        docxRun(prefix, {}) + docxRuns(clone, {}, ctx),
        { indent: 360 + level * 360 }
      );

      Array.from(item.children).forEach(function (child) {
        if (/^(ul|ol)$/i.test(child.tagName)) {
          out += docxList(child, ctx, level + 1);
        }
      });
    });

    return out;
  }

  function docxTable(table, ctx) {
    var rows = Array.from(table.querySelectorAll('tr'));
    var columns = 1;

    rows.forEach(function (row) {
      columns = Math.max(columns, row.children.length);
    });

    var grid = '';
    for (var i = 0; i < columns; i++) grid += '<w:gridCol w:w="3000"/>';

    var out = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="D0D5DB"/>' +
      '<w:left w:val="single" w:sz="4" w:space="0" w:color="D0D5DB"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D5DB"/>' +
      '<w:right w:val="single" w:sz="4" w:space="0" w:color="D0D5DB"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D5DB"/>' +
      '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D5DB"/>' +
      '</w:tblBorders></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>';

    rows.forEach(function (row, rowIndex) {
      var cells = Array.from(row.children);
      out += '<w:tr>' + (rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '');

      cells.forEach(function (cell) {
        var header = cell.tagName.toLowerCase() === 'th';
        var inline = docxRuns(cell, { bold: header }, ctx);
        out += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
          docxParagraph(inline) + '</w:tc>';
      });

      out += '</w:tr>';
    });

    return out + '</w:tbl><w:p/>';
  }

  function docxBlocks(root, ctx) {
    var out = '';

    Array.from(root.children).forEach(function (el) {
      var tag = el.tagName.toLowerCase();

      if (el.classList && (el.classList.contains('mermaid-source') ||
          el.classList.contains('doc-notice') ||
          el.classList.contains('disk-notice') ||
          el.classList.contains('code-lang'))) return;

      if (/^h[1-6]$/.test(tag)) {
        out += docxParagraph(docxRuns(el, {}, ctx), {
          style: 'Heading' + tag.slice(1)
        });
        return;
      }

      if (tag === 'p') {
        var inline = docxRuns(el, {}, ctx);
        var centered = !!el.querySelector('img') && !el.textContent.trim();
        out += docxParagraph(inline, centered ? { align: 'center' } : {});
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        out += docxList(el, ctx, 0);
        return;
      }

      if (tag === 'blockquote') {
        Array.from(el.children).forEach(function (child) {
          if (/^(ul|ol)$/i.test(child.tagName)) out += docxList(child, ctx, 1);
          else out += docxParagraph(docxRuns(child, { italic: true }, ctx), {
            style: 'Quote',
            indent: 360
          });
        });
        return;
      }

      if (tag === 'pre') {
        out += docxCode(el, ctx);
        return;
      }

      if (tag === 'div' && el.classList.contains('code-block')) {
        var pre = el.querySelector('pre');
        out += pre ? docxCode(pre, ctx) : docxParagraph(docxRuns(el, {}, ctx));
        return;
      }

      if (tag === 'table') {
        out += docxTable(el, ctx);
        return;
      }

      if (tag === 'hr') {
        out += docxParagraph('', { bottomBorder: true });
        return;
      }

      if (tag === 'img') {
        var image = docxImage(el, ctx);
        if (image) out += docxParagraph(image, { align: 'center' });
        return;
      }

      if (tag === 'figure') {
        out += docxBlocks(el, ctx);
        return;
      }

      if (tag === 'section' || tag === 'div' || tag === 'article') {
        out += docxBlocks(el, ctx);
        return;
      }

      out += docxParagraph(docxRuns(el, {}, ctx));
    });

    return out;
  }

  function svgToPng(svg) {
    return new Promise(function (resolve) {
      try {
        var viewBox = svg.viewBox && svg.viewBox.baseVal;
        var width = (viewBox && viewBox.width) || parseFloat(svg.getAttribute('width')) || 640;
        var height = (viewBox && viewBox.height) || parseFloat(svg.getAttribute('height')) || 400;
        var scale = 2;
        var clone = svg.cloneNode(true);

        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        svgPlainLabels(clone);

        var source = new XMLSerializer().serializeToString(clone);
        var url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
        var image = new Image();

        image.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            var context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
          } catch (e) {
            URL.revokeObjectURL(url);
            resolve(null);
          }
        };

        image.onerror = function () {
          URL.revokeObjectURL(url);
          resolve(null);
        };

        image.src = url;
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function prepareDocxFragment(html) {
    var container = document.createElement('div');
    container.innerHTML = html;

    container.querySelectorAll('.mermaid-source, .doc-notice, .disk-notice, button').forEach(function (el) {
      el.remove();
    });

    var blocks = Array.from(container.querySelectorAll('.mermaid-block'));

    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var svg = block.querySelector('svg');

      if (!svg) {
        var source = block.querySelector('.mermaid-source');
        var pre = document.createElement('pre');
        pre.textContent = source ? source.textContent : '[Diagrama Mermaid]';
        block.replaceWith(pre);
        continue;
      }

      var viewBox = svg.viewBox && svg.viewBox.baseVal;
      var width = (viewBox && viewBox.width) || 640;
      var height = (viewBox && viewBox.height) || 400;
      var png = await svgToPng(svg);

      if (!png) {
        var fallback = document.createElement('pre');
        fallback.textContent = '[Diagrama Mermaid]';
        block.replaceWith(fallback);
        continue;
      }

      var dataUrl = await blobToDataUrl(png);
      var img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Diagrama Mermaid';
      img.dataset.exportWidth = String(Math.round(width));
      img.dataset.exportHeight = String(Math.round(height));
      block.replaceWith(img);
    }

    return container;
  }

  async function waitImages(root) {
    var images = Array.from(root.querySelectorAll('img'));

    await Promise.all(images.map(function (img) {
      if (img.complete && img.naturalWidth > 0) {
        return typeof img.decode === 'function' ? img.decode().catch(function () {}) : Promise.resolve();
      }

      return new Promise(function (resolve) {
        var timer = setTimeout(done, 2500);

        function done() {
          clearTimeout(timer);
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          resolve();
        }

        img.addEventListener('load', done);
        img.addEventListener('error', done);
      });
    }));
  }

  async function buildDocx(html, options) {
    options = options || {};

    var container = await prepareDocxFragment(html);
    await waitImages(container);

    var ctx = createDocxContext();
    var body = docxBlocks(container, ctx);
    var title = documentTitle(options);
    var timestamp = nowIso();

    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="1F2328"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="57606A"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F6F8FA"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2F6FEB"/><w:u w:val="single"/></w:rPr></w:style>' +
      '</w:styles>';

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>';

    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    ctx.media.forEach(function (item) {
      docRels += '<Relationship Id="' + item.relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + item.name + '"/>';
    });

    ctx.links.forEach(function (link) {
      docRels += '<Relationship Id="' + link.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
        xml(link.url) + '" TargetMode="External"/>';
    });

    docRels += '</Relationships>';

    var extensions = {};
    extensions.xml = 'application/xml';
    extensions.rels = 'application/vnd.openxmlformats-package.relationships+xml';
    ctx.media.forEach(function (item) {
      var ext = item.name.split('.').pop().toLowerCase();
      extensions[ext] = item.mime;
    });

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      Object.keys(extensions).map(function (ext) {
        return '<Default Extension="' + ext + '" ContentType="' + extensions[ext] + '"/>';
      }).join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xml(title) + '</dc:title>' +
      '<dc:creator>Iluminura</dc:creator>' +
      '<cp:lastModifiedBy>Iluminura</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + timestamp + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + timestamp + '</dcterms:modified>' +
      '</cp:coreProperties>';

    var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Iluminura</Application></Properties>';

    var entries = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app }
    ];

    ctx.media.forEach(function (item) {
      entries.push({ name: 'word/media/' + item.name, data: item.bytes });
    });

    return zip(entries, DOCX_MIME);
  }

  /* ------------------------------------------------------------- EPUB -- */

  function cleanEpubContainer(html) {
    var container = document.createElement('div');
    container.innerHTML = html;

    container.querySelectorAll('.mermaid-source, .doc-notice, .disk-notice, button, script').forEach(function (el) {
      el.remove();
    });

    container.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
      var mark = document.createElement('span');
      mark.textContent = input.checked ? '[x] ' : '[ ] ';
      input.replaceWith(mark);
    });

    container.querySelectorAll('.mermaid-block svg').forEach(function (svg) {
      svgPlainLabels(svg);
    });

    return container;
  }

  function extractEpubImages(container) {
    var media = [];
    var counter = 0;

    container.querySelectorAll('img').forEach(function (img) {
      var data = parseDataUrl(img.getAttribute('src') || '');

      if (!data || data.mime.indexOf('image/') !== 0) {
        img.removeAttribute('srcset');
        return;
      }

      counter++;
      var name = 'image' + counter + '.' + data.ext;
      media.push({ name: name, mime: data.mime, bytes: data.bytes });
      img.setAttribute('src', 'images/' + name);
      img.removeAttribute('srcset');
    });

    return media;
  }

  function epubNavigation(headings, title) {
    var list = (headings || []).filter(function (heading) {
      return heading && heading.text;
    });

    if (!list.length) {
      return '<nav epub:type="toc" id="toc"><h1>Sumário</h1><ol><li><a href="chapter.xhtml">' +
        xml(title) + '</a></li></ol></nav>';
    }

    return '<nav epub:type="toc" id="toc"><h1>Sumário</h1><ol>' +
      list.map(function (heading) {
        return '<li class="toc-level-' + heading.level + '"><a href="chapter.xhtml#' +
          xml(heading.id) + '">' + xml(heading.text) + '</a></li>';
      }).join('') +
      '</ol></nav>';
  }

  function epubCss() {
    return [
      'body { font-family: Georgia, "Times New Roman", serif; line-height: 1.65; margin: 5%; color: #111; }',
      'h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }',
      'h1 { font-size: 1.9em; }',
      'h2 { font-size: 1.5em; border-bottom: 1px solid #ddd; padding-bottom: 0.25em; }',
      'h3 { font-size: 1.22em; }',
      'p { margin: 0 0 1em; }',
      'a { color: #2f6feb; text-decoration: none; }',
      'code { font-family: "Cascadia Code", Consolas, monospace; font-size: 0.88em; background: #f6f8fa; padding: 0.1em 0.25em; }',
      'pre { white-space: pre-wrap; overflow-wrap: break-word; background: #f6f8fa; border: 1px solid #ddd; padding: 0.8em; font-size: 0.85em; }',
      'pre code { background: none; padding: 0; }',
      'blockquote { margin: 0 0 1em; padding-left: 1em; border-left: 3px solid #ccc; color: #555; }',
      'table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }',
      'th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; text-align: left; }',
      'th { background: #f2f3f5; }',
      'img { max-width: 100%; height: auto; }',
      '.mermaid-block { margin: 0 0 1em; text-align: center; }',
      '.mermaid-block svg { max-width: 100%; height: auto; }',
      '.mermaid-source, .code-lang { display: none; }',
      '.mermaid-error { color: #cf222e; font-size: 0.8em; }',
      '.task-list { list-style: none; padding-left: 0.4em; }'
    ].join('\n');
  }

  async function buildEpub(html, options) {
    options = options || {};

    var container = cleanEpubContainer(html);
    var media = extractEpubImages(container);
    var title = documentTitle(options);
    var timestamp = nowIso();
    var identifier = 'urn:uuid:' + (global.crypto && global.crypto.randomUUID
      ? global.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2));

    var serialized = new XMLSerializer().serializeToString(container);
    var inner = serialized.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
    var chapterBody = '<section xmlns="http://www.w3.org/1999/xhtml">' + inner + '</section>';

    var chapter = '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR" lang="pt-BR">' +
      '<head><meta charset="utf-8"/><title>' + xml(title) + '</title>' +
      '<link rel="stylesheet" type="text/css" href="style.css"/></head>' +
      '<body>' + chapterBody + '</body></html>';

    var nav = '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR" lang="pt-BR">' +
      '<head><meta charset="utf-8"/><title>Sumário</title>' +
      '<link rel="stylesheet" type="text/css" href="style.css"/></head>' +
      '<body>' + epubNavigation(options.headings, title) + '</body></html>';

    var manifestImages = media.map(function (item, index) {
      return '<item id="img' + (index + 1) + '" href="images/' + item.name + '" media-type="' + item.mime + '"/>';
    }).join('');

    var opf = '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:identifier id="pub-id">' + xml(identifier) + '</dc:identifier>' +
      '<dc:title>' + xml(title) + '</dc:title>' +
      '<dc:language>pt-BR</dc:language>' +
      '<dc:creator>Iluminura</dc:creator>' +
      '<meta property="dcterms:modified">' + timestamp + '</meta>' +
      '</metadata>' +
      '<manifest>' +
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="style" href="style.css" media-type="text/css"/>' +
      manifestImages +
      '</manifest>' +
      '<spine><itemref idref="chapter"/></spine>' +
      '</package>';

    var containerXml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
      '</container>';

    var entries = [
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: containerXml },
      { name: 'OEBPS/content.opf', data: opf },
      { name: 'OEBPS/nav.xhtml', data: nav },
      { name: 'OEBPS/chapter.xhtml', data: chapter },
      { name: 'OEBPS/style.css', data: epubCss() }
    ];

    media.forEach(function (item) {
      entries.push({ name: 'OEBPS/images/' + item.name, data: item.bytes });
    });

    return zip(entries, EPUB_MIME);
  }

  global.IluminuraExport = {
    docx: buildDocx,
    epub: buildEpub
  };
})(window);
