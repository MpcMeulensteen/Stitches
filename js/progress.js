/*
 * Stitching progress: which cells are done, the order you stitch them in,
 * and drawing finished stitches on a chart. Used by the counter page and the editor.
 *
 * A "step" is one cell that has any stitch in it. Backstitches, knots and beads are
 * not steps; they are ticked off by hand and stored as keys in `vec`.
 */
(function (SP) {
  const U = SP.util, Geo = SP.Geo;
  const P = SP.Progress = {};

  P.MODES = [
    ['rows', 'Row by row'],
    ['columns', 'Column by column'],
    ['diagonal', 'Diagonal (corner to corner)'],
    ['blocks', 'Blocks (parking method)'],
    ['colours', 'One colour at a time'],
    ['free', 'Free (mark cells yourself)']
  ];
  P.PRESETS = {
    reading: { label: 'Rows, top-left to right', order: { mode: 'rows', startY: 'top', startX: 'left', snake: false } },
    knitFlat: { label: 'Knitting / crochet flat (back and forth from bottom-right)', order: { mode: 'rows', startY: 'bottom', startX: 'right', snake: true } },
    knitRound: { label: 'Knitting in the round (every row right to left)', order: { mode: 'rows', startY: 'bottom', startX: 'right', snake: false } },
    c2c: { label: 'Crochet C2C (corner to corner)', order: { mode: 'diagonal', corner: 'bl', snake: true } },
    peyote: { label: 'Beading peyote (columns, back and forth)', order: { mode: 'columns', startX: 'left', startY: 'top', snake: true } },
    parking: { label: 'Cross stitch: per 10×10 block, colour by colour', order: { mode: 'blocks', block: 10, inBlock: 'colour', blockSnake: false } },
    colours: { label: 'Cross stitch: one colour at a time', order: { mode: 'colours' } },
    free: { label: 'Free: mark cells yourself', order: { mode: 'free' } }
  };
  const BASE = { mode: 'rows', startY: 'top', startX: 'left', snake: false, corner: 'bl', block: 10, inBlock: 'colour', blockSnake: false };
  P.normOrder = o => Object.assign({}, BASE, o || {});
  P.defaultOrder = (settings) => {
    const c = settings.craft;
    const pre = c === 'knit' || c === 'crochet' ? 'knitFlat' : c === 'cross' ? 'parking'
      : c === 'bead' && settings.beadLayout === 'peyote' ? 'peyote' : 'reading';
    return P.normOrder(P.PRESETS[pre].order);
  };
  P.GROUP_WORD = { rows: 'row', columns: 'column', diagonal: 'diagonal', blocks: 'block', colours: 'colour', free: '' };

  P.cellColors = (p) => {
    const n = p.w * p.h, L = p.legs, col = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const b = i * 4;
      col[i] = (L[b] || L[b + 1] || L[b + 2] || L[b + 3]) - 1;
    }
    return col;
  };

  /**
   * Build the stitching sequence.
   * Returns { steps, groups, posOf, col, info[], gStart, gEnd, groupCount, word }
   * steps[k] = cell index of the k-th stitch, groups[k] = its group (row, block run, ...).
   */
  P.build = (p, order) => {
    const o = P.normOrder(order);
    const w = p.w, h = p.h, n = w * h;
    const col = P.cellColors(p);
    const steps = [], groups = [], info = [];
    const push = (i, g) => { if (col[i] >= 0) { steps.push(i); groups.push(g); } };
    let word = P.GROUP_WORD[o.mode] || 'row';

    if (o.mode === 'rows') {
      for (let k = 0; k < h; k++) {
        const y = o.startY === 'bottom' ? h - 1 - k : k;
        const ltr = (o.startX === 'left') !== (o.snake && k % 2 === 1);
        info.push({ name: `Row ${k + 1}`, chart: `chart row ${y + 1}`, dir: ltr ? '→' : '←' });
        for (let j = 0; j < w; j++) push(y * w + (ltr ? j : w - 1 - j), k);
      }
    } else if (o.mode === 'columns') {
      for (let k = 0; k < w; k++) {
        const x = o.startX === 'right' ? w - 1 - k : k;
        const down = (o.startY === 'top') !== (o.snake && k % 2 === 1);
        info.push({ name: `Column ${k + 1}`, chart: `chart column ${x + 1}`, dir: down ? '↓' : '↑' });
        for (let j = 0; j < h; j++) push((down ? j : h - 1 - j) * w + x, k);
      }
    } else if (o.mode === 'diagonal') {
      const toXY = (rx, ry) => {
        const x = o.corner === 'br' || o.corner === 'tr' ? w - 1 - rx : rx;
        const y = o.corner === 'bl' || o.corner === 'br' ? h - 1 - ry : ry;
        return y * w + x;
      };
      for (let d = 0; d <= w + h - 2; d++) {
        const lo = Math.max(0, d - (h - 1)), hi = Math.min(d, w - 1);
        const rev = o.snake && d % 2 === 1;
        info.push({ name: `Diagonal ${d + 1}`, chart: '', dir: '' });
        for (let k = 0; k <= hi - lo; k++) { const rx = rev ? hi - k : lo + k; push(toXY(rx, d - rx), d); }
      }
    } else if (o.mode === 'blocks') {
      const B = Math.max(2, o.block | 0), bw = Math.ceil(w / B), bh = Math.ceil(h / B), nb = bw * bh;
      let g = 0, bk = 0;
      word = o.inBlock === 'colour' ? 'colour in this block' : 'block';
      for (let by = 0; by < bh; by++) {
        for (let j = 0; j < bw; j++) {
          const bx = o.blockSnake && by % 2 === 1 ? bw - 1 - j : j;
          const x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
          const rect = { x0, y0, x1, y1 };
          const name = `Block ${bk + 1} of ${nb}`;
          if (o.inBlock === 'colour') {
            const byCol = new Map();
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const i = y * w + x;
              if (col[i] < 0) continue;
              if (!byCol.has(col[i])) byCol.set(col[i], []);
              byCol.get(col[i]).push(i);
            }
            for (const c of Array.from(byCol.keys()).sort((a, b) => a - b)) {
              info.push({ name, chart: '', rect, colour: c });
              for (const i of byCol.get(c)) push(i, g);
              g++;
            }
          } else {
            info.push({ name, chart: '', rect });
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) push(y * w + x, g);
            g++;
          }
          bk++;
        }
      }
    } else if (o.mode === 'colours') {
      const lists = p.palette.map(() => []);
      for (let i = 0; i < n; i++) if (col[i] >= 0 && lists[col[i]]) lists[col[i]].push(i);
      let g = 0;
      lists.forEach((list, c) => {
        if (!list.length) return;
        info.push({ name: `Colour ${g + 1}`, chart: '', colour: c });
        for (const i of list) push(i, g);
        g++;
      });
    }

    const S = Int32Array.from(steps), G = Int32Array.from(groups);
    const posOf = new Int32Array(n).fill(-1);
    for (let k = 0; k < S.length; k++) posOf[S[k]] = k;
    const gStart = new Int32Array(info.length).fill(-1), gEnd = new Int32Array(info.length).fill(-1);
    for (let k = 0; k < G.length; k++) { if (gStart[G[k]] < 0) gStart[G[k]] = k; gEnd[G[k]] = k + 1; }
    return { order: o, steps: S, groups: G, posOf, col, info, gStart, gEnd, groupCount: info.length, word };
  };

  // ---- progress record ----
  P.newRecord = (p, order) => ({ id: p.id, w: p.w, h: p.h, done: new Uint8Array(p.w * p.h), vec: new Set(), order: P.normOrder(order || P.defaultOrder(p.settings)), pos: 0, started: Date.now() });
  P.encode = r => ({ id: r.id, w: r.w, h: r.h, done: U.bytesToB64(r.done), vec: Array.from(r.vec), order: r.order, pos: r.pos || 0, started: r.started, updated: Date.now() });
  P.decode = r => ({ id: r.id, w: r.w, h: r.h, done: U.b64ToBytes(r.done), vec: new Set(r.vec || []), order: P.normOrder(r.order), pos: r.pos || 0, started: r.started || Date.now() });
  P.describe = (o) => {
    o = P.normOrder(o);
    switch (o.mode) {
      case 'rows': return `Rows from the ${o.startY}, first row ${o.startX === 'left' ? 'left → right' : 'right → left'}${o.snake ? ', back and forth' : ''}`;
      case 'columns': return `Columns from the ${o.startX}, first column ${o.startY === 'top' ? 'top → bottom' : 'bottom → top'}${o.snake ? ', back and forth' : ''}`;
      case 'diagonal': return `Diagonals from the ${{ bl: 'bottom-left', br: 'bottom-right', tl: 'top-left', tr: 'top-right' }[o.corner]} corner${o.snake ? ', back and forth' : ''}`;
      case 'blocks': return `${o.block}×${o.block} blocks, ${o.inBlock === 'colour' ? 'one colour at a time' : 'row by row'} inside each block`;
      case 'colours': return 'One colour at a time, row by row';
      default: return 'Free: you mark stitches yourself';
    }
  };

  P.vecKey = (type, o) => type === 'l'
    ? 'l:' + ((o.x1 < o.x2 || (o.x1 === o.x2 && o.y1 <= o.y2)) ? [o.x1, o.y1, o.x2, o.y2] : [o.x2, o.y2, o.x1, o.y1]).join(',')
    : type + ':' + o.x + ',' + o.y;

  /** Totals: { total, done, perColour: [{total, done}], vecTotal, vecDone } */
  P.stats = (p, rec, col) => {
    col = col || P.cellColors(p);
    const per = p.palette.map(() => ({ total: 0, done: 0 }));
    let total = 0, done = 0;
    for (let i = 0; i < col.length; i++) {
      if (col[i] < 0) continue;
      total++;
      const d = rec.done[i] ? 1 : 0;
      done += d;
      if (per[col[i]]) { per[col[i]].total++; per[col[i]].done += d; }
    }
    let vecTotal = 0, vecDone = 0;
    const vt = (t, arr) => arr.forEach(o => { vecTotal++; if (rec.vec.has(P.vecKey(t, o))) vecDone++; });
    vt('l', p.lines); vt('k', p.knots); vt('b', p.beads);
    return { total, done, perColour: per, vecTotal, vecDone };
  };

  /** Draw finished stitches. style: 'dim' | 'hatch' | 'hide' */
  /**
   * Show progress on a chart.
   * style 'todo': finished stitches in full colour, stitches still to do faded.
   * style 'dim' | 'hatch' | 'hide': finished stitches faded / crossed out / hidden.
   */
  P.drawDone = (ctx, p, g, rec, style, width, height) => {
    if (!rec) return;
    const L = p.legs, D = rec.done, fab = p.settings.fabricColor;
    const todo = style === 'todo';
    const vx0 = Math.max(0, Math.floor(-g.ox / g.cw) - 1), vx1 = Math.min(p.w, Math.ceil((width - g.ox) / g.cw) + 1);
    const vy0 = Math.max(0, Math.floor(-g.oy / g.ch) - 1), vy1 = Math.min(p.h, Math.ceil((height - g.oy) / g.ch) + 1);
    ctx.save();
    ctx.fillStyle = fab;
    ctx.globalAlpha = style === 'hide' ? 1 : style === 'hatch' ? 0.45 : todo ? 0.7 : 0.72;
    const hatch = style === 'hatch' && Math.min(g.cw, g.ch) >= 6;
    const hp = hatch ? new Path2D() : null;
    for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
      const i = y * p.w + x;
      if (!D[i] !== todo) continue; // fade either the finished or the unfinished stitches
      const b = i * 4;
      if (!(L[b] | L[b + 1] | L[b + 2] | L[b + 3])) continue;
      const xy = Geo.cellXY(g, x, y);
      ctx.fillRect(xy[0], xy[1], g.cw + 0.5, g.ch + 0.5);
      if (hp) { hp.moveTo(xy[0] + 1, xy[1] + g.ch - 1); hp.lineTo(xy[0] + g.cw - 1, xy[1] + 1); }
    }
    if (hp) { ctx.globalAlpha = 0.8; ctx.strokeStyle = U.contrastColor(fab) === '#000000' ? '#555' : '#ddd'; ctx.lineWidth = 1.2; ctx.stroke(hp); }
    // backstitches / knots / beads: draw a light line over the faded ones
    if (rec.vec.size || todo) {
      ctx.globalAlpha = 0.75; ctx.strokeStyle = fab; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, Math.min(g.cw, g.ch) * 0.2);
      for (const l of p.lines) {
        if (rec.vec.has(P.vecKey('l', l)) === todo) continue;
        const a = Geo.halfXY(g, l.x1, l.y1), c = Geo.halfXY(g, l.x2, l.y2);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      }
      ctx.fillStyle = fab;
      for (const [t, arr] of [['k', p.knots], ['b', p.beads]]) for (const k of arr) {
        if (rec.vec.has(P.vecKey(t, k)) === todo) continue;
        const a = Geo.halfXY(g, k.x, k.y);
        ctx.beginPath(); ctx.arc(a[0], a[1], Math.max(2.5, Math.min(g.cw, g.ch) * 0.36), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  };
})(window.SP);
