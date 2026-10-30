/*
 * Reading cell fill colours from Excel, without libraries:
 *  - .xlsx files: unzip in the browser (DecompressionStream) and read the sheet, style and theme XML.
 *  - copied cells: Excel puts an HTML table with the fill colours on the clipboard.
 * Both give a "grid source": { rows, cols, r0, c0, colorAt(r, c) -> '#rrggbb' | null }
 * where r / c are 0-based sheet positions (r0 / c0 = first used row / column).
 */
(function (SP) {
  const X = SP.Xlsx = {};

  // ---------- cell references ----------
  X.colName = c => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - 1 - m) / 26; } return s; };
  X.colNum = s => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  X.ref = (r, c) => X.colName(c) + (r + 1);
  /** "B2:AZ60" (or "b2 - az60", or one cell) -> { r1, c1, r2, c2 } 0-based inclusive, or null. */
  X.parseRange = txt => {
    const m = String(txt || '').trim().match(/^([a-z]{1,3})(\d{1,7})(?:\s*[:\-–]\s*([a-z]{1,3})(\d{1,7}))?$/i);
    if (!m) return null;
    const a = { r: +m[2] - 1, c: X.colNum(m[1]) }, b = m[3] ? { r: +m[4] - 1, c: X.colNum(m[3]) } : a;
    if (a.r < 0 || b.r < 0) return null;
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  };
  X.rangeText = g => X.ref(g.r1, g.c1) + ':' + X.ref(g.r2, g.c2);

  // ---------- colours ----------
  const hex2 = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
  const parseHex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  /** Excel tint: lighter (tint > 0) or darker (tint < 0) in HSL lightness. */
  function applyTint(hex, tint) {
    if (!tint) return hex;
    let [r, g, b] = parseHex(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    if (s === 0) { r = g = b = l; } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
      r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
    }
    return toHex(r * 255, g * 255, b * 255);
  }
  // Excel's legacy colour palette (indexed colours)
  const INDEXED = ('000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF ' +
    '800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF ' +
    '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 ' +
    '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333').split(' ');

  /** Any CSS colour ("#ffc000", "yellow", "rgb(...)") -> '#rrggbb', or null for none/transparent. */
  let cssCtx = null;
  X.cssColor = v => {
    v = String(v || '').trim().split(/\s+(?![^(]*\))/)[0];
    if (!v || /^(none|transparent|inherit|initial|auto|windowtext|window)$/i.test(v)) return null;
    cssCtx = cssCtx || document.createElement('canvas').getContext('2d');
    cssCtx.fillStyle = '#010203';
    cssCtx.fillStyle = v;
    const out = cssCtx.fillStyle;
    if (out === '#010203' && v.toLowerCase() !== '#010203') return null; // not a colour
    if (out[0] === '#') return out.toLowerCase();
    const m = out.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] != null && +m[4] === 0)) return null;
    return toHex(+m[1], +m[2], +m[3]);
  };

  // ---------- zip ----------
  /** Minimal zip reader: returns { names, text(name) -> Promise<string> }. */
  async function openZip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map(), dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      entries.set(dec.decode(u8.subarray(p + 46, p + 46 + nl)), { method, csize, off });
      p += 46 + nl + el + cl;
    }
    const text = async name => {
      const e = entries.get(name);
      if (!e) return null;
      const lo = e.off, start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8) throw new Error('Unsupported compression in the Excel file.');
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Use a recent Chrome, Edge or Firefox, or copy the cells and paste them.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    };
    return { names: [...entries.keys()], text };
  }

  // ---------- xml helpers ----------
  const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const first = (node, tag) => node.getElementsByTagNameNS('*', tag)[0] || null;
  const resolvePath = (base, target) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const t of target.split('/')) { if (t === '..') parts.pop(); else if (t !== '.') parts.push(t); }
    return parts.join('/');
  };

  /**
   * Open an .xlsx file. Returns { sheets: [{ name }], read(index) -> Promise<grid source> }.
   */
  X.openFile = async (file) => {
    if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files cannot be read. In Excel, use Save As → Excel Workbook (.xlsx).');
    const zip = await openZip(await file.arrayBuffer());
    const wb = parseXml(await zip.text('xl/workbook.xml') || '');
    const rels = parseXml(await zip.text('xl/_rels/workbook.xml.rels') || '<x/>');
    const relMap = new Map(all(rels, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const sheets = all(wb, 'sheet').map(s => {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      const target = relMap.get(rid);
      return { name: s.getAttribute('name'), path: target ? resolvePath('xl/workbook.xml', target) : null };
    }).filter(s => s.path);
    if (!sheets.length) throw new Error('No worksheets found in this file.');

    // theme colours (Excel swaps the first two pairs: 0 = light 1, 1 = dark 1, 2 = light 2, 3 = dark 2)
    const theme = [];
    const th = await zip.text('xl/theme/theme1.xml');
    if (th) {
      const scheme = first(parseXml(th), 'clrScheme');
      if (scheme) for (const el of Array.from(scheme.children)) {
        const c = el.firstElementChild;
        theme.push(c ? '#' + (c.getAttribute('lastClr') || c.getAttribute('val') || '000000').slice(-6).toLowerCase() : '#000000');
      }
    }
    const THEME_ORDER = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11];
    const colorOf = el => {
      if (!el) return null;
      let hex = null;
      if (el.hasAttribute('rgb')) hex = '#' + el.getAttribute('rgb').slice(-6).toLowerCase();
      else if (el.hasAttribute('theme')) hex = theme[THEME_ORDER[+el.getAttribute('theme')]] || null;
      else if (el.hasAttribute('indexed')) { const i = +el.getAttribute('indexed'); hex = INDEXED[i] ? '#' + INDEXED[i].toLowerCase() : null; }
      return hex ? applyTint(hex, parseFloat(el.getAttribute('tint') || '0')) : null;
    };

    // fills per cell style (cellXfs index)
    const st = parseXml(await zip.text('xl/styles.xml') || '<x/>');
    const fills = [];
    const fillsEl = first(st, 'fills');
    if (fillsEl) for (const f of Array.from(fillsEl.children)) {
      const pf = first(f, 'patternFill'), gf = first(f, 'gradientFill');
      if (pf) {
        const type = pf.getAttribute('patternType') || (first(pf, 'fgColor') ? 'solid' : 'none');
        fills.push(type === 'none' ? null : colorOf(first(pf, 'fgColor')) || (type === 'solid' ? null : colorOf(first(pf, 'bgColor'))));
      } else if (gf) fills.push(colorOf(first(gf, 'color')));
      else fills.push(null);
    }
    const xfsEl = first(st, 'cellXfs');
    const xfFill = xfsEl ? all(xfsEl, 'xf').map(x => fills[+(x.getAttribute('fillId') || 0)] || null) : [];
    const fillOfStyle = s => (s == null ? null : xfFill[s] || null);

    const read = async (index) => {
      const sheet = sheets[index];
      const doc = parseXml(await zip.text(sheet.path) || '<x/>');
      const cells = new Map(), rowStyle = new Map(), colStyle = [];
      let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
      for (const col of all(doc, 'col')) {
        const f = fillOfStyle(col.getAttribute('style'));
        if (f) colStyle.push([+col.getAttribute('min') - 1, +col.getAttribute('max') - 1, f]);
      }
      for (const row of all(doc, 'row')) {
        const r = +row.getAttribute('r') - 1;
        if (row.getAttribute('customFormat') === '1') rowStyle.set(r, fillOfStyle(row.getAttribute('s')));
        for (const c of all(row, 'c')) {
          const m = (c.getAttribute('r') || '').match(/^([A-Z]+)(\d+)$/);
          if (!m) continue;
          const cc = X.colNum(m[1]), rr = +m[2] - 1;
          const f = fillOfStyle(c.getAttribute('s'));
          cells.set(rr * 20000 + cc, f);
          if (f) { r0 = Math.min(r0, rr); r1 = Math.max(r1, rr); c0 = Math.min(c0, cc); c1 = Math.max(c1, cc); }
        }
      }
      const colorAt = (r, c) => {
        const k = r * 20000 + c;
        if (cells.has(k)) return cells.get(k);
        if (rowStyle.has(r)) return rowStyle.get(r);
        for (const [a, b, f] of colStyle) if (c >= a && c <= b) return f;
        return null;
      };
      if (r1 < 0) { // nothing filled cell by cell: maybe whole rows / columns were filled
        const rs = [...rowStyle.entries()].filter(e => e[1]).map(e => e[0]);
        if (rs.length) { r0 = Math.min(...rs); r1 = Math.max(...rs); c0 = 0; c1 = 29; }
        else if (colStyle.length) { c0 = Math.min(...colStyle.map(x => x[0])); c1 = Math.min(Math.max(...colStyle.map(x => x[1])), c0 + 199); r0 = 0; r1 = 29; }
      }
      const dim = first(doc, 'dimension');
      return {
        name: sheet.name, colorAt, empty: r1 < 0,
        used: r1 < 0 ? null : { r1: r0, c1: c0, r2: r1, c2: c1 },
        dimension: dim ? X.parseRange((dim.getAttribute('ref') || '').replace(/\$/g, '')) : null
      };
    };
    return { sheets: sheets.map(s => ({ name: s.name })), read };
  };

  /**
   * Cells copied from Excel (clipboard text/html). Returns a grid source with the pasted block
   * at A1, or null when the HTML has no table.
   */
  X.fromHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    // class rules from the <style> blocks (Excel writes .xl65 { background:#FFC000; ... })
    const rules = new Map();
    const css = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n').replace(/<!--|-->/g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      for (const sel of m[1].split(',')) {
        const cm = sel.trim().match(/^(?:td)?\.([\w-]+)$/i);
        if (cm) rules.set(cm[1], (rules.get(cm[1]) || '') + ';' + m[2]);
      }
    }
    const bgFrom = decl => {
      if (!decl) return undefined;
      let found;
      for (const m of decl.matchAll(/(?:^|;)\s*(background(?:-color)?|mso-pattern)\s*:\s*([^;]+)/gi)) {
        const prop = m[1].toLowerCase(), v = m[2].trim();
        if (prop === 'mso-pattern') { if (/none/i.test(v)) found = found === undefined ? null : found; continue; }
        found = X.cssColor(v);
      }
      return found;
    };
    const grid = [];
    let maxC = 0;
    Array.from(table.rows).forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const td of Array.from(tr.cells)) {
        while (grid[r][c] !== undefined) c++;
        let col = bgFrom(td.getAttribute('style'));
        if (col === undefined) for (const cls of td.classList) { const v = bgFrom(rules.get(cls)); if (v !== undefined) col = v; }
        if (col === undefined && td.getAttribute('bgcolor')) col = X.cssColor(td.getAttribute('bgcolor'));
        if (col === undefined) col = null;
        const cs = Math.max(1, +td.colSpan || 1), rs = Math.max(1, +td.rowSpan || 1);
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
          grid[r + dr] = grid[r + dr] || [];
          grid[r + dr][c + dc] = col;
        }
        c += cs; maxC = Math.max(maxC, c);
      }
    });
    const rows = grid.length;
    if (!rows || !maxC) return null;
    let any = false;
    for (const row of grid) if (row && row.some(v => v)) { any = true; break; }
    const colorAt = (r, c) => (grid[r] && grid[r][c]) || null;
    return { name: 'Pasted cells', colorAt, empty: !any, used: { r1: 0, c1: 0, r2: rows - 1, c2: maxC - 1 }, dimension: { r1: 0, c1: 0, r2: rows - 1, c2: maxC - 1 } };
  };

  /** Does this clipboard HTML look like cells copied from a spreadsheet? */
  X.looksLikeSheet = html => /<table/i.test(html || '') && /urn:schemas-microsoft-com:office:excel|ProgId|<td/i.test(html);
})(window.SP);
