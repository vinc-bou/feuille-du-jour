/* Tennis : classement de force (Elo) par surface + modèle jeu par jeu pour sets et jeux. */
window.App = window.App || {};

App.tennis = (() => {
  const { m, d, t } = App;
  const C = App.config;
  const SURF = { hard: 'dur', clay: 'terre battue', grass: 'gazon' };

  function surfaceOf(name, ts) {
    const n = t.norm(name);
    const mo = new Date(ts).getMonth() + 1;
    if (C.grassJuneOnly.some(k => n.includes(k))) return mo === 6 ? 'grass' : (mo === 4 ? 'clay' : 'hard');
    if (C.grass.some(k => n.includes(k))) return 'grass';
    if (C.clay.some(k => n.includes(k))) return 'clay';
    return 'hard';
  }
  const isSlam = name => C.slams.some(k => t.norm(name).includes(k));
  const invalid = x => /walkover|retired|cancel|postponed|forfeit|abandon/i.test(x.stName || '');

  /* ---------- Elo ---------- */
  function build(history, ranks) {
    const seen = new Set();
    const list = history.filter(x => {
      if (seen.has(x.id)) return false; seen.add(x.id);
      return x.st === 'post' && !invalid(x) && x.players.some(p => p.winner);
    }).sort((a, b) => a.ts - b.ts);
    const R = {}, N = {}, RS = { hard: {}, clay: {}, grass: {} }, NS = { hard: {}, clay: {}, grass: {} };
    const seed = (k) => {
      const r = ranks[k];
      return r ? 1500 + 350 * (1 - Math.log(r.rank) / Math.log(500)) : 1430;
    };
    const rec = {}; // joueur -> derniers matchs
    list.forEach(x => {
      const [A, B] = x.players;
      const s = surfaceOf(x.tour, x.ts);
      [A, B].forEach(p => {
        if (R[p.key] === undefined) { R[p.key] = seed(p.key); N[p.key] = 0; }
        if (RS[s][p.key] === undefined) { RS[s][p.key] = R[p.key]; NS[s][p.key] = 0; }
      });
      const e = 1 / (1 + Math.pow(10, (R[B.key] - R[A.key]) / 400));
      const es = 1 / (1 + Math.pow(10, (RS[s][B.key] - RS[s][A.key]) / 400));
      const wa = A.winner ? 1 : 0;
      const k = n => 250 / Math.pow(n + 5, 0.4);
      R[A.key] += k(N[A.key]) * (wa - e); R[B.key] -= k(N[B.key]) * (wa - e);
      RS[s][A.key] += k(NS[s][A.key]) * (wa - es); RS[s][B.key] -= k(NS[s][B.key]) * (wa - es);
      N[A.key]++; N[B.key]++; NS[s][A.key]++; NS[s][B.key]++;
      [[A, B], [B, A]].forEach(([me, op]) => {
        (rec[me.key] = rec[me.key] || []).push({ ts: x.ts, win: me.winner, opp: op.name, oppKey: op.key, surf: s,
          sets: me.sets.length + 0, games: me.sets.reduce((a, b) => a + (b || 0), 0) + op.sets.reduce((a, b) => a + (b || 0), 0), tour: x.tour });
      });
    });
    return { R, N, RS, NS, rec, ranks };
  }

  /* ---------- Modèle jeu par jeu ---------- */
  // Distribution des scores d'un set : [{ga, gb, p}] ; A sert en premier si aFirst
  function setDist(hA, hB, aFirst) {
    const ptb = m.clamp(0.5 + (hA - hB) * 0.75, 0.05, 0.95);
    const out = [];
    const P = {}; P['0,0'] = 1;
    for (let tot = 0; tot <= 12; tot++) {
      for (let a = 0; a <= tot; a++) {
        const b = tot - a, key = a + ',' + b, p = P[key];
        if (!p) continue;
        const done = (a >= 6 && a - b >= 2) || (b >= 6 && b - a >= 2) || a === 7 || b === 7;
        if (done) { out.push({ ga: a, gb: b, p }); continue; }
        if (a === 6 && b === 6) { out.push({ ga: 7, gb: 6, p: p * ptb }); out.push({ ga: 6, gb: 7, p: p * (1 - ptb) }); continue; }
        const aServes = ((a + b) % 2 === 0) === aFirst;
        const pa = aServes ? hA : 1 - hB;
        P[(a + 1) + ',' + b] = (P[(a + 1) + ',' + b] || 0) + p * pa;
        P[a + ',' + (b + 1)] = (P[a + ',' + (b + 1)] || 0) + p * (1 - pa);
      }
    }
    return out;
  }
  function avgSetDist(hA, hB) {
    const x = setDist(hA, hB, true), y = setDist(hA, hB, false);
    const map = {};
    [...x, ...y].forEach(o => { const k = o.ga + ',' + o.gb; map[k] = (map[k] || 0) + o.p / 2; });
    return Object.entries(map).map(([k, p]) => { const [ga, gb] = k.split(',').map(Number); return { ga, gb, p }; });
  }
  const setWin = sd => sd.filter(o => o.ga > o.gb).reduce((a, b) => a + b.p, 0);
  const bo3 = s => s * s * (3 - 2 * s);

  // Trouve les probabilités de tenir son service qui donnent la probabilité de victoire voulue
  function solveHolds(pMatch, h0) {
    let lo = -0.35, hi = 0.35;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const hA = m.clamp(h0 + mid, 0.25, 0.985), hB = m.clamp(h0 - mid, 0.25, 0.985);
      const pm = bo3(setWin(avgSetDist(hA, hB)));
      if (pm < pMatch) lo = mid; else hi = mid;
    }
    const dd = (lo + hi) / 2;
    return [m.clamp(h0 + dd, 0.25, 0.985), m.clamp(h0 - dd, 0.25, 0.985)];
  }

  // Distribution du match : sets gagnés et jeux totaux
  function matchDist(sd, bestOf) {
    const need = bestOf === 5 ? 3 : 2;
    let states = [{ sa: 0, sb: 0, ga: 0, gb: 0, p: 1 }];
    const fin = [];
    while (states.length) {
      const next = {};
      states.forEach(s => {
        sd.forEach(o => {
          const sa = s.sa + (o.ga > o.gb ? 1 : 0), sb = s.sb + (o.gb > o.ga ? 1 : 0);
          const st = { sa, sb, ga: s.ga + o.ga, gb: s.gb + o.gb, p: s.p * o.p };
          if (sa === need || sb === need) fin.push(st);
          else { const k = `${sa},${sb},${st.ga},${st.gb}`; if (next[k]) next[k].p += st.p; else next[k] = st; }
        });
      });
      states = Object.values(next);
    }
    return fin;
  }

  /* ---------- Analyse d'un match ---------- */
  function analyzeMatch(fx, E) {
    const [A, B] = fx.players;
    const surf = surfaceOf(fx.tour, fx.ts);
    const bestOf = fx.gender === 'M' && isSlam(fx.tour) ? 5 : 3;
    const r = k => {
      const o = E.R[k] !== undefined ? E.R[k] : (E.ranks[k] ? 1500 + 350 * (1 - Math.log(E.ranks[k].rank) / Math.log(500)) : 1430);
      const s = E.RS[surf][k] !== undefined ? E.RS[surf][k] : o;
      return { o, s, mix: 0.5 * o + 0.5 * s, n: E.N[k] || 0, ns: E.NS[surf][k] || 0 };
    };
    const ra = r(A.key), rb = r(B.key);
    const factors = [], tags = [];
    let diff = ra.mix - rb.mix;

    // Confrontations directes
    const recA = E.rec[A.key] || [], recB = E.rec[B.key] || [];
    const h2h = recA.filter(x => x.oppKey === B.key);
    const hw = h2h.filter(x => x.win).length, hl = h2h.length - hw;
    if (h2h.length) {
      factors.push(`Face-à-face récents : ${A.name} ${hw} - ${hl} ${B.name}`);
      const dd = hw - hl;
      if (Math.abs(dd) >= 2) diff += Math.sign(dd) * Math.min(Math.abs(dd), 4) * 6;
    }
    // Fatigue : sets joués ces 3 derniers jours
    [[A, recA, 1], [B, recB, -1]].forEach(([p, rec, sg]) => {
      const sets = rec.filter(x => fx.ts - x.ts < 3 * d.DAY && x.ts < fx.ts).reduce((a, b) => a + b.sets, 0);
      if (sets >= 7) { diff -= sg * 15; factors.push(`${p.name} : ${sets} sets joués ces 3 derniers jours`); tags.push('Fatigue'); }
      const last10 = rec.slice(-10);
      if (last10.length >= 5) factors.push(`${p.name} : ${last10.filter(x => x.win).length} victoires sur ses ${last10.length} derniers matchs`);
      const onS = rec.filter(x => x.surf === surf && fx.ts - x.ts < 365 * d.DAY);
      if (onS.length >= 4) factors.push(`${p.name} sur ${SURF[surf]} (12 mois) : ${onS.filter(x => x.win).length}-${onS.filter(x => !x.win).length}`);
    });
    const rkA = E.ranks[A.key], rkB = E.ranks[B.key];
    factors.unshift(`Surface : ${SURF[surf]} · format : ${bestOf} sets${rkA || rkB ? ` · classement : ${rkA ? rkA.rank : '-'} contre ${rkB ? rkB.rank : '-'}` : ''}`);
    factors.push(`Indice de force sur ${SURF[surf]} : ${Math.round(ra.mix)} contre ${Math.round(rb.mix)}`);

    const pA = m.clamp(1 / (1 + Math.pow(10, -diff / 400)), 0.03, 0.97);
    const h0 = fx.gender === 'M' ? (surf === 'clay' ? 0.76 : surf === 'grass' ? 0.84 : 0.80) : (surf === 'clay' ? 0.62 : 0.66);
    const [hA, hB] = solveHolds(pA, h0);
    const sd = avgSetDist(hA, hB);
    const md = matchDist(sd, bestOf);
    const sum = fn => md.filter(fn).reduce((a, b) => a + b.p, 0);

    let conf = m.clamp(Math.min(ra.n, rb.n) / 25, 0, 1) * (0.7 + 0.3 * m.clamp(Math.min(ra.ns, rb.ns) / 8, 0, 1));
    const bets = [];
    const add = (group, label, p, settle, c = conf) => {
      if (!(p > 0.02 && p < 0.995)) return;
      bets.push({ group, label, p: m.temper(p, 0.78), conf: c, settle, notes: [] });
    };
    const need = bestOf === 5 ? 3 : 2;
    const pWinA = sum(x => x.sa === need);
    const surname = n => { const p = n.split(' '); return p.length > 1 ? p.slice(1).join(' ') : n; };
    const nA = surname(A.name), nB = surname(B.name);
    add('Vainqueur', `Victoire ${A.name}`, pWinA, { k: 'win', who: 0 });
    add('Vainqueur', `Victoire ${B.name}`, 1 - pWinA, { k: 'win', who: 1 });
    add('Sets', `${nA} gagne au moins un set`, 1 - sum(x => x.sb === need && x.sa === 0), { k: 'oneSet', who: 0 });
    add('Sets', `${nB} gagne au moins un set`, 1 - sum(x => x.sa === need && x.sb === 0), { k: 'oneSet', who: 1 });
    add('Sets', `${nA} gagne en ${need} sets secs`, sum(x => x.sa === need && x.sb === 0), { k: 'straight', who: 0 });
    add('Sets', `${nB} gagne en ${need} sets secs`, sum(x => x.sb === need && x.sa === 0), { k: 'straight', who: 1 });
    if (bestOf === 3) {
      const p3 = sum(x => x.sa + x.sb === 3);
      add('Sets', 'Match en 3 sets', p3, { k: 'nsets', side: 'o', line: 2.5 });
      add('Sets', 'Match en 2 sets', 1 - p3, { k: 'nsets', side: 'u', line: 2.5 });
    } else {
      [3.5, 4.5].forEach(l => {
        const po = sum(x => x.sa + x.sb > l);
        add('Sets', `+${t.num(l)} sets`, po, { k: 'nsets', side: 'o', line: l });
        add('Sets', `-${t.num(l)} sets`, 1 - po, { k: 'nsets', side: 'u', line: l });
      });
    }
    const ss = {};
    md.forEach(x => { const k = x.sa + '-' + x.sb; ss[k] = (ss[k] || 0) + x.p; });
    const bestSS = Object.entries(ss).sort((a, b) => b[1] - a[1])[0];
    add('Sets', `Score en sets ${bestSS[0]}`, bestSS[1], { k: 'setscore', sel: bestSS[0] }, conf * 0.85);
    const s1 = setWin(sd);
    add('1er set', `${nA} gagne le 1er set`, s1, { k: 'set1', who: 0 });
    add('1er set', `${nB} gagne le 1er set`, 1 - s1, { k: 'set1', who: 1 });
    const meanG = md.reduce((a, b) => a + (b.ga + b.gb) * b.p, 0);
    const centre = Math.round(meanG) + 0.5;
    [-4, -3, -2, -1, 0, 1, 2, 3].forEach(o => {
      const l = centre + o;
      const po = sum(x => x.ga + x.gb > l);
      add('Jeux', `+${t.num(l)} jeux`, po, { k: 'games', side: 'o', line: l });
      add('Jeux', `-${t.num(l)} jeux`, 1 - po, { k: 'games', side: 'u', line: l });
    });
    [2.5, 3.5, 4.5, 5.5].forEach(l => {
      add('Jeux', `${nA} -${t.num(l)} jeux (handicap)`, sum(x => x.ga - x.gb > l), { k: 'ghcp', who: 0, line: -l });
      add('Jeux', `${nB} -${t.num(l)} jeux (handicap)`, sum(x => x.gb - x.ga > l), { k: 'ghcp', who: 1, line: -l });
      add('Jeux', `${nA} +${t.num(l)} jeux (handicap)`, sum(x => x.ga - x.gb > -l), { k: 'ghcp', who: 0, line: l });
      add('Jeux', `${nB} +${t.num(l)} jeux (handicap)`, sum(x => x.gb - x.ga > -l), { k: 'ghcp', who: 1, line: l });
    });
    factors.push(`Jeux attendus : ${t.num(meanG, 1)}`);
    if (conf < 0.4) factors.push('Peu de matchs connus pour au moins un des joueurs : pronostic déclassé');

    const favIdx = pWinA >= 0.5 ? 0 : 1;
    return {
      match: fx, sport: 'tennis', comp: `${fx.lg.toUpperCase()} · ${fx.tour}`, compId: `${fx.lg}|${fx.tour}`, country: '',
      conf, bets, factors, tags, surface: SURF[surf], bestOf,
      fav: { side: favIdx, name: fx.players[favIdx].name, pWin: Math.max(pWinA, 1 - pWinA), fragility: Math.min(pWinA, 1 - pWinA), isFav: true },
    };
  }

  function settle(s, x) {
    if (!x || x.st !== 'post') return null;
    if (invalid(x)) return 'void';
    const [A, B] = x.players;
    const sa = A.sets.filter((v, i) => v > B.sets[i]).length, sb = B.sets.filter((v, i) => v > A.sets[i]).length;
    const ga = A.sets.reduce((a, b) => a + (b || 0), 0), gb = B.sets.reduce((a, b) => a + (b || 0), 0);
    const w = A.winner ? 0 : 1;
    const me = s.who === 0 ? [sa, sb, ga, gb] : [sb, sa, gb, ga];
    const over = v => s.side === 'o' ? v > s.line : v < s.line;
    switch (s.k) {
      case 'win': return w === s.who;
      case 'oneSet': return me[0] >= 1;
      case 'straight': return w === s.who && me[1] === 0;
      case 'nsets': return over(sa + sb);
      case 'setscore': return `${sa}-${sb}` === s.sel;
      case 'set1': return s.who === 0 ? A.sets[0] > B.sets[0] : B.sets[0] > A.sets[0];
      case 'games': return over(ga + gb);
      case 'ghcp': return me[2] - me[3] + s.line > 0;
    }
    return null;
  }

  return { build, analyzeMatch, settle };
})();
