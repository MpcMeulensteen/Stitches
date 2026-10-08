/* Panels, tool options and dialogs. */
(function (SP) {
  const U = SP.util, $ = U.$, $$ = U.$$;
  let app;

  const UI = SP.UI = {
    init(a) {
      app = a;
      this.buildToolButtons();
      this.bindToolOptions();
      this.bindView();
      this.bindActions();
      this.prepareDialogs();
      $('#patternName').addEventListener('change', e => {
        const v = e.target.value.trim() || 'Untitled pattern';
        app.begin('Rename'); app.pattern.touch(); app.pattern.name = v; app.commit();
      });
      $('#currentColor').addEventListener('click', () => this.setPaletteOpen($('#paletteDrop').hidden));
      this.setPaletteOpen(SP.Storage.prefs.get('paletteOpen', false));
      // make sure the counter reads the latest version of this pattern
      $('#counterLink').addEventListener('click', e => {
        e.preventDefault();
        const go = () => { location.href = $('#counterLink').href; };
        if (app.floating) app.commitFloat();
        app.saveNow().then(go, go);
      });
      $('#fileOpen').addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) app.loadFile(f);
        e.target.value = '';
      });
    },

    refreshAll() {
      const p = app.pattern;
      $('#patternName').value = p.name;
      $('#counterLink').href = 'counter.html?pattern=' + encodeURIComponent(p.id || '');
      this.refreshTools();
      this.refreshPalette();
      this.refreshUndo();
      app.refreshInfo();
      app.render();
    },
    refreshUndo() {
      $('[data-action=undo]').disabled = !app.history.undoStack.length && !app.floating;
      $('[data-action=redo]').disabled = !app.history.redoStack.length;
      const u = app.history.undoStack[app.history.undoStack.length - 1];
      $('[data-action=undo]').title = u ? 'Undo ' + u.label + ' (Ctrl+Z)' : 'Undo (Ctrl+Z)';
    },
    setSaveState(t) { $('#saveState').textContent = t; },

    // ================= tools =================
    toolAvailable(id) {
      if (!app.pattern) return true;
      const c = app.craft();
      if (id === 'backstitch' || id === 'knot' || id === 'bead') return c.tools.includes(id);
      if (id === 'stamp') return !!c.marks;
      return true;
    },
    buildToolButtons() {
      const box = $('#toolButtons');
      box.innerHTML = SP.TOOL_ORDER.map(t =>
        `<button data-tool="${t[0]}" title="${t[1]} (${t[2].toUpperCase()})">${SP.toolIcon(t[0])}</button>`).join('');
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-tool]');
        if (b) app.setTool(b.dataset.tool);
      });
    },
    refreshTools() {
      const st = app.state, p = app.pattern;
      if (!p) return;
      if (!this.toolAvailable(st.tool)) { st.tool = 'pencil'; }
      $$('#toolButtons [data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === st.tool);
        b.hidden = !this.toolAvailable(b.dataset.tool);
      });
      const craft = app.craft();
      $$('#toolOptions .opt').forEach(sec => {
        let show = sec.dataset.for.split(' ').includes(st.tool);
        if (show && sec.querySelector('#stitchTypeSeg') && craft.stitchTypes.length < 2) show = false;
        sec.hidden = !show;
      });
      $$('#stitchTypeSeg button').forEach(b => {
        b.hidden = !craft.stitchTypes.includes(b.dataset.stitch);
        b.classList.toggle('active', b.dataset.stitch === app.stitchType());
      });
      $('#halfDirRow').hidden = app.stitchType() !== 'half';
      $$('#halfDirSeg button').forEach(b => b.classList.toggle('active', b.dataset.dir === st.halfDir));
      $('#optOverwrite').checked = st.overwrite;
      $('#optBrushSize').value = st.brushSize; $('#optBrushSizeOut').textContent = st.brushSize;
      $$('#brushShapeSeg button').forEach(b => b.classList.toggle('active', b.dataset.shape === st.brushShape));
      $$('#fillModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.fill === st.fillMode));
      $('#optShapeFilled').checked = st.shapeFilled;
      $('#optEraserLayer').value = st.eraserLayer;
      $$('#snapSeg button').forEach(b => b.classList.toggle('active', b.dataset.snap === st.snap));
      $('#optSymmetry').value = st.symmetry;
      $('#optText').value = st.text;
      $('#optTextScale').value = st.textScale; $('#optTextScaleOut').textContent = st.textScale;
      $('#optTextSpacing').value = st.textSpacing; $('#optTextSpacingOut').textContent = st.textSpacing;
      $('#optTextBold').checked = st.textBold;
      this.buildMarks();
      $('#statusTool').textContent = (SP.TOOL_ORDER.find(t => t[0] === st.tool) || [])[1] || '';
    },
    buildMarks() {
      const craft = app.craft();
      const list = craft.marks ? SP.MARKS[craft.marks] : [];
      const box = $('#markGrid');
      const key = craft.marks + ':' + app.state.mark;
      if (box.dataset.key === key) return;
      box.dataset.key = key;
      if (list.length && !list.some(m => m.id === app.state.mark)) app.state.mark = list[0].id;
      box.innerHTML = '';
      for (const m of list) {
        const b = document.createElement('button');
        b.type = 'button'; b.title = m.name;
        b.classList.toggle('active', m.id === app.state.mark);
        const cv = document.createElement('canvas');
        cv.width = 52; cv.height = 52;
        const ctx = cv.getContext('2d');
        SP.drawMark(ctx, m.id, 4, 4, 44, 44, m.id === app.state.mark ? '#ffffff' : getComputedStyle(document.documentElement).getPropertyValue('--text').trim());
        b.appendChild(cv);
        b.addEventListener('click', () => { app.state.mark = m.id; app.saveState(); box.dataset.key = ''; this.buildMarks(); });
        box.appendChild(b);
      }
    },
    bindToolOptions() {
      const st = app.state;
      const seg = (sel, attr, key) => $(sel).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        st[key] = b.dataset[attr]; app.saveState(); this.refreshTools(); app.render();
      });
      seg('#stitchTypeSeg', 'stitch', 'stitchType');
      seg('#halfDirSeg', 'dir', 'halfDir');
      seg('#brushShapeSeg', 'shape', 'brushShape');
      seg('#fillModeSeg', 'fill', 'fillMode');
      seg('#snapSeg', 'snap', 'snap');
      const bind = (sel, key, ev, conv) => $(sel).addEventListener(ev || 'change', e => {
        const el = e.target;
        st[key] = conv ? conv(el) : el.value; app.saveState(); this.refreshTools(); app.render();
      });
      bind('#optOverwrite', 'overwrite', 'change', el => el.checked);
      bind('#optBrushSize', 'brushSize', 'input', el => +el.value);
      bind('#optShapeFilled', 'shapeFilled', 'change', el => el.checked);
      bind('#optEraserLayer', 'eraserLayer');
      bind('#optSymmetry', 'symmetry');
      bind('#optText', 'text', 'input', el => el.value);
      bind('#optTextScale', 'textScale', 'input', el => +el.value);
      bind('#optTextSpacing', 'textSpacing', 'input', el => +el.value);
      bind('#optTextBold', 'textBold', 'change', el => el.checked);
    },

    // ================= view =================
    bindView() {
      const v = app.viewOpts;
      const map = { viewGrid: 'grid', viewMajor: 'major', viewCenter: 'center', viewRulers: 'rulers', viewBack: 'back', viewKnots: 'knots', viewMarks: 'marks', viewHighlight: 'highlight', viewProgress: 'progress' };
      for (const id in map) {
        const el = $('#' + id);
        el.checked = !!v[map[id]];
        el.addEventListener('change', () => {
          v[map[id]] = el.checked; app.saveState();
          if (id === 'viewRulers') app.fit(); else app.render();
        });
      }
      const mode = $('#viewMode');
      mode.value = v.mode;
      mode.addEventListener('change', () => { v.mode = mode.value; app.saveState(); app.render(); });
    },

    // ================= actions =================
    bindActions() {
      const A = {
        new: () => this.dlgNew(),
        library: () => this.dlgLibrary(),
        saveFile: () => app.saveFile(),
        openFile: () => $('#fileOpen').click(),
        importImage: () => this.dlgImport(),
        exportPng: () => this.dlgPng(),
        print: () => this.dlgPrint(),
        undo: () => app.undo(), redo: () => app.redo(),
        settings: () => this.dlgSettings(),
        help: () => $('#dlgHelp').showModal(),
        zoomIn: () => app.zoomCenter(1.25), zoomOut: () => app.zoomCenter(0.8), zoomFit: () => app.fit(),
        selectAll: () => app.selectAll(), deselect: () => app.deselect(),
        copy: () => app.copy(), cut: () => app.cut(), paste: () => app.paste(), delete: () => app.deleteSel(),
        flipH: () => app.flipH(), flipV: () => app.flipV(), rotate: () => app.rotate(), crop: () => app.crop(),
        commitFloat: () => app.commitFloat(),
        addThread: () => this.dlgThreads(),
        addCustom: () => this.dlgColor(-1),
        replaceColor: () => this.dlgReplace(),
        convertBrand: () => this.dlgConvert(),
        removeUnused: () => this.removeUnused(),
        sortPalette: () => this.sortPalette()
      };
      document.addEventListener('click', e => {
        const b = e.target.closest('[data-action]');
        if (!b || b.closest('dialog')) return;
        const f = A[b.dataset.action];
        if (!f) return;
        b.blur();
        if (!app.pattern && !['new', 'library', 'openFile', 'help'].includes(b.dataset.action)) {
          app.toast('No pattern is open yet. Use New or Open.');
          return;
        }
        f();
      });
    },

    // ================= palette =================
    refreshPalette() {
      const p = app.pattern;
      const list = $('#paletteList');
      const stats = p.stats();
      this._stats = stats;
      if (!p.palette.length) {
        list.innerHTML = '<div class="pal-empty">No colours yet. Add threads or a custom colour.</div>';
      } else {
        list.innerHTML = p.palette.map((e, i) => {
          const s = stats[i];
          const cnt = s.full + s.half + s.three + s.quarter;
          const extra = [s.back ? 'backstitch ' + s.back.toFixed(1) : '', s.knots ? s.knots + ' knots' : '', s.beads ? s.beads + ' beads' : ''].filter(Boolean).join(', ');
          return `<div class="pal-item${i === app.state.color ? ' active' : ''}" data-i="${i}" title="${U.esc(this.colorLabel(e))}${extra ? ' – ' + extra : ''}${i < 9 ? ' (key ' + (i + 1) + ')' : ''}">
            <span class="sw" style="background:${e.hex};color:${U.contrastColor(e.hex)}">${U.esc(e.symbol)}</span>
            <span class="nm">${e.brand ? `<b>${U.esc(e.code)}</b> ` : ''}${U.esc(e.name || e.hex)}${e.brand ? ` <small>${U.esc(e.brand)}</small>` : ''}</span>
            <span class="cnt">${cnt || (extra ? '•' : '')}</span>
            <span class="acts"><button data-edit="${i}" title="Edit colour">✎</button><button data-del="${i}" title="Remove colour">✕</button></span>
          </div>`;
        }).join('');
      }
      if (!list._bound) {
        list._bound = true;
        list.addEventListener('click', e => {
          const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
          if (ed) return this.dlgColor(+ed.dataset.edit);
          if (del) return this.removeColor(+del.dataset.del);
          const it = e.target.closest('.pal-item');
          if (it) { app.setColor(+it.dataset.i); this.setPaletteOpen(false); }
        });
        list.addEventListener('dblclick', e => { const it = e.target.closest('.pal-item'); if (it) this.dlgColor(+it.dataset.i); });
      }
      const cur = p.palette[app.state.color];
      const n = p.palette.length;
      $('#currentColor').innerHTML = (cur
        ? `<span class="sw" style="background:${cur.hex};color:${U.contrastColor(cur.hex)}">${U.esc(cur.symbol)}</span>
           <span class="txt"><b>${U.esc(cur.brand ? cur.brand + ' ' + cur.code : cur.hex)}</b>${U.esc(cur.name)}</span>`
        : '<span class="txt hint">No colour selected</span>') +
        `<span class="caret">${n} colour${n === 1 ? '' : 's'}</span>`;
      const active = list.querySelector('.pal-item.active');
      if (active && active.scrollIntoViewIfNeeded) active.scrollIntoViewIfNeeded(false);
      app.render();
    },
    refreshPaletteCounts() { this.refreshPalette(); },
    setPaletteOpen(open) {
      $('#paletteDrop').hidden = !open;
      $('#currentColor').setAttribute('aria-expanded', String(open));
      SP.Storage.prefs.set('paletteOpen', open);
      if (open) {
        const active = $('#paletteList .pal-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      }
    },
    colorLabel(e) { return (e.brand ? e.brand + ' ' + e.code + ' ' : '') + (e.name || '') + ' ' + e.hex; },

    removeColor(i) {
      const p = app.pattern;
      const used = p.usage()[i];
      if (used && !confirm(`"${this.colorLabel(p.palette[i])}" is used in the pattern. Remove it and erase everything in this colour?`)) return;
      const map = p.palette.map((_, k) => (k < i ? k : k > i ? k - 1 : -1));
      app.fullOp('Remove colour', () => p.remapColors(map, p.palette.filter((_, k) => k !== i)));
      if (app.state.color >= p.palette.length) app.state.color = Math.max(0, p.palette.length - 1);
      this.refreshPalette();
    },
    removeUnused() {
      const p = app.pattern, u = p.usage();
      const keep = p.palette.map((_, k) => u[k] > 0);
      const n = keep.filter(k => !k).length;
      if (!n) { app.toast('All colours are in use.'); return; }
      let j = 0;
      const map = keep.map(k => (k ? j++ : -1));
      const cur = map[app.state.color];
      app.fullOp('Remove unused colours', () => p.remapColors(map, p.palette.filter((_, k) => keep[k])));
      app.state.color = cur >= 0 ? cur : 0;
      this.refreshPalette();
      app.toast(`Removed ${n} unused colour${n > 1 ? 's' : ''}.`);
    },
    sortPalette() {
      const p = app.pattern;
      const num = s => { const n = parseFloat(s); return isNaN(n) ? Infinity : n; };
      const order = p.palette.map((e, i) => i).sort((a, b) => {
        const A = p.palette[a], B = p.palette[b];
        return (A.brand || '~').localeCompare(B.brand || '~') || num(A.code) - num(B.code) || String(A.code).localeCompare(String(B.code)) || U.luma(B.hex) - U.luma(A.hex);
      });
      const map = new Array(order.length);
      order.forEach((old, nw) => { map[old] = nw; });
      const cur = map[app.state.color];
      app.fullOp('Sort colours', () => p.remapColors(map, order.map(i => p.palette[i])));
      app.state.color = cur || 0;
      this.refreshPalette();
    },

    // ================= dialogs =================
    prepareDialogs() {
      $$('dialog').forEach(d => {
        $$('button[value=cancel]', d).forEach(b => {
          b.type = 'button';
          b.addEventListener('click', () => { d.close('cancel'); if (d._finish) d._finish(false); });
        });
      });
    },
    openDialog(id, onOk, onClose) {
      const d = $('#' + id), form = d.querySelector('form');
      d.returnValue = '';
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        form.removeEventListener('submit', onSubmit);
        d.removeEventListener('cancel', onCancel);
        d._finish = null;
        if (ok && onOk) onOk(form);
        if (onClose) onClose();
      };
      // handle OK synchronously on submit (the dialog 'close' event can be delayed by the browser)
      const onSubmit = e => {
        const v = e.submitter ? e.submitter.value : 'ok';
        if (v !== 'ok') return;
        e.preventDefault();
        d.close('ok');
        finish(true);
      };
      const onCancel = () => finish(false); // Escape key
      if (d._finish) d._finish(false);
      d._finish = finish;
      form.addEventListener('submit', onSubmit);
      d.addEventListener('cancel', onCancel);
      d.showModal();
      return d;
    },

    fillCraftSelect(sel, value) {
      sel.innerHTML = Object.keys(SP.CRAFTS).map(k => `<option value="${k}">${SP.CRAFTS[k].name}</option>`).join('');
      sel.value = value;
    },
    /** Builds the craft-specific inputs; returns a function that reads settings back. */
    buildCraftFields(box, settings, onChange) {
      const craft = SP.CRAFTS[settings.craft];
      box.innerHTML = '<div class="form-grid">' + craft.fields.map(f => {
        const v = settings[f.key];
        if (f.type === 'select') {
          return `<label>${f.label}</label><select data-k="${f.key}">` + f.options.map(o => {
            const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
            return `<option value="${val}"${String(val) === String(v) ? ' selected' : ''}>${lab}</option>`;
          }).join('') + '</select>';
        }
        return `<label>${f.label}</label><input type="number" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}">`;
      }).join('') + '</div>';
      $$('[data-k]', box).forEach(el => el.addEventListener('input', onChange));
      return (s) => {
        $$('[data-k]', box).forEach(el => {
          const raw = el.value;
          s[el.dataset.k] = isNaN(parseFloat(raw)) || el.dataset.k === 'drillShape' || el.dataset.k === 'beadLayout' ? raw : parseFloat(raw);
        });
        return s;
      };
    },
    sizeHint(w, h, settings) {
      const tmp = { w, h, settings };
      const fs = SP.finishedSize(tmp);
      return `Finished size: ${U.formatLen(fs[0], settings.units)} × ${U.formatLen(fs[1], settings.units)}`;
    },

    dlgNew() {
      const d = $('#dlgNew'), f = d.querySelector('form');
      const cur = app.pattern ? app.pattern.settings : SP.defaultSettings();
      const settings = Object.assign(SP.defaultSettings(), { units: cur.units });
      const sel = f.querySelector('.craft-select');
      this.fillCraftSelect(sel, cur.craft);
      settings.craft = sel.value;
      let read;
      const upd = () => {
        read(settings);
        $('.finished-size', d).textContent = this.sizeHint(+f.w.value || 1, +f.h.value || 1, settings);
      };
      const rebuild = () => { settings.craft = sel.value; read = this.buildCraftFields($('.craft-fields', d), settings, upd); upd(); };
      sel.onchange = rebuild;
      f.w.oninput = f.h.oninput = upd;
      rebuild();
      f.name.value = 'Untitled pattern';
      this.openDialog('dlgNew', () => {
        read(settings);
        const w = U.clamp(+f.w.value || 80, 1, 1000), h = U.clamp(+f.h.value || 80, 1, 1000);
        if (app.dirty) app.autosave.flush();
        app.setPattern(app.makePattern({ name: f.name.value.trim() || 'Untitled pattern', w, h, settings }), false);
      });
    },

    dlgSettings() {
      const p = app.pattern, d = $('#dlgSettings'), f = d.querySelector('form');
      const settings = Object.assign({}, p.settings);
      f.w.value = p.w; f.h.value = p.h;
      let anchor = [1, 1];
      const ag = $('#anchorGrid');
      ag.innerHTML = '';
      const arrows = ['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘'];
      for (let i = 0; i < 9; i++) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = arrows[i];
        b.title = 'Keep content anchored here';
        b.onclick = () => { anchor = [i % 3, (i / 3) | 0]; $$('button', ag).forEach((x, k) => x.classList.toggle('active', k === i)); };
        ag.appendChild(b);
      }
      $$('button', ag)[4].classList.add('active');
      const sel = f.querySelector('.craft-select');
      this.fillCraftSelect(sel, settings.craft);
      let read;
      const upd = () => {
        read(settings);
        settings.units = f.units.value;
        $('.finished-size', d).textContent = this.sizeHint(+f.w.value || 1, +f.h.value || 1, settings);
      };
      const rebuild = () => { settings.craft = sel.value; read = this.buildCraftFields($('.craft-fields', d), settings, upd); upd(); };
      sel.onchange = rebuild;
      f.w.oninput = f.h.oninput = upd;
      f.units.onchange = upd;
      ['fabricColor', 'gridColor', 'majorColor', 'centerColor'].forEach(k => { f[k].value = settings[k]; });
      f.majorEvery.value = settings.majorEvery;
      f.units.value = settings.units;
      rebuild();
      this.openDialog('dlgSettings', () => {
        read(settings);
        ['fabricColor', 'gridColor', 'majorColor', 'centerColor'].forEach(k => { settings[k] = f[k].value; });
        settings.majorEvery = U.clamp(+f.majorEvery.value || 10, 2, 100);
        settings.units = f.units.value;
        const nw = U.clamp(+f.w.value || p.w, 1, 1000), nh = U.clamp(+f.h.value || p.h, 1, 1000);
        const resized = nw !== p.w || nh !== p.h;
        const aspectChanged = SP.aspectOf(settings) !== SP.aspectOf(p.settings) || SP.layoutOf(settings) !== SP.layoutOf(p.settings);
        if (resized && (nw < p.w || nh < p.h) && !confirm('The pattern gets smaller. Stitches outside the new size are removed. Continue?')) return;
        app.fullOp('Pattern settings', () => {
          p.settings = settings;
          if (resized) {
            const dx = anchor[0] === 0 ? 0 : anchor[0] === 1 ? Math.floor((nw - p.w) / 2) : nw - p.w;
            const dy = anchor[1] === 0 ? 0 : anchor[1] === 1 ? Math.floor((nh - p.h) / 2) : nh - p.h;
            p.reframe(nw, nh, dx, dy);
          }
          p.version++;
        });
        app.selection = null;
        if (resized || aspectChanged) app.fit();
      });
    },

    dlgThreads() {
      const d = $('#dlgThreads');
      const brandSel = $('#threadBrand'), search = $('#threadSearch'), grid = $('#threadGrid');
      brandSel.innerHTML = Object.keys(SP.THREAD_BRANDS).map(k => `<option value="${k}">${SP.THREAD_BRANDS[k].name}</option>`).join('');
      brandSel.value = this._lastBrand || 'dmc';
      const picked = new Map();
      const render = () => {
        const lib = SP.threadLib(brandSel.value);
        const q = search.value.trim().toLowerCase();
        const p = app.pattern;
        const have = new Set(p.palette.map(e => e.brand + '|' + e.code));
        grid.innerHTML = lib.filter(t => !q || t.code.toLowerCase().startsWith(q) || t.name.toLowerCase().includes(q))
          .map(t => {
            const key = t.brand + '|' + t.code;
            return `<div class="thread${picked.has(key) ? ' sel' : ''}${have.has(key) ? ' has' : ''}" data-key="${U.esc(key)}" title="${U.esc(t.brand + ' ' + t.code + ' ' + t.name + ' ' + t.hex)}${have.has(key) ? ' (already in palette)' : ''}">
              <span class="sw" style="background:${t.hex}"></span><span class="t"><b>${U.esc(t.code)}</b> ${U.esc(t.name)}</span></div>`;
          }).join('') || '<p class="hint">No threads match.</p>';
        $('#threadSelCount').textContent = picked.size ? picked.size + ' selected' : 'Click threads to select them';
      };
      grid.onclick = e => {
        const it = e.target.closest('.thread'); if (!it) return;
        const key = it.dataset.key;
        if (picked.has(key)) picked.delete(key);
        else picked.set(key, SP.threadLib(brandSel.value).find(t => t.brand + '|' + t.code === key));
        it.classList.toggle('sel');
        $('#threadSelCount').textContent = picked.size ? picked.size + ' selected' : 'Click threads to select them';
      };
      grid.ondblclick = e => {
        const it = e.target.closest('.thread');
        if (!it) return;
        const key = it.dataset.key;
        if (!picked.has(key)) picked.set(key, SP.threadLib(brandSel.value).find(t => t.brand + '|' + t.code === key));
        d.querySelector('button[value=ok]').click();
      };
      brandSel.onchange = () => { this._lastBrand = brandSel.value; render(); };
      search.oninput = render;
      search.value = '';
      render();
      this.openDialog('dlgThreads', () => {
        if (!picked.size) return;
        const p = app.pattern;
        app.begin('Add threads');
        let last = -1;
        picked.forEach(t => { last = p.addColor({ brand: t.brand, code: t.code, name: t.name, hex: t.hex }); });
        app.commit();
        if (last >= 0) app.state.color = last;
        this.refreshPalette();
      });
      setTimeout(() => search.focus(), 50);
    },

    dlgColor(i) {
      const p = app.pattern, d = $('#dlgColor'), f = d.querySelector('form');
      const isNew = i < 0;
      const e = isNew ? { brand: '', code: '', name: '', hex: '#c2185b', symbol: SP.nextSymbol(p.palette) } : p.palette[i];
      $('.title', d).textContent = isNew ? 'Add custom colour' : 'Edit colour';
      f.hex.value = e.hex; f.name.value = e.name; f.brand.value = e.brand; f.code.value = e.code; f.symbol.value = e.symbol;
      const used = new Set(p.palette.filter((_, k) => k !== i).map(x => x.symbol));
      const pick = $('#symbolPick');
      pick.innerHTML = SP.SYMBOLS.map(s => `<button type="button" class="${used.has(s) ? 'used' : ''}" title="${used.has(s) ? 'Already used' : ''}">${U.esc(s)}</button>`).join('');
      pick.onclick = ev => { const b = ev.target.closest('button'); if (b) f.symbol.value = b.textContent; };
      const brandKey = () => (/anchor/i.test(f.brand.value) ? 'anchor' : 'dmc');
      const near = () => {
        const t = SP.nearestThread(f.hex.value, brandKey());
        $('.nearest', d).textContent = t ? `Closest ${t.brand}: ${t.code} ${t.name}` : '';
        return t;
      };
      f.hex.oninput = () => {
        near();
        if (f.brand.value) { f.brand.value = ''; f.code.value = ''; }
      };
      near();
      $('[data-nearest]', d).onclick = () => {
        const t = near();
        if (t) { f.hex.value = t.hex; f.brand.value = t.brand; f.code.value = t.code; f.name.value = t.name; }
      };
      this.openDialog('dlgColor', () => {
        const vals = { hex: f.hex.value, name: f.name.value.trim(), brand: f.brand.value.trim(), code: f.code.value.trim(), symbol: f.symbol.value.trim() || '?' };
        if (isNew) {
          app.begin('Add colour');
          const k = p.addColor(vals);
          app.commit();
          app.state.color = k;
        } else {
          app.begin('Edit colour');
          p.touch();
          Object.assign(p.palette[i], vals);
          app.commit();
        }
        this.refreshPalette();
      });
    },

    dlgReplace() {
      const p = app.pattern, f = $('#dlgReplace form');
      if (p.palette.length < 2) { app.toast('You need at least two colours.'); return; }
      const opts = p.palette.map((e, i) => `<option value="${i}">${U.esc(e.symbol + '  ' + this.colorLabel(e))}</option>`).join('');
      f.from.innerHTML = opts; f.to.innerHTML = opts;
      f.from.value = app.state.color; f.to.value = app.state.color === 0 ? 1 : 0;
      this.openDialog('dlgReplace', () => {
        const from = +f.from.value, to = +f.to.value;
        if (from === to) return;
        const map = p.palette.map((_, k) => { const t = k === from ? to : k; return t > from ? t - 1 : t; });
        app.fullOp('Replace colour', () => p.remapColors(map, p.palette.filter((_, k) => k !== from)));
        app.state.color = map[to];
        this.refreshPalette();
      });
    },

    dlgConvert() {
      const p = app.pattern, f = $('#dlgConvert form');
      f.brand.innerHTML = Object.keys(SP.THREAD_BRANDS).map(k => `<option value="${k}">${SP.THREAD_BRANDS[k].name}</option>`).join('');
      this.openDialog('dlgConvert', () => {
        const brand = f.brand.value;
        const np = [], map = [];
        p.palette.forEach(e => {
          const t = SP.nearestThread(e.hex, brand);
          let k = np.findIndex(x => x.code === t.code);
          if (k < 0) { k = np.length; np.push({ brand: t.brand, code: t.code, name: t.name, hex: t.hex, symbol: e.symbol }); }
          map.push(k);
        });
        const merged = p.palette.length - np.length;
        app.fullOp('Match to ' + SP.THREAD_BRANDS[brand].name, () => p.remapColors(map, np));
        app.state.color = map[app.state.color] || 0;
        this.refreshPalette();
        app.toast(`Converted to ${SP.THREAD_BRANDS[brand].name}${merged ? `, ${merged} colour(s) merged` : ''}.`);
      });
    },

    dlgImport() {
      const d = $('#dlgImport'), f = d.querySelector('form');
      const fileIn = $('#impFile'), orig = $('#impOrig'), res = $('#impResult');
      const sel = f.querySelector('.craft-select');
      this.fillCraftSelect(sel, app.pattern.settings.craft);
      let img = null, result = null, fileName = '';
      const settingsFor = () => Object.assign(SP.defaultSettings(), { craft: sel.value, units: app.pattern.settings.units });
      const syncH = () => {
        if (!img || !f.lock.checked) return;
        const asp = SP.aspectOf(settingsFor());
        f.h.value = Math.max(4, Math.round(+f.w.value * img.height / img.width / asp));
      };
      const syncW = () => {
        if (!img || !f.lock.checked) return;
        const asp = SP.aspectOf(settingsFor());
        f.w.value = Math.max(4, Math.round(+f.h.value * img.width / img.height * asp));
      };
      const run = U.debounce(() => {
        if (!img) return;
        const o = {
          w: U.clamp(+f.w.value || 80, 4, 600), h: U.clamp(+f.h.value || 80, 4, 600),
          colors: U.clamp(+f.colors.value || 20, 2, 128), source: f.source.value, currentPalette: app.pattern.palette,
          dither: f.dither.value, bg: f.bg.value, bgTol: +f.bgTol.value, bright: +f.bright.value, contrast: +f.contrast.value,
          sat: +f.sat.value, minCount: +f.minCount.value || 0
        };
        $('#impInfo').textContent = 'working…';
        setTimeout(() => {
          try {
            result = SP.Importer.convert(img, o);
            this.drawImportResult(res, result, settingsFor());
            $('#impInfo').textContent = `${result.w} × ${result.h}, ${result.palette.length} colours`;
          } catch (err) { $('#impInfo').textContent = err.message; result = null; }
        }, 10);
      }, 250);
      fileIn.value = '';
      orig.width = orig.height = res.width = res.height = 0;
      $('#impInfo').textContent = 'choose an image';
      fileIn.onchange = () => {
        const file = fileIn.files[0];
        if (!file) return;
        fileName = file.name.replace(/\.[^.]+$/, '');
        SP.Importer.loadImage(file).then(im => {
          img = im;
          const sc = Math.min(1, 480 / Math.max(im.width, im.height));
          orig.width = Math.round(im.width * sc); orig.height = Math.round(im.height * sc);
          orig.getContext('2d').drawImage(im, 0, 0, orig.width, orig.height);
          syncH(); run();
        }).catch(err => alert(err.message));
      };
      f.w.oninput = () => { syncH(); run(); };
      f.h.oninput = () => { syncW(); run(); };
      sel.onchange = () => { syncH(); run(); };
      $$('select, input[type=range], input[name=colors], input[name=minCount]', f).forEach(el => {
        if (el !== sel) el.oninput = el.onchange = run;
      });
      this.openDialog('dlgImport', () => {
        if (!result) return;
        const settings = settingsFor();
        const p = new SP.Pattern(result.w, result.h, settings);
        p.id = U.uid();
        p.name = fileName || 'Imported image';
        result.palette.forEach(e => p.palette.push(Object.assign({}, e, { symbol: SP.nextSymbol(p.palette) })));
        for (let i = 0; i < result.idx.length; i++) {
          const v = result.idx[i];
          if (v >= 0) { p.legs[i * 4] = p.legs[i * 4 + 1] = p.legs[i * 4 + 2] = p.legs[i * 4 + 3] = v + 1; }
        }
        if (app.dirty) app.autosave.flush();
        app.setPattern(p, false);
        app.toast('Pattern created from image. Your previous pattern is in Open.');
      });
    },
    drawImportResult(cv, r, settings) {
      const asp = SP.aspectOf(settings);
      const cell = Math.max(1, Math.floor(480 / Math.max(r.w, r.h * asp)));
      const ch = cell * asp;
      cv.width = r.w * cell; cv.height = Math.round(r.h * ch);
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const v = r.idx[y * r.w + x];
        if (v < 0) continue;
        ctx.fillStyle = r.palette[v].hex;
        ctx.fillRect(x * cell, Math.floor(y * ch), cell, Math.ceil(ch));
      }
    },

    dlgPng() {
      const d = $('#dlgPng'), f = d.querySelector('form');
      f.mode.value = app.viewOpts.mode;
      const upd = () => {
        const sz = SP.Exporter.pngSize(app.pattern, +f.cell.value || 12, f.rulers.checked);
        $('.png-size', d).textContent = `Image size: ${sz[0]} × ${sz[1]} pixels` + (sz[0] > 16000 || sz[1] > 16000 ? ' – too large, use a smaller cell size' : '');
      };
      f.cell.oninput = f.rulers.onchange = upd;
      upd();
      this.openDialog('dlgPng', () => {
        const o = { cell: U.clamp(+f.cell.value || 12, 1, 60), mode: f.mode.value, grid: f.grid.checked, rulers: f.rulers.checked, transparent: f.transparent.checked };
        const sz = SP.Exporter.pngSize(app.pattern, o.cell, o.rulers);
        if (sz[0] > 16000 || sz[1] > 16000) { alert('The image would be too large. Choose a smaller cell size.'); return; }
        SP.Exporter.exportPng(app.pattern, o);
      });
    },

    dlgPrint() {
      const d = $('#dlgPrint'), f = d.querySelector('form');
      const opts = () => ({ mode: f.mode.value, paper: f.paper.value, orient: f.orient.value, cellmm: U.clamp(+f.cellmm.value || 3, 1.5, 10),
        overlap: U.clamp(+f.overlap.value || 0, 0, 10), cover: f.cover.checked, key: f.key.checked });
      const upd = () => {
        const l = SP.Exporter.pageLayout(app.pattern, opts());
        $('.print-info', d).textContent = `${l.tiles.length} chart page(s), ${l.cols} × ${l.rows} cells per page.`;
      };
      $$('select, input', f).forEach(el => { el.oninput = el.onchange = upd; });
      upd();
      this.openDialog('dlgPrint', () => {
        if (app.floating) app.commitFloat();
        setTimeout(() => SP.Exporter.print(app.pattern, opts()), 50);
      });
    },

    dlgLibrary() {
      if (app.dirty) app.autosave.flush();
      const box = $('#libraryList');
      box.innerHTML = '<p class="hint">Loading…</p>';
      const load = () => SP.Storage.list().then(items => {
        if (!items.length) { box.innerHTML = '<p class="hint">No saved patterns yet.</p>'; return; }
        box.innerHTML = items.map(it => {
          const cur = it.id === app.pattern.id;
          return `<div class="lib-item${cur ? ' current' : ''}" data-id="${it.id}">
            ${it.thumb ? `<img src="${it.thumb}" alt="">` : '<img alt="">'}
            <div class="t" title="${U.esc(it.name)}">${U.esc(it.name)}</div>
            <div class="d">${it.w} × ${it.h} · ${U.esc((SP.CRAFTS[it.craft] || SP.CRAFTS.cross).name)}<br>${new Date(it.updated).toLocaleString()}</div>
            <div class="b">
              <button type="button" data-open ${cur ? 'disabled' : ''}>${cur ? 'Open now' : 'Open'}</button>
              <button type="button" data-dup>Duplicate</button>
              <button type="button" data-delete ${cur ? 'disabled title="This pattern is open"' : ''}>Delete</button>
            </div></div>`;
        }).join('');
      }).catch(err => { box.innerHTML = `<p class="hint">${U.esc(err.message)}</p>`; });
      box.onclick = e => {
        const it = e.target.closest('.lib-item'); if (!it) return;
        const id = it.dataset.id;
        if (e.target.closest('[data-open]')) {
          SP.Storage.get(id).then(rec => {
            const p = SP.Pattern.fromJSON(rec.data); p.id = rec.id;
            $('#dlgLibrary').close();
            app.setPattern(p, true);
          }).catch(err => alert('Could not open: ' + err.message));
        } else if (e.target.closest('[data-dup]')) {
          SP.Storage.get(id).then(rec => {
            const copy = Object.assign({}, rec, { id: U.uid(), name: rec.name + ' (copy)', updated: Date.now() });
            copy.data = Object.assign({}, rec.data, { name: copy.name });
            return SP.Storage.save(copy);
          }).then(load);
        } else if (e.target.closest('[data-delete]')) {
          const name = it.querySelector('.t').textContent;
          if (confirm(`Delete "${name}" from this browser? This cannot be undone.`)) SP.Storage.remove(id).then(load);
        }
      };
      load();
      this.openDialog('dlgLibrary');
    }
  };
})(window.SP);
