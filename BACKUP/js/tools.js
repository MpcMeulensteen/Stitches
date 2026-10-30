/* Drawing tools. Each tool receives pointer info: { sx, sy, cell:{x,y,fx,fy}, half:{x,y}, button, shift, alt, ctrl, pressed }. */
(function (SP) {
  const U = SP.util, Geo = SP.Geo;
  const T = SP.Tools = {};

  const ICON = {
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3"/>',
    eraser: '<path d="M9 20h11 M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7z M9 11l5 5"/>',
    fill: '<path d="M4 12l7-7 8 8-7 7z M4 12h15 M20 16s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>',
    line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
    eyedropper: '<path d="M13 5l6 6 M15 3.5l5.5 5.5-2.5 2.5-5.5-5.5z M13 8l-8 8v3h3l8-8"/>',
    select: '<path d="M4 8V4h4 M12 4h2 M18 4h2v4 M20 12v2 M20 18v2h-4 M12 20h-2 M6 20H4v-4 M4 12v-2" />',
    text: '<path d="M5 7V5h14v2 M12 5v14 M9 19h6"/>',
    backstitch: '<path d="M4 18l5-7 5 4 6-9"/><circle cx="4" cy="18" r="1.3"/><circle cx="9" cy="11" r="1.3"/><circle cx="14" cy="15" r="1.3"/><circle cx="20" cy="6" r="1.3"/>',
    knot: '<circle cx="12" cy="12" r="5"/><path d="M9.5 10.5c1.5-1.5 3.5-1.5 5 0 M9.5 13.5c1.5 1.5 3.5 1.5 5 0"/>',
    bead: '<ellipse cx="12" cy="12" rx="7" ry="5.5" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="1.6"/>',
    stamp: '<path d="M7 5h10 M12 5v14 M9 13.5l6-3"/>',
    pan: '<path d="M12 3v18 M3 12h18 M12 3l-2.5 2.5 M12 3l2.5 2.5 M12 21l-2.5-2.5 M12 21l2.5-2.5 M3 12l2.5-2.5 M3 12l2.5 2.5 M21 12l-2.5-2.5 M21 12l-2.5 2.5"/>'
  };
  SP.TOOL_ORDER = [
    ['pencil', 'Pencil', 'p'], ['eraser', 'Eraser', 'e'], ['fill', 'Fill', 'f'], ['eyedropper', 'Colour picker', 'i'],
    ['line', 'Line', 'l'], ['rect', 'Rectangle', 'r'], ['ellipse', 'Ellipse', 'o'], ['select', 'Select / move', 's'],
    ['text', 'Text', 't'], ['backstitch', 'Backstitch', 'b'], ['knot', 'French knot', 'k'], ['bead', 'Bead', 'd'],
    ['stamp', 'Stitch symbols', 'm'], ['pan', 'Pan', 'h']
  ];
  SP.toolIcon = id => `<svg viewBox="0 0 24 24">${ICON[id] || ''}</svg>`;

  // ---------- helpers ----------
  const brushCache = new Map();
  function brushOffsets(size, shape) {
    const key = size + shape;
    if (brushCache.has(key)) return brushCache.get(key);
    const out = [], c = Math.floor((size - 1) / 2), r = size / 2;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      if (shape === 'round' && size > 2) {
        const dx = i + 0.5 - r, dy = j + 0.5 - r;
        if (dx * dx + dy * dy > r * r + 0.01) continue;
      }
      out.push([i - c, j - c]);
    }
    brushCache.set(key, out);
    return out;
  }
  SP.brushOffsets = brushOffsets;

  function symTargets(app, x, y) {
    const p = app.pattern, m = app.state.symmetry;
    const out = [[x, y, 0]];
    if (m === 'v' || m === 'both') out.push([p.w - 1 - x, y, 1]);
    if (m === 'h' || m === 'both') out.push([x, p.h - 1 - y, 2]);
    if (m === 'both') out.push([p.w - 1 - x, p.h - 1 - y, 3]);
    return out;
  }
  function symHalf(app, hx, hy) {
    const p = app.pattern, m = app.state.symmetry;
    const out = [[hx, hy]];
    if (m === 'v' || m === 'both') out.push([p.w * 2 - hx, hy]);
    if (m === 'h' || m === 'both') out.push([hx, p.h * 2 - hy]);
    if (m === 'both') out.push([p.w * 2 - hx, p.h * 2 - hy]);
    return out;
  }
  function xformMask(m, f) {
    if (f & 1) m = SP.flipMaskH(m);
    if (f & 2) m = SP.flipMaskV(m);
    return m;
  }
  const quadrant = c => (c.fy < 0.5 ? 0 : 2) + (c.fx < 0.5 ? 0 : 1);
  function maskFor(app, cell) {
    const st = app.stitchType();
    if (st === 'half') return app.state.halfDir === '/' ? SP.MASK.halfF : SP.MASK.halfB;
    if (st === 'quarter') return 1 << quadrant(cell);
    if (st === 'three') return 15 & ~(1 << (3 - quadrant(cell)));
    return 15;
  }
  function overwrite(app) { return app.state.overwrite && app.stitchType() !== 'quarter'; }
  /** How to paint with the current stitch type. */
  function paintHow(app) { return { overwrite: overwrite(app) || app.stitchType() === 'cross', cross: app.stitchType() === 'cross' }; }

  function eraseCell(app, x, y, layer) {
    const p = app.pattern;
    if (!p.inside(x, y)) return;
    if (layer === 'all' || layer === 'stitches') p.clearCell(x, y);
    if (layer === 'all' || layer === 'marks') p.setMark(y * p.w + x, 0);
    if (layer === 'all' || layer === 'knots') {
      p.removePointsIn('knots', x * 2, y * 2, x * 2 + 2, y * 2 + 2);
      p.removePointsIn('beads', x * 2, y * 2, x * 2 + 2, y * 2 + 2);
    }
    if (layer === 'all' || layer === 'back') p.removeLinesNear(x * 2 + 1, y * 2 + 1, 1.05);
  }

  /** Paint (or erase) one cell, applying mirror drawing. */
  function paintCell(app, x, y, mask, how) {
    const p = app.pattern;
    for (const t of symTargets(app, x, y)) {
      if (how.erase) eraseCell(app, t[0], t[1], how.layer || 'all');
      else if (how.mark != null) { if (p.inside(t[0], t[1])) p.setMark(t[1] * p.w + t[0], how.mark); }
      else p.applyStitch(t[0], t[1], xformMask(mask, t[2]), app.state.color + 1, how.overwrite, how.cross);
    }
  }
  function stampBrush(app, x, y, mask, how) {
    for (const o of brushOffsets(app.state.brushSize, app.state.brushShape)) paintCell(app, x + o[0], y + o[1], mask, how);
  }

  function drawCellsOverlay(app, ctx, g, cells, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (const c of cells) {
      if (!app.pattern.inside(c[0], c[1])) continue;
      const xy = Geo.cellXY(g, c[0], c[1]);
      ctx.fillRect(xy[0], xy[1], g.cw, g.ch);
    }
    ctx.restore();
  }
  function brushOverlay(app, ctx, g, cell, erase) {
    if (!cell) return;
    const cells = [];
    for (const o of brushOffsets(app.state.brushSize, app.state.brushShape))
      for (const t of symTargets(app, cell.x + o[0], cell.y + o[1])) cells.push(t);
    drawCellsOverlay(app, ctx, g, cells, erase ? '#ffffff' : app.colorHex(), erase ? 0.6 : 0.45);
    ctx.save();
    ctx.strokeStyle = '#000'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
    const xy = Geo.cellXY(g, cell.x, cell.y);
    const c = Math.floor((app.state.brushSize - 1) / 2);
    ctx.strokeRect(xy[0] - c * g.cw + 0.5, xy[1] - c * g.ch + 0.5, app.state.brushSize * g.cw, app.state.brushSize * g.ch);
    ctx.restore();
  }

  // ---------- Pencil / Eraser / Stamp ----------
  function strokeTool(kind) {
    return {
      down(app, pt) {
        if (kind === 'pencil' && pt.alt) return T.eyedropper.down(app, pt);
        const right = pt.button === 2;
        if (kind !== 'eraser' && !right && !app.ensureColor()) return;
        app.begin(kind === 'eraser' || right ? 'Erase' : kind === 'stamp' ? 'Symbols' : 'Draw');
        if (kind === 'eraser') this.how = { erase: true, layer: app.state.eraserLayer };
        else if (kind === 'stamp') this.how = right ? { mark: 0 } : { mark: app.state.mark };
        else this.how = right ? { erase: true, layer: 'stitches' } : paintHow(app);
        this.mask = maskFor(app, pt.cell);
        this.last = null;
        this.paint(app, pt.cell);
      },
      paint(app, c) {
        const pts = this.last ? U.lineCells(this.last.x, this.last.y, c.x, c.y) : [[c.x, c.y]];
        for (const q of pts) stampBrush(app, q[0], q[1], this.mask, this.how);
        this.last = { x: c.x, y: c.y };
        app.changed();
      },
      move(app, pt) { if (pt.pressed && this.how) this.paint(app, pt.cell); },
      up(app) { if (this.how) app.commit(); this.how = null; },
      overlay(app, ctx, g) { brushOverlay(app, ctx, g, app.hoverCell, kind === 'eraser'); }
    };
  }
  T.pencil = strokeTool('pencil');
  T.eraser = strokeTool('eraser');
  T.stamp = strokeTool('stamp');

  // ---------- Fill ----------
  T.fill = {
    down(app, pt) {
      const p = app.pattern, c = pt.cell;
      if (!p.inside(c.x, c.y)) return;
      const erase = pt.button === 2;
      if (!erase && !app.ensureColor()) return;
      const st = app.stitchType();
      const mask = erase ? 15 : st === 'half' ? (app.state.halfDir === '/' ? SP.MASK.halfF : SP.MASK.halfB) : 15;
      const val = erase ? 0 : app.state.color + 1;
      const cross = !erase && st === 'cross' ? 1 : 0;
      const L = p.legs, X = p.xs, s0 = (c.y * p.w + c.x) * 4;
      const t = [L[s0], L[s0 + 1], L[s0 + 2], L[s0 + 3]], tx = X[c.y * p.w + c.x];
      const res = [0, 1, 2, 3].map(q => (mask & (1 << q)) ? val : 0);
      if (t.every((v, i) => v === res[i]) && tx === cross) return;
      const match = i => L[i * 4] === t[0] && L[i * 4 + 1] === t[1] && L[i * 4 + 2] === t[2] && L[i * 4 + 3] === t[3] && X[i] === tx;
      app.begin('Fill');
      const n = p.w * p.h;
      if (app.state.fillMode === 'global') {
        const todo = [];
        for (let i = 0; i < n; i++) if (match(i)) todo.push(i);
        for (const i of todo) p.applyStitch(i % p.w, (i / p.w) | 0, mask, val, true, cross);
      } else {
        const seen = new Uint8Array(n), stack = new Int32Array(n);
        let sp = 0;
        stack[sp++] = c.y * p.w + c.x; seen[c.y * p.w + c.x] = 1;
        while (sp) {
          const i = stack[--sp];
          const x = i % p.w, y = (i / p.w) | 0;
          p.applyStitch(x, y, mask, val, true, cross);
          const nb = [x > 0 ? i - 1 : -1, x < p.w - 1 ? i + 1 : -1, y > 0 ? i - p.w : -1, y < p.h - 1 ? i + p.w : -1];
          for (const j of nb) if (j >= 0 && !seen[j] && match(j)) { seen[j] = 1; stack[sp++] = j; }
        }
      }
      app.commit();
      app.changed();
    },
    move() {}, up() {},
    overlay(app, ctx, g) { if (app.hoverCell) drawCellsOverlay(app, ctx, g, [[app.hoverCell.x, app.hoverCell.y]], app.colorHex(), 0.5); }
  };

  // ---------- Shapes ----------
  function shapeCells(kind, a, b, filled, app) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    let cells = [];
    if (kind === 'line') cells = U.lineCells(a.x, a.y, b.x, b.y);
    else if (kind === 'rect') {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
        if (filled || x === x0 || x === x1 || y === y0 || y === y1) cells.push([x, y]);
    } else {
      const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
      const inside = (x, y) => {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        return dx * dx + dy * dy <= 1.0001;
      };
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) cells.push([x, y]);
      }
    }
    if (!filled || kind === 'line') {
      const size = app.state.brushSize;
      if (size > 1) {
        const set = new Map();
        const offs = brushOffsets(size, app.state.brushShape);
        for (const c of cells) for (const o of offs) set.set((c[0] + o[0]) + ',' + (c[1] + o[1]), [c[0] + o[0], c[1] + o[1]]);
        cells = Array.from(set.values());
      }
    }
    return cells;
  }
  function constrain(kind, a, c, shift) {
    if (!shift) return { x: c.x, y: c.y };
    let dx = c.x - a.x, dy = c.y - a.y;
    if (kind === 'line') {
      if (Math.abs(dx) > 2 * Math.abs(dy)) dy = 0;
      else if (Math.abs(dy) > 2 * Math.abs(dx)) dx = 0;
      else { const d = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx) * d; dy = Math.sign(dy) * d; }
    } else {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (Math.sign(dx) || 1) * d; dy = (Math.sign(dy) || 1) * d;
    }
    return { x: a.x + dx, y: a.y + dy };
  }
  function shapeTool(kind) {
    return {
      down(app, pt) {
        this.erase = pt.button === 2;
        if (!this.erase && !app.ensureColor()) return;
        this.a = { x: pt.cell.x, y: pt.cell.y };
        this.b = this.a;
        this.mask = maskFor(app, pt.cell);
        this.cells = shapeCells(kind, this.a, this.b, app.state.shapeFilled, app);
      },
      move(app, pt) {
        if (!this.a || !pt.pressed) return;
        this.b = constrain(kind, this.a, pt.cell, pt.shift);
        this.cells = shapeCells(kind, this.a, this.b, app.state.shapeFilled, app);
        app.render();
      },
      up(app) {
        if (!this.a) return;
        app.begin(kind === 'line' ? 'Line' : kind === 'rect' ? 'Rectangle' : 'Ellipse');
        const how = this.erase ? { erase: true, layer: 'stitches' } : paintHow(app);
        for (const c of this.cells) paintCell(app, c[0], c[1], this.mask, how);
        app.commit();
        this.a = null; this.cells = null;
        app.changed();
      },
      cancel() { this.a = null; this.cells = null; },
      overlay(app, ctx, g) {
        if (this.cells) {
          const all = [];
          for (const c of this.cells) for (const t of symTargets(app, c[0], c[1])) all.push(t);
          drawCellsOverlay(app, ctx, g, all, this.erase ? '#ffffff' : app.colorHex(), 0.7);
        } else if (app.hoverCell) brushOverlay(app, ctx, g, app.hoverCell, false);
      }
    };
  }
  T.line = shapeTool('line');
  T.rect = shapeTool('rect');
  T.ellipse = shapeTool('ellipse');

  // ---------- Colour picker ----------
  T.eyedropper = {
    down(app, pt) {
      const p = app.pattern, c = pt.cell;
      let v = p.cellColor(c.x, c.y) - 1;
      if (v < 0) {
        const hx = (pt.sx - app.geo.ox) / (app.geo.cw / 2), hy = (pt.sy - app.geo.oy) / (app.geo.ch / 2);
        const li = p.nearestLine(hx, hy, 1);
        if (li >= 0) v = p.lines[li].c;
        const k = p.knots.concat(p.beads).find(k => Math.abs(k.x - hx) <= 0.8 && Math.abs(k.y - hy) <= 0.8);
        if (k) v = k.c;
      }
      if (v >= 0) {
        app.setColor(v);
        if (app.state.tool === 'eyedropper' && app.prevTool) app.setTool(app.prevTool);
      }
    },
    move() {}, up() {}
  };

  // ---------- Select / move ----------
  const inRect = (c, r) => c.x >= r.x && c.y >= r.y && c.x < r.x + r.w && c.y < r.y + r.h;
  T.select = {
    down(app, pt) {
      const c = pt.cell, f = app.floating;
      if (f) {
        if (inRect(c, { x: f.x, y: f.y, w: f.clip.w, h: f.clip.h })) { this.drag = { sx: c.x, sy: c.y, fx: f.x, fy: f.y }; return; }
        app.commitFloat();
      }
      const s = app.selection;
      if (s && inRect(c, s) && !pt.shift) {
        app.liftSelection();
        const f2 = app.floating;
        this.drag = { sx: c.x, sy: c.y, fx: f2.x, fy: f2.y };
        return;
      }
      const p = app.pattern;
      this.anchor = { x: U.clamp(c.x, 0, p.w - 1), y: U.clamp(c.y, 0, p.h - 1) };
      app.selection = { x: this.anchor.x, y: this.anchor.y, w: 1, h: 1 };
      app.render();
    },
    move(app, pt) {
      const c = pt.cell;
      if (pt.pressed && this.drag && app.floating) {
        app.floating.x = this.drag.fx + c.x - this.drag.sx;
        app.floating.y = this.drag.fy + c.y - this.drag.sy;
        app.render();
      } else if (pt.pressed && this.anchor) {
        const p = app.pattern;
        const x = U.clamp(c.x, 0, p.w - 1), y = U.clamp(c.y, 0, p.h - 1);
        app.selection = { x: Math.min(x, this.anchor.x), y: Math.min(y, this.anchor.y), w: Math.abs(x - this.anchor.x) + 1, h: Math.abs(y - this.anchor.y) + 1 };
        app.render();
      }
      const f = app.floating, s = app.selection;
      app.setCursor((f && inRect(c, { x: f.x, y: f.y, w: f.clip.w, h: f.clip.h })) || (s && inRect(c, s)) ? 'move' : 'crosshair');
    },
    up(app) { this.drag = null; this.anchor = null; app.updateSelectionInfo(); },
    overlay(app, ctx, g) {
      const f = app.floating;
      if (f) {
        SP.Renderer.drawClip(ctx, app.pattern, f.clip, g, f.x, f.y, Object.assign(app.renderOpts(), { alpha: 0.9 }));
        dashedRect(ctx, g, f.x, f.y, f.clip.w, f.clip.h, '#1565c0');
      }
      const s = app.selection;
      if (s) dashedRect(ctx, g, s.x, s.y, s.w, s.h, '#000');
    }
  };
  function dashedRect(ctx, g, x, y, w, h, color) {
    const X = Math.round(g.ox + x * g.cw) + 0.5, Y = Math.round(g.oy + y * g.ch) + 0.5;
    const W = Math.round(w * g.cw), H = Math.round(h * g.ch);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff'; ctx.strokeRect(X, Y, W, H);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = color; ctx.strokeRect(X, Y, W, H);
    ctx.restore();
  }

  // ---------- Text ----------
  T.text = {
    clipFor(app) {
      const st = app.state;
      const key = [st.text, st.textScale, st.textSpacing, st.textBold, st.color, app.stitchType(), st.halfDir].join('|');
      if (this._key === key) return this._clip;
      const r = SP.textCells(st.text, st.textScale, st.textSpacing, st.textBold);
      const clip = { w: r.w, h: r.h, legs: new Uint16Array(r.w * r.h * 4), marks: new Uint8Array(r.w * r.h), xs: new Uint8Array(r.w * r.h), lines: [], knots: [], beads: [] };
      const st2 = app.stitchType();
      const mask = st2 === 'half' ? (st.halfDir === '/' ? SP.MASK.halfF : SP.MASK.halfB) : 15;
      for (const c of r.cells) {
        const ci = c[1] * r.w + c[0], i = ci * 4;
        for (let q = 0; q < 4; q++) if (mask & (1 << q)) clip.legs[i + q] = st.color + 1;
        if (st2 === 'cross') clip.xs[ci] = 1;
      }
      this._key = key; this._clip = clip;
      return clip;
    },
    down(app, pt) {
      if (pt.button === 2 || !app.ensureColor() || !app.state.text) return;
      const clip = this.clipFor(app);
      app.begin('Text');
      app.pattern.stamp(clip, pt.cell.x, pt.cell.y);
      app.commit();
      app.changed();
    },
    move() {}, up() {},
    overlay(app, ctx, g) {
      if (!app.hoverCell || !app.state.text || !app.pattern.palette.length) return;
      const clip = this.clipFor(app);
      SP.Renderer.drawClip(ctx, app.pattern, clip, g, app.hoverCell.x, app.hoverCell.y, Object.assign(app.renderOpts(), { alpha: 0.6 }));
      dashedRect(ctx, g, app.hoverCell.x, app.hoverCell.y, clip.w, clip.h, '#1565c0');
    }
  };

  // ---------- Backstitch / knots / beads ----------
  function hoverDot(ctx, g, h, color) {
    if (!h) return;
    const p = Geo.halfXY(g, h.x, h.y);
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(3, g.cw * 0.15), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  T.backstitch = {
    down(app, pt) {
      if (pt.button === 2) {
        const hx = (pt.sx - app.geo.ox) / (app.geo.cw / 2), hy = (pt.sy - app.geo.oy) / (app.geo.ch / 2);
        const i = app.pattern.nearestLine(hx, hy, 1.5);
        if (i >= 0) {
          app.begin('Remove backstitch');
          app.pattern.touch(); app.pattern.lines.splice(i, 1);
          app.commit(); app.changed();
        }
        return;
      }
      if (!app.ensureColor()) return;
      this.a = pt.half; this.b = pt.half;
    },
    move(app, pt) {
      if (this.a && pt.pressed) { this.b = pt.half; app.render(); }
    },
    up(app) {
      if (!this.a) return;
      const a = this.a, b = this.b;
      this.a = null;
      if (a.x === b.x && a.y === b.y) { app.render(); return; }
      app.begin('Backstitch');
      const A = symHalf(app, a.x, a.y), B = symHalf(app, b.x, b.y);
      for (let i = 0; i < A.length; i++) app.pattern.addLine(A[i][0], A[i][1], B[i][0], B[i][1], app.state.color);
      app.commit(); app.changed();
    },
    cancel() { this.a = null; },
    overlay(app, ctx, g) {
      if (this.a) {
        const A = symHalf(app, this.a.x, this.a.y), B = symHalf(app, this.b.x, this.b.y);
        ctx.save();
        ctx.strokeStyle = app.colorHex(); ctx.lineCap = 'round'; ctx.globalAlpha = 0.8;
        ctx.lineWidth = Math.max(2, g.cw * 0.16);
        for (let i = 0; i < A.length; i++) {
          const p = Geo.halfXY(g, A[i][0], A[i][1]), q = Geo.halfXY(g, B[i][0], B[i][1]);
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        ctx.restore();
      }
      hoverDot(ctx, g, app.hoverHalf, app.colorHex());
    }
  };
  function pointTool(list, snapCenter) {
    const pos = (app, pt) => snapCenter ? { x: pt.cell.x * 2 + 1, y: pt.cell.y * 2 + 1 } : pt.half;
    return {
      down(app, pt) {
        const h = pos(app, pt);
        if (!app.pattern.inside(Math.min(h.x >> 1, app.pattern.w - 1), Math.min(h.y >> 1, app.pattern.h - 1))) return;
        if (pt.button === 2) {
          app.begin('Remove');
          for (const s of symHalf(app, h.x, h.y)) app.pattern.removePointsIn(list, s[0] - 1, s[1] - 1, s[0] + 1, s[1] + 1);
          app.commit(); app.changed();
          return;
        }
        if (!app.ensureColor()) return;
        app.begin(list === 'knots' ? 'French knot' : 'Bead');
        for (const s of symHalf(app, h.x, h.y)) app.pattern.addPoint(list, s[0], s[1], app.state.color);
        app.commit(); app.changed();
      },
      move() {}, up() {},
      overlay(app, ctx, g) {
        if (!app.hoverCell) return;
        const h = snapCenter ? { x: app.hoverCell.x * 2 + 1, y: app.hoverCell.y * 2 + 1 } : app.hoverHalf;
        if (!h) return;
        for (const s of symHalf(app, h.x, h.y)) hoverDot(ctx, g, { x: s[0], y: s[1] }, app.colorHex());
      }
    };
  }
  T.knot = pointTool('knots', false);
  T.bead = pointTool('beads', true);

  // ---------- Pan ----------
  T.pan = {
    down(app, pt) { app.startPan(pt); },
    move(app, pt) { if (pt.pressed) app.movePan(pt); },
    up(app) { app.endPan(); }
  };
})(window.SP);
