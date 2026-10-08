/* Geometry (screen <-> cells) and canvas rendering of a pattern. */
(function (SP) {
  const U = SP.util;

  // ===================== Geometry =====================
  const Geo = SP.Geo = {
    make(p, view) {
      const s = p.settings;
      return {
        ox: view.ox, oy: view.oy, cw: view.cw, ch: view.cw * SP.aspectOf(s),
        layout: SP.layoutOf(s), w: p.w, h: p.h
      };
    },
    cellXY(g, x, y) {
      let px = g.ox + x * g.cw, py = g.oy + y * g.ch;
      if (g.layout === 'brick' && (y & 1)) px += g.cw / 2;
      else if (g.layout === 'peyote' && (x & 1)) py += g.ch / 2;
      return [px, py];
    },
    /** Screen point to cell, plus fractional position inside the cell. */
    pointToCell(g, sx, sy) {
      let x, y, fx, fy;
      if (g.layout === 'brick') {
        const ry = (sy - g.oy) / g.ch; y = Math.floor(ry);
        const rx = (sx - g.ox - ((y & 1) ? g.cw / 2 : 0)) / g.cw; x = Math.floor(rx);
        fx = rx - x; fy = ry - y;
      } else if (g.layout === 'peyote') {
        const rx = (sx - g.ox) / g.cw; x = Math.floor(rx);
        const ry = (sy - g.oy - ((x & 1) ? g.ch / 2 : 0)) / g.ch; y = Math.floor(ry);
        fx = rx - x; fy = ry - y;
      } else {
        const rx = (sx - g.ox) / g.cw, ry = (sy - g.oy) / g.ch;
        x = Math.floor(rx); y = Math.floor(ry); fx = rx - x; fy = ry - y;
      }
      return { x, y, fx, fy };
    },
    pointToHalf(g, sx, sy, snap) {
      let hx = (sx - g.ox) / (g.cw / 2), hy = (sy - g.oy) / (g.ch / 2);
      if (snap === 'corner') { hx = Math.round(hx / 2) * 2; hy = Math.round(hy / 2) * 2; }
      else { hx = Math.round(hx); hy = Math.round(hy); }
      return { x: U.clamp(hx, 0, g.w * 2), y: U.clamp(hy, 0, g.h * 2) };
    },
    halfXY(g, hx, hy) { return [g.ox + hx * g.cw / 2, g.oy + hy * g.ch / 2]; },
    size(g) {
      return [g.w * g.cw + (g.layout === 'brick' ? g.cw / 2 : 0), g.h * g.ch + (g.layout === 'peyote' ? g.ch / 2 : 0)];
    }
  };

  // ===================== Renderer =====================
  const R = SP.Renderer = {};
  const bmCache = new WeakMap();

  /** 1 pixel per cell bitmap of the full stitches (fast drawing when zoomed out). */
  function fullBitmap(p) {
    let c = bmCache.get(p);
    const key = p.version + ':' + p.w + 'x' + p.h;
    if (c && c.key === key) return c.canvas;
    if (!c) { c = { canvas: document.createElement('canvas') }; bmCache.set(p, c); }
    c.canvas.width = p.w; c.canvas.height = p.h;
    const cx = c.canvas.getContext('2d');
    const img = cx.createImageData(p.w, p.h);
    const D = img.data, L = p.legs, X = p.xs;
    const rgb = p.palette.map(e => U.hexToRgb(e.hex));
    for (let i = 0, n = p.w * p.h; i < n; i++) {
      const v = L[i * 4];
      if (v && v === L[i * 4 + 1] && v === L[i * 4 + 2] && v === L[i * 4 + 3] && !(X && X[i])) {
        const col = rgb[v - 1]; if (!col) continue;
        D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    c.key = key;
    return c.canvas;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  R.roundRect = roundRect;

  function threadStroke(ctx, x1, y1, x2, y2, lw, col, dark, light) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = dark; ctx.lineWidth = lw; ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = lw * 0.72; ctx.stroke();
    ctx.strokeStyle = light; ctx.lineWidth = lw * 0.22; ctx.stroke();
  }

  /**
   * Draw a pattern.
   * o: { width, height, mode, grid, major, center, rulers, back, knots, marks, highlight,
   *      bg, noFabric, noBitmap, range:{x0,y0,x1,y1}, rulerSize, alpha }
   */
  R.render = function (ctx, p, g, o) {
    const s = p.settings;
    const craft = s.craft;
    const W = p.w, L = p.legs, M = p.marks, XS = p.xs;
    const pal = p.palette;
    const cols = pal.map(e => e.hex);
    const darks = cols.map(c => U.shade(c, -0.35));
    const lights = cols.map(c => U.shade(c, 0.45));
    const contrast = cols.map(c => U.contrastColor(c));
    const mode = o.mode || 'blocks';
    const small = g.cw < 7 || g.ch < 6;
    const hl = o.highlight == null ? -1 : o.highlight;
    const style = craft === 'diamond' ? 'drill' : craft === 'bead' ? 'bead' : 'square';

    let x0 = 0, y0 = 0, x1 = p.w, y1 = p.h;
    if (o.range) { x0 = o.range.x0; y0 = o.range.y0; x1 = o.range.x1; y1 = o.range.y1; }
    const vx0 = Math.max(x0, Math.floor(-g.ox / g.cw) - 1), vx1 = Math.min(x1, Math.ceil((o.width - g.ox) / g.cw) + 1);
    const vy0 = Math.max(y0, Math.floor(-g.oy / g.ch) - 1), vy1 = Math.min(y1, Math.ceil((o.height - g.oy) / g.ch) + 1);

    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, o.width, o.height); }

    // Pattern area
    const px0 = g.ox + x0 * g.cw, py0 = g.oy + y0 * g.ch;
    const PW = (x1 - x0) * g.cw + (g.layout === 'brick' ? g.cw / 2 : 0);
    const PH = (y1 - y0) * g.ch + (g.layout === 'peyote' ? g.ch / 2 : 0);
    if (!o.noFabric) {
      ctx.fillStyle = mode === 'symbols' ? '#ffffff' : s.fabricColor;
      ctx.fillRect(px0, py0, PW, PH);
      if (mode === 'realistic' && style === 'square' && craft === 'cross' && g.cw >= 8) {
        // fabric holes
        ctx.fillStyle = U.shade(s.fabricColor, -0.18);
        const r = Math.max(0.8, g.cw * 0.07);
        for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
          ctx.fillRect(g.ox + x * g.cw - r, g.oy + y * g.ch - r, r * 2, r * 2);
        }
      }
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0, PW, PH); ctx.clip();

    // Fast path: bitmap of full stitches
    let usedBitmap = false;
    if (!o.noBitmap && g.layout === 'grid' && style === 'square' && hl < 0 &&
        (mode === 'blocks' || mode === 'colorsymbols' || small)) {
      const bm = fullBitmap(p);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bm, x0, y0, x1 - x0, y1 - y0, px0, py0, (x1 - x0) * g.cw, (y1 - y0) * g.ch);
      usedBitmap = true;
    }

    const minS = Math.min(g.cw, g.ch);
    const symSize = Math.max(6, Math.floor(minS * 0.74));
    const symFont = `${symSize}px "Segoe UI Symbol", "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = symFont;

    const drawSymbol = (ci, cx, cy, color, size) => {
      if (size) ctx.font = `${size}px "Segoe UI Symbol", "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(pal[ci] ? pal[ci].symbol : '?', cx, cy + minS * 0.03);
      if (size) ctx.font = symFont;
    };

    const fillShape = (ci, px, py) => {
      const col = cols[ci];
      if (style === 'drill') {
        if (s.drillShape === 'square') {
          ctx.fillStyle = col; ctx.fillRect(px + g.cw * 0.05, py + g.ch * 0.05, g.cw * 0.9, g.ch * 0.9);
          if (!small) {
            ctx.fillStyle = lights[ci]; ctx.globalAlpha *= 0.6;
            ctx.beginPath(); ctx.moveTo(px + g.cw * 0.05, py + g.ch * 0.05); ctx.lineTo(px + g.cw * 0.95, py + g.ch * 0.05); ctx.lineTo(px + g.cw * 0.5, py + g.ch * 0.5); ctx.fill();
            ctx.globalAlpha /= 0.6;
          }
        } else {
          ctx.fillStyle = col; ctx.beginPath();
          ctx.arc(px + g.cw / 2, py + g.ch / 2, minS * 0.46, 0, Math.PI * 2); ctx.fill();
          if (!small) {
            ctx.strokeStyle = darks[ci]; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath();
            ctx.arc(px + g.cw * 0.38, py + g.ch * 0.36, minS * 0.12, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (style === 'bead') {
        ctx.fillStyle = col;
        roundRect(ctx, px + g.cw * 0.06, py + g.ch * 0.06, g.cw * 0.88, g.ch * 0.88, minS * 0.3); ctx.fill();
        if (!small) {
          ctx.strokeStyle = darks[ci]; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.4)';
          ctx.fillRect(px + g.cw * 0.25, py + g.ch * 0.2, g.cw * 0.5, g.ch * 0.14);
        }
      } else {
        ctx.fillStyle = col; ctx.fillRect(px, py, g.cw + 0.5, g.ch + 0.5);
      }
    };

    const fabricContrast = U.contrastColor(s.fabricColor);
    const drawFull = (ci, px, py, isX) => {
      if (mode === 'symbols' && !small) {
        drawSymbol(ci, px + g.cw / 2, py + g.ch / 2, '#000');
        return;
      }
      if (isX && !(mode === 'realistic' && !small && style === 'square')) {
        // "cross" stitch type: an X in the thread colour instead of a filled square
        const i = small ? 0.08 : 0.16;
        ctx.lineCap = small ? 'butt' : 'round';
        ctx.strokeStyle = cols[ci];
        ctx.lineWidth = Math.max(1, minS * (small ? 0.3 : 0.2));
        ctx.beginPath();
        ctx.moveTo(px + g.cw * i, py + g.ch * i); ctx.lineTo(px + g.cw * (1 - i), py + g.ch * (1 - i));
        ctx.moveTo(px + g.cw * (1 - i), py + g.ch * i); ctx.lineTo(px + g.cw * i, py + g.ch * (1 - i));
        ctx.stroke();
        if (mode === 'colorsymbols' && !small) drawSymbol(ci, px + g.cw / 2, py + g.ch / 2, fabricContrast, Math.max(6, Math.floor(minS * 0.5)));
        return;
      }
      if (mode === 'realistic' && !small && style === 'square') {
        if (craft === 'knit') {
          ctx.fillStyle = darks[ci]; ctx.fillRect(px, py, g.cw + 0.5, g.ch + 0.5);
          const lw = g.cw * 0.42;
          ctx.lineCap = 'round';
          threadStroke(ctx, px + g.cw * 0.22, py + g.ch * 0.12, px + g.cw * 0.5, py + g.ch * 0.85, lw, cols[ci], darks[ci], lights[ci]);
          threadStroke(ctx, px + g.cw * 0.78, py + g.ch * 0.12, px + g.cw * 0.5, py + g.ch * 0.85, lw, cols[ci], darks[ci], lights[ci]);
        } else if (craft === 'crochet') {
          ctx.fillStyle = cols[ci]; roundRect(ctx, px + 0.5, py + 0.5, g.cw - 1, g.ch - 1, minS * 0.25); ctx.fill();
          ctx.strokeStyle = darks[ci]; ctx.lineWidth = Math.max(1, minS * 0.08); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px + g.cw * 0.5, py + g.ch * 0.15); ctx.lineTo(px + g.cw * 0.5, py + g.ch * 0.85); ctx.stroke();
        } else {
          const i = 0.12, lw = minS * 0.3;
          ctx.lineCap = 'round';
          threadStroke(ctx, px + g.cw * i, py + g.ch * (1 - i), px + g.cw * (1 - i), py + g.ch * i, lw, cols[ci], darks[ci], lights[ci]);
          threadStroke(ctx, px + g.cw * i, py + g.ch * i, px + g.cw * (1 - i), py + g.ch * (1 - i), lw, cols[ci], darks[ci], lights[ci]);
        }
        return;
      }
      if (!usedBitmap || style !== 'square') fillShape(ci, px, py);
      if (mode === 'colorsymbols' && !small) drawSymbol(ci, px + g.cw / 2, py + g.ch / 2, contrast[ci]);
    };

    const CORN = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const drawLeg = (q, ci, px, py) => {
      const cx = px + g.cw / 2, cy = py + g.ch / 2;
      if (mode === 'symbols' && !small) {
        const qx = px + g.cw * (CORN[q][0] ? 0.74 : 0.26), qy = py + g.ch * (CORN[q][1] ? 0.74 : 0.26);
        drawSymbol(ci, qx, qy, '#000', Math.max(5, Math.floor(minS * 0.42)));
        return;
      }
      const kx = px + g.cw * CORN[q][0], ky = py + g.ch * CORN[q][1];
      ctx.save();
      ctx.beginPath(); ctx.rect(px, py, g.cw, g.ch); ctx.clip();
      if (mode === 'realistic' && !small) {
        ctx.lineCap = 'round';
        const ix = kx + (cx - kx) * 0.24, iy = ky + (cy - ky) * 0.24;
        threadStroke(ctx, ix, iy, cx + (cx - kx) * 0.05, cy + (cy - ky) * 0.05, minS * 0.3, cols[ci], darks[ci], lights[ci]);
      } else {
        ctx.lineCap = 'butt';
        ctx.strokeStyle = cols[ci]; ctx.lineWidth = minS * 0.42;
        ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(cx, cy); ctx.stroke();
      }
      ctx.restore();
    };

    /** Symbols chart: thin grey legs plus one symbol per colour, placed on its legs. */
    const drawPartialSymbols = (b, px, py) => {
      const cx = px + g.cw / 2, cy = py + g.ch / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(px, py, g.cw, g.ch); ctx.clip();
      ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(1, minS * 0.1);
      const groups = new Map();
      for (let q = 0; q < 4; q++) {
        const v = L[b + q];
        if (!v) continue;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(q);
        ctx.globalAlpha = hl >= 0 && v - 1 !== hl ? dim : 1;
        ctx.strokeStyle = '#a8a39e';
        ctx.beginPath(); ctx.moveTo(px + g.cw * CORN[q][0], py + g.ch * CORN[q][1]); ctx.lineTo(cx, cy); ctx.stroke();
      }
      const size = Math.max(6, Math.floor(minS * (groups.size > 1 ? 0.45 : 0.56)));
      groups.forEach((qs, v) => {
        let sx = 0, sy = 0;
        for (const q of qs) { sx += CORN[q][0] ? 0.72 : 0.28; sy += CORN[q][1] ? 0.72 : 0.28; }
        ctx.globalAlpha = hl >= 0 && v - 1 !== hl ? dim : 1;
        // keep the symbol off the centre when one colour covers opposite legs and another colour shares the cell
        let fx = sx / qs.length, fy = sy / qs.length;
        if (groups.size > 1 && Math.abs(fx - 0.5) < 0.01 && Math.abs(fy - 0.5) < 0.01) { fx = CORN[qs[0]][0] ? 0.72 : 0.28; fy = CORN[qs[0]][1] ? 0.72 : 0.28; }
        drawSymbol(v - 1, px + g.cw * fx, py + g.ch * fy, '#000', size);
      });
      ctx.restore();
    };

    const dim = 0.16;
    for (let y = vy0; y < vy1; y++) {
      for (let x = vx0; x < vx1; x++) {
        const ci = y * W + x, b = ci * 4;
        const a = L[b], b1 = L[b + 1], c = L[b + 2], d = L[b + 3];
        const mk = o.marks ? M[ci] : 0;
        if (!(a | b1 | c | d) && !mk) continue;
        const xy = Geo.cellXY(g, x, y), px = xy[0], py = xy[1];
        if (a | b1 | c | d) {
          if (a && a === b1 && a === c && a === d) {
            if (hl >= 0 && a - 1 !== hl) ctx.globalAlpha = dim;
            drawFull(a - 1, px, py, XS && XS[ci]);
            ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
          } else if (mode === 'symbols' && !small) {
            drawPartialSymbols(b, px, py);
          } else {
            for (let q = 0; q < 4; q++) {
              const v = L[b + q];
              if (!v) continue;
              if (hl >= 0 && v - 1 !== hl) ctx.globalAlpha = dim;
              drawLeg(q, v - 1, px, py);
              ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
            }
          }
        }
        if (mk && minS >= 6) {
          const v = a || b1 || c || d;
          const mc = v && mode !== 'symbols' ? contrast[v - 1] : '#222';
          SP.drawMark(ctx, mk, px, py, g.cw, g.ch, mc);
        }
      }
    }

    // Grid
    const N = Math.max(2, s.majorEvery | 0);
    const top = Math.max(py0, 0), bot = Math.min(py0 + PH, o.height);
    const left = Math.max(px0, 0), right = Math.min(px0 + PW, o.width);
    if (g.layout === 'grid') {
      if (o.grid && minS >= 4) {
        ctx.beginPath();
        for (let x = vx0; x <= vx1; x++) {
          if (o.major && x % N === 0) continue;
          const X = Math.round(g.ox + x * g.cw) + 0.5;
          ctx.moveTo(X, top); ctx.lineTo(X, bot);
        }
        for (let y = vy0; y <= vy1; y++) {
          if (o.major && y % N === 0) continue;
          const Y = Math.round(g.oy + y * g.ch) + 0.5;
          ctx.moveTo(left, Y); ctx.lineTo(right, Y);
        }
        ctx.strokeStyle = s.gridColor; ctx.lineWidth = 1; ctx.stroke();
      }
      if (o.major && minS >= 1.5) {
        ctx.beginPath();
        for (let x = Math.ceil(vx0 / N) * N; x <= vx1; x += N) {
          const X = Math.round(g.ox + x * g.cw) + 0.5;
          ctx.moveTo(X, top); ctx.lineTo(X, bot);
        }
        for (let y = Math.ceil(vy0 / N) * N; y <= vy1; y += N) {
          const Y = Math.round(g.oy + y * g.ch) + 0.5;
          ctx.moveTo(left, Y); ctx.lineTo(right, Y);
        }
        ctx.strokeStyle = s.majorColor; ctx.lineWidth = minS >= 10 ? 2 : 1; ctx.stroke();
      }
    } else if (o.grid && minS >= 5) {
      ctx.strokeStyle = s.gridColor; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
        const xy = Geo.cellXY(g, x, y);
        ctx.rect(Math.round(xy[0]) + 0.5, Math.round(xy[1]) + 0.5, Math.round(g.cw), Math.round(g.ch));
      }
      ctx.stroke();
    }

    // Centre lines
    if (o.center) {
      ctx.strokeStyle = s.centerColor || '#e0457b'; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      const cx = g.ox + (p.w / 2) * g.cw, cy = g.oy + (p.h / 2) * g.ch;
      ctx.moveTo(cx, top); ctx.lineTo(cx, bot); ctx.moveTo(left, cy); ctx.lineTo(right, cy);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Backstitches, knots, beads
    const vecAlpha = (c) => (hl >= 0 && c !== hl ? dim : (o.alpha != null ? o.alpha : 1));
    if (o.back !== false && p.lines.length) {
      ctx.lineCap = 'round';
      const lw = Math.max(1.5, minS * (mode === 'realistic' ? 0.2 : 0.16));
      for (const l of p.lines) {
        if (!cols[l.c]) continue;
        const a = Geo.halfXY(g, l.x1, l.y1), b = Geo.halfXY(g, l.x2, l.y2);
        ctx.globalAlpha = vecAlpha(l.c);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        if (mode === 'realistic' || minS >= 10) { ctx.strokeStyle = darks[l.c]; ctx.lineWidth = lw * 1.35; ctx.stroke(); }
        ctx.strokeStyle = mode === 'symbols' ? U.shade(cols[l.c], -0.2) : cols[l.c]; ctx.lineWidth = lw; ctx.stroke();
      }
    }
    if (o.knots !== false) {
      for (const k of p.knots) {
        if (!cols[k.c]) continue;
        const a = Geo.halfXY(g, k.x, k.y);
        ctx.globalAlpha = vecAlpha(k.c);
        ctx.beginPath(); ctx.arc(a[0], a[1], Math.max(2, minS * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = cols[k.c]; ctx.fill();
        ctx.strokeStyle = darks[k.c]; ctx.lineWidth = Math.max(1, minS * 0.05); ctx.stroke();
      }
      for (const k of p.beads) {
        if (!cols[k.c]) continue;
        const a = Geo.halfXY(g, k.x, k.y);
        ctx.globalAlpha = vecAlpha(k.c);
        ctx.beginPath(); ctx.ellipse(a[0], a[1], Math.max(2, g.cw * 0.34), Math.max(1.5, g.ch * 0.26), -0.6, 0, Math.PI * 2);
        ctx.fillStyle = cols[k.c]; ctx.fill();
        ctx.strokeStyle = darks[k.c]; ctx.lineWidth = Math.max(1, minS * 0.06); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(a[0] - g.cw * 0.1, a[1] - g.ch * 0.07, Math.max(0.8, minS * 0.07), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.restore(); // pattern clip

    if (!o.noFabric) {
      ctx.strokeStyle = s.majorColor; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(px0) + 0.5, Math.round(py0) + 0.5, Math.round(PW), Math.round(PH));
    }

    if (o.rulers) R.drawRulers(ctx, p, g, o, vx0, vx1, vy0, vy1, x0, y0, x1, y1);
    ctx.restore();
  };

  R.drawRulers = function (ctx, p, g, o, vx0, vx1, vy0, vy1, x0, y0, x1, y1) {
    const s = p.settings;
    const RS = o.rulerSize || 22;
    const N = Math.max(2, s.majorEvery | 0);
    ctx.save();
    ctx.fillStyle = o.rulerBg || '#efedea';
    ctx.fillRect(0, 0, o.width, RS); ctx.fillRect(0, 0, RS, o.height);
    ctx.strokeStyle = '#9a948e'; ctx.fillStyle = o.rulerText || '#4b4641'; ctx.lineWidth = 1;
    ctx.font = `${Math.min(11, RS * 0.5)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // clip so labels do not overlap the corner
    ctx.save(); ctx.beginPath(); ctx.rect(RS, 0, o.width - RS, RS); ctx.clip();
    ctx.beginPath();
    const labelEvery = N * g.cw >= 22 ? N : N * Math.ceil(22 / (N * g.cw));
    for (let x = Math.max(x0, vx0); x <= Math.min(x1, vx1); x++) {
      const X = Math.round(g.ox + x * g.cw) + 0.5;
      if (x % N === 0) { ctx.moveTo(X, RS - 7); ctx.lineTo(X, RS); }
      else if (g.cw >= 5) { ctx.moveTo(X, RS - 3); ctx.lineTo(X, RS); }
      if (x % labelEvery === 0 && x > 0 && X - RS > 8) ctx.fillText(String(x), X, RS * 0.4);
    }
    ctx.stroke();
    const cx = g.ox + (p.w / 2) * g.cw;
    ctx.fillStyle = s.centerColor || '#e0457b';
    ctx.beginPath(); ctx.moveTo(cx - 5, RS - 8); ctx.lineTo(cx + 5, RS - 8); ctx.lineTo(cx, RS); ctx.fill();
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(0, RS, RS, o.height - RS); ctx.clip();
    ctx.beginPath();
    const labelEveryY = N * g.ch >= 14 ? N : N * Math.ceil(14 / (N * g.ch));
    for (let y = Math.max(y0, vy0); y <= Math.min(y1, vy1); y++) {
      const Y = Math.round(g.oy + y * g.ch) + 0.5;
      if (y % N === 0) { ctx.moveTo(RS - 7, Y); ctx.lineTo(RS, Y); }
      else if (g.ch >= 5) { ctx.moveTo(RS - 3, Y); ctx.lineTo(RS, Y); }
      if (y % labelEveryY === 0 && y > 0 && Y - RS > 10) {
        ctx.save(); ctx.translate(RS * 0.4, Y); ctx.rotate(-Math.PI / 2); ctx.fillText(String(y), 0, 0); ctx.restore();
      }
    }
    ctx.stroke();
    const cy = g.oy + (p.h / 2) * g.ch;
    ctx.fillStyle = s.centerColor || '#e0457b';
    ctx.beginPath(); ctx.moveTo(RS - 8, cy - 5); ctx.lineTo(RS - 8, cy + 5); ctx.lineTo(RS, cy); ctx.fill();
    ctx.restore();

    ctx.fillStyle = o.rulerBg || '#efedea'; ctx.fillRect(0, 0, RS, RS);
    ctx.strokeStyle = '#9a948e';
    ctx.beginPath(); ctx.moveTo(0, RS + 0.5); ctx.lineTo(o.width, RS + 0.5); ctx.moveTo(RS + 0.5, 0); ctx.lineTo(RS + 0.5, o.height); ctx.stroke();
    ctx.restore();
  };

  /** Draw a clipboard fragment (floating paste / text preview) at cell (cx, cy). */
  R.drawClip = function (ctx, p, clip, g, cx, cy, o) {
    const tmp = { w: clip.w, h: clip.h, legs: clip.legs, marks: clip.marks, xs: clip.xs, lines: clip.lines, knots: clip.knots, beads: clip.beads,
      palette: p.palette, settings: p.settings, version: -1 };
    const g2 = Object.assign({}, g, { ox: g.ox + cx * g.cw, oy: g.oy + cy * g.ch, w: clip.w, h: clip.h });
    R.render(ctx, tmp, g2, Object.assign({}, o, { noFabric: true, noBitmap: true, rulers: false, grid: false, major: false, center: false, bg: null, range: null, highlight: -1 }));
  };
})(window.SP);
