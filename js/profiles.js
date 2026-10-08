/*
 * Profiles: separate patterns, counters, progress and settings per person in the same browser.
 * The first profile ("default") keeps the original storage keys, so data from before profiles
 * existed automatically belongs to it.
 */
window.SP = window.SP || {};
(function (SP) {
  const KEY = 'sps.profiles';
  // per-profile localStorage names used by the app (for deleting the default profile)
  const KNOWN = ['state', 'view', 'lastId', 'paletteOpen', 'counter'];

  let reg = null;
  try { reg = JSON.parse(localStorage.getItem(KEY)); } catch (e) { reg = null; }
  if (!reg || !Array.isArray(reg.list) || !reg.list.length) reg = { list: [{ id: 'default', name: 'Me' }], current: 'default' };
  if (!reg.list.some(p => p.id === reg.current)) reg.current = reg.list[0].id;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(reg)); } catch (e) { /* storage blocked */ } };
  persist();
  /** Re-read the list (another tab may have changed it) but keep this tab's profile. */
  const fresh = () => {
    try {
      const r = JSON.parse(localStorage.getItem(KEY));
      if (r && Array.isArray(r.list) && r.list.length) {
        const mine = reg.list.find(p => p.id === reg.current);
        reg.list = r.list;
        if (mine && !reg.list.some(p => p.id === mine.id)) reg.list.push(mine);
      }
    } catch (e) { /* keep what we have */ }
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const P = SP.Profiles = {
    list: () => reg.list.slice(),
    current: () => reg.list.find(p => p.id === reg.current),
    /** localStorage key for this profile. */
    key: (name) => 'sps.' + (reg.current === 'default' ? '' : reg.current + '.') + name,

    add(name) {
      fresh();
      const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name };
      reg.list.push(p);
      reg.current = p.id;
      persist();
      return p;
    },
    rename(name) { fresh(); P.current().name = name; persist(); },
    switchTo(id) { fresh(); if (reg.list.some(p => p.id === id)) { reg.current = id; persist(); } },
    /** Delete a profile with all its data. */
    async remove(id) {
      fresh();
      if (reg.list.length < 2) throw new Error('You need at least one profile.');
      if (SP.Storage && SP.Storage.removeProfileData) await SP.Storage.removeProfileData(id);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (id === 'default' ? KNOWN.some(n => k === 'sps.' + n) : k.startsWith('sps.' + id + '.')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
      reg.list = reg.list.filter(p => p.id !== id);
      if (reg.current === id) reg.current = reg.list[0].id;
      persist();
    },

    /**
     * Fill a <select> with the profiles plus "new / rename / delete" actions.
     * beforeLeave() saves pending work (may return a promise); the page reloads after a change.
     */
    mountPicker(sel, beforeLeave) {
      const cur = P.current();
      sel.innerHTML = reg.list.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') +
        '<option disabled>──────────</option>' +
        '<option value="__new">＋ New profile…</option>' +
        `<option value="__rename">Rename "${esc(cur.name)}"…</option>` +
        (reg.list.length > 1 ? `<option value="__delete">Delete "${esc(cur.name)}"…</option>` : '');
      sel.value = cur.id;
      sel.title = 'Profile: everyone has their own patterns, counters and progress';
      const leave = async (fn) => {
        try { await Promise.resolve(beforeLeave && beforeLeave()); } catch (e) { /* still switch */ }
        P.leaving = true; // from now on this page must not save anything (it belongs to the old profile)
        try { await fn(); } catch (e) { P.leaving = false; throw e; }
        location.reload();
      };
      sel.onchange = () => {
        const v = sel.value;
        sel.value = cur.id;
        sel.blur();
        if (v === cur.id) return;
        if (v === '__new') {
          const name = (prompt('Name of the new profile:', '') || '').trim();
          if (name) leave(() => P.add(name));
        } else if (v === '__rename') {
          const name = (prompt('New name for this profile:', cur.name) || '').trim();
          if (name) { P.rename(name); P.mountPicker(sel, beforeLeave); }
        } else if (v === '__delete') {
          if (confirm(`Delete profile "${cur.name}" with ALL its patterns, counters and stitching progress?\n\nThis cannot be undone. Tip: use Save file first for patterns you want to keep.`)) {
            leave(() => P.remove(cur.id)).catch(err => alert(err.message));
          }
        } else {
          leave(() => P.switchTo(v));
        }
      };
    }
  };
})(window.SP);
