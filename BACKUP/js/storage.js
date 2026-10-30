/* Browser storage: patterns and stitching progress in IndexedDB, small preferences in localStorage,
   and a message bus so the editor and the counter page (open in different tabs) stay in sync. */
(function (SP) {
  const DB = 'stitch-pattern-studio', PATTERNS = 'patterns', PROGRESS = 'progress';
  const BUSY = 'Your saved patterns are locked by another tab of this app that runs an older version. ' +
    'Close or reload the other Stitch Pattern Studio / Stitch Counter tabs, then reload this page.';
  let dbp = null;
  /**
   * Open the database. Never waits forever: if another tab (with older code) keeps the database
   * open during an upgrade, the browser queues our request silently, so we give up after a few seconds.
   */
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('Browser storage is not available.'));
        let settled = false;
        const fail = err => { if (settled) return; settled = true; dbp = null; rej(err); };
        const timer = setTimeout(() => fail(new Error(BUSY)), 4000);
        let r;
        try { r = indexedDB.open(DB, 2); } catch (e) { clearTimeout(timer); fail(e); return; }
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains(PATTERNS)) d.createObjectStore(PATTERNS, { keyPath: 'id' });
          if (!d.objectStoreNames.contains(PROGRESS)) d.createObjectStore(PROGRESS, { keyPath: 'id' });
        };
        r.onsuccess = () => {
          clearTimeout(timer);
          const d = r.result;
          if (settled) { d.close(); return; } // we already gave up; the next call opens it again
          // a newer version of the app in another tab wants to upgrade: let it
          d.onversionchange = () => { d.close(); dbp = null; };
          settled = true;
          res(d);
        };
        r.onerror = () => { clearTimeout(timer); fail(r.error || new Error('Could not open browser storage.')); };
        r.onblocked = () => { /* wait for the other tab; the timer reports it if it takes too long */ };
      });
    }
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
    }));
  }
  // patterns saved before profiles existed have no profile field: they belong to the first profile
  const profileOf = r => r.profile || 'default';
  const curProfile = () => (SP.Profiles ? SP.Profiles.current().id : 'default');

  SP.Storage = {
    save(rec) {
      if (SP.Profiles && SP.Profiles.leaving) return Promise.resolve(); // switching profiles
      rec.profile = rec.profile || curProfile();
      return tx(PATTERNS, 'readwrite', st => st.put(rec));
    },
    get(id) { return tx(PATTERNS, 'readonly', st => st.get(id)); },
    remove(id) { return tx(PATTERNS, 'readwrite', st => st.delete(id)).then(() => this.progress.remove(id)); },
    /** Patterns of the current profile, newest first. */
    list() {
      const me = curProfile();
      return tx(PATTERNS, 'readonly', st => st.getAll()).then(all =>
        (all || []).filter(r => profileOf(r) === me)
          .map(r => ({ id: r.id, name: r.name, updated: r.updated, thumb: r.thumb, w: r.w, h: r.h, craft: r.craft }))
          .sort((a, b) => b.updated - a.updated));
    },
    /** Delete every pattern (and its progress) of a profile. */
    removeProfileData(pid) {
      return tx(PATTERNS, 'readonly', st => st.getAll()).then(async all => {
        for (const r of (all || []).filter(r => profileOf(r) === pid)) await this.remove(r.id);
      });
    },
    progress: {
      get(id) { return tx(PROGRESS, 'readonly', st => st.get(id)); },
      save(rec) { return tx(PROGRESS, 'readwrite', st => st.put(rec)); },
      remove(id) { return tx(PROGRESS, 'readwrite', st => st.delete(id)); }
    },
    prefs: {
      // per profile (see profiles.js)
      get(key, def) {
        try { const v = localStorage.getItem(SP.Profiles.key(key)); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
      },
      set(key, v) {
        if (SP.Profiles.leaving) return;
        try { localStorage.setItem(SP.Profiles.key(key), JSON.stringify(v)); } catch (e) { /* ignore */ }
      }
    }
  };

  // ---- cross-tab messages: { type: 'pattern' | 'progress', id } ----
  const listeners = [];
  let ch = null;
  try { ch = new BroadcastChannel('stitch-pattern-studio'); ch.onmessage = e => listeners.forEach(f => f(e.data)); } catch (e) { ch = null; }
  if (!ch) {
    window.addEventListener('storage', e => {
      if (e.key !== 'sps.bus' || !e.newValue) return;
      try { const m = JSON.parse(e.newValue); listeners.forEach(f => f(m)); } catch (err) { /* ignore */ }
    });
  }
  SP.bus = {
    post(msg) {
      if (ch) ch.postMessage(msg);
      else try { localStorage.setItem('sps.bus', JSON.stringify(Object.assign({ t: Date.now() }, msg))); } catch (e) { /* ignore */ }
    },
    on(fn) { listeners.push(fn); }
  };
})(window.SP);
