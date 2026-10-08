/* Stitch / row counter page: configurable counters with keyboard keys, targets and roll-over,
   plus "follow a pattern": a chart with a live position that moves one stitch per key press. */
(function (SP) {
  const U = SP.util, $ = U.$, $$ = U.$$, Geo = SP.Geo;
  const STORE = SP.Profiles.key('counter'); // counters / projects per profile

  const DEF_SETTINGS = { sound: true, targetSound: true, vibrate: true, repeat: false, tapCard: true, wake: false, size: 'm', undoKey: null };
  const PRESETS = {
    stitches: { name: 'Stitches', color: '#c2185b', keyUp: { code: 'Space', label: 'Space' } },
    rows: { name: 'Rows', color: '#1565c0', keyUp: { code: 'Enter', label: 'Enter' } },
    repeats: { name: 'Repeats', color: '#2e7d32', keyUp: { code: 'KeyR', label: 'R' } },
    rounds: { name: 'Rounds', color: '#6a1b9a', keyUp: { code: 'KeyO', label: 'O' } }
  };
  const DEF_PAT = {
    patternId: null,
    keys: { next: { code: 'Space', label: 'Space' }, back: { code: 'Backspace', label: 'Backspace' }, finish: { code: 'Enter', label: 'Enter' } },
    stitchCounter: null, groupCounter: null, resetEach: true,
    lookAhead: 3, colourSound: true, groupSound: true,
    tool: 'jump', follow: true, focus: false, view: 'colorsymbols', doneStyle: 'todo'
  };

  const newCounter = (o) => Object.assign({
    id: U.uid(), name: 'Counter', color: '#c2185b', value: 0, step: 1, start: 0, min: 0,
    target: null, onTarget: 'notify', linkTo: null, keyUp: null, keyDown: null
  }, o || {});
  const newSet = (name) => {
    const rows = newCounter(Object.assign({}, PRESETS.rows));
    const sts = newCounter(Object.assign({}, PRESETS.stitches, { linkTo: rows.id }));
    return { id: U.uid(), name, notes: '', log: [], counters: [sts, rows], pat: null };
  };

  // ---------------- state ----------------
  let state;
  try { state = JSON.parse(localStorage.getItem(STORE)); } catch (e) { state = null; }
  if (!state || !Array.isArray(state.sets) || !state.sets.length) {
    const s = newSet('My project');
    state = { sets: [s], current: s.id, settings: {} };
  }
  state.settings = Object.assign({}, DEF_SETTINGS, state.settings);
  const save = U.debounce(() => {
    if (SP.Profiles.leaving) return; // switching profiles
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }, 250);
  const set = () => state.sets.find(s => s.id === state.current) || state.sets[0];
  const byId = id => set().counters.find(c => c.id === id);
  const normPat = (s) => {
    const p = s.pat || {};
    s.pat = Object.assign({}, DEF_PAT, p, { keys: Object.assign({}, DEF_PAT.keys, p.keys || {}) });
    if (!s.pat.v) { s.pat.doneStyle = 'todo'; s.pat.v = 2; } // new default: finished stitches in colour
    return s.pat;
  };
  state.sets.forEach(normPat);

  const undoStack = [];
  const session = { start: Date.now(), counts: 0 };

  // ---------------- feedback ----------------
  let actx = null;
  function beep(freq, dur, when, type) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + (when || 0);
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq; o.type = type || 'sine';
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio not available */ }
  }
  const clickSound = () => { if (state.settings.sound) beep(1400, 0.04); };
  const targetSound = () => { if (state.settings.targetSound) { beep(880, 0.15); beep(1320, 0.25, 0.16); } };
  const colourSound = () => { beep(660, 0.12, 0, 'triangle'); beep(990, 0.12, 0.13, 'triangle'); };
  const groupSound = () => { beep(523, 0.1); beep(659, 0.1, 0.1); beep(784, 0.18, 0.2); };
  const vibrate = (ms) => { if (state.settings.vibrate && navigator.vibrate) navigator.vibrate(ms); };

  function flashCard(id, cls) {
    const el = $(`.ct-card[data-id="${id}"]`);
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), cls === 'flash' ? 700 : 90);
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------------- counting ----------------
  /** Remember counter values (and optionally a pattern change) for undo. */
  function snapshot(label, pat) {
    const e = { setId: set().id, values: set().counters.map(c => [c.id, c.value]), logLen: set().log.length, label, pat: null };
    if (pat && PS.rec) e.pat = { id: PS.rec.id, cells: pat.cells || [], old: pat.old || [], vec: pat.vec || [], pos: pat.pos };
    undoStack.push(e);
    if (undoStack.length > 500) undoStack.shift();
    return e;
  }
  function log(text) {
    const s = set();
    s.log.push({ t: Date.now(), text });
    if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  }
  function signalTargets(signals) {
    if (!signals.length) return;
    targetSound(); vibrate([60, 60, 120]);
    signals.forEach(id => flashCard(id, 'flash'));
    const names = signals.map(id => byId(id)).filter(Boolean).map(x => x.name);
    toast('Target reached: ' + names.join(', '));
  }

  /** Change counter c by one step up (+1) or down (-1). */
  function count(c, dir) {
    snapshot(c.name);
    const signals = [];
    apply(c, dir, 0, signals);
    if (dir > 0) session.counts++;
    clickSound(); vibrate(15);
    signalTargets(signals);
    save(); render();
    flashCard(c.id, 'bump');
  }
  function apply(c, dir, depth, signals) {
    const prev = c.value;
    if (dir > 0) {
      if (c.target && c.onTarget === 'stop' && prev >= c.target) { signals.push(c.id); return; }
      let nv = c.value + c.step;
      if (c.target && c.onTarget === 'stop' && nv > c.target) nv = c.target;
      c.value = nv;
      log(`<b>${U.esc(c.name)}</b> ${prev} → ${nv}`);
      // roll-over also fires when the value was already past a (newly set) target
      if (c.target && nv >= c.target && (prev < c.target || c.onTarget === 'rollover')) {
        signals.push(c.id);
        if (c.onTarget === 'rollover') {
          c.value = c.start;
          const link = c.linkTo && byId(c.linkTo);
          log(`<b>${U.esc(c.name)}</b> reached ${c.target}, back to ${c.start}`);
          if (link && link !== c && depth < 10) apply(link, 1, depth + 1, signals);
        }
      }
    } else {
      const nv = Math.max(c.min, c.value - c.step);
      if (nv === prev) return;
      c.value = nv;
      log(`<b>${U.esc(c.name)}</b> ${prev} → ${nv}`);
    }
  }
  function undo() {
    const e = undoStack.pop();
    if (!e) { toast('Nothing to undo.'); return; }
    const s = state.sets.find(x => x.id === e.setId);
    if (!s) return;
    const switched = state.current !== s.id;
    state.current = s.id;
    for (const [id, v] of e.values) { const c = s.counters.find(x => x.id === id); if (c) c.value = v; }
    s.log.length = Math.min(s.log.length, e.logLen);
    if (e.pat && PS.rec && PS.rec.id === e.pat.id) {
      const D = PS.rec.done;
      e.pat.cells.forEach((i, k) => { D[i] = e.pat.old[k]; });
      e.pat.vec.forEach(([key, had]) => { if (had) PS.rec.vec.add(key); else PS.rec.vec.delete(key); });
      PS.pos = e.pat.pos;
      PS.celebrated = false;
      saveProgress();
    } else session.counts = Math.max(0, session.counts - 1);
    save();
    if (switched) loadPattern(); else render(true);
    toast('Undone: ' + e.label);
  }
  function resetCounter(c) {
    snapshot(c.name + ' reset');
    log(`<b>${U.esc(c.name)}</b> reset ${c.value} → ${c.start}`);
    c.value = c.start;
    save(); render();
  }

  // ---------------- keys ----------------
  const keyLabel = e => {
    if (e.code === 'Space') return 'Space';
    const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    if (arrows[e.code]) return arrows[e.code];
    if (e.code.startsWith('Numpad')) return 'Num ' + (e.key.length === 1 ? e.key : e.code.slice(6));
    if (e.key && e.key.length === 1) return e.key.toUpperCase();
    return e.key || e.code;
  };
  const kbd = k => (k ? `<span class="kbd">${U.esc(k.label)}</span>` : '');
  let capturing = null; // { apply(key), cancel() }

  document.addEventListener('keydown', e => {
    if (capturing) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { capturing.cancel(); capturing = null; return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      capturing.apply({ code: e.code, label: keyLabel(e) });
      capturing = null;
      if (document.activeElement) document.activeElement.blur();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = set();
    if (state.settings.undoKey && state.settings.undoKey.code === e.code) {
      e.preventDefault();
      if (!e.repeat || state.settings.repeat) undo();
      return;
    }
    // pattern keys win over counters with the same key
    if (PS.p) {
      for (const kind of ['next', 'back', 'finish']) {
        const k = s.pat.keys[kind];
        if (k && k.code === e.code) {
          e.preventDefault();
          if (!e.repeat || state.settings.repeat) patAction(kind);
          return;
        }
      }
    }
    const ups = s.counters.filter(c => c.keyUp && c.keyUp.code === e.code);
    const downs = s.counters.filter(c => c.keyDown && c.keyDown.code === e.code);
    if (!ups.length && !downs.length) return;
    e.preventDefault();
    if (e.repeat && !state.settings.repeat) return;
    ups.forEach(c => count(c, 1));
    downs.forEach(c => count(c, -1));
  }, true);

  // ================= follow a pattern =================
  const PS = {
    p: null, rec: null, seq: null, pos: 0, view: { ox: 30, oy: 30, cw: 14 }, geo: null,
    canvas: $('#ppCanvas'), ctx: null, w: 0, h: 0, dpr: 1,
    active: 0, last: 0, steps: 0, celebrated: false, paint: null, pan: null, raf: 0
  };
  PS.ctx = PS.canvas.getContext('2d');
  const RULER = 20;

  const saveProgress = U.debounce(() => {
    if (!PS.rec || SP.Profiles.leaving) return;
    PS.rec.pos = PS.pos;
    SP.Storage.progress.save(SP.Progress.encode(PS.rec))
      .then(() => SP.bus.post({ type: 'progress', id: PS.rec.id }))
      .catch(err => toast('Could not save progress: ' + err.message));
  }, 400);

  async function loadPattern(opts) {
    opts = opts || {};
    const s = set(), cfg = s.pat;
    if (!cfg || !cfg.patternId) { PS.p = PS.rec = PS.seq = null; layout(); render(true); return; }
    try {
      const rec = await SP.Storage.get(cfg.patternId);
      if (!rec) {
        toast('That pattern no longer exists.');
        cfg.patternId = null; save(); PS.p = PS.rec = PS.seq = null; layout(); render(true); return;
      }
      const p = SP.Pattern.fromJSON(rec.data); p.id = rec.id;
      const pr = await SP.Storage.progress.get(p.id);
      let prog = pr ? SP.Progress.decode(pr) : null;
      if (prog && (prog.w !== p.w || prog.h !== p.h)) {
        if (confirm(`"${p.name}" changed size since you started, so the stitching progress no longer fits. Start over with this pattern?`)) prog = null;
        else { cfg.patternId = null; save(); PS.p = PS.rec = PS.seq = null; layout(); render(true); return; }
      }
      const same = PS.p && PS.p.id === p.id;
      if (!prog) prog = SP.Progress.newRecord(p, opts.order);
      else if (opts.order) prog.order = SP.Progress.normOrder(opts.order);
      PS.p = p; PS.rec = prog;
      PS.seq = SP.Progress.build(p, prog.order);
      PS.pos = opts.order ? nextPos(0) : nextPos(Math.min(prog.pos || 0, PS.seq.steps.length));
      const st = SP.Progress.stats(p, prog, PS.seq.col);
      PS.celebrated = st.total > 0 && st.done === st.total;
      layout();
      if (!same || opts.fit) { fitView(); ensureVisible(true); drawChart(); }
      render(true);
      saveProgress();
    } catch (err) { console.error(err); toast('Could not open the pattern: ' + err.message); }
  }
  // reload when the pattern is changed in the editor (another tab)
  SP.bus.on(msg => {
    if (msg && msg.type === 'pattern' && PS.p && msg.id === PS.p.id) {
      saveProgress.flush();
      setTimeout(() => loadPattern(), 150);
    }
  });

  function firstUndone(k) {
    const S = PS.seq.steps, D = PS.rec.done;
    while (k < S.length && D[S[k]]) k++;
    return k;
  }
  /** Next not-done stitch from k; wraps to skipped stitches earlier in the order. */
  function nextPos(k) {
    let j = firstUndone(k);
    if (j >= PS.seq.steps.length) j = firstUndone(0);
    return j;
  }
  function groupDone(g) {
    const seq = PS.seq, D = PS.rec.done;
    if (g < 0 || seq.gStart[g] < 0) return true;
    for (let k = seq.gStart[g]; k < seq.gEnd[g]; k++) if (!D[seq.steps[k]]) return false;
    return true;
  }
  const word = () => (PS.seq ? PS.seq.word : 'row');
  const shortWord = () => ({ 'colour in this block': 'colour' }[word()] || word());
  const colorLabel = e => (e ? (e.brand ? `${e.brand} ${e.code}` : e.hex) + (e.name ? ' ' + e.name : '') : '');
  const swatch = (e, cls) => (e ? `<span class="${cls}" style="background:${e.hex};color:${U.contrastColor(e.hex)}">${U.esc(e.symbol)}</span>` : '');

  function patAction(kind) {
    if (!PS.p) return;
    const cfg = set().pat, seq = PS.seq, S = seq.steps, D = PS.rec.done, len = S.length;
    if (seq.order.mode === 'free') { toast('Free order: click stitches on the chart to mark them done (Mark done tool).'); return; }
    if (!len) { toast('This pattern has no stitches.'); return; }
    if (kind === 'next' || kind === 'finish') {
      if (PS.pos >= len) { toast('Everything is done! 🎉'); return; }
      const k0 = PS.pos, g = seq.groups[k0];
      const cells = [];
      if (kind === 'next') cells.push(S[k0]);
      else for (let k = k0; k < seq.gEnd[g]; k++) if (!D[S[k]]) cells.push(S[k]);
      snapshot(kind === 'next' ? 'Stitch' : 'Finish ' + shortWord(), { cells, old: cells.map(() => 0), pos: k0 });
      const wasComplete = groupDone(g);
      cells.forEach(i => { D[i] = 1; });
      PS.pos = nextPos(kind === 'next' ? k0 + 1 : seq.gEnd[g]);
      afterDone(cells.length, g, wasComplete, cells[cells.length - 1]);
    } else if (kind === 'back') {
      let j = Math.min(PS.pos, len) - 1;
      while (j >= 0 && !D[S[j]]) j--;
      if (j < 0) { toast('Nothing to go back to.'); return; }
      snapshot('Back', { cells: [S[j]], old: [1], pos: PS.pos });
      D[S[j]] = 0; PS.pos = j; PS.celebrated = false;
      const c = cfg.stitchCounter && byId(cfg.stitchCounter);
      if (c) apply(c, -1, 0, []);
      clickSound();
      commitPattern();
    }
  }
  function afterDone(n, g, wasComplete, lastCell) {
    const cfg = set().pat, seq = PS.seq, signals = [];
    const sc = cfg.stitchCounter && byId(cfg.stitchCounter);
    if (sc) for (let k = 0; k < n; k++) apply(sc, 1, 0, signals);
    trackSpeed(n);
    session.counts += n;
    let msg = null;
    if (!wasComplete && groupDone(g)) {
      const gc = cfg.groupCounter && byId(cfg.groupCounter);
      if (gc) apply(gc, 1, 0, signals);
      if (sc && cfg.resetEach && sc !== gc) sc.value = sc.start;
      if (cfg.groupSound) groupSound();
      msg = `${seq.info[g].name} finished`;
    }
    if (PS.pos < seq.steps.length) {
      const nc = seq.col[seq.steps[PS.pos]], oc = seq.col[lastCell];
      if (nc !== oc && nc >= 0) {
        if (cfg.colourSound) colourSound();
        banner(`Change colour → ${swatch(PS.p.palette[nc], 'mini')} ${U.esc(colorLabel(PS.p.palette[nc]))}`);
      }
    }
    clickSound(); vibrate(15);
    signalTargets(signals);
    if (msg && !signals.length) toast(msg);
    const st = SP.Progress.stats(PS.p, PS.rec, seq.col);
    if (st.total && st.done === st.total && !PS.celebrated) { PS.celebrated = true; celebrate(); }
    commitPattern();
  }
  function commitPattern() {
    saveProgress(); save();
    if (set().pat.follow) ensureVisible();
    render();
  }
  function trackSpeed(n) {
    const now = Date.now();
    if (PS.last && now - PS.last < 3 * 60 * 1000) PS.active += now - PS.last;
    PS.last = now; PS.steps += n;
  }
  function banner(html) {
    const b = $('#ppBanner');
    b.innerHTML = html; b.hidden = false;
    clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 2800);
  }
  function celebrate() {
    toast('Pattern finished! Well done 🎉');
    beep(523, 0.12); beep(659, 0.12, 0.12); beep(784, 0.12, 0.24); beep(1047, 0.35, 0.36);
    const box = $('#confetti');
    const cols = PS.p.palette.map(e => e.hex).concat(['#c2185b', '#ffd54f', '#4fc3f7']);
    for (let i = 0; i < 140; i++) {
      const el = document.createElement('i');
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = cols[i % cols.length];
      el.style.animationDuration = (2 + Math.random() * 2.5) + 's';
      el.style.animationDelay = Math.random() * 0.8 + 's';
      box.appendChild(el);
    }
    setTimeout(() => { box.innerHTML = ''; }, 5500);
  }

  // ---------- chart view ----------
  function layout() {
    const on = !!PS.p;
    document.body.classList.toggle('has-pattern', on);
    $('#patternPane').hidden = !on;
    $('#patternStatus').hidden = !on;
    $('#patternEmpty').hidden = on;
    if (on) resizeChart(); else renderEmptyList();
  }

  // ---------- choosing / importing a pattern ----------
  /** Counters that should count along by default: "Stitches" per stitch, "Rows" per row. */
  function defaultLinks(s) {
    const guess = (name, code) => (s.counters.find(c => c.name.toLowerCase() === name) || s.counters.find(c => c.keyUp && c.keyUp.code === code) || {}).id || null;
    return { stitchCounter: guess('stitches', 'Space'), groupCounter: guess('rows', 'Enter') };
  }
  function linkPattern(id, s) {
    s = s || set();
    saveProgress.flush();
    const first = !s.pat.stitchCounter && !s.pat.groupCounter;
    s.pat.patternId = id;
    if (first) Object.assign(s.pat, defaultLinks(s));
    state.current = s.id;
    save();
    return loadPattern({ fit: true });
  }
  function renderEmptyList() {
    const box = $('#peList');
    SP.Storage.list().then(async items => {
      if (!items.length) { box.innerHTML = '<p class="hint">You have no saved patterns yet. Import a pattern file, or make one in the pattern editor.</p>'; return; }
      box.innerHTML = items.map(it => `<div class="pat-item" data-id="${it.id}" title="Follow this pattern">
          <img src="${it.thumb || ''}" alt=""><div><div class="t">${U.esc(it.name)}</div>
          <div class="d">${it.w} × ${it.h} · ${U.esc((SP.CRAFTS[it.craft] || SP.CRAFTS.cross).name)}<br><span data-pct></span></div></div></div>`).join('');
      for (const it of items) {
        const pr = await SP.Storage.progress.get(it.id).catch(() => null);
        if (!pr) continue;
        const rec = SP.Progress.decode(pr);
        const n = rec.done.reduce((a, b) => a + b, 0);
        const el = box.querySelector(`[data-id="${it.id}"] [data-pct]`);
        if (el && n) el.textContent = `${n} stitches done`;
      }
    }).catch(err => { box.innerHTML = `<p class="hint">${U.esc(err.message)}</p>`; });
  }
  $('#peList').addEventListener('click', e => {
    const it = e.target.closest('.pat-item');
    if (it) linkPattern(it.dataset.id);
  });
  function importPatternFile(file) {
    file.text().then(txt => {
      const p = SP.Pattern.fromJSON(JSON.parse(txt));
      p.id = U.uid();
      const rec = { id: p.id, name: p.name, updated: Date.now(), w: p.w, h: p.h, craft: p.settings.craft,
        thumb: SP.Exporter.thumbnail(p, 180), data: p.toJSON() };
      return SP.Storage.save(rec).then(() => {
        const d = $('#dlgPattern');
        if (d.open) closeDialog(d);
        toast(`Imported "${p.name}". It is also in the pattern editor under Open.`);
        return linkPattern(p.id);
      });
    }).catch(err => alert('Could not import this file: ' + err.message));
  }
  $('#patFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importPatternFile(f);
    e.target.value = '';
  });

  /** counter.html?pattern=<id> (the editor's Counter button): follow that pattern straight away. */
  async function openFromUrl() {
    const id = new URLSearchParams(location.search).get('pattern');
    if (!id) return false;
    history.replaceState(null, '', location.pathname);
    const rec = await SP.Storage.get(id).catch(() => null);
    if (!rec || (rec.profile || 'default') !== SP.Profiles.current().id) return false;
    let s = state.sets.find(x => x.pat && x.pat.patternId === id);
    if (!s && !set().pat.patternId) s = set();
    if (!s) { // current project follows another pattern: make a project for this one
      s = newSet(rec.name);
      normPat(s);
      state.sets.push(s);
    }
    await linkPattern(id, s);
    toast(`Following "${rec.name}". Press Space for each stitch.`);
    return true;
  }
  function resizeChart() {
    const box = $('.pp-canvas');
    const dpr = window.devicePixelRatio || 1;
    PS.w = box.clientWidth; PS.h = box.clientHeight; PS.dpr = dpr;
    PS.canvas.width = Math.max(1, Math.round(PS.w * dpr));
    PS.canvas.height = Math.max(1, Math.round(PS.h * dpr));
    if (set().pat.follow) ensureVisible();
    drawChart();
  }
  new ResizeObserver(() => { if (PS.p) resizeChart(); }).observe($('.pp-canvas'));

  function fitView() {
    const p = PS.p;
    if (!p || !PS.w) return;
    const asp = SP.aspectOf(p.settings), lay = SP.layoutOf(p.settings);
    const aw = PS.w - RULER - 24, ah = PS.h - RULER - 24;
    const cw = U.clamp(Math.min(aw / (p.w + (lay === 'brick' ? 0.5 : 0)), ah / ((p.h + (lay === 'peyote' ? 0.5 : 0)) * asp)), 1, 60);
    const sz = Geo.size(Geo.make(p, { ox: 0, oy: 0, cw }));
    PS.view = { cw, ox: Math.round(RULER + (PS.w - RULER - sz[0]) / 2), oy: Math.round(RULER + (PS.h - RULER - sz[1]) / 2) };
  }
  function cellRect(i) {
    const g = PS.geo || Geo.make(PS.p, PS.view);
    const xy = Geo.cellXY(g, i % PS.p.w, (i / PS.p.w) | 0);
    return [xy[0], xy[1], g.cw, g.ch];
  }
  /** Keep the current stitch on screen; zoom in to a readable size the first time. */
  function ensureVisible(force) {
    if (!PS.p || !PS.seq || PS.pos >= PS.seq.steps.length || !PS.w) return;
    if (force && PS.view.cw < 12) PS.view.cw = 14;
    PS.geo = Geo.make(PS.p, PS.view);
    const r = cellRect(PS.seq.steps[PS.pos]);
    const mx = PS.w * 0.18, my = PS.h * 0.18;
    if (force || r[0] < RULER + mx || r[0] + r[2] > PS.w - mx || r[1] < RULER + my || r[1] + r[3] > PS.h - my) {
      PS.view.ox += (RULER + PS.w) / 2 - (r[0] + r[2] / 2);
      PS.view.oy += (RULER + PS.h) / 2 - (r[1] + r[3] / 2);
    }
  }
  function requestDraw() {
    if (PS.raf) return;
    PS.raf = requestAnimationFrame(() => { PS.raf = 0; drawChart(); });
  }

  function drawChart() {
    if (!PS.p || !PS.w) return;
    const ctx = PS.ctx, W = PS.w, H = PS.h, p = PS.p, cfg = set().pat, seq = PS.seq;
    ctx.setTransform(PS.dpr, 0, 0, PS.dpr, 0, 0);
    const g = PS.geo = Geo.make(p, PS.view);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#c2185b';
    SP.Renderer.render(ctx, p, g, {
      width: W, height: H, mode: cfg.view, grid: true, major: true, center: false, rulers: false,
      back: true, knots: true, marks: true, highlight: -1, bg: css.getPropertyValue('--workspace').trim() || '#d9d5d0'
    });
    SP.Progress.drawDone(ctx, p, g, PS.rec, cfg.doneStyle, W, H);
    const S = seq.steps;
    if (seq.order.mode !== 'free' && PS.pos < S.length) {
      const k = PS.pos, gi = seq.groups[k];
      if (cfg.focus) focusOverlay(ctx, g, gi, W, H);
      // the rest of the current colour run
      const cur = S[k], cc = seq.col[cur];
      ctx.save();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
      let shown = 0;
      for (let j = k + 1; j < S.length && shown < 60; j++) {
        const i = S[j];
        if (PS.rec.done[i]) continue;
        if (seq.col[i] !== cc || seq.groups[j] !== gi) break;
        const r = cellRect(i);
        if (r[2] >= 6) ctx.strokeRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
        shown++;
      }
      ctx.restore();
      // the current stitch
      const r = cellRect(cur), lw = Math.max(2.5, Math.min(r[2], r[3]) * 0.16);
      ctx.save();
      ctx.lineWidth = lw + 3; ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(r[0] - lw / 2, r[1] - lw / 2, r[2] + lw, r[3] + lw);
      ctx.lineWidth = lw; ctx.strokeStyle = accent;
      ctx.strokeRect(r[0] - lw / 2, r[1] - lw / 2, r[2] + lw, r[3] + lw);
      if (r[2] < 8) { // too small to see: add a target ring
        ctx.beginPath(); ctx.arc(r[0] + r[2] / 2, r[1] + r[3] / 2, 14, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    const vx0 = Math.max(0, Math.floor(-g.ox / g.cw) - 1), vx1 = Math.min(p.w, Math.ceil((W - g.ox) / g.cw) + 1);
    const vy0 = Math.max(0, Math.floor(-g.oy / g.ch) - 1), vy1 = Math.min(p.h, Math.ceil((H - g.oy) / g.ch) + 1);
    SP.Renderer.drawRulers(ctx, p, g, {
      width: W, height: H, rulerSize: RULER,
      rulerBg: css.getPropertyValue('--panel').trim(), rulerText: css.getPropertyValue('--muted').trim()
    }, vx0, vx1, vy0, vy1, 0, 0, p.w, p.h);
  }
  function focusOverlay(ctx, g, gi, W, H) {
    const seq = PS.seq, info = seq.info[gi], p = PS.p;
    const path = new Path2D();
    path.rect(0, 0, W, H);
    if (info.rect) {
      const a = Geo.cellXY(g, info.rect.x0, info.rect.y0);
      path.rect(a[0], a[1], (info.rect.x1 - info.rect.x0) * g.cw, (info.rect.y1 - info.rect.y0) * g.ch);
    } else if (seq.order.mode === 'rows' || seq.order.mode === 'columns') {
      const i = seq.steps[seq.gStart[gi]], x = i % p.w, y = (i / p.w) | 0;
      if (seq.order.mode === 'rows') { const a = Geo.cellXY(g, 0, y); path.rect(g.ox, a[1], p.w * g.cw + g.cw, g.ch); }
      else { const a = Geo.cellXY(g, x, 0); path.rect(a[0], g.oy, g.cw, p.h * g.ch + g.ch); }
    } else {
      const n = seq.gEnd[gi] - seq.gStart[gi];
      if (n > 8000) return;
      for (let k = seq.gStart[gi]; k < seq.gEnd[gi]; k++) { const r = cellRect(seq.steps[k]); path.rect(r[0], r[1], r[2], r[3]); }
    }
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fill(path, 'evenodd');
    ctx.restore();
  }

  // ---------- chart mouse ----------
  function chartPoint(e) {
    const r = PS.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const g = PS.geo || Geo.make(PS.p, PS.view);
    return { sx, sy, cell: Geo.pointToCell(g, sx, sy), hx: (sx - g.ox) / (g.cw / 2), hy: (sy - g.oy) / (g.ch / 2) };
  }
  function hitVector(pt) {
    const p = PS.p;
    let best = null, bd = 0.9 * 0.9;
    for (const [t, arr] of [['k', p.knots], ['b', p.beads]]) for (const k of arr) {
      const d = (k.x - pt.hx) ** 2 + (k.y - pt.hy) ** 2;
      if (d <= bd) { bd = d; best = SP.Progress.vecKey(t, k); }
    }
    if (best) return best;
    const li = p.nearestLine(pt.hx, pt.hy, 0.6);
    return li >= 0 ? SP.Progress.vecKey('l', p.lines[li]) : null;
  }
  function paintCell(cell) {
    const p = PS.p, P = PS.paint;
    if (!p.inside(cell.x, cell.y)) return;
    const i = cell.y * p.w + cell.x;
    if (PS.seq.col[i] < 0 || PS.rec.done[i] === P.val) return;
    P.entry.pat.cells.push(i); P.entry.pat.old.push(PS.rec.done[i]);
    PS.rec.done[i] = P.val;
    P.changed++;
  }
  PS.canvas.addEventListener('contextmenu', e => e.preventDefault());
  PS.canvas.addEventListener('pointerdown', e => {
    if (!PS.p) return;
    PS.canvas.setPointerCapture(e.pointerId);
    const pt = chartPoint(e), tool = set().pat.tool;
    if (e.button !== 0 || tool === 'pan') { PS.pan = { sx: pt.sx, sy: pt.sy, ox: PS.view.ox, oy: PS.view.oy }; PS.canvas.style.cursor = 'grabbing'; return; }
    const p = PS.p, c = pt.cell;
    if (tool === 'jump') {
      if (!p.inside(c.x, c.y)) return;
      const i = c.y * p.w + c.x, k = PS.seq.posOf[i];
      if (PS.seq.order.mode === 'free') { toast('Free order has no position. Use Mark done instead.'); return; }
      if (k < 0) { toast('There is no stitch in that cell.'); return; }
      snapshot('Jump', { cells: [], old: [], pos: PS.pos });
      if (PS.rec.done[i]) { PS.pos = nextPos(k); toast('That stitch is already done. Continuing at the next open stitch.'); }
      else PS.pos = k;
      commitPattern();
      return;
    }
    const val = tool === 'mark' ? 1 : 0;
    const entry = snapshot(val ? 'Mark done' : 'Unmark', { cells: [], old: [], vec: [], pos: PS.pos });
    const vk = hitVector(pt);
    if (vk) {
      const had = PS.rec.vec.has(vk);
      if (had === !!val) { undoStack.pop(); return; }
      entry.pat.vec.push([vk, had]);
      if (val) PS.rec.vec.add(vk); else PS.rec.vec.delete(vk);
      commitPattern();
      return;
    }
    PS.paint = { entry, val, last: c, changed: 0 };
    paintCell(c);
    requestDraw();
  });
  PS.canvas.addEventListener('pointermove', e => {
    if (!PS.p) return;
    const pt = chartPoint(e);
    if (PS.pan) {
      PS.view.ox = PS.pan.ox + pt.sx - PS.pan.sx; PS.view.oy = PS.pan.oy + pt.sy - PS.pan.sy;
      requestDraw(); return;
    }
    if (PS.paint) {
      for (const q of U.lineCells(PS.paint.last.x, PS.paint.last.y, pt.cell.x, pt.cell.y)) paintCell({ x: q[0], y: q[1] });
      PS.paint.last = pt.cell;
      requestDraw();
    }
  });
  const endPointer = () => {
    if (PS.pan) { PS.pan = null; PS.canvas.style.cursor = set().pat.tool === 'pan' ? 'grab' : 'crosshair'; return; }
    if (!PS.paint) return;
    const P = PS.paint;
    PS.paint = null;
    if (!P.changed) { if (undoStack[undoStack.length - 1] === P.entry) undoStack.pop(); return; }
    if (PS.pos < PS.seq.steps.length && PS.rec.done[PS.seq.steps[PS.pos]]) PS.pos = nextPos(PS.pos);
    if (!P.val) PS.celebrated = false;
    const st = SP.Progress.stats(PS.p, PS.rec, PS.seq.col);
    if (st.total && st.done === st.total && !PS.celebrated) { PS.celebrated = true; celebrate(); }
    saveProgress(); save(); render();
  };
  PS.canvas.addEventListener('pointerup', endPointer);
  PS.canvas.addEventListener('pointercancel', endPointer);
  PS.canvas.addEventListener('wheel', e => {
    if (!PS.p) return;
    e.preventDefault();
    const pt = chartPoint(e);
    const f = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
    const cw = U.clamp(PS.view.cw * f, 1, 120), k = cw / PS.view.cw;
    PS.view.ox = pt.sx - (pt.sx - PS.view.ox) * k; PS.view.oy = pt.sy - (pt.sy - PS.view.oy) * k; PS.view.cw = cw;
    requestDraw();
  }, { passive: false });
  const zoomBy = f => {
    const cx = (PS.w + RULER) / 2, cy = (PS.h + RULER) / 2;
    const cw = U.clamp(PS.view.cw * f, 1, 120), k = cw / PS.view.cw;
    PS.view.ox = cx - (cx - PS.view.ox) * k; PS.view.oy = cy - (cy - PS.view.oy) * k; PS.view.cw = cw;
    requestDraw();
  };
  $('#ppZoomIn').onclick = () => zoomBy(1.3);
  $('#ppZoomOut').onclick = () => zoomBy(1 / 1.3);
  $('#ppFit').onclick = () => { fitView(); requestDraw(); };
  $('#ppFind').onclick = () => { ensureVisible(true); requestDraw(); };
  $('#ppTool').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]'); if (!b) return;
    set().pat.tool = b.dataset.tool; save(); renderPatternTools(); b.blur();
  });
  $('#ppFollow').onchange = e => { set().pat.follow = e.target.checked; save(); if (e.target.checked) { ensureVisible(); requestDraw(); } };
  $('#ppFocus').onchange = e => { set().pat.focus = e.target.checked; save(); requestDraw(); };
  $('#ppView').onchange = e => { set().pat.view = e.target.value; save(); requestDraw(); e.target.blur(); };
  $('#ppDone').onchange = e => { set().pat.doneStyle = e.target.value; save(); requestDraw(); e.target.blur(); };
  $('#patternStatus').addEventListener('click', e => {
    const b = e.target.closest('[data-pact]');
    if (b) { patAction(b.dataset.pact); b.blur(); }
  });

  function renderPatternTools() {
    const cfg = set().pat;
    $$('#ppTool [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === cfg.tool));
    $('#ppFollow').checked = cfg.follow; $('#ppFocus').checked = cfg.focus;
    $('#ppView').value = cfg.view; $('#ppDone').value = cfg.doneStyle;
    PS.canvas.style.cursor = cfg.tool === 'pan' ? 'grab' : 'crosshair';
  }

  function fmtDuration(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h < 48 ? `${h} h ${m % 60} min` : `${Math.round(h / 24)} days (${h} h)`;
  }

  function renderPatternStatus() {
    const cfg = set().pat, p = PS.p, seq = PS.seq, S = seq.steps, D = PS.rec.done, len = S.length;
    $('#psName').textContent = p.name;
    $('#psOrder').textContent = SP.Progress.describe(seq.order);
    $('#psFinishBtn').textContent = 'Finish ' + shortWord();
    const free = seq.order.mode === 'free';
    $$('.ps-btns button').forEach(b => { b.disabled = free; });
    let cur = '', grp = '', ahead = '';
    if (free) {
      cur = '<span class="hint">Free order: use <b>Mark done</b> and click or drag over the stitches you finished.</span>';
    } else if (!len) {
      cur = '<span class="hint">This pattern has no stitches yet.</span>';
    } else if (PS.pos >= len) {
      cur = '<b>All stitches are done 🎉</b>';
    } else {
      const i = S[PS.pos], c = seq.col[i], e = p.palette[c];
      cur = `${swatch(e, 'sw')}<span class="t"><b>${U.esc(colorLabel(e))}</b><span>Column ${i % p.w + 1}, row ${((i / p.w) | 0) + 1}</span></span>`;
      const g = seq.groups[PS.pos], info = seq.info[g];
      let gDone = 0;
      for (let k = seq.gStart[g]; k < seq.gEnd[g]; k++) if (D[S[k]]) gDone++;
      const gTot = seq.gEnd[g] - seq.gStart[g];
      const of = seq.order.mode === 'blocks' ? '' : ` of ${seq.groupCount}`;
      grp = `<b>${U.esc(info.name)}</b>${of}${info.chart ? ` <span class="hint">(${info.chart})</span>` : ''} ${info.dir || ''}` +
        (info.colour != null && seq.order.mode === 'blocks' ? ` · ${swatch(p.palette[info.colour], 'mini')} ${U.esc(colorLabel(p.palette[info.colour]))}` : '') +
        `<br>Stitch <b>${gDone + 1}</b> of ${gTot} in this ${word()}`;
      // look-ahead: runs of the same colour
      const runs = [];
      let lastG = g;
      for (let k = PS.pos; k < len && runs.length <= cfg.lookAhead; k++) {
        const ci = S[k];
        if (D[ci]) continue;
        const col = seq.col[ci], brk = seq.groups[k] !== lastG;
        lastG = seq.groups[k];
        const r = runs[runs.length - 1];
        if (r && r.c === col && !brk) r.n++;
        else { if (runs.length === cfg.lookAhead) break; runs.push({ c: col, n: 1, brk }); }
      }
      ahead = runs.map((r, idx) => (r.brk ? `<span class="brk">next ${shortWord()}:</span> ` : idx ? '→ ' : '') +
        `<span class="run${idx === 0 ? ' first' : ''}">${r.n} × ${swatch(p.palette[r.c], 'mini')} ${U.esc(p.palette[r.c] ? (p.palette[r.c].code || p.palette[r.c].name || '') : '')}</span>`).join(' ');
    }
    $('#psCurrent').innerHTML = cur;
    $('#psGroup').innerHTML = grp;
    $('#psAhead').innerHTML = ahead;
    const k = cfg.keys;
    $('#psKeys').innerHTML = [k.next && `${kbd(k.next)} next`, k.back && `${kbd(k.back)} back`, k.finish && `${kbd(k.finish)} finish ${shortWord()}`].filter(Boolean).join(' · ');

    const st = SP.Progress.stats(p, PS.rec, seq.col);
    const pct = st.total ? st.done / st.total * 100 : 0;
    $('#psBar').style.width = pct + '%';
    const lines = [`<b>${st.done.toLocaleString()}</b> of ${st.total.toLocaleString()} stitches done (<b>${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.floor(pct)}%</b>)`];
    if (st.vecTotal) lines.push(`Backstitches, knots &amp; beads: ${st.vecDone} of ${st.vecTotal} <span class="hint">(tick off with Mark done)</span>`);
    if (PS.steps >= 5 && PS.active > 20000) {
      const perMs = PS.steps / PS.active;
      lines.push(`Speed: <b>${Math.round(perMs * 3600000)}</b> stitches per hour`);
      if (st.total > st.done) lines.push(`Time left: about <b>${fmtDuration((st.total - st.done) / perMs)}</b>`);
    }
    lines.push(`Started ${new Date(PS.rec.started).toLocaleDateString()}`);
    $('#psTotals').innerHTML = lines.join('<br>');
    $('#psColourList').innerHTML = st.perColour.map((c, i) => {
      if (!c.total) return '';
      const e = p.palette[i];
      return `<div class="pc"><span class="mini" style="background:${e.hex}"></span><span class="nm">${U.esc(colorLabel(e))}</span>
        <span class="n">${c.done}/${c.total}</span><div class="bar"><div style="width:${c.done / c.total * 100}%;background:${e.hex}"></div></div></div>`;
    }).join('');
  }

  // ---------------- rendering ----------------
  function render(full) {
    const s = set();
    document.body.dataset.size = state.settings.size;
    const sel = $('#setSelect');
    sel.innerHTML = state.sets.map(x => `<option value="${x.id}">${U.esc(x.name)}</option>`).join('');
    sel.value = s.id;
    if (full || document.activeElement !== $('#setNotes')) $('#setNotes').value = s.notes || '';

    const box = $('#counters');
    const linked = PS.p ? [s.pat.stitchCounter, s.pat.groupCounter] : [];
    if (!s.counters.length) {
      box.innerHTML = '<div class="ct-empty">No counters yet. Click <b>+ Counter</b> to add one.</div>';
    } else {
      box.innerHTML = s.counters.map(c => {
        const pct = c.target ? Math.min(100, (c.value - Math.min(c.start, 0)) / c.target * 100) : 0;
        const done = c.target && c.value >= c.target;
        const link = c.onTarget === 'rollover' && c.linkTo ? byId(c.linkTo) : null;
        const auto = linked.includes(c.id) ? `<div class="ct-roll">Counts along with the pattern</div>` : '';
        return `<div class="ct-card${state.settings.tapCard ? ' tap' : ''}${done ? ' done' : ''}" data-id="${c.id}" style="--c:${c.color};--on-c:${U.contrastColor(c.color)}">
          <div class="ct-head"><span class="ct-name" title="${U.esc(c.name)}">${U.esc(c.name)}</span>
            <span class="ct-icons"><button data-reset title="Reset to ${c.start}">↺</button><button data-edit title="Settings">⚙</button></span></div>
          <div class="ct-value">${c.value}</div>
          <div class="ct-target">${c.target ? `${c.value} / ${c.target}${done ? ' ✓' : ''}` : c.step !== 1 ? `steps of ${c.step}` : ''}</div>
          ${c.target ? `<div class="ct-bar"><div style="width:${pct}%"></div></div>` : ''}
          ${link ? `<div class="ct-roll">At ${c.target}: back to ${c.start} and +1 ${U.esc(link.name)}</div>` : ''}${auto}
          <div class="ct-btns"><button data-minus title="Count down">−</button><button data-plus class="plus" title="Count up">+</button></div>
          <div class="ct-keys">${c.keyUp ? `+ ${kbd(c.keyUp)}` : ''} ${c.keyDown ? `− ${kbd(c.keyDown)}` : ''} ${!c.keyUp && !c.keyDown ? 'no keys set' : ''}</div>
        </div>`;
      }).join('');
    }
    const keys = [];
    if (PS.p) {
      const k = s.pat.keys;
      if (k.next) keys.push(`${kbd(k.next)} next stitch`);
      if (k.back) keys.push(`${kbd(k.back)} back`);
      if (k.finish) keys.push(`${kbd(k.finish)} finish ${shortWord()}`);
    }
    const pk = PS.p ? Object.values(s.pat.keys).filter(Boolean).map(k => k.code) : [];
    s.counters.filter(c => c.keyUp && !pk.includes(c.keyUp.code)).forEach(c => keys.push(`${kbd(c.keyUp)} ${U.esc(c.name)}`));
    if (state.settings.undoKey) keys.push(`${kbd(state.settings.undoKey)} undo`);
    $('#keyHint').innerHTML = keys.length ? 'Keys: ' + keys.join(' · ') + ' · Ctrl+Z undo' : 'Tip: give a counter a keyboard key in its ⚙ settings.';
    $('#historyList').innerHTML = s.log.slice(-60).reverse().map(l =>
      `<li><span>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> ${l.text}</li>`).join('') || '<li>No counts yet.</li>';
    $('[data-act=undo]').disabled = !undoStack.length;
    renderSession();
    if (PS.p) { renderPatternTools(); renderPatternStatus(); requestDraw(); }
  }
  function renderSession() {
    const sec = Math.floor((Date.now() - session.start) / 1000);
    const hh = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60, ss = sec % 60;
    const rate = sec > 30 ? Math.round(session.counts / (sec / 3600)) : null;
    $('#sessionInfo').innerHTML =
      `Time: <b>${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</b><br>` +
      `Counted up: <b>${session.counts}</b>` + (rate != null ? `<br>Speed: <b>${rate}</b> per hour` : '');
  }
  setInterval(renderSession, 1000);

  // card clicks
  $('#counters').addEventListener('click', e => {
    const card = e.target.closest('.ct-card');
    if (!card) return;
    const c = byId(card.dataset.id);
    if (!c) return;
    if (e.target.closest('[data-plus]')) count(c, 1);
    else if (e.target.closest('[data-minus]')) count(c, -1);
    else if (e.target.closest('[data-edit]')) openCounter(c);
    else if (e.target.closest('[data-reset]')) { if (confirm(`Reset "${c.name}" to ${c.start}?`)) resetCounter(c); }
    else if (state.settings.tapCard && !e.target.closest('button')) count(c, 1);
  });

  // ---------------- dialogs ----------------
  function openDialog(d, onOk) {
    const form = d.querySelector('form');
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      form.removeEventListener('submit', onSubmit);
      d.removeEventListener('cancel', onCancel);
      d._finish = null;
      if (capturing) { capturing.cancel(); capturing = null; }
      if (ok) onOk(form);
    };
    const onSubmit = e => {
      if ((e.submitter ? e.submitter.value : 'ok') !== 'ok') return;
      e.preventDefault(); d.close('ok'); finish(true);
    };
    const onCancel = () => finish(false);
    if (d._finish) d._finish(false);
    d._finish = finish;
    form.addEventListener('submit', onSubmit);
    d.addEventListener('cancel', onCancel);
    d.showModal();
  }
  const closeDialog = d => { d.close('cancel'); if (d._finish) d._finish(false); };
  $$('dialog').forEach(d => $$('button[value=cancel]', d).forEach(b => {
    b.type = 'button';
    b.addEventListener('click', () => closeDialog(d));
  }));

  function startCapture(btn, applyKey) {
    if (capturing) capturing.cancel();
    const old = btn.innerHTML;
    btn.classList.add('listening'); btn.textContent = 'Press a key…';
    capturing = {
      apply: k => { btn.classList.remove('listening'); applyKey(k); },
      cancel: () => { btn.classList.remove('listening'); btn.innerHTML = old; }
    };
  }

  function openCounter(c) {
    const s = set(), d = $('#dlgCounter'), f = d.querySelector('form');
    const isNew = !c;
    const cur = c ? Object.assign({}, c) : newCounter({ color: ['#c2185b', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f'][s.counters.length % 6], name: 'Counter ' + (s.counters.length + 1) });
    $('.title', d).textContent = isNew ? 'New counter' : 'Counter settings';
    const keys = { keyUp: cur.keyUp, keyDown: cur.keyDown };
    const fill = () => {
      f.name.value = cur.name; f.color.value = cur.color; f.step.value = cur.step; f.start.value = cur.start;
      f.min.value = cur.min; f.target.value = cur.target || ''; f.onTarget.value = cur.onTarget;
    };
    const others = s.counters.filter(x => x.id !== cur.id);
    f.linkTo.innerHTML = '<option value="">(none)</option>' + others.map(x => `<option value="${x.id}">${U.esc(x.name)}</option>`).join('');
    f.linkTo.value = cur.linkTo || '';
    const showRoll = () => $$('.roll-row', d).forEach(el => { el.hidden = f.onTarget.value !== 'rollover'; });
    f.onTarget.onchange = showRoll;
    const renderKeys = () => {
      $$('[data-capture]', d).forEach(b => { b.innerHTML = keys[b.dataset.capture] ? kbd(keys[b.dataset.capture]) : '<span class="hint">click to set</span>'; });
      const warn = [];
      for (const k of ['keyUp', 'keyDown']) {
        const key = keys[k]; if (!key) continue;
        const clash = others.filter(x => (x.keyUp && x.keyUp.code === key.code) || (x.keyDown && x.keyDown.code === key.code)).map(x => x.name);
        if (state.settings.undoKey && state.settings.undoKey.code === key.code) clash.push('Undo');
        if (s.pat && s.pat.patternId && Object.values(s.pat.keys).some(pk => pk && pk.code === key.code)) clash.push('the pattern (pattern wins)');
        if (clash.length) warn.push(`${key.label} is also used by: ${clash.join(', ')}`);
      }
      if (keys.keyUp && keys.keyDown && keys.keyUp.code === keys.keyDown.code) warn.push('Count up and count down use the same key.');
      $('.key-warn', d).textContent = warn.join(' · ');
    };
    $$('[data-capture]', d).forEach(b => { b.onclick = () => startCapture(b, k => { keys[b.dataset.capture] = k; renderKeys(); }); });
    $$('[data-clear]', d).forEach(b => { b.onclick = () => { keys[b.dataset.clear] = null; renderKeys(); }; });
    $$('[data-preset]', d).forEach(b => {
      b.onclick = () => {
        const p = PRESETS[b.dataset.preset];
        cur.name = p.name; cur.color = p.color; keys.keyUp = p.keyUp;
        f.name.value = cur.name; f.color.value = cur.color; renderKeys();
      };
    });
    const del = $('[data-delete-counter]', d);
    del.hidden = isNew;
    del.onclick = () => {
      if (!confirm(`Delete counter "${cur.name}"?`)) return;
      s.counters = s.counters.filter(x => x.id !== cur.id);
      s.counters.forEach(x => { if (x.linkTo === cur.id) x.linkTo = null; });
      if (s.pat.stitchCounter === cur.id) s.pat.stitchCounter = null;
      if (s.pat.groupCounter === cur.id) s.pat.groupCounter = null;
      closeDialog(d);
      save(); render();
    };
    fill(); showRoll(); renderKeys();
    openDialog(d, () => {
      const num = (v, def) => { const n = parseInt(v, 10); return isNaN(n) ? def : n; };
      const out = c || cur;
      Object.assign(out, {
        name: f.name.value.trim() || 'Counter', color: f.color.value,
        step: Math.max(1, num(f.step.value, 1)), start: num(f.start.value, 0), min: num(f.min.value, 0),
        target: num(f.target.value, 0) > 0 ? num(f.target.value, 0) : null,
        onTarget: f.onTarget.value, linkTo: f.linkTo.value || null,
        keyUp: keys.keyUp, keyDown: keys.keyDown
      });
      if (out.min > out.start) out.min = out.start;
      if (isNew) { out.value = out.start; s.counters.push(out); }
      if (out.value < out.min) out.value = out.min;
      save(); render();
    });
    setTimeout(() => f.name.select(), 30);
  }

  function openSettings() {
    const d = $('#dlgCtSettings'), f = d.querySelector('form');
    const st = state.settings;
    let undoKey = st.undoKey;
    ['sound', 'targetSound', 'vibrate', 'repeat', 'tapCard', 'wake'].forEach(k => { f[k].checked = !!st[k]; });
    f.size.value = st.size;
    const capBtn = $('[data-capture-global]', d);
    const showKey = () => { capBtn.innerHTML = undoKey ? kbd(undoKey) : '<span class="hint">click to set</span>'; };
    capBtn.onclick = () => startCapture(capBtn, k => { undoKey = k; showKey(); });
    $('[data-clear-global]', d).onclick = () => { undoKey = null; showKey(); };
    showKey();
    openDialog(d, () => {
      ['sound', 'targetSound', 'vibrate', 'repeat', 'tapCard', 'wake'].forEach(k => { st[k] = f[k].checked; });
      st.size = f.size.value; st.undoKey = undoKey;
      save(); render(); updateWakeLock();
    });
  }

  function openPatternDialog() {
    const s = set(), d = $('#dlgPattern'), f = d.querySelector('form');
    const cfg = JSON.parse(JSON.stringify(s.pat));
    const keys = cfg.keys;
    let selId = cfg.patternId, selCraft = null;
    let order = PS.p && PS.p.id === selId ? Object.assign({}, PS.rec.order) : null;
    const origOrder = order ? JSON.stringify(order) : null;

    // pattern list
    const list = $('#patList');
    list.innerHTML = '<p class="hint">Loading…</p>';
    SP.Storage.list().then(items => {
      if (!items.length) { list.innerHTML = '<p class="hint">No saved patterns yet. Make or import one in the pattern editor first.</p>'; return; }
      list.innerHTML = items.map(it => `<div class="pat-item${it.id === selId ? ' sel' : ''}" data-id="${it.id}" data-craft="${U.esc(it.craft || 'cross')}">
          <img src="${it.thumb || ''}" alt=""><div><div class="t">${U.esc(it.name)}</div>
          <div class="d">${it.w} × ${it.h} · ${U.esc((SP.CRAFTS[it.craft] || SP.CRAFTS.cross).name)}</div></div></div>`).join('');
      const selEl = list.querySelector('.pat-item.sel');
      if (selEl) { selCraft = selEl.dataset.craft; selEl.scrollIntoView({ block: 'nearest' }); }
    }).catch(err => { list.innerHTML = `<p class="hint">${U.esc(err.message)}</p>`; });
    list.onclick = e => {
      const it = e.target.closest('.pat-item'); if (!it) return;
      $$('.pat-item', list).forEach(x => x.classList.toggle('sel', x === it));
      selId = it.dataset.id; selCraft = it.dataset.craft;
      SP.Storage.progress.get(selId).then(pr => {
        order = pr ? SP.Progress.decode(pr).order : SP.Progress.defaultOrder({ craft: selCraft });
        fillOrder();
      });
    };

    // order
    f.preset.innerHTML = '<option value="">(choose…)</option>' + Object.keys(SP.Progress.PRESETS).map(k => `<option value="${k}">${SP.Progress.PRESETS[k].label}</option>`).join('');
    f.mode.innerHTML = SP.Progress.MODES.map(m => `<option value="${m[0]}">${m[1]}</option>`).join('');
    const fillOrder = () => {
      const o = SP.Progress.normOrder(order || SP.Progress.defaultOrder({ craft: selCraft || 'cross' }));
      f.mode.value = o.mode; f.startY.value = o.startY; f.startX.value = o.startX; f.corner.value = o.corner;
      f.snake.checked = o.snake; f.block.value = o.block; f.inBlock.value = o.inBlock; f.blockSnake.checked = o.blockSnake;
      showModes();
    };
    const readOrder = () => {
      order = SP.Progress.normOrder({
        mode: f.mode.value, startY: f.startY.value, startX: f.startX.value, corner: f.corner.value, snake: f.snake.checked,
        block: U.clamp(+f.block.value || 10, 2, 100), inBlock: f.inBlock.value, blockSnake: f.blockSnake.checked
      });
      showModes();
    };
    const showModes = () => {
      $$('[data-modes]', d).forEach(el => { el.hidden = !el.dataset.modes.split(' ').includes(f.mode.value); });
      const w = SP.Progress.GROUP_WORD[f.mode.value] || 'row';
      $('.finish-word', d).textContent = f.mode.value === 'blocks' && f.inBlock.value === 'colour' ? 'Finish colour' : 'Finish ' + (w || 'row');
      $('.finish-each', d).textContent = f.mode.value === 'blocks' && f.inBlock.value === 'colour' ? 'Each finished colour in a block' : `Each finished ${w || 'row'}`;
      $('.order-info', d).textContent = order ? SP.Progress.describe(order) + '.' : '';
    };
    f.preset.onchange = () => { const pr = SP.Progress.PRESETS[f.preset.value]; if (pr) { order = SP.Progress.normOrder(pr.order); fillOrder(); } };
    ['mode', 'startY', 'startX', 'corner', 'snake', 'block', 'inBlock', 'blockSnake'].forEach(n => { f[n].onchange = () => { f.preset.value = ''; readOrder(); }; });
    f.preset.value = '';
    fillOrder();

    // keys
    const renderKeys = () => $$('[data-pkey]', d).forEach(b => { b.innerHTML = keys[b.dataset.pkey] ? kbd(keys[b.dataset.pkey]) : '<span class="hint">click to set</span>'; });
    $$('[data-pkey]', d).forEach(b => { b.onclick = () => startCapture(b, k => { keys[b.dataset.pkey] = k; renderKeys(); }); });
    $$('[data-pclear]', d).forEach(b => { b.onclick = () => { keys[b.dataset.pclear] = null; renderKeys(); }; });
    renderKeys();

    // counters
    const guessed = defaultLinks(s);
    const opts = '<option value="">(none)</option>' + s.counters.map(c => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('');
    f.stitchCounter.innerHTML = opts; f.groupCounter.innerHTML = opts;
    const firstLink = !cfg.patternId && !cfg.stitchCounter && !cfg.groupCounter;
    f.stitchCounter.value = cfg.stitchCounter || (firstLink ? guessed.stitchCounter || '' : '');
    f.groupCounter.value = cfg.groupCounter || (firstLink ? guessed.groupCounter || '' : '');
    f.colourSound.checked = cfg.colourSound; f.groupSound.checked = cfg.groupSound; f.resetEach.checked = cfg.resetEach;
    f.lookAhead.value = String(cfg.lookAhead);

    $('[data-unlink]', d).hidden = !s.pat.patternId;
    $('[data-unlink]', d).onclick = () => {
      saveProgress.flush();
      s.pat.patternId = null; save();
      closeDialog(d);
      PS.p = PS.rec = PS.seq = null; layout(); render(true);
      toast('Stopped following the pattern. Your progress is kept.');
    };
    $('[data-reset-progress]', d).onclick = () => {
      if (!selId) { toast('Choose a pattern first.'); return; }
      if (!confirm('Reset all stitching progress for this pattern? This cannot be undone.')) return;
      SP.Storage.progress.remove(selId).then(() => {
        if (PS.p && PS.p.id === selId) {
          PS.rec = SP.Progress.newRecord(PS.p, order);
          PS.seq = SP.Progress.build(PS.p, PS.rec.order);
          PS.pos = nextPos(0); PS.celebrated = false;
          undoStack.length = 0;
          saveProgress(); render();
        }
        SP.bus.post({ type: 'progress', id: selId });
        toast('Progress reset.');
      });
    };

    openDialog(d, () => {
      if (!selId) { toast('Choose a pattern to follow.'); return; }
      Object.assign(s.pat, {
        patternId: selId, keys,
        stitchCounter: f.stitchCounter.value || null, groupCounter: f.groupCounter.value || null,
        colourSound: f.colourSound.checked, groupSound: f.groupSound.checked, resetEach: f.resetEach.checked,
        lookAhead: +f.lookAhead.value || 3
      });
      save();
      const orderChanged = order && JSON.stringify(order) !== origOrder;
      if (PS.p && PS.p.id === selId) {
        if (orderChanged) {
          saveProgress.flush();
          PS.rec.order = SP.Progress.normOrder(order);
          PS.seq = SP.Progress.build(PS.p, PS.rec.order);
          PS.pos = nextPos(0);
          saveProgress(); ensureVisible(true);
        }
        render(true);
      } else {
        saveProgress.flush();
        loadPattern({ order: orderChanged ? order : null, fit: true });
      }
    });
  }

  // ---------------- screen wake lock ----------------
  let wakeLock = null;
  async function updateWakeLock() {
    try {
      if (state.settings.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { $('#ctMsg').textContent = 'Keeping the screen on is not supported here (needs https or localhost).'; }
  }
  document.addEventListener('visibilitychange', updateWakeLock);

  // ---------------- toolbar ----------------
  const ACTS = {
    pattern: openPatternDialog,
    importPattern: () => $('#patFile').click(),
    addCounter: () => openCounter(null),
    undo,
    settings: openSettings,
    resetAll: () => {
      const s = set();
      if (!s.counters.length || !confirm(`Reset all counters in "${s.name}"? (Pattern progress is not changed.)`)) return;
      snapshot('Reset all');
      s.counters.forEach(c => { c.value = c.start; });
      log('<b>All counters</b> reset');
      save(); render();
    },
    resetSession: () => { session.start = Date.now(); session.counts = 0; PS.active = 0; PS.steps = 0; PS.last = 0; render(); },
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    },
    newSet: () => {
      const name = prompt('Name of the new project:', 'Project ' + (state.sets.length + 1));
      if (!name) return;
      const s = newSet(name.trim() || 'Project');
      normPat(s);
      state.sets.push(s); state.current = s.id;
      save(); loadPattern();
    },
    renameSet: () => {
      const s = set();
      const name = prompt('New name:', s.name);
      if (!name) return;
      s.name = name.trim() || s.name;
      save(); render();
    },
    deleteSet: () => {
      const s = set();
      if (state.sets.length < 2) { toast('You need at least one project.'); return; }
      if (!confirm(`Delete project "${s.name}" and all its counters? (The pattern and its progress are kept.)`)) return;
      state.sets = state.sets.filter(x => x !== s);
      state.current = state.sets[0].id;
      save(); loadPattern();
    }
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const f = ACTS[b.dataset.act];
    if (f) { f(); b.blur(); }
  });
  $('#setSelect').addEventListener('change', e => {
    saveProgress.flush();
    state.current = e.target.value; save(); e.target.blur();
    loadPattern({ fit: true });
  });
  $('#setNotes').addEventListener('input', e => { set().notes = e.target.value; save(); });
  window.addEventListener('beforeunload', () => { save.flush(); saveProgress.flush(); });

  SP.Profiles.mountPicker($('#profileSelect'), () => {
    save.flush(); saveProgress.flush();
    return new Promise(r => setTimeout(r, 300)); // let the progress write finish
  });
  render(true);
  openFromUrl().then(done => { if (!done) loadPattern({ fit: true }); });
  updateWakeLock();
})(window.SP);
