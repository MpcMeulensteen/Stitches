/*
 * Pattern data model.
 *
 * Every cell has four "legs" (TL, TR, BL, BR): the half-diagonals from a
 * corner to the cell centre. A full cross uses all four, a half stitch "/"
 * uses TR+BL, "\" uses TL+BR, a quarter uses one and a three-quarter uses three.
 * Leg values are palette index + 1 (0 = empty).
 *
 * Backstitches, French knots and beads are vectors in half-cell units, so
 * (2x, 2y) is the top-left corner of cell (x, y) and (2x+1, 2y+1) its centre.
 */
(function (SP) {
  const U = SP.util;

  SP.MASK = { full: 15, halfF: 6, halfB: 9 }; // halfF = "/", halfB = "\"
  SP.flipMaskH = m => ((m & 1) << 1) | ((m & 2) >> 1) | ((m & 4) << 1) | ((m & 8) >> 1);
  SP.flipMaskV = m => ((m & 3) << 2) | ((m & 12) >> 2);
  SP.rotMaskCW = m => ((m & 1) ? 2 : 0) | ((m & 2) ? 8 : 0) | ((m & 8) ? 4 : 0) | ((m & 4) ? 1 : 0);

  class Pattern {
    constructor(w, h, settings) {
      this.id = null;
      this.name = 'Untitled pattern';
      this.w = w; this.h = h;
      this.legs = new Uint16Array(w * h * 4);
      this.marks = new Uint8Array(w * h);
      this.xs = new Uint8Array(w * h); // 1 = full stitch drawn as a cross (X) instead of a filled square
      this.lines = []; // {x1,y1,x2,y2,c}
      this.knots = []; // {x,y,c}
      this.beads = []; // {x,y,c}
      this.palette = []; // {brand, code, name, hex, symbol}
      this.settings = Object.assign(SP.defaultSettings(), settings || {});
      this.version = 0;
      this.tx = null; // active history transaction
    }

    inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

    // ---- low-level mutation (records into the active transaction) ----
    setLeg(i, v) {
      const o = this.legs[i];
      if (o === v) return;
      if (this.tx && !this.tx.legs.has(i)) this.tx.legs.set(i, o);
      this.legs[i] = v;
      this.version++;
    }
    setMark(i, v) {
      const o = this.marks[i];
      if (o === v) return;
      if (this.tx && !this.tx.marks.has(i)) this.tx.marks.set(i, o);
      this.marks[i] = v;
      this.version++;
    }
    setX(i, v) {
      const o = this.xs[i];
      if (o === v) return;
      if (this.tx && !this.tx.xs.has(i)) this.tx.xs.set(i, o);
      this.xs[i] = v;
      this.version++;
    }
    /** Call before changing palette, vectors, settings or name. */
    touch() {
      if (this.tx && !this.tx.lite && !this.tx.full) this.tx.lite = this.liteState();
      this.version++;
    }

    // ---- stitches ----
    /** cross = draw this full stitch as an X instead of a filled square. */
    applyStitch(x, y, mask, val, overwrite, cross) {
      if (!this.inside(x, y)) return;
      const i = y * this.w + x, b = i * 4;
      for (let q = 0; q < 4; q++) {
        if (mask & (1 << q)) this.setLeg(b + q, val);
        else if (overwrite) this.setLeg(b + q, 0);
      }
      this.setX(i, cross && val ? 1 : 0);
    }
    clearCell(x, y) {
      if (!this.inside(x, y)) return;
      const i = y * this.w + x, b = i * 4;
      for (let q = 0; q < 4; q++) this.setLeg(b + q, 0);
      this.setX(i, 0);
    }
    cellColor(x, y) {
      if (!this.inside(x, y)) return 0;
      const b = (y * this.w + x) * 4;
      return this.legs[b] || this.legs[b + 1] || this.legs[b + 2] || this.legs[b + 3];
    }
    sameCell(i, j) {
      const L = this.legs, a = i * 4, b = j * 4;
      return L[a] === L[b] && L[a + 1] === L[b + 1] && L[a + 2] === L[b + 2] && L[a + 3] === L[b + 3];
    }

    // ---- vectors ----
    addLine(x1, y1, x2, y2, c) {
      if (x1 === x2 && y1 === y2) return;
      const hw = this.w * 2, hh = this.h * 2;
      if ([x1, x2].some(v => v < 0 || v > hw) || [y1, y2].some(v => v < 0 || v > hh)) return;
      const dup = this.lines.find(l => ((l.x1 === x1 && l.y1 === y1 && l.x2 === x2 && l.y2 === y2) ||
        (l.x1 === x2 && l.y1 === y2 && l.x2 === x1 && l.y2 === y1)));
      this.touch();
      if (dup) { dup.c = c; return; }
      this.lines.push({ x1, y1, x2, y2, c });
    }
    addPoint(list, x, y, c) {
      if (x < 0 || y < 0 || x > this.w * 2 || y > this.h * 2) return;
      this.touch();
      const arr = this[list];
      const ex = arr.find(k => k.x === x && k.y === y);
      if (ex) ex.c = c; else arr.push({ x, y, c });
    }
    removePointsIn(list, hx0, hy0, hx1, hy1) {
      const arr = this[list];
      const keep = arr.filter(k => !(k.x >= hx0 && k.x <= hx1 && k.y >= hy0 && k.y <= hy1));
      if (keep.length !== arr.length) { this.touch(); this[list] = keep; }
    }
    removeLinesNear(hx, hy, maxDist) {
      const d2 = maxDist * maxDist;
      const keep = this.lines.filter(l => U.segDist2(hx, hy, l.x1, l.y1, l.x2, l.y2) > d2);
      if (keep.length !== this.lines.length) { this.touch(); this.lines = keep; return true; }
      return false;
    }
    nearestLine(hx, hy, maxDist) {
      let best = -1, bd = maxDist * maxDist;
      this.lines.forEach((l, i) => {
        const d = U.segDist2(hx, hy, l.x1, l.y1, l.x2, l.y2);
        if (d <= bd) { bd = d; best = i; }
      });
      return best;
    }

    // ---- palette ----
    findColor(e) {
      return this.palette.findIndex(p =>
        (e.brand && p.brand === e.brand && p.code === e.code) ||
        (!e.brand && !p.brand && p.hex.toLowerCase() === e.hex.toLowerCase()));
    }
    addColor(e) {
      const ex = this.findColor(e);
      if (ex >= 0) return ex;
      this.touch();
      this.palette.push({
        brand: e.brand || '', code: e.code || '', name: e.name || '', hex: e.hex,
        symbol: e.symbol || SP.nextSymbol(this.palette)
      });
      return this.palette.length - 1;
    }
    /** map[oldIndex] = newIndex or -1 (removes). Caller owns history. */
    remapColors(map, newPalette) {
      const L = this.legs;
      for (let i = 0; i < L.length; i++) {
        const v = L[i];
        if (v) L[i] = map[v - 1] >= 0 ? map[v - 1] + 1 : 0;
      }
      const vec = arr => arr.filter(o => map[o.c] >= 0).map(o => Object.assign({}, o, { c: map[o.c] }));
      this.lines = vec(this.lines); this.knots = vec(this.knots); this.beads = vec(this.beads);
      this.palette = newPalette;
      this.version++;
    }
    usage() {
      const n = this.palette.length;
      const used = new Uint32Array(n);
      const L = this.legs;
      for (let i = 0; i < L.length; i++) if (L[i]) used[L[i] - 1]++;
      for (const arr of [this.lines, this.knots, this.beads]) for (const o of arr) if (o.c < n) used[o.c]++;
      return used;
    }

    /** Stitch counts per colour. */
    stats() {
      const n = this.palette.length;
      const S = this.palette.map(() => ({ full: 0, half: 0, quarter: 0, three: 0, back: 0, knots: 0, beads: 0 }));
      const L = this.legs;
      const masks = new Map();
      for (let c = 0; c < this.w * this.h; c++) {
        const b = c * 4;
        if (!(L[b] | L[b + 1] | L[b + 2] | L[b + 3])) continue;
        masks.clear();
        for (let q = 0; q < 4; q++) if (L[b + q]) masks.set(L[b + q], (masks.get(L[b + q]) || 0) | (1 << q));
        masks.forEach((m, v) => {
          const s = S[v - 1]; if (!s) return;
          if (m === 15) s.full++;
          else if (m === 6 || m === 9) s.half++;
          else {
            const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
            if (bits === 3) s.three++; else s.quarter += bits;
          }
        });
      }
      for (const l of this.lines) if (S[l.c]) S[l.c].back += Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / 2;
      for (const k of this.knots) if (S[k.c]) S[k.c].knots++;
      for (const k of this.beads) if (S[k.c]) S[k.c].beads++;
      return S.slice(0, n);
    }

    // ---- regions / clipboard ----
    extract(x0, y0, w, h) {
      const clip = { w, h, legs: new Uint16Array(w * h * 4), marks: new Uint8Array(w * h), xs: new Uint8Array(w * h), lines: [], knots: [], beads: [] };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = x0 + x, sy = y0 + y;
        if (!this.inside(sx, sy)) continue;
        const si = sy * this.w + sx, di = y * w + x;
        for (let q = 0; q < 4; q++) clip.legs[di * 4 + q] = this.legs[si * 4 + q];
        clip.marks[di] = this.marks[si];
        clip.xs[di] = this.xs[si];
      }
      const hx0 = x0 * 2, hy0 = y0 * 2, hx1 = (x0 + w) * 2, hy1 = (y0 + h) * 2;
      const inR = (x, y) => x >= hx0 && x <= hx1 && y >= hy0 && y <= hy1;
      for (const l of this.lines) if (inR(l.x1, l.y1) && inR(l.x2, l.y2))
        clip.lines.push({ x1: l.x1 - hx0, y1: l.y1 - hy0, x2: l.x2 - hx0, y2: l.y2 - hy0, c: l.c });
      for (const k of this.knots) if (inR(k.x, k.y)) clip.knots.push({ x: k.x - hx0, y: k.y - hy0, c: k.c });
      for (const k of this.beads) if (inR(k.x, k.y)) clip.beads.push({ x: k.x - hx0, y: k.y - hy0, c: k.c });
      return clip;
    }
    clearRegion(x0, y0, w, h) {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        if (!this.inside(x, y)) continue;
        this.clearCell(x, y);
        this.setMark(y * this.w + x, 0);
      }
      const hx0 = x0 * 2, hy0 = y0 * 2, hx1 = (x0 + w) * 2, hy1 = (y0 + h) * 2;
      const inR = (x, y) => x >= hx0 && x <= hx1 && y >= hy0 && y <= hy1;
      const lines = this.lines.filter(l => !(inR(l.x1, l.y1) && inR(l.x2, l.y2)));
      const knots = this.knots.filter(k => !inR(k.x, k.y));
      const beads = this.beads.filter(k => !inR(k.x, k.y));
      if (lines.length !== this.lines.length || knots.length !== this.knots.length || beads.length !== this.beads.length) {
        this.touch(); this.lines = lines; this.knots = knots; this.beads = beads;
      }
    }
    /** Paste a clip; empty clip cells leave the pattern untouched. */
    stamp(clip, x0, y0) {
      for (let y = 0; y < clip.h; y++) for (let x = 0; x < clip.w; x++) {
        const dx = x0 + x, dy = y0 + y;
        if (!this.inside(dx, dy)) continue;
        const si = y * clip.w + x, di = dy * this.w + dx;
        const L = clip.legs;
        if (L[si * 4] | L[si * 4 + 1] | L[si * 4 + 2] | L[si * 4 + 3]) {
          for (let q = 0; q < 4; q++) this.setLeg(di * 4 + q, L[si * 4 + q]);
          this.setX(di, clip.xs ? clip.xs[si] : 0);
        }
        if (clip.marks[si]) this.setMark(di, clip.marks[si]);
      }
      const ox = x0 * 2, oy = y0 * 2;
      for (const l of clip.lines) this.addLine(l.x1 + ox, l.y1 + oy, l.x2 + ox, l.y2 + oy, l.c);
      for (const k of clip.knots) this.addPoint('knots', k.x + ox, k.y + oy, k.c);
      for (const k of clip.beads) this.addPoint('beads', k.x + ox, k.y + oy, k.c);
    }

    /** Change the canvas size; existing content moves by (dx, dy) cells. */
    reframe(nw, nh, dx, dy) {
      const legs = new Uint16Array(nw * nh * 4), marks = new Uint8Array(nw * nh), xs = new Uint8Array(nw * nh);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= nw || ny >= nh) continue;
        const si = y * this.w + x, di = ny * nw + nx;
        for (let q = 0; q < 4; q++) legs[di * 4 + q] = this.legs[si * 4 + q];
        marks[di] = this.marks[si];
        xs[di] = this.xs[si];
      }
      const hx = dx * 2, hy = dy * 2, HW = nw * 2, HH = nh * 2;
      const ok = (x, y) => x >= 0 && y >= 0 && x <= HW && y <= HH;
      this.lines = this.lines.map(l => ({ x1: l.x1 + hx, y1: l.y1 + hy, x2: l.x2 + hx, y2: l.y2 + hy, c: l.c }))
        .filter(l => ok(l.x1, l.y1) && ok(l.x2, l.y2));
      const mv = k => ({ x: k.x + hx, y: k.y + hy, c: k.c });
      this.knots = this.knots.map(mv).filter(k => ok(k.x, k.y));
      this.beads = this.beads.map(mv).filter(k => ok(k.x, k.y));
      this.w = nw; this.h = nh; this.legs = legs; this.marks = marks; this.xs = xs;
      this.version++;
    }

    // ---- snapshots ----
    liteState() {
      return {
        name: this.name,
        settings: Object.assign({}, this.settings),
        palette: this.palette.map(p => Object.assign({}, p)),
        lines: this.lines.map(o => Object.assign({}, o)),
        knots: this.knots.map(o => Object.assign({}, o)),
        beads: this.beads.map(o => Object.assign({}, o))
      };
    }
    restoreLite(s) {
      this.name = s.name; this.settings = Object.assign({}, s.settings);
      this.palette = s.palette.map(p => Object.assign({}, p));
      this.lines = s.lines.map(o => Object.assign({}, o));
      this.knots = s.knots.map(o => Object.assign({}, o));
      this.beads = s.beads.map(o => Object.assign({}, o));
      this.version++;
    }
    fullState() {
      return Object.assign(this.liteState(), { w: this.w, h: this.h, legs: this.legs.slice(), marks: this.marks.slice(), xs: this.xs.slice() });
    }
    restoreFull(s) {
      this.w = s.w; this.h = s.h; this.legs = s.legs.slice(); this.marks = s.marks.slice(); this.xs = s.xs.slice();
      this.restoreLite(s);
    }

    toJSON() {
      return {
        format: 'stitch-pattern-studio', version: 1,
        name: this.name, w: this.w, h: this.h,
        settings: this.settings, palette: this.palette,
        legs: U.typedToB64(this.legs), marks: U.typedToB64(this.marks), xs: U.typedToB64(this.xs),
        lines: this.lines, knots: this.knots, beads: this.beads
      };
    }
    static fromJSON(o) {
      if (!o || o.format !== 'stitch-pattern-studio') throw new Error('This is not a Stitch Pattern Studio file.');
      const p = new Pattern(o.w, o.h, o.settings);
      p.name = o.name || 'Untitled pattern';
      p.palette = (o.palette || []).map(e => Object.assign({ brand: '', code: '', name: '', symbol: '?' }, e));
      const lb = U.b64ToBytes(o.legs);
      p.legs = new Uint16Array(lb.buffer, 0, o.w * o.h * 4).slice();
      p.marks = U.b64ToBytes(o.marks).slice(0, o.w * o.h);
      if (o.xs) p.xs = U.b64ToBytes(o.xs).slice(0, o.w * o.h); // older files have no cross flags
      p.lines = o.lines || []; p.knots = o.knots || []; p.beads = o.beads || [];
      return p;
    }
  }
  SP.Pattern = Pattern;

  // ---- clip transforms (for floating selections) ----
  SP.clipOps = {
    flipH(c) {
      const n = { w: c.w, h: c.h, legs: new Uint16Array(c.legs.length), marks: new Uint8Array(c.marks.length), xs: new Uint8Array(c.marks.length) };
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const s = y * c.w + x, d = y * c.w + (c.w - 1 - x);
        for (let q = 0; q < 4; q++) n.legs[d * 4 + (q ^ 1)] = c.legs[s * 4 + q];
        n.marks[d] = c.marks[s];
        if (c.xs) n.xs[d] = c.xs[s];
      }
      const W = c.w * 2;
      n.lines = c.lines.map(l => ({ x1: W - l.x1, y1: l.y1, x2: W - l.x2, y2: l.y2, c: l.c }));
      n.knots = c.knots.map(k => ({ x: W - k.x, y: k.y, c: k.c }));
      n.beads = c.beads.map(k => ({ x: W - k.x, y: k.y, c: k.c }));
      return n;
    },
    flipV(c) {
      const n = { w: c.w, h: c.h, legs: new Uint16Array(c.legs.length), marks: new Uint8Array(c.marks.length), xs: new Uint8Array(c.marks.length) };
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const s = y * c.w + x, d = (c.h - 1 - y) * c.w + x;
        for (let q = 0; q < 4; q++) n.legs[d * 4 + (q ^ 2)] = c.legs[s * 4 + q];
        n.marks[d] = c.marks[s];
        if (c.xs) n.xs[d] = c.xs[s];
      }
      const H = c.h * 2;
      n.lines = c.lines.map(l => ({ x1: l.x1, y1: H - l.y1, x2: l.x2, y2: H - l.y2, c: l.c }));
      n.knots = c.knots.map(k => ({ x: k.x, y: H - k.y, c: k.c }));
      n.beads = c.beads.map(k => ({ x: k.x, y: H - k.y, c: k.c }));
      return n;
    },
    rotate(c) { // 90° clockwise
      const nw = c.h, nh = c.w;
      const n = { w: nw, h: nh, legs: new Uint16Array(c.legs.length), marks: new Uint8Array(c.marks.length), xs: new Uint8Array(c.marks.length) };
      const qmap = [1, 3, 0, 2]; // TL->TR, TR->BR, BL->TL, BR->BL
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const s = y * c.w + x, nx = c.h - 1 - y, ny = x, d = ny * nw + nx;
        for (let q = 0; q < 4; q++) n.legs[d * 4 + qmap[q]] = c.legs[s * 4 + q];
        n.marks[d] = c.marks[s];
        if (c.xs) n.xs[d] = c.xs[s];
      }
      const H = c.h * 2;
      n.lines = c.lines.map(l => ({ x1: H - l.y1, y1: l.x1, x2: H - l.y2, y2: l.x2, c: l.c }));
      n.knots = c.knots.map(k => ({ x: H - k.y, y: k.x, c: k.c }));
      n.beads = c.beads.map(k => ({ x: H - k.y, y: k.x, c: k.c }));
      return n;
    }
  };
})(window.SP);
