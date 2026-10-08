/* Application controller: state, canvas interaction, keyboard, selection, autosave. */
(function (SP) {
  const U = SP.util, Geo = SP.Geo, R = SP.Renderer, $ = U.$, $$ = U.$$;
  const RULER = 22;

  const DEFAULT_STATE = {
    tool: 'pencil', color: 0, stitchType: 'full', halfDir: '/', overwrite: true,
    brushSize: 1, brushShape: 'square', fillMode: 'contig', shapeFilled: false,
    eraserLayer: 'all', symmetry: 'none', mark: 1, snap: 'half',
    text: 'Hello', textScale: 1, textSpacing: 1, textBold: false
  };
  const DEFAULT_VIEW = { mode: 'blocks', grid: true, major: true, center: true, rulers: true, back: true, knots: true, marks: true, highlight: false, progress: true };

  const STARTER = [['310', 'dmc'], ['White', 'dmc'], ['321', 'dmc'], ['740', 'dmc'], ['444', 'dmc'], ['699', 'dmc'], ['797', 'dmc'], ['208', 'dmc'], ['3865', 'dmc'], ['801', 'dmc']];

  const app = SP.app = {
    pattern: null,
    history: null,
    state: Object.assign({}, DEFAULT_STATE, SP.Storage.prefs.get('state', {})),
    viewOpts: Object.assign({}, DEFAULT_VIEW, SP.Storage.prefs.get('view', {})),
    view: { ox: 40, oy: 40, cw: 16 },
    geo: null,
    selection: null, floating: null, clipboard: null,
    hoverCell: null, hoverHalf: null, prevTool: null,
    pressed: false, panning: null, spaceDown: false,

    // ================= setup =================
    init() {
      this.canvas = $('#canvas');
      this.ctx = this.canvas.getContext('2d');
      this.history = new SP.History(() => { this.onHistory(); });
      this.autosave = U.debounce(() => this.saveNow(), 1200);
      this.refreshInfoSoon = U.debounce(() => { SP.UI.refreshPaletteCounts(); this.refreshInfo(); }, 300);
      this.state.tool = this.state.tool === 'pan' ? 'pencil' : this.state.tool;

      new ResizeObserver(() => { this.resizeCanvas(); }).observe($('#workspace'));
      this.bindPointer();
      this.bindKeys();
      SP.UI.init(this);
      this.resizeCanvas();

      const lastId = SP.Storage.prefs.get('lastId', null);
      let storageError = null;
      const start = lastId ? SP.Storage.get(lastId).catch(err => { storageError = err; return null; }) : Promise.resolve(null);
      start.then(rec => {
        if (rec && rec.data) {
          try { const p = SP.Pattern.fromJSON(rec.data); p.id = rec.id; this.setPattern(p, true); return; } catch (e) { console.error(e); }
        }
        this.setPattern(this.makePattern({ name: storageError ? 'Untitled pattern' : 'My first pattern', w: 60, h: 60, settings: {} }), !!storageError);
        if (storageError) {
          SP.Storage.prefs.set('lastId', lastId); // keep pointing at your real pattern for the next reload
          SP.UI.setSaveState('Saved patterns could not be opened');
          alert('Your saved patterns could not be opened right now:\n\n' + storageError.message + '\n\nAn empty pattern is shown for now. Nothing has been lost.');
        }
      });
      window.addEventListener('beforeunload', () => { if (this.dirty) this.autosave.flush(); });
      SP.bus.on(msg => { if (msg && msg.type === 'progress' && this.pattern && msg.id === this.pattern.id) this.loadProgress(); });
    },

    makePattern(o) {
      const p = new SP.Pattern(o.w, o.h, o.settings);
      p.name = o.name || 'Untitled pattern';
      p.id = U.uid();
      for (const s of STARTER) {
        const t = SP.threadLib(s[1]).find(t => t.code === s[0]);
        if (t) p.palette.push({ brand: t.brand, code: t.code, name: t.name, hex: t.hex, symbol: SP.nextSymbol(p.palette) });
      }
      return p;
    },

    setPattern(p, loaded) {
      this.pattern = p;
      this.history.clear();
      this.selection = null; this.floating = null;
      if (this.state.color >= p.palette.length) this.state.color = 0;
      this.fit();
      SP.UI.refreshAll();
      if (!loaded) this.saveNow();
      else SP.Storage.prefs.set('lastId', p.id);
      this.loadProgress();
    },

    /** Stitching progress from the counter page (read-only here). */
    loadProgress() {
      const p = this.pattern;
      this.progress = null;
      if (!p || !p.id) return;
      SP.Storage.progress.get(p.id).then(rec => {
        if (p !== this.pattern) return;
        this.progress = rec && rec.w === p.w && rec.h === p.h ? SP.Progress.decode(rec) : null;
        this.refreshInfo(); this.render();
      }).catch(() => {});
    },

    // ================= state helpers =================
    craft() { return SP.craftOf(this.pattern.settings); },
    stitchType() {
      const st = this.state.stitchType;
      return this.craft().stitchTypes.includes(st) ? st : 'full';
    },
    colorHex() { const e = this.pattern.palette[this.state.color]; return e ? e.hex : '#000000'; },
    ensureColor() {
      const p = this.pattern;
      if (!p.palette.length) {
        const t = SP.threadLib('dmc').find(t => t.code === '310');
        this.begin('Add colour');
        p.addColor({ brand: t.brand, code: t.code, name: t.name, hex: t.hex });
        this.commit();
        this.state.color = 0;
        SP.UI.refreshPalette();
        this.toast('Added DMC 310 (black) to the palette.');
      }
      if (this.state.color >= p.palette.length) this.state.color = 0;
      return true;
    },
    setColor(i) {
      if (i < 0 || i >= this.pattern.palette.length) return;
      this.state.color = i;
      this.saveState();
      SP.UI.refreshPalette();
      this.render();
    },
    setTool(id) {
      if (!SP.Tools[id]) return;
      if (this.floating && id !== 'select') this.commitFloat();
      const cur = SP.Tools[this.state.tool];
      if (cur && cur.cancel) cur.cancel(this);
      if (this.state.tool !== 'eyedropper') this.prevTool = this.state.tool;
      this.state.tool = id;
      this.saveState();
      SP.UI.refreshTools();
      this.setCursor(id === 'pan' ? 'grab' : 'crosshair');
      this.render();
    },
    setCursor(c) { if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c; },
    saveState() { SP.Storage.prefs.set('state', this.state); SP.Storage.prefs.set('view', this.viewOpts); },

    // ================= history =================
    begin(label, full) {
      // any other edit first places a floating (pasted / moved) part
      if (this.floating && !this._placing) {
        this._placing = true;
        try { this.commitFloat(); } finally { this._placing = false; }
      }
      this.history.begin(this.pattern, label, full);
    },
    commit() { return this.history.commit(this.pattern); },
    changed() { this.render(); },
    onHistory() {
      if (!this.pattern) return;
      this.markDirty();
      SP.UI.refreshUndo();
      this.refreshInfoSoon();
    },
    fullOp(label, fn) {
      this.begin(label, true);
      try { fn(); } finally { this.commit(); }
      SP.UI.refreshAll();
    },
    undo() {
      if (this.floating) { this.cancelFloat(); return; }
      const e = this.history.undo(this.pattern);
      if (e) { this.afterUndoRedo(); this.status('Undo: ' + e.label); }
    },
    redo() {
      if (this.floating) this.commitFloat();
      const e = this.history.redo(this.pattern);
      if (e) { this.afterUndoRedo(); this.status('Redo: ' + e.label); }
    },
    afterUndoRedo() {
      if (this.selection) this.clampSelection();
      if (this.state.color >= this.pattern.palette.length) this.state.color = Math.max(0, this.pattern.palette.length - 1);
      SP.UI.refreshAll(true);
    },

    // ================= saving =================
    markDirty() {
      this.dirty = true;
      SP.UI.setSaveState('Saving…');
      this.autosave();
    },
    saveNow() {
      const p = this.pattern;
      if (!p) return Promise.resolve();
      if (!p.id) p.id = U.uid();
      const rec = {
        id: p.id, name: p.name, updated: Date.now(), w: p.w, h: p.h, craft: p.settings.craft,
        thumb: SP.Exporter.thumbnail(p, 180), data: p.toJSON()
      };
      return SP.Storage.save(rec).then(() => {
        this.dirty = false;
        SP.Storage.prefs.set('lastId', p.id);
        SP.UI.setSaveState('Saved in browser ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        SP.bus.post({ type: 'pattern', id: p.id }); // an open counter page reloads the pattern
        if (this.progress && (this.progress.w !== p.w || this.progress.h !== p.h)) { this.progress = null; this.refreshInfo(); }
      }).catch(err => {
        console.error(err);
        SP.UI.setSaveState(/locked by another tab/.test(err.message)
          ? 'Not saved: close other tabs of this app and reload'
          : 'Could not save in browser – use Save file');
      });
    },
    saveFile() {
      const p = this.pattern;
      U.download(U.safeFileName(p.name) + '.stitch.json', JSON.stringify(p.toJSON()), 'application/json');
      this.toast('Project file downloaded.');
    },
    loadFile(file) {
      file.text().then(txt => {
        const p = SP.Pattern.fromJSON(JSON.parse(txt));
        p.id = U.uid();
        this.setPattern(p, false);
        this.toast('Opened "' + p.name + '".');
      }).catch(err => alert('Could not open file: ' + err.message));
    },

    // ================= rendering =================
    resizeCanvas() {
      const ws = $('#workspace');
      const dpr = window.devicePixelRatio || 1;
      const w = ws.clientWidth, h = ws.clientHeight;
      this.cssW = w; this.cssH = h;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.dpr = dpr;
      if (!this._fitted && w > 0 && this.pattern) this.fit();
      this.draw();
    },
    render() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    },
    renderOpts() {
      const v = this.viewOpts;
      return {
        mode: v.mode, grid: v.grid, major: v.major, center: v.center, rulers: v.rulers, rulerSize: RULER,
        back: v.back, knots: v.knots, marks: v.marks, highlight: v.highlight ? this.state.color : -1
      };
    },
    draw() {
      if (!this.pattern) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.geo = Geo.make(this.pattern, this.view);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--workspace').trim() || '#d9d5d0';
      const o = Object.assign(this.renderOpts(), { width: this.cssW, height: this.cssH, bg, rulers: false });
      R.render(ctx, this.pattern, this.geo, o);
      const tool = SP.Tools[this.state.tool];
      if (this.viewOpts.progress && this.progress && this.progress.w === this.pattern.w && this.progress.h === this.pattern.h) {
        SP.Progress.drawDone(ctx, this.pattern, this.geo, this.progress, 'dim', this.cssW, this.cssH);
      }
      if (tool && tool.overlay) tool.overlay(this, ctx, this.geo);
      if (this.state.tool !== 'select' && (this.floating || this.selection)) SP.Tools.select.overlay(this, ctx, this.geo);
      if (this.viewOpts.rulers) {
        const g = this.geo;
        R.drawRulers(ctx, this.pattern, g, Object.assign(o, { rulerBg: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
          rulerText: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }),
          Math.max(0, Math.floor(-g.ox / g.cw) - 1), Math.min(this.pattern.w, Math.ceil((this.cssW - g.ox) / g.cw) + 1),
          Math.max(0, Math.floor(-g.oy / g.ch) - 1), Math.min(this.pattern.h, Math.ceil((this.cssH - g.oy) / g.ch) + 1),
          0, 0, this.pattern.w, this.pattern.h);
      }
      $('#zoomLabel').textContent = Math.round(this.view.cw / 16 * 100) + '%';
    },

    // ================= view =================
    fit() {
      const p = this.pattern;
      if (!p || !this.cssW) return;
      this._fitted = true;
      const off = this.viewOpts.rulers ? RULER : 0;
      const aw = this.cssW - off - 40, ah = this.cssH - off - 40;
      const asp = SP.aspectOf(p.settings), lay = SP.layoutOf(p.settings);
      const cw = Math.min(aw / (p.w + (lay === 'brick' ? 0.5 : 0)), ah / ((p.h + (lay === 'peyote' ? 0.5 : 0)) * asp));
      this.view.cw = U.clamp(cw, 1, 60);
      const g = Geo.make(p, { ox: 0, oy: 0, cw: this.view.cw });
      const sz = Geo.size(g);
      this.view.ox = Math.round(off + (this.cssW - off - sz[0]) / 2);
      this.view.oy = Math.round(off + (this.cssH - off - sz[1]) / 2);
      this.render();
    },
    zoomAt(f, sx, sy) {
      const cw = U.clamp(this.view.cw * f, 1, 120);
      const k = cw / this.view.cw;
      this.view.ox = sx - (sx - this.view.ox) * k;
      this.view.oy = sy - (sy - this.view.oy) * k;
      this.view.cw = cw;
      this.render();
    },
    zoomCenter(f) { this.zoomAt(f, this.cssW / 2, this.cssH / 2); },
    startPan(pt) { this.panning = { sx: pt.sx, sy: pt.sy, ox: this.view.ox, oy: this.view.oy }; this.setCursor('grabbing'); },
    movePan(pt) {
      if (!this.panning) return;
      this.view.ox = this.panning.ox + pt.sx - this.panning.sx;
      this.view.oy = this.panning.oy + pt.sy - this.panning.sy;
      this.render();
    },
    endPan() { this.panning = null; this.setCursor(this.state.tool === 'pan' || this.spaceDown ? 'grab' : 'crosshair'); },

    // ================= input =================
    makePt(e) {
      const r = this.canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const g = this.geo || Geo.make(this.pattern, this.view);
      return {
        sx, sy, cell: Geo.pointToCell(g, sx, sy), half: Geo.pointToHalf(g, sx, sy, this.state.snap),
        button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, pressed: this.pressed
      };
    },
    bindPointer() {
      const cv = this.canvas;
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('pointerdown', e => {
        if (!this.pattern) return;
        cv.setPointerCapture(e.pointerId);
        const pt = this.makePt(e);
        if (e.button === 1 || this.spaceDown) { e.preventDefault(); this.startPan(pt); return; }
        if (e.button !== 0 && e.button !== 2) return;
        this.pressed = true; pt.pressed = true;
        this.activeButton = e.button;
        SP.Tools[this.state.tool].down(this, pt);
        this.render();
      });
      cv.addEventListener('pointermove', e => {
        if (!this.pattern) return;
        const pt = this.makePt(e);
        pt.button = this.activeButton;
        this.hoverCell = this.pattern.inside(pt.cell.x, pt.cell.y) ? pt.cell : null;
        this.hoverHalf = pt.half;
        this.updateStatusPos(pt);
        if (this.panning) { this.movePan(pt); return; }
        SP.Tools[this.state.tool].move(this, pt);
        this.render();
      });
      const end = e => {
        if (this.panning) { this.endPan(); return; }
        if (!this.pressed) return;
        this.pressed = false;
        const pt = this.makePt(e);
        SP.Tools[this.state.tool].up(this, pt);
        this.render();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { this.hoverCell = null; this.hoverHalf = null; $('#statusPos').textContent = '–'; this.render(); });
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        if (e.shiftKey && !e.ctrlKey) { this.view.ox -= e.deltaY; this.render(); return; }
        const f = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
        this.zoomAt(f, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
    },
    bindKeys() {
      document.addEventListener('keydown', e => {
        const t = e.target;
        if (document.querySelector('dialog[open]')) return;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
          if (e.key === 'Escape') t.blur();
          return;
        }
        const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        if (k === ' ') { if (!this.spaceDown) { this.spaceDown = true; this.setCursor('grab'); } e.preventDefault(); return; }
        if (ctrl) {
          const map = { z: () => (e.shiftKey ? this.redo() : this.undo()), y: () => this.redo(), c: () => this.copy(), x: () => this.cut(),
            v: () => this.paste(), a: () => this.selectAll(), s: () => this.saveFile() };
          if (map[k]) { e.preventDefault(); map[k](); }
          return;
        }
        if (e.altKey) return;
        if (this.floating) {
          if (k === 'h') return this.flipH();
          if (k === 'v') return this.flipV();
          if (k === 'r') return this.rotate();
        }
        switch (e.key) {
          case 'Escape':
            if (this.floating) this.cancelFloat();
            else if (this.selection) { this.selection = null; this.updateSelectionInfo(); }
            else { const tl = SP.Tools[this.state.tool]; if (tl.cancel) tl.cancel(this); }
            this.render(); return;
          case 'Enter': this.commitFloat(); return;
          case 'Delete': case 'Backspace': this.deleteSel(); e.preventDefault(); return;
          case '[': this.setBrush(this.state.brushSize - 1); return;
          case ']': this.setBrush(this.state.brushSize + 1); return;
          case '+': case '=': this.zoomCenter(1.25); return;
          case '-': case '_': this.zoomCenter(0.8); return;
          case '0': this.fit(); return;
        }
        if (k === 'x') { this.state.halfDir = this.state.halfDir === '/' ? '\\' : '/'; this.saveState(); SP.UI.refreshTools(); return; }
        if (/^[1-9]$/.test(k)) { this.setColor(+k - 1); return; }
        const tl = SP.TOOL_ORDER.find(o => o[2] === k);
        if (tl && SP.UI.toolAvailable(tl[0])) this.setTool(tl[0]);
      });
      document.addEventListener('keyup', e => {
        if (e.key === ' ') { this.spaceDown = false; if (!this.panning) this.setCursor(this.state.tool === 'pan' ? 'grab' : 'crosshair'); }
      });
    },
    setBrush(n) { this.state.brushSize = U.clamp(n, 1, 30); this.saveState(); SP.UI.refreshTools(); this.render(); },

    // ================= selection / clipboard =================
    clampSelection() {
      const s = this.selection, p = this.pattern;
      const x0 = U.clamp(s.x, 0, p.w), y0 = U.clamp(s.y, 0, p.h);
      const x1 = U.clamp(s.x + s.w, 0, p.w), y1 = U.clamp(s.y + s.h, 0, p.h);
      this.selection = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    },
    selectAll() {
      if (this.floating) this.commitFloat();
      if (this.state.tool !== 'select') this.setTool('select');
      this.selection = { x: 0, y: 0, w: this.pattern.w, h: this.pattern.h };
      this.updateSelectionInfo(); this.render();
    },
    deselect() { if (this.floating) this.commitFloat(); this.selection = null; this.updateSelectionInfo(); this.render(); },
    cloneClip(c) {
      return { w: c.w, h: c.h, legs: c.legs.slice(), marks: c.marks.slice(), xs: c.xs ? c.xs.slice() : new Uint8Array(c.w * c.h),
        lines: c.lines.map(o => Object.assign({}, o)), knots: c.knots.map(o => Object.assign({}, o)), beads: c.beads.map(o => Object.assign({}, o)) };
    },
    copy() {
      if (this.floating) this.clipboard = this.cloneClip(this.floating.clip);
      else if (this.selection) { const s = this.selection; this.clipboard = this.pattern.extract(s.x, s.y, s.w, s.h); }
      else { this.toast('Select an area first (S).'); return false; }
      this.clipboard.palette = this.pattern.palette.map(e => Object.assign({}, e));
      this.toast('Copied ' + this.clipboard.w + ' × ' + this.clipboard.h + '.');
      return true;
    },
    cut() {
      if (this.floating) { this.copy(); this.deleteSel(); return; }
      if (!this.selection) { this.toast('Select an area first (S).'); return; }
      this.copy();
      const s = this.selection;
      this.begin('Cut'); this.pattern.clearRegion(s.x, s.y, s.w, s.h); this.commit();
      this.render();
    },
    paste() {
      if (!this.clipboard) { this.toast('Nothing copied yet.'); return; }
      if (this.floating) this.commitFloat();
      if (this.state.tool !== 'select') this.setTool('select');
      const clip = this.cloneClip(this.clipboard);
      // colours may come from another pattern: map them by brand/code or hex
      const src = this.clipboard.palette || [];
      const p = this.pattern;
      const needMap = src.some((e, i) => !p.palette[i] || p.palette[i].hex !== e.hex || p.palette[i].code !== e.code);
      if (needMap) {
        this.begin('Add colours');
        const map = src.map(e => p.addColor(e));
        this.commit();
        for (let i = 0; i < clip.legs.length; i++) if (clip.legs[i]) clip.legs[i] = map[clip.legs[i] - 1] + 1;
        for (const arr of [clip.lines, clip.knots, clip.beads]) for (const o of arr) o.c = map[o.c];
        SP.UI.refreshPalette();
      }
      let x, y;
      if (this.selection) { x = this.selection.x; y = this.selection.y; }
      else {
        const g = this.geo;
        x = U.clamp(Math.floor((RULER + 10 - g.ox) / g.cw), 0, p.w - 1);
        y = U.clamp(Math.floor((RULER + 10 - g.oy) / g.ch), 0, p.h - 1);
      }
      this.floating = { clip, x, y, fromLift: false };
      this.selection = null;
      this.updateSelectionInfo();
      this.render();
    },
    liftSelection() {
      const s = this.selection;
      if (!s) return;
      const clip = this.pattern.extract(s.x, s.y, s.w, s.h);
      this.begin('Move');
      this.pattern.clearRegion(s.x, s.y, s.w, s.h);
      this.floating = { clip, x: s.x, y: s.y, fromLift: true };
      this.selection = null;
    },
    commitFloat() {
      const f = this.floating;
      if (!f) return;
      this.floating = null;
      if (!this.pattern.tx) this.begin('Paste');
      this.pattern.stamp(f.clip, f.x, f.y);
      this.commit();
      this.selection = { x: f.x, y: f.y, w: f.clip.w, h: f.clip.h };
      this.clampSelection();
      this.updateSelectionInfo();
      this.render();
    },
    cancelFloat() {
      const f = this.floating;
      if (!f) return;
      if (f.fromLift) this.history.rollback(this.pattern);
      this.floating = null;
      this.render();
    },
    deleteSel() {
      if (this.floating) {
        if (this.floating.fromLift) { this.commit(); }
        this.floating = null;
      } else if (this.selection) {
        const s = this.selection;
        this.begin('Delete'); this.pattern.clearRegion(s.x, s.y, s.w, s.h); this.commit();
      }
      this.render();
    },
    transformFloat(op) {
      if (!this.floating) {
        if (!this.selection) { this.toast('Select an area first (S).'); return; }
        this.liftSelection();
      }
      const f = this.floating;
      const cx = f.x + f.clip.w / 2, cy = f.y + f.clip.h / 2;
      f.clip = Object.assign(SP.clipOps[op](f.clip), { palette: f.clip.palette });
      if (op === 'rotate') { f.x = Math.round(cx - f.clip.w / 2); f.y = Math.round(cy - f.clip.h / 2); }
      this.render();
    },
    flipH() { this.transformFloat('flipH'); },
    flipV() { this.transformFloat('flipV'); },
    rotate() { this.transformFloat('rotate'); },
    crop() {
      if (this.floating) this.commitFloat();
      const s = this.selection;
      if (!s) { this.toast('Select the area to keep first.'); return; }
      this.fullOp('Crop', () => this.pattern.reframe(s.w, s.h, -s.x, -s.y));
      this.selection = null;
      this.fit();
    },
    updateSelectionInfo() { this.refreshInfo(); },

    // ================= status =================
    updateStatusPos(pt) {
      const p = this.pattern, c = pt.cell;
      if (!p.inside(c.x, c.y)) { $('#statusPos').textContent = '–'; return; }
      let txt = `Column ${c.x + 1}, row ${c.y + 1}`;
      const v = p.cellColor(c.x, c.y);
      if (v && p.palette[v - 1]) { const e = p.palette[v - 1]; txt += ` · ${e.brand ? e.brand + ' ' + e.code : e.hex} ${e.name}`; }
      const m = p.marks[c.y * p.w + c.x];
      if (m) txt += ' · ' + SP.markName(m);
      $('#statusPos').textContent = txt;
    },
    status(msg) { $('#statusMsg').textContent = msg; },
    toast(msg) {
      const t = $('#toast');
      t.textContent = msg; t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), 2200);
    },
    refreshInfo() {
      const p = this.pattern;
      if (!p) return;
      const craft = this.craft();
      const fs = SP.finishedSize(p);
      const st = p.stats();
      const tot = st.reduce((a, s) => { for (const k in s) a[k] = (a[k] || 0) + s[k]; return a; }, {});
      const used = st.filter(s => s.full + s.half + s.quarter + s.three + s.back + s.knots + s.beads > 0).length;
      const lines = [
        `<b>${U.esc(craft.name)}</b>`,
        `${p.w} × ${p.h} ${craft.unit}`,
        `Finished: ${U.formatLen(fs[0], p.settings.units)} × ${U.formatLen(fs[1], p.settings.units)}` +
          (p.settings.craft === 'cross' ? ` (${p.settings.fabricCount} ct${p.settings.over === 2 ? ', over 2' : ''})` : ''),
        `Colours used: ${used} of ${p.palette.length}`,
        `Full: ${tot.full || 0}` + (tot.half ? ` · Half: ${tot.half}` : '') + (tot.three ? ` · ¾: ${tot.three}` : '') + (tot.quarter ? ` · ¼: ${tot.quarter}` : '')
      ];
      if (tot.back) lines.push(`Backstitch: ${p.lines.length} lines (${tot.back.toFixed(1)} ${craft.unit === 'stitches' ? 'cells' : ''} long)`);
      if (tot.knots) lines.push(`French knots: ${tot.knots}`);
      if (tot.beads) lines.push(`Beads: ${tot.beads}`);
      if (this.progress && this.progress.w === p.w && this.progress.h === p.h) {
        const ps = SP.Progress.stats(p, this.progress);
        const pct = ps.done / Math.max(1, ps.total) * 100;
        if (ps.done) lines.push(`<b>Stitched:</b> ${ps.done} of ${ps.total} (${pct < 10 ? pct.toFixed(1) : Math.floor(pct)}%)`);
      }
      if (this.selection) lines.push(`<b>Selection:</b> ${this.selection.w} × ${this.selection.h} at ${this.selection.x + 1}, ${this.selection.y + 1}`);
      if (this.floating) lines.push(`<b>Pasted part:</b> ${this.floating.clip.w} × ${this.floating.clip.h} (Enter to place)`);
      $('#patternInfo').innerHTML = lines.join('<br>');
      $('#statusSize').textContent = `${p.w} × ${p.h}`;
    }
  };

  document.addEventListener('DOMContentLoaded', () => app.init());
})(window.SP);
