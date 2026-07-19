/**
 * ImportExportService.js — Gemensam import/export-motor
 *
 * Stödjer CSV och XLSX (OpenXML) utan externa bibliotek.
 * Kan användas för kunder, fastigheter, objekt, artiklar, personal.
 *
 * Publika API:
 *   ImportExportService.parseCSV(text, opts)           → { headers, rows }
 *   ImportExportService.parseXLSX(arrayBuffer)         → { headers, rows }
 *   ImportExportService.buildCSV(headers, rows, opts)  → string (UTF-8 med BOM)
 *   ImportExportService.buildXLSX(sheets)              → ArrayBuffer
 *   ImportExportService.downloadCSV(filename, headers, rows)
 *   ImportExportService.downloadXLSX(filename, sheets)
 *   ImportExportService.BOKIO_PROFILE                  → kolumnmatchningsprofil
 *   ImportExportService.autoMatchColumns(headers, entityType)
 *   ImportExportService.saveImportLog(log)             → sparar i state + persist
 *   ImportExportService.undoImport(logId)              → återställer skapade/uppdaterade poster
 */

const ImportExportService = (function () {

  /* ── CSV-parser ──────────────────────────────────────────────────────────── */

  /**
   * Parsar en CSV-sträng. Hanterar:
   *  - RFC 4180 (citationstecken, radbrytningar inuti fält)
   *  - Semikolon eller komma som avgränsare (auto-detect)
   *  - BOM (UTF-8)
   *  - Blandrader och tomrader
   *
   * Returnerar { headers: string[], rows: string[][] }
   */
  function parseCSV(text, opts) {
    opts = opts || {};

    // Ta bort BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // Auto-detektera avgränsare
    var delim = opts.delimiter;
    if (!delim) {
      var firstLine = text.split(/\r?\n/)[0] || '';
      var semicolons = (firstLine.match(/;/g) || []).length;
      var commas    = (firstLine.match(/,/g) || []).length;
      delim = semicolons >= commas ? ';' : ',';
    }

    var result = _csvTokenize(text, delim);
    if (result.length === 0) return { headers: [], rows: [] };

    var headers = result[0].map(function (h) { return h.trim(); });
    var rows    = result.slice(1).filter(function (r) {
      // Hoppa över tomrader
      return r.some(function (c) { return c.trim() !== ''; });
    });

    return { headers: headers, rows: rows };
  }

  function _csvTokenize(text, delim) {
    var rows = [];
    var row  = [];
    var cell = '';
    var inQ  = false;
    var i = 0;
    var len = text.length;

    while (i < len) {
      var ch = text[i];

      if (inQ) {
        if (ch === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            // Escaped quote
            cell += '"';
            i += 2;
          } else {
            inQ = false;
            i++;
          }
        } else {
          cell += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQ = true;
          i++;
        } else if (ch === delim) {
          row.push(cell);
          cell = '';
          i++;
        } else if (ch === '\r') {
          if (i + 1 < len && text[i + 1] === '\n') i++;
          row.push(cell);
          rows.push(row);
          row  = [];
          cell = '';
          i++;
        } else if (ch === '\n') {
          row.push(cell);
          rows.push(row);
          row  = [];
          cell = '';
          i++;
        } else {
          cell += ch;
          i++;
        }
      }
    }

    // Sista cellen/raden
    if (cell !== '' || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  /* ── CSV-byggare ─────────────────────────────────────────────────────────── */

  /**
   * Bygger en CSV-sträng med UTF-8 BOM (öppnas korrekt i Excel).
   * headers: string[]
   * rows:    (string|number)[][]
   * opts.delimiter: ';' (default)
   */
  function buildCSV(headers, rows, opts) {
    opts = opts || {};
    var d = opts.delimiter || ';';
    var lines = [];
    lines.push(headers.map(function (h) { return _csvEscape(h, d); }).join(d));
    rows.forEach(function (row) {
      lines.push(row.map(function (c) { return _csvEscape(c == null ? '' : String(c), d); }).join(d));
    });
    return '﻿' + lines.join('\r\n');
  }

  function _csvEscape(v, d) {
    if (v.includes('"') || v.includes(d) || v.includes('\n') || v.includes('\r')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  /* ── CRC-32 ──────────────────────────────────────────────────────────────── */

  var _crcTable = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c;
    }
    return t;
  })();

  function _crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = _crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ── UTF-8-encoder ───────────────────────────────────────────────────────── */

  function _enc(str) {
    var encoder = new TextEncoder();
    return encoder.encode(str);
  }

  /* ── ZIP-byggare (STORE, ingen komprimering) ─────────────────────────────── */

  /**
   * Bygger ett ZIP-arkiv med STORE-metod (method=0).
   * entries: [{ name: string, data: Uint8Array }]
   * Returnerar Uint8Array.
   */
  function _buildZIP(entries) {
    var localHeaders = [];
    var centralDir   = [];
    var offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = _enc(entry.name);
      var data      = entry.data;
      var crc       = _crc32(data);
      var size      = data.length;

      // Local file header (30 bytes + name)
      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0,  0x04034B50, true);  // Signature
      dv.setUint16(4,  20,         true);  // Version needed
      dv.setUint16(6,  0,          true);  // Flags
      dv.setUint16(8,  0,          true);  // Compression (STORE)
      dv.setUint16(10, 0,          true);  // Mod time
      dv.setUint16(12, 0,          true);  // Mod date
      dv.setUint32(14, crc,        true);  // CRC-32
      dv.setUint32(18, size,       true);  // Compressed size
      dv.setUint32(22, size,       true);  // Uncompressed size
      dv.setUint16(26, nameBytes.length, true); // Filename length
      dv.setUint16(28, 0,          true);  // Extra length
      lh.set(nameBytes, 30);

      // Central directory record (46 bytes + name)
      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0,  0x02014B50, true);  // Signature
      cv.setUint16(4,  20,         true);  // Version made by
      cv.setUint16(6,  20,         true);  // Version needed
      cv.setUint16(8,  0,          true);  // Flags
      cv.setUint16(10, 0,          true);  // Compression
      cv.setUint16(12, 0,          true);  // Mod time
      cv.setUint16(14, 0,          true);  // Mod date
      cv.setUint32(16, crc,        true);  // CRC-32
      cv.setUint32(20, size,       true);  // Compressed size
      cv.setUint32(24, size,       true);  // Uncompressed size
      cv.setUint16(28, nameBytes.length, true); // Filename length
      cv.setUint16(30, 0,          true);  // Extra length
      cv.setUint16(32, 0,          true);  // Comment length
      cv.setUint16(34, 0,          true);  // Disk start
      cv.setUint16(36, 0,          true);  // Int file attr
      cv.setUint32(38, 0,          true);  // Ext file attr
      cv.setUint32(42, offset,     true);  // Offset of local header
      cd.set(nameBytes, 46);

      localHeaders.push({ lh: lh, data: data });
      centralDir.push(cd);
      offset += lh.length + data.length;
    });

    var cdSize   = centralDir.reduce(function (s, cd) { return s + cd.length; }, 0);
    var cdOffset = offset;

    // End of central directory (22 bytes)
    var eocd = new Uint8Array(22);
    var ev   = new DataView(eocd.buffer);
    ev.setUint32(0,  0x06054B50,       true);  // Signature
    ev.setUint16(4,  0,                true);  // Disk number
    ev.setUint16(6,  0,                true);  // Start disk
    ev.setUint16(8,  entries.length,   true);  // Entries on disk
    ev.setUint16(10, entries.length,   true);  // Total entries
    ev.setUint32(12, cdSize,           true);  // Central dir size
    ev.setUint32(16, cdOffset,         true);  // Central dir offset
    ev.setUint16(20, 0,                true);  // Comment length

    // Konkatera allt
    var parts = [];
    localHeaders.forEach(function (e) { parts.push(e.lh, e.data); });
    centralDir.forEach(function (cd) { parts.push(cd); });
    parts.push(eocd);

    var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    var out   = new Uint8Array(total);
    var pos   = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ── ZIP-läsare ──────────────────────────────────────────────────────────── */

  /**
   * Läser ett ZIP-arkiv och returnerar en Map: name → Uint8Array (okomprimerat).
   * Stöder method=0 (STORE) och method=8 (DEFLATE via DecompressionStream).
   */
  async function _readZIP(buffer) {
    var bytes = new Uint8Array(buffer);
    var dv    = new DataView(buffer);
    var files = new Map();

    // Hitta End of Central Directory
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Ogiltig ZIP-fil (EOCD saknas)');

    var cdOffset = dv.getUint32(eocd + 16, true);
    var cdCount  = dv.getUint16(eocd + 10, true);

    var pos = cdOffset;
    for (var n = 0; n < cdCount; n++) {
      if (dv.getUint32(pos, true) !== 0x02014B50) break;
      var method    = dv.getUint16(pos + 10, true);
      var cSize     = dv.getUint32(pos + 20, true);
      var uSize     = dv.getUint32(pos + 24, true);
      var nameLen   = dv.getUint16(pos + 28, true);
      var extraLen  = dv.getUint16(pos + 30, true);
      var commentLen= dv.getUint16(pos + 32, true);
      var lhOffset  = dv.getUint32(pos + 42, true);
      var name      = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));

      // Hoppa till local header för att läsa extra-fältlängd
      var lhExtra = dv.getUint16(lhOffset + 28, true);
      var dataStart = lhOffset + 30 + nameLen + lhExtra;
      var rawData   = bytes.slice(dataStart, dataStart + cSize);

      var decompressed;
      if (method === 0) {
        decompressed = rawData;
      } else if (method === 8) {
        decompressed = await _inflate(rawData, uSize);
      } else {
        throw new Error('ZIP: okänd komprimeringsmetod ' + method);
      }

      files.set(name, decompressed);
      pos += 46 + nameLen + extraLen + commentLen;
    }

    return files;
  }

  async function _inflate(data, expectedSize) {
    var stream = new DecompressionStream('deflate-raw');
    var writer = stream.writable.getWriter();
    var reader = stream.readable.getReader();
    writer.write(data);
    writer.close();

    var chunks = [];
    var totalLen = 0;
    while (true) {
      var result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      totalLen += result.value.length;
    }

    var out = new Uint8Array(totalLen);
    var offset = 0;
    chunks.forEach(function (c) { out.set(c, offset); offset += c.length; });
    return out;
  }

  /* ── OpenXML / XLSX-byggare ──────────────────────────────────────────────── */

  /**
   * Bygger en XLSX-fil.
   * sheets: [{ name: string, headers: string[], rows: (string|number)[][] }]
   * Returnerar ArrayBuffer.
   */
  function buildXLSX(sheets) {
    // Samla alla strängar i shared strings-tabell (global för alla sheets)
    var ssTable  = [];   // [{s: string, i: index}]
    var ssMap    = {};   // string → index

    function ssIdx(s) {
      s = s == null ? '' : String(s);
      if (s in ssMap) return ssMap[s];
      var i = ssTable.length;
      ssTable.push(s);
      ssMap[s] = i;
      return i;
    }

    // Preprocessa sheets och bygg celldata
    var sheetXmls = sheets.map(function (sh, shIdx) {
      return _buildSheetXml(sh, ssIdx);
    });

    // Shared strings XML
    var ssXml = _buildSharedStringsXml(ssTable);

    // Workbook XML
    var wbXml = _buildWorkbookXml(sheets);

    // Styles XML (minimal)
    var stylesXml = _buildStylesXml();

    // Content types XML
    var ctXml = _buildContentTypesXml(sheets);

    // Relationships
    var wbRelsXml = _buildWorkbookRelsXml(sheets);
    var rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    // Bygg ZIP-entries
    var entries = [];
    entries.push({ name: '[Content_Types].xml',        data: _enc(ctXml) });
    entries.push({ name: '_rels/.rels',                data: _enc(rootRelsXml) });
    entries.push({ name: 'xl/workbook.xml',            data: _enc(wbXml) });
    entries.push({ name: 'xl/_rels/workbook.xml.rels', data: _enc(wbRelsXml) });
    entries.push({ name: 'xl/sharedStrings.xml',       data: _enc(ssXml) });
    entries.push({ name: 'xl/styles.xml',              data: _enc(stylesXml) });
    sheetXmls.forEach(function (xml, i) {
      entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: _enc(xml) });
    });

    var zip = _buildZIP(entries);
    return zip.buffer;
  }

  function _xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function _colName(n) {
    // n is 0-indexed column number
    var s = '';
    n++;
    while (n > 0) {
      var rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function _buildSheetXml(sh, ssIdx) {
    var rows = [sh.headers].concat(sh.rows || []);
    var xml  = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
               '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet"' +
               ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
               '<sheetData>';

    rows.forEach(function (rowData, ri) {
      xml += '<row r="' + (ri + 1) + '">';
      rowData.forEach(function (cell, ci) {
        var addr = _colName(ci) + (ri + 1);
        var v    = cell == null ? '' : cell;
        if (typeof v === 'number' && !isNaN(v)) {
          xml += '<c r="' + addr + '"><v>' + v + '</v></c>';
        } else {
          var si = ssIdx(v);
          xml += '<c r="' + addr + '" t="s"><v>' + si + '</v></c>';
        }
      });
      xml += '</row>';
    });

    xml += '</sheetData></worksheet>';
    return xml;
  }

  function _buildSharedStringsXml(ssTable) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
              '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet" count="' +
              ssTable.length + '" uniqueCount="' + ssTable.length + '">';
    ssTable.forEach(function (s) {
      xml += '<si><t xml:space="preserve">' + _xmlEsc(s) + '</t></si>';
    });
    xml += '</sst>';
    return xml;
  }

  function _buildWorkbookXml(sheets) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
              '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet"' +
              ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
              '<sheets>';
    sheets.forEach(function (sh, i) {
      xml += '<sheet name="' + _xmlEsc(sh.name) + '" sheetId="' + (i + 1) +
             '" r:id="rId' + (i + 3) + '"/>';
    });
    xml += '</sheets></workbook>';
    return xml;
  }

  function _buildWorkbookRelsXml(sheets) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
              '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    sheets.forEach(function (sh, i) {
      xml += '<Relationship Id="rId' + (i + 3) + '"' +
             ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"' +
             ' Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    });
    xml += '</Relationships>';
    return xml;
  }

  function _buildStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
           '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/sheet">' +
           '<fonts><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
           '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
           '<borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
           '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
           '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
           '</styleSheet>';
  }

  function _buildContentTypesXml(sheets) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
              '<Default Extension="xml" ContentType="application/xml"/>' +
              '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
              '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
              '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    sheets.forEach(function (sh, i) {
      xml += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml"' +
             ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });
    xml += '</Types>';
    return xml;
  }

  /* ── XLSX-läsare ─────────────────────────────────────────────────────────── */

  /**
   * Läser en XLSX-fil (ArrayBuffer).
   * Returnerar { headers: string[], rows: string[][] } för det första kalkylbladet.
   */
  async function parseXLSX(buffer) {
    var files = await _readZIP(buffer);

    // Hitta sharedStrings
    var ssFile  = files.get('xl/sharedStrings.xml');
    var ssArr   = [];
    if (ssFile) {
      var ssText = new TextDecoder().decode(ssFile);
      var ssDoc  = new DOMParser().parseFromString(ssText, 'application/xml');
      var sis    = ssDoc.querySelectorAll('si');
      sis.forEach(function (si) {
        var texts = si.querySelectorAll('t');
        var s = '';
        texts.forEach(function (t) { s += t.textContent; });
        ssArr.push(s);
      });
    }

    // Hitta workbook.xml för att hitta sheet-ordning
    var wbFile = files.get('xl/workbook.xml');
    var sheet1Name = 'xl/worksheets/sheet1.xml';
    if (wbFile) {
      var wbText = new TextDecoder().decode(wbFile);
      var wbDoc  = new DOMParser().parseFromString(wbText, 'application/xml');
      var sheetEl = wbDoc.querySelector('sheet');
      if (sheetEl) {
        var rId = sheetEl.getAttribute('r:id') || 'rId3';
        // Hitta filsökväg från workbook.xml.rels
        var relsFile = files.get('xl/_rels/workbook.xml.rels');
        if (relsFile) {
          var relsText = new TextDecoder().decode(relsFile);
          var relsDoc  = new DOMParser().parseFromString(relsText, 'application/xml');
          var relEl    = relsDoc.querySelector('Relationship[Id="' + rId + '"]');
          if (relEl) {
            var target = relEl.getAttribute('Target') || '';
            if (!target.startsWith('xl/')) target = 'xl/' + target;
            sheet1Name = target;
          }
        }
      }
    }

    var shFile = files.get(sheet1Name);
    if (!shFile) {
      // Prova direkt
      shFile = files.get('xl/worksheets/sheet1.xml');
    }
    if (!shFile) return { headers: [], rows: [] };

    var shText = new TextDecoder().decode(shFile);
    var shDoc  = new DOMParser().parseFromString(shText, 'application/xml');
    var rowEls = shDoc.querySelectorAll('row');

    var matrix = [];
    var maxCol = 0;

    rowEls.forEach(function (rowEl) {
      var rowIdx = parseInt(rowEl.getAttribute('r') || '0', 10) - 1;
      var cells  = rowEl.querySelectorAll('c');
      var rowObj = {};

      cells.forEach(function (c) {
        var addr = c.getAttribute('r') || '';
        var colStr = addr.replace(/[0-9]/g, '');
        var colIdx = _colLetterToIndex(colStr);
        if (colIdx > maxCol) maxCol = colIdx;

        var t = c.getAttribute('t') || '';
        var vEl = c.querySelector('v');
        var val = vEl ? vEl.textContent : '';

        if (t === 's') {
          val = ssArr[parseInt(val, 10)] || '';
        } else if (t === 'str' || t === 'inlineStr') {
          var is = c.querySelector('is t');
          if (is) val = is.textContent;
        }

        rowObj[colIdx] = val;
      });

      while (matrix.length <= rowIdx) matrix.push(null);
      matrix[rowIdx] = rowObj;
    });

    // Konvertera till 2D-array
    var result = matrix.map(function (rowObj) {
      if (!rowObj) return Array(maxCol + 1).fill('');
      var arr = [];
      for (var ci = 0; ci <= maxCol; ci++) {
        arr.push(rowObj[ci] != null ? rowObj[ci] : '');
      }
      return arr;
    });

    if (result.length === 0) return { headers: [], rows: [] };
    var headers = result[0];
    var rows    = result.slice(1).filter(function (r) {
      return r.some(function (c) { return c !== ''; });
    });

    return { headers: headers, rows: rows };
  }

  function _colLetterToIndex(s) {
    var idx = 0;
    for (var i = 0; i < s.length; i++) {
      idx = idx * 26 + (s.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  /* ── Kolumnmatchning ─────────────────────────────────────────────────────── */

  /**
   * Bokio-exportprofil: mappar Bokio-kolumnnamn → interna fältnamn.
   * Fält utan matchning mappas till null (importera inte).
   */
  var BOKIO_PROFILE = {
    name: 'Bokio',
    entityType: 'customer',
    mappings: {
      'Namn':              'name',
      'Organisationsnummer': 'orgNr',
      'Personnummer':      'personnr',
      'Typ':               'type',
      'Adress':            'address',
      'Postnummer':        'zip',
      'Ort':               'city',
      'Telefon':           'phone',
      'E-post':            'email',
      'Kontaktperson':     'contactPerson',
      'Kundnummer':        'customerNumber',
      'Betalningsvillkor': 'paymentTerms',
      'Referens':          'externalId',
      'Fakturaadress':     'invoiceAddress',
      'Faktura postnummer':'invoiceZip',
      'Faktura ort':       'invoiceCity',
      'Anteckning':        'note',
      'Kommentar':         'note'
    }
  };

  /**
   * Föreslår kolumnmatchning automatiskt.
   * headers: string[]  — kolumnrubriker från import-filen
   * entityType: 'customer' (utökbart)
   * Returnerar { [header]: fieldName | null }
   *
   * Matchningsprioritet:
   *   1. Exakt match (case-insensitive) mot internt fältnamn
   *   2. Match mot kända svenska alias
   *   3. Match mot Bokio-profil
   *   4. null (importera inte)
   */
  var _CUSTOMER_ALIASES = {
    name:          ['namn', 'company', 'företag', 'foretagsnamn', 'företagsnamn', 'bolagsnamn'],
    orgNr:         ['orgnr', 'org.nr', 'org nr', 'organisationsnummer', 'cvr', 'vat'],
    personnr:      ['personnr', 'personnummer', 'pnr'],
    type:          ['typ', 'kundtyp', 'type'],
    firstName:     ['förnamn', 'fornamn', 'firstname', 'first name'],
    lastName:      ['efternamn', 'lastname', 'last name', 'surname'],
    contactPerson: ['kontaktperson', 'kontakt', 'contact', 'ansvarig'],
    phone:         ['telefon', 'tel', 'phone', 'mobilnummer', 'mobil', 'mobile'],
    email:         ['e-post', 'epost', 'email', 'e-mail', 'mail'],
    address:       ['adress', 'address', 'gatuadress', 'street'],
    zip:           ['postnummer', 'zip', 'postcode', 'postal'],
    city:          ['ort', 'stad', 'city'],
    invoiceAddress:['fakturaadress', 'invoice address', 'fakturaadress'],
    invoiceZip:    ['faktura postnummer', 'invoice zip', 'fakturapostnummer'],
    invoiceCity:   ['faktura ort', 'invoice city', 'fakturaort'],
    note:          ['anteckning', 'kommentar', 'note', 'notes', 'anmärkning'],
    customerNumber:['kundnummer', 'kund nr', 'customer number', 'kundid'],
    externalId:    ['externt id', 'external id', 'referens', 'ref', 'ext id', 'bokio id'],
    externalSystem:['externt system', 'external system', 'system'],
    paymentTerms:  ['betalningsvillkor', 'betvillkor', 'payment terms', 'netto']
  };

  function autoMatchColumns(headers, entityType) {
    var aliases = entityType === 'customer' ? _CUSTOMER_ALIASES : {};
    var result  = {};

    headers.forEach(function (h) {
      var lower = h.toLowerCase().trim();
      var matched = null;

      // Exakt match mot fältnamn
      if (aliases[lower]) {
        matched = lower;
      }

      // Match mot alias
      if (!matched) {
        Object.keys(aliases).forEach(function (field) {
          if (matched) return;
          if (aliases[field].indexOf(lower) !== -1) {
            matched = field;
          }
        });
      }

      // Match mot Bokio-profil
      if (!matched && BOKIO_PROFILE.mappings[h]) {
        matched = BOKIO_PROFILE.mappings[h];
      }

      result[h] = matched;
    });

    return result;
  }

  /* ── Nedladdningshjälpare ────────────────────────────────────────────────── */

  function downloadCSV(filename, headers, rows, opts) {
    var content = buildCSV(headers, rows, opts);
    var blob    = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    _triggerDownload(blob, filename);
  }

  function downloadXLSX(filename, sheets) {
    var buffer = buildXLSX(sheets);
    var blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    _triggerDownload(blob, filename);
  }

  function _triggerDownload(blob, filename) {
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /* ── Importlogg ──────────────────────────────────────────────────────────── */

  /**
   * Sparar en import-loggpost i state.importLogs och kör persist().
   * log: delvis ifyllt Schema.importLog()-objekt (id och createdAt sätts här om det saknas)
   */
  var MAX_IMPORT_LOGS = 50;

  function saveImportLog(log) {
    if (!log.id)        log.id        = newId(state.importLogs, 'IMP');
    if (!log.createdAt) log.createdAt = new Date().toISOString();
    state.importLogs.push(log);

    /* Pruning: behåll de MAX_IMPORT_LOGS senaste loggarna */
    if (state.importLogs.length > MAX_IMPORT_LOGS) {
      state.importLogs.sort(function (a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      state.importLogs.splice(MAX_IMPORT_LOGS);
    }

    persist();
    return log;
  }

  /**
   * Ångrar en import: tar bort skapade poster och återställer uppdaterade poster.
   * Returnerar { removed, restored, errors, conflicts }
   * conflicts: poster som ändrades efter importen och inte kunde säkert återställas
   */
  function undoImport(logId) {
    var log = state.importLogs.find(function (l) { return l.id === logId; });
    if (!log) return { removed: 0, restored: 0, errors: ['Importloggen hittades inte'], conflicts: [] };
    if (log.undone)  return { removed: 0, restored: 0, errors: ['Importen har redan ångrats'], conflicts: [] };

    var errors    = [];
    var removed   = 0;
    var restored  = 0;
    var conflicts = [];   // [{id, field, importedValue, currentValue}]

    var arr = _getEntityArray(log.type);
    if (!arr) {
      return { removed: 0, restored: 0, errors: ['Okänd entitetstyp: ' + log.type], conflicts: [] };
    }

    // Ta bort skapade poster
    (log.createdIds || []).forEach(function (id) {
      var idx = arr.findIndex(function (e) { return e.id === id; });
      if (idx !== -1) {
        arr.splice(idx, 1);
        removed++;
      } else {
        errors.push('Hittade inte ' + id + ' för borttagning');
      }
    });

    // Återställ uppdaterade poster — kontrollera om posten ändrats sedan importen
    (log.updatedSnapshots || []).forEach(function (snap) {
      var idx = arr.findIndex(function (e) { return e.id === snap.id; });
      if (idx === -1) {
        errors.push('Hittade inte ' + snap.id + ' för återställning');
        return;
      }
      var current = arr[idx];

      // Konfliktdetektering: om updatedAtAfter finns och current.updatedAt är nyare
      if (snap.updatedAtAfter && current.updatedAt && current.updatedAt > snap.updatedAtAfter) {
        conflicts.push({ id: snap.id, name: current.name || snap.id, updatedAt: current.updatedAt });
      }

      // Återställ ändå (med snapshot) — konflikten rapporteras men blockerar inte
      arr[idx] = Object.assign({}, current, snap.before);
      restored++;
    });

    log.undone = true;
    persist();

    return { removed: removed, restored: restored, errors: errors, conflicts: conflicts };
  }

  function _getEntityArray(type) {
    if (typeof state === 'undefined') return null;
    var map = {
      customer:       state.customers,
      property:       state.properties,
      propertyObject: state.propertyObjects,
      object:         state.propertyObjects,
      article:        state.articles,
      priceGroup:     state.priceGroups,
      staff:          state.staff
    };
    return map[type] || null;
  }

  /* ── Exporthjälpare för kunder ───────────────────────────────────────────── */

  /**
   * Bygger exportrader för kundregistret.
   * opts.includeSensitive: false (default) — exkluderar alltid portkoder/lösenord
   * opts.includeContacts:  true (default) — kontaktpersoner
   * Returnerar { headers, rows }
   */
  function buildCustomerExportRows(customers, opts) {
    opts = opts || {};
    var headers = [
      'Kundnummer', 'Namn', 'Typ', 'Organisationsnummer', 'Personnummer',
      'Förnamn', 'Efternamn', 'Kontaktperson', 'Telefon', 'E-post',
      'Adress', 'Postnummer', 'Ort',
      'Fakturaadress', 'Faktura postnummer', 'Faktura ort',
      'Betalningsvillkor', 'Externt ID', 'Externt system',
      'Anteckning', 'Aktiv', 'Skapad'
    ];

    var typeMap = {
      privat: 'Privatperson', foretag: 'Företag', brf: 'BRF', fastighetsagare: 'Fastighetsägare'
    };

    var rows = customers.map(function (c) {
      return [
        c.customerNumber || '',
        c.name            || '',
        typeMap[c.type]   || c.type || '',
        c.orgNr           || '',
        c.personnr        || '',
        c.firstName       || '',
        c.lastName        || '',
        c.contactPerson   || '',
        c.phone           || '',
        c.email           || '',
        c.address         || '',
        c.zip             || '',
        c.city            || '',
        c.invoiceAddress  || '',
        c.invoiceZip      || '',
        c.invoiceCity     || '',
        c.paymentTerms != null ? c.paymentTerms : '',
        c.externalId      || '',
        c.externalSystem  || '',
        c.note            || '',
        c.active !== false ? 'Ja' : 'Nej',
        c.createdAt ? c.createdAt.split('T')[0] : ''
      ];
    });

    return { headers: headers, rows: rows };
  }

  /* ── Publikt API ─────────────────────────────────────────────────────────── */

  return {
    parseCSV:               parseCSV,
    parseXLSX:              parseXLSX,
    buildCSV:               buildCSV,
    buildXLSX:              buildXLSX,
    downloadCSV:            downloadCSV,
    downloadXLSX:           downloadXLSX,
    BOKIO_PROFILE:          BOKIO_PROFILE,
    autoMatchColumns:       autoMatchColumns,
    saveImportLog:          saveImportLog,
    undoImport:             undoImport,
    buildCustomerExportRows: buildCustomerExportRows,
    // Interna, exponeras för tester
    _buildZIP:  _buildZIP,
    _readZIP:   _readZIP,
    _crc32:     _crc32
  };

})();
