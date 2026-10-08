/* General helpers: colours, encoding, DOM. */
window.SP = window.SP || {};
(function (SP) {
  const U = SP.util = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  U.hexToRgb = (hex) => {
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map(v => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  /** sRGB (0-255) to CIE L*a*b* (D65). */
  U.rgbToLab = (r, g, b) => {
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  U.hexToLab = (hex) => { const c = U.hexToRgb(hex); return U.rgbToLab(c[0], c[1], c[2]); };
  U.labDist2 = (a, b) => {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  };
  U.luma = (hex) => { const c = U.hexToRgb(hex); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
  U.contrastColor = (hex) => (U.luma(hex) > 140 ? '#000000' : '#ffffff');
  U.shade = (hex, amt) => {
    const c = U.hexToRgb(hex);
    if (amt < 0) return U.rgbToHex(c[0] * (1 + amt), c[1] * (1 + amt), c[2] * (1 + amt));
    return U.rgbToHex(c[0] + (255 - c[0]) * amt, c[1] + (255 - c[1]) * amt, c[2] + (255 - c[2]) * amt);
  };

  /** Find nearest entry in a list of {lab} objects. */
  U.nearest = (lab, list) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = U.labDist2(lab, list[i].lab);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  // ---- base64 for typed arrays ----
  U.bytesToB64 = (u8) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  };
  U.b64ToBytes = (b64) => {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  };
  U.typedToB64 = (t) => U.bytesToB64(new Uint8Array(t.buffer, t.byteOffset, t.byteLength));

  // ---- misc ----
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.debounce = (fn, ms) => {
    let t = 0;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = () => { clearTimeout(t); fn(); };
    return d;
  };
  U.download = (filename, data, mime) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  U.safeFileName = (s) => (String(s || 'pattern').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'pattern');
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.formatLen = (mm, units) => {
    if (units === 'in') return (mm / 25.4).toFixed(1) + '"';
    return (mm / 10).toFixed(1) + ' cm';
  };

  /** Bresenham line between cells. */
  U.lineCells = (x0, y0, x1, y1) => {
    const out = [];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  };

  /** Squared distance from point to segment. */
  U.segDist2 = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = U.clamp(t, 0, 1);
    const qx = x1 + t * dx - px, qy = y1 + t * dy - py;
    return qx * qx + qy * qy;
  };
})(window.SP);
