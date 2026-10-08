/* Pattern library in IndexedDB (browser storage) with a localStorage fallback for preferences. */
(function (SP) {
  const DB = 'stitch-pattern-studio', STORE = 'patterns';
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('Browser storage is not available.'));
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    }));
  }
  SP.Storage = {
    save(rec) { return tx('readwrite', st => st.put(rec)); },
    get(id) { return tx('readonly', st => st.get(id)); },
    remove(id) { return tx('readwrite', st => st.delete(id)); },
    list() {
      return tx('readonly', st => st.getAll()).then(all =>
        (all || []).map(r => ({ id: r.id, name: r.name, updated: r.updated, thumb: r.thumb, w: r.w, h: r.h, craft: r.craft }))
          .sort((a, b) => b.updated - a.updated));
    },
    prefs: {
      get(key, def) {
        try { const v = localStorage.getItem('sps.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
      },
      set(key, v) { try { localStorage.setItem('sps.' + key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
    }
  };
})(window.SP);
