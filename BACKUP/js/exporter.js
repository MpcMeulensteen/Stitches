/* PNG export and printable chart (print / save as PDF). */
(function (SP) {
  const U = SP.util, Geo = SP.Geo, R = SP.Renderer;

  SP.Exporter = {
    pngSize(p, cell, rulers) {
      const RS = rulers ? Math.max(24, cell * 2) : 0;
      const g = Geo.make(p, { ox: RS, oy: RS, cw: cell });
      const s = Geo.size(g);
      return [Math.ceil(s[0] + RS + 1), Math.ceil(s[1] + RS + 1)];
    },

    renderToCanvas(p, o) {
      const RS = o.rulers ? Math.max(24, o.cell * 2) : 0;
      const g = Geo.make(p, { ox: RS, oy: RS, cw: o.cell });
      const sz = this.pngSize(p, o.cell, o.rulers);
      const cv = document.createElement('canvas');
      cv.width = sz[0]; cv.height = sz[1];
      const ctx = cv.getContext('2d');
      if (!o.transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); }
      R.render(ctx, p, g, {
        width: cv.width, height: cv.height, mode: o.mode, grid: o.grid, major: o.grid, center: false,
        rulers: o.rulers, rulerSize: RS, back: true, knots: true, marks: true, highlight: -1,
        noFabric: !!o.transparent, rulerBg: '#ffffff'
      });
      return cv;
    },

    exportPng(p, o) {
      const cv = this.renderToCanvas(p, o);
      cv.toBlob(b => U.download(U.safeFileName(p.name) + '.png', b), 'image/png');
    },

    thumbnail(p, max) {
      const cell = Math.max(1, Math.min(8, Math.floor(max / Math.max(p.w, p.h * SP.aspectOf(p.settings)))));
      const cv = this.renderToCanvas(p, { cell, mode: 'blocks', grid: false, rulers: false });
      return cv.toDataURL('image/png');
    },

    /** Thread length estimate in skeins (cross stitch only). */
    skeins(p, st) {
      if (p.settings.craft !== 'cross') return null;
      const cellCm = 2.54 / p.settings.fabricCount * p.settings.over;
      const perFull = cellCm * (2 * Math.SQRT2 + 2);
      let len = st.full * perFull + st.half * perFull / 2 + st.three * perFull * 0.75 + st.quarter * perFull / 4;
      len += st.back * cellCm * 2 + st.knots * 3;
      len *= 1.15;
      const strands = p.settings.strands || 2;
      const perSkein = 800 * 6 / strands;
      return len / perSkein;
    },

    pageLayout(p, o) {
      const paper = o.paper === 'Letter' ? [215.9, 279.4] : [210, 297];
      const pw = o.orient === 'landscape' ? paper[1] : paper[0];
      const ph = o.orient === 'landscape' ? paper[0] : paper[1];
      const margin = 10, header = 9, rulerMM = 6;
      const usableW = pw - margin * 2 - rulerMM, usableH = ph - margin * 2 - header - rulerMM - 6;
      const cwmm = o.cellmm, chmm = o.cellmm * SP.aspectOf(p.settings);
      const cols = Math.max(4, Math.floor(usableW / cwmm - (SP.layoutOf(p.settings) === 'brick' ? 0.5 : 0)));
      const rows = Math.max(4, Math.floor(usableH / chmm - (SP.layoutOf(p.settings) === 'peyote' ? 0.5 : 0)));
      const ov = Math.min(o.overlap, Math.min(cols, rows) - 1);
      const tiles = [];
      const stepX = cols - ov, stepY = rows - ov;
      for (let y = 0; y < p.h; y += stepY) {
        for (let x = 0; x < p.w; x += stepX) {
          tiles.push({ x0: x, y0: y, x1: Math.min(p.w, x + cols), y1: Math.min(p.h, y + rows) });
          if (x + cols >= p.w) break;
        }
        if (y + rows >= p.h) break;
      }
      return { pw, ph, margin, rulerMM, cwmm, chmm, cols, rows, tiles };
    },

    print(p, o) {
      const lay = this.pageLayout(p, o);
      const PXMM = 8; // ~200 dpi
      const area = document.getElementById('printArea');
      area.innerHTML = '';
      const css = document.createElement('style');
      css.textContent = `@page { size: ${o.paper} ${o.orient}; margin: ${lay.margin}mm; }`;
      area.appendChild(css);
      const craft = SP.craftOf(p.settings);
      const fs = SP.finishedSize(p);
      const stats = p.stats();
      const totals = stats.reduce((a, s) => { for (const k in s) a[k] = (a[k] || 0) + s[k]; return a; }, {});
      const page = html => { const d = document.createElement('div'); d.className = 'print-page'; d.innerHTML = html; area.appendChild(d); return d; };
      const pages = lay.tiles.length;

      if (o.cover) {
        const cell = Math.max(1, Math.min(12, Math.floor(1400 / Math.max(p.w, p.h))));
        const img = this.renderToCanvas(p, { cell, mode: 'blocks', grid: false, rulers: false }).toDataURL('image/png');
        const info = [
          `<b>Craft:</b> ${U.esc(craft.name)}`,
          `<b>Size:</b> ${p.w} × ${p.h} ${craft.unit}`,
          `<b>Finished size:</b> ${U.formatLen(fs[0], p.settings.units)} × ${U.formatLen(fs[1], p.settings.units)}` +
            (p.settings.craft === 'cross' ? ` on ${p.settings.fabricCount} count${p.settings.over === 2 ? ' (over 2)' : ''}` : ''),
          `<b>Colours:</b> ${p.palette.length}`,
          `<b>Chart pages:</b> ${pages} (${lay.cols} × ${lay.rows} ${craft.unit} per page)`
        ];
        page(`<h1>${U.esc(p.name)}</h1><div class="meta">${info.join('<br>')}</div><img class="cover-img" src="${img}">`);
      }

      if (o.key) {
        const rows = p.palette.map((e, i) => {
          const s = stats[i] || {};
          const parts = [];
          if (s.full) parts.push(s.full + ' full');
          if (s.half) parts.push(s.half + ' half');
          if (s.three) parts.push(s.three + ' ¾');
          if (s.quarter) parts.push(s.quarter + ' ¼');
          if (s.back) parts.push(s.back.toFixed(1) + ' back');
          if (s.knots) parts.push(s.knots + ' knots');
          if (s.beads) parts.push(s.beads + ' beads');
          const sk = this.skeins(p, s);
          return `<tr><td class="sy">${U.esc(e.symbol)}</td><td><span class="sw" style="background:${e.hex}"></span></td>` +
            `<td>${U.esc(e.brand)}</td><td>${U.esc(e.code)}</td><td>${U.esc(e.name)}</td><td>${parts.join(', ') || '–'}</td>` +
            (sk != null ? `<td>${sk ? Math.max(1, Math.ceil(sk)) : 0}</td>` : '') + '</tr>';
        }).join('');
        const sk = p.settings.craft === 'cross';
        page(`<h2>${U.esc(p.name)} – colour key</h2>
          <table class="print-key"><thead><tr><th>Sym</th><th></th><th>Brand</th><th>No.</th><th>Name</th><th>Stitches</th>${sk ? `<th>Skeins*</th>` : ''}</tr></thead>
          <tbody>${rows}</tbody></table>
          <div class="print-footer">Total: ${(totals.full || 0)} full, ${(totals.half || 0)} half, ${(totals.three || 0)} three-quarter, ${(totals.quarter || 0)} quarter stitches` +
          `${totals.knots ? ', ' + totals.knots + ' knots' : ''}${totals.beads ? ', ' + totals.beads + ' beads' : ''}.` +
          `${sk ? ` *Estimate with ${p.settings.strands} strand(s), 8 m skeins, 15% extra.` : ''}</div>`);
      }

      lay.tiles.forEach((t, k) => {
        const cw = lay.cwmm * PXMM;
        const RS = lay.rulerMM * PXMM;
        const tmpG = { ox: RS - t.x0 * cw, oy: 0, cw };
        const g = Geo.make(p, tmpG);
        g.oy = RS - t.y0 * g.ch;
        const W = Math.ceil(RS + (t.x1 - t.x0) * g.cw + (g.layout === 'brick' ? g.cw / 2 : 0) + 2);
        const H = Math.ceil(RS + (t.y1 - t.y0) * g.ch + (g.layout === 'peyote' ? g.ch / 2 : 0) + 2);
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        R.render(ctx, p, g, {
          width: W, height: H, mode: o.mode, grid: true, major: true, center: true, rulers: true, rulerSize: RS,
          back: true, knots: true, marks: true, highlight: -1, range: t, rulerBg: '#ffffff', noBitmap: true
        });
        const url = cv.toDataURL('image/png');
        page(`<h2>${U.esc(p.name)} – page ${k + 1} of ${pages} <span style="font-weight:normal;font-size:9pt">` +
          `(columns ${t.x0 + 1}–${t.x1}, rows ${t.y0 + 1}–${t.y1})</span></h2>` +
          `<img src="${url}" style="width:${(W / PXMM).toFixed(2)}mm;height:${(H / PXMM).toFixed(2)}mm">`);
      });

      const imgs = Array.from(area.querySelectorAll('img'));
      Promise.all(imgs.map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve())).then(() => {
        const done = () => { area.innerHTML = ''; window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
      });
    }
  };
})(window.SP);
