/* Outils communs : stockage local (IndexedDB), maths, dates. */
window.App = window.App || {};

/* ---------- Stockage ---------- */
App.db = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('feuille-du-jour', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('cache');
        d.createObjectStore('history');
        d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    get: (store, key) => tx(store, 'readonly', s => s.get(key)),
    put: (store, key, val) => tx(store, 'readwrite', s => { s.put(val, key); }),
    del: (store, key) => tx(store, 'readwrite', s => { s.delete(key); }),
    all: async (store) => {
      const d = await open();
      return new Promise((res, rej) => {
        const out = [];
        const t = d.transaction(store, 'readonly');
        const c = t.objectStore(store).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
      });
    },
    clear: (store) => tx(store, 'readwrite', s => { s.clear(); }),
  };
})();

/* ---------- Maths ---------- */
App.m = {
  clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
  logit: p => Math.log(p / (1 - p)),
  sigmoid: x => 1 / (1 + Math.exp(-x)),
  // Prudence : resserre légèrement les probabilités extrêmes (les modèles sont souvent trop sûrs d'eux)
  temper(p, k = 0.9) {
    p = App.m.clamp(p, 0.001, 0.999);
    return App.m.sigmoid(k * App.m.logit(p));
  },
  poissonPmf(l, maxK) {
    const out = new Array(maxK + 1);
    let p = Math.exp(-l);
    out[0] = p;
    for (let k = 1; k <= maxK; k++) { p = p * l / k; out[k] = p; }
    return out;
  },
  // Binomiale négative (moyenne mu, dispersion r) : pour corners et cartons, plus variables qu'un Poisson
  nbPmf(mu, r, maxK) {
    const out = new Array(maxK + 1);
    const p = r / (r + mu);
    out[0] = Math.pow(p, r);
    for (let k = 1; k <= maxK; k++) out[k] = out[k - 1] * ((k - 1 + r) / k) * (1 - p);
    return out;
  },
  cdfOver(pmf, line) { // P(X > line)
    let s = 0;
    for (let k = 0; k < pmf.length; k++) if (k > line) s += pmf[k];
    return s;
  },
  normCdf(x) {
    // Approximation d'Abramowitz-Stegun
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  },
  wmean(vals, ws) {
    let s = 0, w = 0;
    for (let i = 0; i < vals.length; i++) { s += vals[i] * ws[i]; w += ws[i]; }
    return w ? s / w : 0;
  },
};

/* ---------- Dates ---------- */
App.d = {
  DAY: 86400000,
  ymd(dt) { // AAAAMMJJ en heure locale
    const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  },
  ym(dt) { return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}`; },
  // Une « journée » de paris va de 6 h à 6 h le lendemain (pour inclure les matchs NBA de la nuit)
  window(dayOffset = 0) {
    const s = new Date(); s.setHours(6, 0, 0, 0);
    if (new Date().getHours() < 6) s.setDate(s.getDate() - 1);
    s.setDate(s.getDate() + dayOffset);
    const e = new Date(s.getTime() + App.d.DAY);
    return { start: s.getTime(), end: e.getTime(), key: App.d.ymd(s), date: s };
  },
  hm(ts) { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); },
  dayLabel(ts) { return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); },
};

/* ---------- Texte ---------- */
App.t = {
  norm: s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
  pct: p => `${Math.round(p * 100)} %`,
  odd: p => (1 / p).toFixed(2).replace('.', ','),
  num: (x, d = 1) => x.toFixed(d).replace('.', ','),
  esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
};
