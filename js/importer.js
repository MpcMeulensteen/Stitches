/* Image to pattern conversion: resize, adjust, colour-reduce (k-means in Lab), match threads, dither. */
(function (SP) {
  const U = SP.util;

  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  SP.Importer = {
    loadImage(file) {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read this image.')); };
        img.src = url;
      });
    },

    /** Returns { w, h, idx: Int32Array (-1 = empty), palette: [{brand,code,name,hex}] } */
    convert(img, o) {
      const w = o.w, h = o.h;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, w, h);
      const D = cx.getImageData(0, 0, w, h).data;
      const n = w * h;

      // colour adjustments
      const rgb = new Float32Array(n * 3);
      const alpha = new Uint8Array(n);
      const bri = o.bright * 2.55, c = o.contrast * 2.55;
      const cf = (259 * (c + 255)) / (255 * (259 - c));
      const sat = 1 + o.sat / 100;
      for (let i = 0; i < n; i++) {
        let r = D[i * 4], g = D[i * 4 + 1], b = D[i * 4 + 2];
        alpha[i] = D[i * 4 + 3] >= 128 ? 1 : 0;
        r = cf * (r - 128) + 128 + bri; g = cf * (g - 128) + 128 + bri; b = cf * (b - 128) + 128 + bri;
        const gr = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gr + (r - gr) * sat; g = gr + (g - gr) * sat; b = gr + (b - gr) * sat;
        rgb[i * 3] = U.clamp(r, 0, 255); rgb[i * 3 + 1] = U.clamp(g, 0, 255); rgb[i * 3 + 2] = U.clamp(b, 0, 255);
      }

      // background removal (colour of the corners)
      if (o.bg === 'corner') {
        const corners = [0, w - 1, (h - 1) * w, n - 1].filter(i => alpha[i]);
        if (corners.length) {
          const avg = [0, 1, 2].map(k => corners.reduce((s, i) => s + rgb[i * 3 + k], 0) / corners.length);
          const bl = U.rgbToLab(avg[0], avg[1], avg[2]);
          const tol2 = o.bgTol * o.bgTol;
          for (let i = 0; i < n; i++) {
            if (!alpha[i]) continue;
            if (U.labDist2(U.rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), bl) < tol2) alpha[i] = 0;
          }
        }
      }

      // Lab cache (rgb quantised to 6 bits per channel)
      const labCache = new Map();
      const labOf = (r, g, b) => {
        const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
        let l = labCache.get(key);
        if (!l) { l = U.rgbToLab(r, g, b); labCache.set(key, l); }
        return l;
      };

      const opaque = [];
      for (let i = 0; i < n; i++) if (alpha[i]) opaque.push(i);
      if (!opaque.length) return { w, h, idx: new Int32Array(n).fill(-1), palette: [] };

      // ---- candidate colours ----
      let cands;
      if (o.source === 'palette') {
        cands = (o.currentPalette || []).map(e => ({ brand: e.brand, code: e.code, name: e.name, hex: e.hex, lab: U.hexToLab(e.hex) }));
        if (!cands.length) throw new Error('The current palette is empty.');
        if (cands.length > o.colors) cands = this.reduceToUsed(cands, opaque, rgb, labOf, o.colors);
      } else {
        const centers = this.kmeans(opaque, rgb, labOf, Math.min(o.colors, opaque.length));
        if (o.source === 'free') {
          cands = centers.map((ct, i) => ({ brand: '', code: '', name: 'Colour ' + (i + 1), hex: U.rgbToHex(ct.rgb[0], ct.rgb[1], ct.rgb[2]), lab: ct.lab }));
        } else {
          const lib = SP.threadLib(o.source);
          const seen = new Set();
          cands = [];
          for (const ct of centers) {
            const t = lib[U.nearest(ct.lab, lib)];
            if (!t || seen.has(t.code)) continue;
            seen.add(t.code);
            cands.push({ brand: t.brand, code: t.code, name: t.name, hex: t.hex, lab: t.lab });
          }
        }
      }

      // ---- mapping (+ optional dithering), then merge rarely used colours ----
      let idx = this.mapPixels(w, h, alpha, rgb, cands, labOf, o.dither === 'fs');
      for (let round = 0; round < 3 && o.minCount > 0; round++) {
        const cnt = new Uint32Array(cands.length);
        for (let i = 0; i < n; i++) if (idx[i] >= 0) cnt[idx[i]]++;
        const keep = cands.filter((_, k) => cnt[k] >= o.minCount);
        if (!keep.length || keep.length === cands.filter((_, k) => cnt[k] > 0).length) break;
        cands = keep;
        idx = this.mapPixels(w, h, alpha, rgb, cands, labOf, o.dither === 'fs');
      }

      // final palette: only used colours, sorted by frequency
      const cnt = new Uint32Array(cands.length);
      for (let i = 0; i < n; i++) if (idx[i] >= 0) cnt[idx[i]]++;
      const order = cands.map((_, k) => k).filter(k => cnt[k] > 0).sort((a, b) => cnt[b] - cnt[a]);
      const remap = new Int32Array(cands.length).fill(-1);
      order.forEach((k, j) => { remap[k] = j; });
      for (let i = 0; i < n; i++) if (idx[i] >= 0) idx[i] = remap[idx[i]];
      const palette = order.map(k => { const e = cands[k]; return { brand: e.brand, code: e.code, name: e.name, hex: e.hex }; });
      return { w, h, idx, palette, counts: order.map(k => cnt[k]) };
    },

    kmeans(opaque, rgb, labOf, K) {
      const rnd = rng(12345);
      const S = Math.min(opaque.length, 16000);
      const sample = new Array(S);
      for (let i = 0; i < S; i++) sample[i] = opaque[S === opaque.length ? i : Math.floor(rnd() * opaque.length)];
      const pts = sample.map(i => labOf(rgb[i * 3] | 0, rgb[i * 3 + 1] | 0, rgb[i * 3 + 2] | 0));
      // k-means++ initialisation
      const centers = [pts[Math.floor(rnd() * S)].slice()];
      const d2 = new Float64Array(S).fill(Infinity);
      while (centers.length < K) {
        const last = centers[centers.length - 1];
        let sum = 0;
        for (let i = 0; i < S; i++) { const d = U.labDist2(pts[i], last); if (d < d2[i]) d2[i] = d; sum += d2[i]; }
        if (sum <= 0) break;
        let r = rnd() * sum, j = 0;
        for (; j < S - 1; j++) { r -= d2[j]; if (r <= 0) break; }
        centers.push(pts[j].slice());
      }
      const k = centers.length;
      const assign = new Int32Array(S);
      for (let it = 0; it < 14; it++) {
        const acc = new Float64Array(k * 3), num = new Uint32Array(k);
        let moved = 0;
        for (let i = 0; i < S; i++) {
          let best = 0, bd = Infinity;
          for (let c = 0; c < k; c++) { const d = U.labDist2(pts[i], centers[c]); if (d < bd) { bd = d; best = c; } }
          if (assign[i] !== best) moved++;
          assign[i] = best; num[best]++;
          acc[best * 3] += pts[i][0]; acc[best * 3 + 1] += pts[i][1]; acc[best * 3 + 2] += pts[i][2];
        }
        for (let c = 0; c < k; c++) if (num[c]) centers[c] = [acc[c * 3] / num[c], acc[c * 3 + 1] / num[c], acc[c * 3 + 2] / num[c]];
        if (it > 2 && moved < S * 0.002) break;
      }
      // average RGB per cluster (for "any colour" output)
      const racc = new Float64Array(k * 3), rn = new Uint32Array(k);
      for (let i = 0; i < S; i++) {
        const c = assign[i], p = sample[i];
        racc[c * 3] += rgb[p * 3]; racc[c * 3 + 1] += rgb[p * 3 + 1]; racc[c * 3 + 2] += rgb[p * 3 + 2]; rn[c]++;
      }
      const out = [];
      for (let c = 0; c < k; c++) if (rn[c]) out.push({ lab: centers[c], rgb: [racc[c * 3] / rn[c], racc[c * 3 + 1] / rn[c], racc[c * 3 + 2] / rn[c]] });
      return out;
    },

    reduceToUsed(cands, opaque, rgb, labOf, K) {
      const cnt = new Uint32Array(cands.length);
      for (const i of opaque) cnt[U.nearest(labOf(rgb[i * 3] | 0, rgb[i * 3 + 1] | 0, rgb[i * 3 + 2] | 0), cands)]++;
      return cands.map((c, i) => [c, cnt[i]]).sort((a, b) => b[1] - a[1]).slice(0, K).map(a => a[0]);
    },

    mapPixels(w, h, alpha, rgbIn, cands, labOf, dither) {
      const n = w * h;
      const idx = new Int32Array(n).fill(-1);
      const crgb = cands.map(c => U.hexToRgb(c.hex));
      const near = new Map();
      const pick = (r, g, b) => {
        const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
        let v = near.get(key);
        if (v === undefined) { v = U.nearest(labOf(r, g, b), cands); near.set(key, v); }
        return v;
      };
      if (!dither) {
        for (let i = 0; i < n; i++) if (alpha[i]) idx[i] = pick(rgbIn[i * 3] | 0, rgbIn[i * 3 + 1] | 0, rgbIn[i * 3 + 2] | 0);
        return idx;
      }
      const buf = Float32Array.from(rgbIn);
      const spread = (x, y, er, eg, eb, f) => {
        if (x < 0 || x >= w || y >= h) return;
        const j = y * w + x;
        if (!alpha[j]) return;
        buf[j * 3] += er * f; buf[j * 3 + 1] += eg * f; buf[j * 3 + 2] += eb * f;
      };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!alpha[i]) continue;
        const r = U.clamp(buf[i * 3], 0, 255), g = U.clamp(buf[i * 3 + 1], 0, 255), b = U.clamp(buf[i * 3 + 2], 0, 255);
        const k = pick(r | 0, g | 0, b | 0);
        idx[i] = k;
        const er = r - crgb[k][0], eg = g - crgb[k][1], eb = b - crgb[k][2];
        spread(x + 1, y, er, eg, eb, 7 / 16); spread(x - 1, y + 1, er, eg, eb, 3 / 16);
        spread(x, y + 1, er, eg, eb, 5 / 16); spread(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
      return idx;
    }
  };
})(window.SP);
