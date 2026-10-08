/* Craft definitions, chart symbols, knitting/crochet stitch marks and thread libraries. */
(function (SP) {
  const U = SP.util;

  SP.defaultSettings = () => ({
    craft: 'cross',
    fabricCount: 14, over: 1, strands: 2,
    gaugeSts: 22, gaugeRows: 30,
    crochetSts: 18, crochetRows: 18,
    drillSize: 2.5, drillShape: 'round',
    beadW: 1.6, beadH: 1.3, beadLayout: 'loom',
    fabricColor: '#ffffff', gridColor: '#c9c5c0', majorColor: '#4d4945', centerColor: '#e0457b',
    majorEvery: 10, units: 'cm'
  });

  /**
   * Every craft says which stitch types and tools it supports and how big
   * one cell is in millimetres (width, height). The cell aspect ratio follows.
   */
  SP.CRAFTS = {
    cross: {
      name: 'Cross stitch', unit: 'stitches',
      stitchTypes: ['full', 'cross', 'half', 'quarter', 'three'],
      tools: ['backstitch', 'knot', 'bead'],
      marks: null,
      cellMM: s => { const m = 25.4 / s.fabricCount * s.over; return [m, m]; },
      fields: [
        { key: 'fabricCount', label: 'Fabric count (per inch)', type: 'select', options: [6, 8, 11, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40] },
        { key: 'over', label: 'Stitch over', type: 'select', options: [[1, '1 thread (Aida)'], [2, '2 threads (evenweave / linen)']] },
        { key: 'strands', label: 'Strands for thread estimate', type: 'select', options: [1, 2, 3, 4, 6] }
      ]
    },
    knit: {
      name: 'Knitting (colourwork)', unit: 'stitches',
      stitchTypes: ['full'], tools: ['backstitch'], marks: 'knit',
      cellMM: s => [100 / s.gaugeSts, 100 / s.gaugeRows],
      fields: [
        { key: 'gaugeSts', label: 'Stitches per 10 cm', type: 'number', min: 2, max: 80, step: 0.5 },
        { key: 'gaugeRows', label: 'Rows per 10 cm', type: 'number', min: 2, max: 100, step: 0.5 }
      ]
    },
    crochet: {
      name: 'Crochet (tapestry / C2C)', unit: 'stitches',
      stitchTypes: ['full'], tools: ['backstitch'], marks: 'crochet',
      cellMM: s => [100 / s.crochetSts, 100 / s.crochetRows],
      fields: [
        { key: 'crochetSts', label: 'Stitches per 10 cm', type: 'number', min: 2, max: 80, step: 0.5 },
        { key: 'crochetRows', label: 'Rows per 10 cm', type: 'number', min: 2, max: 100, step: 0.5 }
      ]
    },
    diamond: {
      name: 'Diamond painting', unit: 'drills',
      stitchTypes: ['full'], tools: [], marks: null,
      cellMM: s => [s.drillSize, s.drillSize],
      fields: [
        { key: 'drillShape', label: 'Drill shape', type: 'select', options: [['round', 'Round'], ['square', 'Square']] },
        { key: 'drillSize', label: 'Drill size (mm)', type: 'number', min: 1, max: 6, step: 0.1 }
      ]
    },
    bead: {
      name: 'Beading', unit: 'beads',
      stitchTypes: ['full'], tools: [], marks: null,
      cellMM: s => [s.beadW, s.beadH],
      fields: [
        { key: 'beadLayout', label: 'Layout', type: 'select', options: [['loom', 'Loom / square stitch'], ['peyote', 'Peyote (columns offset)'], ['brick', 'Brick stitch (rows offset)']] },
        { key: 'beadW', label: 'Bead width (mm)', type: 'number', min: 0.5, max: 10, step: 0.1 },
        { key: 'beadH', label: 'Bead height (mm)', type: 'number', min: 0.5, max: 10, step: 0.1 }
      ]
    }
  };

  SP.craftOf = s => SP.CRAFTS[s.craft] || SP.CRAFTS.cross;
  SP.layoutOf = s => (s.craft === 'bead' && s.beadLayout !== 'loom' ? s.beadLayout : 'grid');
  SP.aspectOf = s => { const m = SP.craftOf(s).cellMM(s); return m[1] / m[0]; };
  SP.finishedSize = (p) => {
    const m = SP.craftOf(p.settings).cellMM(p.settings);
    const lay = SP.layoutOf(p.settings);
    return [m[0] * (p.w + (lay === 'brick' ? 0.5 : 0)), m[1] * (p.h + (lay === 'peyote' ? 0.5 : 0))];
  };

  // ---- symbols used on charts ----
  SP.SYMBOLS = (
    '●■▲◆★✚✖♥♦♣♠○□△◇☆▼◀▶◐◑◒◓▣▤▥▦▧▨▩⬢⬡✿❖☀☂☘♪♫✱✳⊕⊗⊞⊠∆∇ΩΣΨΦλπµ§¤¥£€@#%&' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghijkmnpqrtuy23456789'
  ).match(/./gu);
  SP.nextSymbol = (palette) => {
    const used = new Set(palette.map(p => p.symbol));
    return SP.SYMBOLS.find(s => !used.has(s)) || '?';
  };

  // ---- knitting / crochet chart marks ----
  SP.MARKS = {
    knit: [
      { id: 1, name: 'Knit' }, { id: 2, name: 'Purl' }, { id: 3, name: 'Yarn over' },
      { id: 4, name: 'K2tog (right-leaning decrease)' }, { id: 5, name: 'SSK (left-leaning decrease)' },
      { id: 6, name: 'Slip stitch' }, { id: 7, name: 'No stitch' }, { id: 8, name: 'Make one' },
      { id: 9, name: 'Bobble' }, { id: 10, name: 'Knit through back loop' }
    ],
    crochet: [
      { id: 21, name: 'Chain' }, { id: 22, name: 'Slip stitch' }, { id: 23, name: 'Single crochet' },
      { id: 24, name: 'Half double crochet' }, { id: 25, name: 'Double crochet' }, { id: 26, name: 'Treble crochet' },
      { id: 27, name: 'Increase' }, { id: 28, name: 'Decrease' }, { id: 29, name: 'Magic ring' }, { id: 30, name: 'Popcorn' }
    ]
  };
  SP.markName = id => {
    for (const k in SP.MARKS) { const m = SP.MARKS[k].find(m => m.id === id); if (m) return m.name; }
    return '';
  };

  /** Draw a stitch mark inside the cell rectangle. */
  SP.drawMark = (ctx, id, x, y, w, h, color) => {
    const s = Math.min(w, h);
    const P = (nx, ny) => [x + nx * w, y + ny * h];
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const line = (...pts) => { ctx.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); };
    const circle = (r, fill) => { const c = P(0.5, 0.5); ctx.beginPath(); ctx.arc(c[0], c[1], r * s, 0, Math.PI * 2); fill ? ctx.fill() : ctx.stroke(); };
    const text = (t, sz) => { ctx.font = `bold ${Math.max(6, s * sz)}px "Segoe UI", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const c = P(0.5, 0.53); ctx.fillText(t, c[0], c[1]); };
    switch (id) {
      case 1: line([0.5, 0.2], [0.5, 0.8]); break;
      case 2: circle(0.14, true); break;
      case 3: circle(0.26, false); break;
      case 4: line([0.25, 0.8], [0.75, 0.2]); break;
      case 5: line([0.25, 0.2], [0.75, 0.8]); break;
      case 6: line([0.25, 0.25], [0.5, 0.78], [0.75, 0.25]); break;
      case 7: ctx.globalAlpha = 0.55; ctx.fillStyle = '#8a8580'; ctx.fillRect(x, y, w, h); break;
      case 8: text('M', 0.6); break;
      case 9: circle(0.3, false); circle(0.13, true); break;
      case 10: text('tbl', 0.36); break;
      case 21: { const c = P(0.5, 0.5); ctx.beginPath(); ctx.ellipse(c[0], c[1], w * 0.3, h * 0.16, 0, 0, Math.PI * 2); ctx.stroke(); break; }
      case 22: circle(0.12, true); break;
      case 23: line([0.27, 0.27], [0.73, 0.73]); line([0.73, 0.27], [0.27, 0.73]); break;
      case 24: line([0.3, 0.18], [0.7, 0.18]); line([0.5, 0.18], [0.5, 0.85]); break;
      case 25: line([0.3, 0.15], [0.7, 0.15]); line([0.5, 0.15], [0.5, 0.88]); line([0.36, 0.6], [0.64, 0.44]); break;
      case 26: line([0.3, 0.12], [0.7, 0.12]); line([0.5, 0.12], [0.5, 0.9]); line([0.36, 0.5], [0.64, 0.35]); line([0.36, 0.7], [0.64, 0.55]); break;
      case 27: line([0.22, 0.2], [0.5, 0.82], [0.78, 0.2]); break;
      case 28: line([0.22, 0.82], [0.5, 0.2], [0.78, 0.82]); break;
      case 29: circle(0.3, false); circle(0.1, true); break;
      case 30: { const c = P(0.5, 0.5); ctx.beginPath(); ctx.ellipse(c[0], c[1], w * 0.24, h * 0.32, 0, 0, Math.PI * 2); ctx.fill(); break; }
    }
    ctx.restore();
  };

  // ---- thread libraries (Lab values cached on first use) ----
  SP.threadLib = (brand) => {
    const b = SP.THREAD_BRANDS[brand];
    if (!b) return [];
    if (!b.list) {
      b.list = b.threads.map(t => ({ brand: b.name, code: t[0], name: t[1], hex: t[2], lab: U.hexToLab(t[2]) }));
    }
    return b.list;
  };
  SP.nearestThread = (hex, brand) => {
    const lib = SP.threadLib(brand);
    const i = U.nearest(U.hexToLab(hex), lib);
    return i >= 0 ? lib[i] : null;
  };
})(window.SP);
