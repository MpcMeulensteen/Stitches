/* Undo / redo. Small edits store per-cell diffs; big edits store full snapshots. */
(function (SP) {
  class History {
    constructor(onChange) {
      this.undoStack = [];
      this.redoStack = [];
      this.limit = 200;
      this.onChange = onChange || (() => {});
    }
    clear() { this.undoStack = []; this.redoStack = []; this.onChange(); }

    begin(p, label, full) {
      if (p.tx) this.commit(p);
      p.tx = { label, legs: new Map(), marks: new Map(), xs: new Map(), lite: null, full: full ? p.fullState() : null };
    }
    commit(p) {
      const tx = p.tx;
      if (!tx) return false;
      p.tx = null;
      let e;
      if (tx.full) {
        e = { label: tx.label, before: tx.full, after: p.fullState() };
      } else {
        if (!tx.legs.size && !tx.marks.size && !tx.xs.size && !tx.lite) return false;
        const li = Array.from(tx.legs.keys()), mi = Array.from(tx.marks.keys()), xi = Array.from(tx.xs.keys());
        e = {
          label: tx.label,
          li: Int32Array.from(li), lo: Uint16Array.from(li, i => tx.legs.get(i)), ln: Uint16Array.from(li, i => p.legs[i]),
          mi: Int32Array.from(mi), mo: Uint8Array.from(mi, i => tx.marks.get(i)), mn: Uint8Array.from(mi, i => p.marks[i]),
          xi: Int32Array.from(xi), xo: Uint8Array.from(xi, i => tx.xs.get(i)), xn: Uint8Array.from(xi, i => p.xs[i]),
          liteBefore: tx.lite, liteAfter: tx.lite ? p.liteState() : null
        };
      }
      this.undoStack.push(e);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
      this.onChange(e);
      return true;
    }
    /** Throw away the running transaction and restore what it changed. */
    rollback(p) {
      const tx = p.tx;
      if (!tx) return;
      p.tx = null;
      if (tx.full) { p.restoreFull(tx.full); }
      else {
        tx.legs.forEach((o, i) => { p.legs[i] = o; });
        tx.marks.forEach((o, i) => { p.marks[i] = o; });
        tx.xs.forEach((o, i) => { p.xs[i] = o; });
        if (tx.lite) p.restoreLite(tx.lite);
      }
      p.version++;
      this.onChange();
    }
    apply(p, e, forward) {
      if (e.before) { p.restoreFull(forward ? e.after : e.before); }
      else {
        const L = p.legs, M = p.marks, lv = forward ? e.ln : e.lo, mv = forward ? e.mn : e.mo;
        for (let k = 0; k < e.li.length; k++) L[e.li[k]] = lv[k];
        for (let k = 0; k < e.mi.length; k++) M[e.mi[k]] = mv[k];
        const xv = forward ? e.xn : e.xo;
        for (let k = 0; k < e.xi.length; k++) p.xs[e.xi[k]] = xv[k];
        const lite = forward ? e.liteAfter : e.liteBefore;
        if (lite) p.restoreLite(lite);
      }
      p.version++;
    }
    undo(p) {
      if (p.tx) this.commit(p);
      const e = this.undoStack.pop();
      if (!e) return null;
      this.apply(p, e, false);
      this.redoStack.push(e);
      this.onChange(e);
      return e;
    }
    redo(p) {
      const e = this.redoStack.pop();
      if (!e) return null;
      this.apply(p, e, true);
      this.undoStack.push(e);
      this.onChange(e);
      return e;
    }
  }
  SP.History = History;
})(window.SP);
