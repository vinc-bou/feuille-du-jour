/* Chef d'orchestre : charge les données, lance les modèles, classe les paris, gère l'historique. */
window.App = window.App || {};

App.engine = (() => {
  const { d, m } = App;
  const D = App.data;

  const inWin = (x, W) => x.ts >= W.start && x.ts < W.end;
  const nextYmd = (date, n) => { const x = new Date(date); x.setDate(x.getDate() + n); return d.ymd(x); };
  const uniq = arr => { const s = new Map(); arr.forEach(x => s.set(x.id, x)); return [...s.values()]; };

  async function settings() {
    const saved = (await App.db.get('kv', 'settings')) || {};
    const comps = saved.comps || {};
    const cfg = App.config;
    const on = (sp, c) => comps[sp + ':' + c.id] !== undefined ? comps[sp + ':' + c.id] : c.on;
    return {
      soccer: cfg.soccer.filter(c => on('soccer', c)),
      tennis: cfg.tennis.filter(c => on('tennis', c)),
      basket: cfg.basket.filter(c => on('basket', c)),
      maxPerMatch: saved.maxPerMatch || cfg.settings.maxPerMatch,
      minOdd: saved.minOdd || cfg.settings.minOdd,
      topN: cfg.settings.topN,
      raw: saved,
    };
  }

  /* ---------- Analyse complète d'une journée ---------- */
  async function run(dayOffset, onStep) {
    const S = await settings();
    const W = d.window(dayOffset);
    const ymds = [d.ymd(W.date), nextYmd(W.date, 1)];
    // Test à l'aveugle : pour un jour passé, l'app se place au matin de ce jour (6 h)
    // et n'utilise que les matchs joués avant. Les résultats ne servent qu'à la fin, pour noter la sélection.
    const replay = dayOffset < 0;
    const now = replay ? W.start : Date.now();
    const before = list => replay ? list.filter(x => x.ts < now) : list;
    const orig = new Map(); // id du match -> match réel (avec le résultat)
    const asPre = x => {
      if (!replay) return x;
      orig.set(x.id, x);
      return x.sp === 'tennis' ? { ...x, st: 'pre', players: x.players.map(p => ({ ...p, winner: false, sets: [] })) }
        : { ...x, st: 'pre', h: { ...x.h, g: 0, g1: 0, pts: 0, q: [] }, a: { ...x.a, g: 0, g1: 0, pts: 0, q: [] }, goals: [], cards: [], odds: null };
    };
    // Données marché API-Football de la journée (collectées la nuit) : avis des bookmakers + matchs supplémentaires
    const MK = replay ? null : await App.marche.load(W.key).catch(() => null);
    const pick = list => replay ? list.filter(x => x.st === 'post' && inWin(x, W)).map(asPre) : list.filter(x => x.st === 'pre' && inWin(x, W));
    const analyses = [];
    const surprises = [];
    const warnings = [];
    let extrasInfo = null;

    // ---- Football ----
    if (S.soccer.length) {
      onStep('Football : historique des championnats et coupes');
      const hist = {};
      await Promise.all(S.soccer.map(async c => { hist[c.id] = await D.soccerHistory(c.id); }));
      onStep('Football : matchs du jour');
      const dayLists = await Promise.all(S.soccer.flatMap(c => ymds.map(y => D.soccerDay(c.id, y))));
      const day = uniq(dayLists.flat());
      const fixtures = pick(day);
      const all = replay ? uniq([...before(Object.values(hist).flat()), ...fixtures]).sort((a, b) => a.ts - b.ts)
        : uniq([...Object.values(hist).flat(), ...day]).sort((a, b) => a.ts - b.ts);
      onStep('Football : données ouvertes (xG, arbitres, cotes, transferts)');
      const X = await App.extras.load(hist, S.soccer.map(c => c.id)).catch(e => { console.warn('Données ouvertes', e); return { ok: false }; });
      extrasInfo = X.ok ? { ok: true, fdMatches: Object.keys(X.byMatch).length, tmClubs: X.club2espn ? Object.keys(X.club2espn).length : 0, fixtures: X.fixtures.length } : { ok: false };
      if (X.ok) {
        const byId = new Map(); Object.values(hist).forEach(list => list.forEach(x => byId.set(x.id, x)));
        Object.entries(X.byMatch).forEach(([id, r]) => { const x = byId.get(id); if (x && r.xg) { x.h.xg = r.xg[0]; x.a.xg = r.xg[1]; } });
      }
      onStep('Football : calcul des forces de chaque équipe');
      const leagues = {};
      S.soccer.filter(c => c.type === 'league').forEach(c => {
        const L = App.soccer.buildLeague(c, before(hist[c.id] || []), now);
        if (L) leagues[c.id] = L; else if ((hist[c.id] || []).length) warnings.push(`${c.name} : pas assez de matchs pour l'analyse`);
      });
      // Championnat principal de chaque équipe
      const teamLeague = {}, cnt = {};
      Object.entries(leagues).forEach(([lg, L]) => {
        before(hist[lg]).forEach(x => { if (x.season !== L.season) return; [x.h.id, x.a.id].forEach(id => { const k = id + '|' + lg; cnt[k] = (cnt[k] || 0) + 1; }); });
      });
      Object.entries(cnt).forEach(([k, n]) => { const [id, lg] = k.split('|'); if (!teamLeague[id] || n > cnt[id + '|' + teamLeague[id]]) teamLeague[id] = lg; });
      const global = App.soccer.buildGlobal(all);
      // Effectifs actuels (pour confirmer les anciens joueurs)
      const rosters = {};
      if (X.ok && X.tm && !replay) {
        onStep('Football : effectifs des équipes du jour');
        await Promise.all(fixtures.flatMap(fx => [fx.h, fx.a].map(async s => { rosters[s.id] = await D.soccerRoster(fx.lg, s.id); })));
      }
      const ctxBase = { leagues, global, all, teamLeague, X, rosters };
      const byLg = {};
      fixtures.forEach(fx => {
        const cfg = S.soccer.find(c => c.id === fx.lg);
        try {
          // En test, l'avis des bookmakers vient des cotes d'avant-match archivées (football-data)
          const market = replay ? (X.ok && X.byMatch[fx.id] ? App.extras.implied(X.byMatch[fx.id]) : null)
            : (MK ? App.marche.marketFor(MK, fx) : null);
          const a = App.soccer.analyzeMatch(fx, { ...ctxBase, lgCfg: cfg, market: market && market.p1 !== undefined ? market : null, noEspnOdds: replay });
          analyses.push(a);
          (byLg[fx.lg] = byLg[fx.lg] || []).push(a);
        } catch (e) { console.warn('Analyse foot', fx, e); }
      });
      // Surprise de la journée : nombre attendu de favoris battus et matchs pièges
      Object.entries(byLg).forEach(([lg, list]) => {
        const L = leagues[lg];
        const cfg = S.soccer.find(c => c.id === lg);
        const rate = L ? L.upsetRate : 0.12;
        const expected = rate * list.length;
        const favs = list.filter(a => a.fav.isFav).sort((a, b) => b.fav.fragility - a.fav.fragility);
        const k = list.length >= 3 ? Math.max(1, Math.round(expected)) : (expected >= 0.5 ? 1 : 0);
        const traps = favs.slice(0, k).filter(a => a.fav.fragility >= 0.18);
        traps.forEach(a => { a.trap = true; a.tags.unshift('Match piège'); a.factors.unshift(`Match piège : ${a.fav.name} est le favori le plus fragile de la journée en ${cfg.name}`); });
        surprises.push({ comp: cfg.name, n: list.length, expected, rate, traps: traps.map(a => `${a.match.h.short} - ${a.match.a.short}`), favLose: L ? L.favLoseRate : null });
      });
    }

    // ---- Tennis ----
    if (S.tennis.length) {
      onStep('Tennis : historique des matchs et classements');
      const [histParts, rankParts, dayParts] = await Promise.all([
        Promise.all(S.tennis.map(c => D.tennisHistory(c.id))),
        Promise.all(['atp', 'wta'].map(f => D.tennisRanks(f))),
        Promise.all(S.tennis.flatMap(c => ymds.map(y => D.tennisDay(c.id, y)))),
      ]);
      const ranks = Object.assign({}, ...rankParts);
      const day = uniq(dayParts.flat());
      onStep('Tennis : indices de force par surface');
      const E = App.tennis.build(before([...histParts.flat(), ...day]), ranks);
      const wantF = S.tennis.some(c => c.id === 'wta'), wantM = S.tennis.some(c => c.id === 'atp');
      pick(day).filter(x => (x.gender === 'M' && wantM) || (x.gender === 'F' && wantF))
        .forEach(fx => { try { analyses.push(App.tennis.analyzeMatch(fx, E)); } catch (e) { console.warn('Analyse tennis', fx, e); } });
    }

    // ---- Basket ----
    for (const c of S.basket) {
      onStep(`Basket : ${c.name}`);
      const [hist, dayParts, inj] = await Promise.all([
        D.basketHistory(c.id),
        Promise.all(ymds.map(y => D.basketDay(c.id, y))),
        c.id === 'nba' && !replay ? D.nbaInjuries() : Promise.resolve({}),
      ]);
      const B = App.basket.build(before(hist), now);
      if (!B) { if (hist.length) warnings.push(`${c.name} : pas assez de matchs`); continue; }
      pick(uniq(dayParts.flat()))
        .forEach(fx => { try { analyses.push(App.basket.analyzeMatch(fx, B, inj, c.name)); } catch (e) { console.warn('Analyse basket', fx, e); } });
    }

    // Tous les autres matchs proposés par les bookmakers (autres championnats, autres sports) : analyse par le marché
    if (MK) {
      onStep('Autres matchs : avis du marché');
      const extra = App.marche.build(MK, W, analyses);
      analyses.push(...extra);
      if (extra.length) extrasInfo = { ...(extrasInfo || {}), marche: extra.length };
    }

    onStep('Classement des paris');
    const { top, all } = rank(analyses, S);
    const combos = buildCombos(top, all);
    let app = [];
    if (replay) {
      // Notation de la sélection avec les vrais résultats
      const mod = sp => sp === 'soccer' ? App.soccer : sp === 'tennis' ? App.tennis : App.basket;
      const res = b => { const r = mod(b.sport).settle(b.settle, orig.get(b.ref.id)); return r === 'void' || r === null || r === undefined ? 'void' : (r ? 'won' : 'lost'); };
      top.forEach(b => { b.result = res(b); });
      [...combos.doubles, ...combos.triples, ...combos.hard].forEach(c => {
        const rs = c.legs.map(l => l.result || res(l));
        c.result = rs.includes('lost') ? 'lost' : rs.every(r => r === 'void') ? 'void' : 'won';
      });
      analyses.forEach(a => { a.real = orig.get(a.match.id); });
    } else { app = appPicks(all); await saveHistory(W.key, top, combos, Date.now(), app); }
    analyses.sort((a, b) => a.match.ts - b.match.ts);
    return { W, analyses, top, all, combos, app, surprises, warnings, extras: extrasInfo, replay, ranAt: Date.now() };
  }

  /* ---------- Classement ---------- */
  function favBet(a, s) {
    if (a.sport !== 'soccer') return false;
    const f = a.fav.side, sel = f === 'h' ? '1' : '2';
    return (s.k === '1x2' && s.sel === sel) || (s.k === 'hcp' && s.who === f && s.line < 0) || (s.k === 'nil' && s.who === f)
      || (s.k === 'team' && s.who === f && s.side === 'o');
  }

  function matchName(a) {
    const x = a.match;
    return x.sp === 'tennis' ? `${x.players[0].name} - ${x.players[1].name}` : `${x.h.short} - ${x.a.short}`;
  }

  function rank(analyses, S) {
    const all = [];
    analyses.forEach(a => {
      a.bets.forEach(b => {
        const trapBet = !!a.trap && favBet(a, b.settle);
        const notes = [...b.notes];
        if (trapBet) notes.unshift('Match piège');
        const score = b.p - 0.07 * (1 - b.conf) - (trapBet ? 0.05 : 0);
        all.push({
          ...b, notes, score, a,
          id: `${a.sport}|${a.match.id}|${JSON.stringify(b.settle)}`,
          ref: { sp: a.sport, lg: a.match.lg, id: a.match.id, ts: a.match.ts, src: a.match.src, apiSport: a.match.apiSport, apiId: a.match.apiId },
          matchName: matchName(a), comp: a.comp, sport: a.sport, ts: a.match.ts,
        });
      });
    });
    all.sort((x, y) => y.score - x.score);
    const per = {}, top = [], taken = new Set();
    // 1er passage : limite de paris par match ; 2e passage (journée creuse) : limite assouplie pour atteindre 100
    [S.maxPerMatch, S.maxPerMatch + 2].forEach(limit => {
      for (const b of all) {
        if (top.length >= S.topN) break;
        if (taken.has(b.id) || 1 / b.p < S.minOdd) continue;
        const k = b.ref.id;
        if ((per[k] || 0) >= limit) continue;
        per[k] = (per[k] || 0) + 1;
        taken.add(b.id);
        top.push(b);
      }
    });
    top.sort((x, y) => y.score - x.score);
    top.forEach((b, i) => { b.rank = i + 1; });
    return { top, all };
  }

  // Combinés « grosse cote » : atteindre une cote de 5, 10 ou 15 avec les paris les plus sûrs,
  // un seul pari par match, au plus 2 matchs d'un même championnat de foot.
  const HARD = [5, 10, 15];
  function hardCombos(all) {
    const best = new Map();
    all.forEach(b => {
      if (b.conf < 0.4 || 1 / b.p < 1.15 || (b.notes || []).includes('Match piège') || b.ts < Date.now()) return;
      const k = b.ref.id, cur = best.get(k);
      if (!cur || b.score > cur.score) best.set(k, b);
    });
    const singles = [...best.values()].sort((x, y) => y.score - x.score);
    // version courte : paris à cote 1,40 - 2,30 (moins de matchs, donc moins de marge du bookmaker)
    const mid = new Map();
    all.forEach(b => {
      const o = 1 / b.p;
      if (b.conf < 0.4 || o < 1.4 || o > 2.3 || (b.notes || []).includes('Match piège') || b.ts < Date.now()) return;
      const k = b.ref.id, cur = mid.get(k);
      if (!cur || b.score + 0.3 * b.p > cur.score + 0.3 * cur.p) mid.set(k, b);
    });
    const midList = [...mid.values()].sort((x, y) => (y.score - 0.03 * (1 / y.p)) - (x.score - 0.03 * (1 / x.p)));
    const lgKey = b => b.sport === 'soccer' ? b.ref.lg : null;
    const grow = (list, T, minFin) => {
      const legs = [], per = {};
      let odd = 1;
      const okLeg = b => !legs.some(l => l.ref.id === b.ref.id) && (!lgKey(b) || (per[lgKey(b)] || 0) < 2);
      const push = b => { legs.push(b); odd /= b.p; if (lgKey(b)) per[lgKey(b)] = (per[lgKey(b)] || 0) + 1; };
      while (odd < T - 1e-9 && legs.length < 25) {
        const need = T / odd;
        const free = list.filter(okLeg);
        if (!free.length) return null;
        // dernier pari : le plus sûr de ceux qui suffisent à atteindre la cote visée sans trop la dépasser
        const finisher = 1 / free[0].p < need - 1e-9 && free.find(x => x.p >= minFin && 1 / x.p >= need - 1e-9 && 1 / x.p <= need * 1.3);
        push(finisher || free[0]);
      }
      if (odd < T - 1e-9) return null;
      legs.sort((x, y) => x.ts - y.ts);
      return { legs, p: legs.reduce((a, b) => a * b.p, 1), conf: Math.min(...legs.map(l => l.conf)), target: T, kind: 'hard',
        id: 'H' + T + '§' + legs.map(l => l.id).sort().join('§') };
    };
    const out = [];
    HARD.forEach(T => {
      const a = grow(singles, T, 0.75); if (a) { a.style = 'sure'; out.push(a); }
      const b = grow(midList, T, 0.6); if (b && (!a || b.id !== a.id)) { b.style = 'courte'; out.push(b); }
    });
    return out;
  }

  function buildCombos(top, all) {
    const pool = top.slice(0, 40);
    const leagueKey = b => b.sport === 'soccer' ? b.ref.lg : b.sport + b.ref.id;
    const ok = legs => {
      const ids = new Set(legs.map(l => l.ref.id));
      if (ids.size !== legs.length) return false; // jamais deux paris sur le même match
      // pas deux paris sur un même championnat de foot (évite d'empiler les favoris d'une même journée)
      const lgs = legs.filter(l => l.sport === 'soccer').map(leagueKey);
      return new Set(lgs).size === lgs.length;
    };
    const mk = legs => ({ legs, p: legs.reduce((a, b) => a * b.p, 1), conf: Math.min(...legs.map(l => l.conf)),
      id: legs.map(l => l.id).sort().join('§') });
    const doubles = [];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const legs = [pool[i], pool[j]]; if (ok(legs)) doubles.push(mk(legs));
    }
    doubles.sort((a, b) => (b.p - 0.05 * (1 - b.conf)) - (a.p - 0.05 * (1 - a.conf)));
    // On évite de réutiliser trop souvent les mêmes paris
    const use = {}, pick = (list, n, maxUse) => {
      const out = [];
      for (const c of list) {
        if (out.length >= n) break;
        if (c.legs.some(l => (use[l.id] || 0) >= maxUse)) continue;
        c.legs.forEach(l => { use[l.id] = (use[l.id] || 0) + 1; });
        out.push(c);
      }
      return out;
    };
    const d2 = pick(doubles, 10, 2);
    const p25 = pool.slice(0, 25), triples = [];
    for (let i = 0; i < p25.length; i++) for (let j = i + 1; j < p25.length; j++) for (let k = j + 1; k < p25.length; k++) {
      const legs = [p25[i], p25[j], p25[k]]; if (ok(legs)) triples.push(mk(legs));
    }
    triples.sort((a, b) => b.p - a.p);
    const d3 = pick(triples, 6, 3);
    return { doubles: d2, triples: d3, hard: hardCombos(all || top) };
  }

  /* ---------- Portefeuille de l'app : elle choisit ses propres paris chaque jour ---------- */
  // 1) « valeur » : foot, le calcul croit nettement plus au pari que les bookmakers (cote estimée = celle du marché, marge 5 %)
  // 2) « fiable » : les paris les plus sûrs à partir de 1,30 (cote estimée = cote mini × 0,91 : sur ces paris
  //    Winamax paie environ 1,18 quand la cote mini est 1,30, constaté le 7/11)
  // Jamais : analyse « marché » seule, match piège, confiance faible, match déjà commencé.
  const APP = { value: 3, reliable: 3, minOdd: 1.30, maxOdd: 2.30 };
  const SAFE_F = 0.91;
  function marketP(b) {
    const m = b.a && b.a.market, s = b.settle;
    if (!m || b.sport !== 'soccer' || m.p1 === undefined) return null;
    if (s.k === '1x2') return s.sel === '1' ? m.p1 : s.sel === '2' ? m.p2 : m.pX;
    if (s.k === 'dc') return s.sel === '1X' ? m.p1 + m.pX : s.sel === 'X2' ? m.pX + m.p2 : m.p1 + m.p2;
    if (s.k === 'tot' && s.line === 2.5 && m.pO !== undefined) return s.side === 'o' ? m.pO : 1 - m.pO;
    return null;
  }
  // Pari « qui rapporte » : la cote probable chez le bookmaker (moyenne du marché, marge 5 %) paie plus que le risque
  // calculé par l'app. ev = gain moyen pour 1 € misé (1,08 = +8 %).
  function valueOf(b) {
    const pm = marketP(b);
    // au moins 40 % de chances (pas de coups de poker) ; un écart énorme avec le marché = donnée douteuse
    if (!pm || b.conf < 0.6 || b.p < 0.4) return null;
    const odd = 1 / (pm * 1.05), ev = b.p * odd;
    return ev > 1.25 ? null : { pm, odd, ev };
  }
  function appPicks(all, now = Date.now()) {
    const ok = b => b.ts > now + 5 * 60000 && b.conf >= 0.6 && !(b.notes || []).includes('Match piège') && b.a && b.a.analysisType !== 'marche';
    const used = new Set(), out = [];
    all.filter(ok).map(b => ({ b, v: valueOf(b) })).filter(x => x.v && x.v.ev >= 1.03 && x.v.odd >= 1.4 && x.v.odd <= 3.5)
      .map(x => ({ ...x, pm: x.v.pm, odd: x.v.odd }))
      .sort((x, y) => y.v.ev - x.v.ev)
      .forEach(x => { if (out.length < APP.value && !used.has(x.b.ref.id)) { used.add(x.b.ref.id); out.push({ id: x.b.id, odd: +x.odd.toFixed(2), kind: 'valeur', pm: x.pm, b: x.b }); } });
    const nV = out.length;
    all.filter(b => ok(b) && 1 / b.p >= APP.minOdd && 1 / b.p <= APP.maxOdd).sort((x, y) => y.score - x.score)
      .forEach(b => { if (out.length < nV + APP.reliable && !used.has(b.ref.id)) { used.add(b.ref.id); out.push({ id: b.id, odd: +Math.max(1.01, SAFE_F / b.p).toFixed(2), kind: 'fiable', b }); } });
    return out;
  }

  /* ---------- Historique ---------- */
  const slim = b => ({ id: b.id, label: b.label, group: b.group, p: b.p, conf: b.conf, settle: b.settle, ref: b.ref,
    matchName: b.matchName, comp: b.comp, sport: b.sport, ts: b.ts, rank: b.rank, notes: b.notes,
    why: b.why || (b.a ? App.why(b) : ''), factors: b.factors || (b.a ? (b.a.factors || []).slice(0, 10) : []) });

  async function saveHistory(dayKey, top, combos, at, app) {
    const H = combos.hard || [];
    app = app || [];
    const now = Date.now();
    const existing = (await App.db.all('history')).filter(([k]) => k.startsWith(dayKey + '|'));
    const keep = new Set();
    top.forEach(b => keep.add(`${dayKey}|B|${b.id}`));
    app.forEach(x => keep.add(`${dayKey}|B|${x.id}`));
    [...combos.doubles, ...combos.triples, ...H].forEach(c => keep.add(`${dayKey}|C|${c.id}`));
    // On retire les anciens pronostics de matchs pas encore commencés qui ne sont plus dans la sélection
    for (const [k, v] of existing) {
      const started = v.type === 'B' ? v.bet.ts <= now : v.legs.some(l => l.ts <= now);
      if (!keep.has(k) && !started && v.result === null && !v.played) await App.db.del('history', k);
    }
    const exMap = new Map(existing);
    for (const b of top) {
      const k = `${dayKey}|B|${b.id}`;
      const prev = exMap.get(k);
      if (prev && b.ts <= now) continue; // match commencé : on garde le pronostic d'origine
      await App.db.put('history', k, { type: 'B', day: dayKey, bet: slim(b), result: prev ? prev.result : null, savedAt: now, at: at || now, played: !!(prev && prev.played) });
    }
    // paris de l'app (le choix d'un match commencé n'est jamais modifié)
    const topIds = new Set(top.map(b => b.id));
    for (const x of app) {
      const k = `${dayKey}|B|${x.id}`;
      const prev = await App.db.get('history', k);
      if (prev && prev.app && x.b.ts <= now) continue;
      const v = prev || { type: 'B', day: dayKey, bet: slim(x.b), result: null, savedAt: now, at: at || now, extra: !topIds.has(x.id) };
      v.app = { odd: x.odd, kind: x.kind, pm: x.pm, at: at || now };
      await App.db.put('history', k, v);
    }
    for (const c of [...combos.doubles, ...combos.triples, ...H]) {
      const k = `${dayKey}|C|${c.id}`;
      const prev = exMap.get(k);
      if (prev && c.legs.some(l => l.ts <= now)) continue;
      await App.db.put('history', k, { type: 'C', day: dayKey, p: c.p, legs: c.legs.map(slim), kind: c.kind || '', target: c.target, result: prev ? prev.result : null, savedAt: now, at: at || now, played: !!(prev && prev.played) });
    }
  }

  // ESPN marque parfois « terminé » un match seulement suspendu (pluie, interruption) ou reporté
  const paused = x => /SUSPEND|POSTPON|DELAY|INTERRUPT/i.test(`${x.stName || ''} ${x.detail || ''}`);
  async function findMatch(ref, ttl = 20 * 60000) {
    const dates = [d.ymd(new Date(ref.ts)), d.ymd(new Date(ref.ts - d.DAY)), d.ymd(new Date(ref.ts + d.DAY))];
    for (const y of dates) {
      let list;
      if (ref.sp === 'soccer') list = await D.soccerDay(ref.lg, y, ttl);
      else if (ref.sp === 'tennis') list = await D.tennisDay(ref.lg, y, ttl);
      else list = await D.basketDay(ref.lg, y, ttl);
      const x = list.find(z => z.id === ref.id);
      if (x) return x;
    }
    return null;
  }

  async function settleBet(b, cache) {
    if (b.ref.src === 'api') { const r = await App.marche.settle(b); return r === undefined ? null : r; }
    if (cache.has(b.ref.id)) return cache.get(b.ref.id)(b);
    const x = await findMatch(b.ref);
    const fn = bb => {
      if (!x) return Date.now() - bb.ts > 3 * d.DAY ? 'void' : null;
      if (paused(x)) return null; // match suspendu ou reporté : pas encore de résultat
      const mod = bb.sport === 'soccer' ? App.soccer : bb.sport === 'tennis' ? App.tennis : App.basket;
      const r = mod.settle(bb.settle, x);
      return r === undefined ? null : r;
    };
    cache.set(b.ref.id, fn);
    return fn(b);
  }

  async function settleAll(onStep) {
    const now = Date.now();
    const entries = (await App.db.all('history')).filter(([, v]) => v.result === null);
    const cache = new Map();
    let n = 0;
    for (const [k, v] of entries) {
      if (v.type === 'B') {
        if (v.bet.ts > now - 2.5 * 3600000) continue;
        const r = await settleBet(v.bet, cache);
        if (r !== null) { v.result = r === 'void' ? 'void' : (r ? 'won' : 'lost'); await App.db.put('history', k, v); n++; }
      } else {
        if (v.legs.some(l => l.ts > now - 2.5 * 3600000)) continue;
        const rs = [];
        for (const l of v.legs) rs.push(await settleBet(l, cache));
        if (rs.some(r => r === false)) v.result = 'lost';
        else if (rs.every(r => r === 'void')) v.result = 'void';
        else if (rs.every(r => r === true || r === 'void')) v.result = 'won';
        else continue;
        v.legResults = rs.map(r => r === 'void' ? 'void' : r ? 'won' : 'lost');
        await App.db.put('history', k, v); n++;
      }
      if (onStep && n % 10 === 0) onStep(`Vérification des résultats : ${n}`);
    }
    return n;
  }

  /* ---------- Sauvegarde de l'analyse sur le serveur local (analyse auto + surveillance des compositions) ---------- */
  const betOut = (b, ai) => { const { a, ...rest } = b; return { ...rest, ai }; };
  function serialize(r) {
    const idx = new Map(r.analyses.map((a, i) => [a, i]));
    const analyses = r.analyses.map(a => { const { bets, real, ...rest } = a; return rest; });
    const top = r.top.map(b => betOut(b, idx.get(b.a)));
    const others = [];
    // on garde 30 paris par match : de quoi refaire un classement par fourchette de cotes
    // + tous les paris comparables aux bookmakers (1N2, double chance, ±2,5 buts) pour le filtre « paris qui rapportent »
    r.analyses.forEach(a => r.all.filter(b => b.a === a).filter((b, i) => i < 30 || marketP(b) !== null).forEach(b => others.push(betOut(b, idx.get(a)))));
    const cmb = list => list.map(c => ({ p: c.p, conf: c.conf, id: c.id, legs: c.legs.map(l => r.top.indexOf(l)) }));
    const app = (r.app || []).map(({ b, ...x }) => ({ ...x, bet: betOut(b, idx.get(b.a)) }));
    return { W: r.W, ranAt: r.ranAt, auto: !!r.auto, analyses, top, others, app, combos: { doubles: cmb(r.combos.doubles), triples: cmb(r.combos.triples),
      hard: (r.combos.hard || []).map(c => ({ ...c, legs: c.legs.map(l => betOut(l, idx.get(l.a))) })) },
      surprises: r.surprises, warnings: r.warnings, extras: r.extras };
  }
  function deserialize(j) {
    const analyses0 = j.analyses.map(a => ({ ...a, bets: [] }));
    // analyses enregistrées avant le filtre « jamais sur Winamax » (Russie, jeunes…) : on les retire
    const bad = new Set(analyses0.filter(a => App.marche.exclu(a)));
    const analyses = analyses0.filter(a => !bad.has(a));
    const topAll = j.top.map(b => ({ ...b, a: analyses0[b.ai] }));
    const top = topAll.filter(b => !bad.has(b.a));
    top.forEach((b, i) => { b.rank = i + 1; });
    const all = j.others.map(b => ({ ...b, a: analyses0[b.ai] })).filter(b => !bad.has(b.a));
    const okC = c => c.legs.every(l => l && !bad.has(l.a));
    const app = j.app ? j.app.map(({ bet, ...x }) => ({ ...x, b: { ...bet, a: analyses0[bet.ai] } })).filter(x => !bad.has(x.b.a)) : null;
    const cmb = list => list.map(c => ({ ...c, legs: c.legs.map(i => topAll[i]) })).filter(okC);
    return { ...j, app, analyses, top, all, combos: { doubles: cmb(j.combos.doubles), triples: cmb(j.combos.triples),
      hard: (j.combos.hard || []).map(c => ({ ...c, legs: c.legs.map(l => ({ ...l, a: analyses0[l.ai] })) })).filter(okC) } };
  }
  async function saveRemote(r) {
    try {
      const res = await fetch('/api/save-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serialize(r)) });
      return res.ok;
    } catch (e) { return false; }
  }
  // Dernière analyse : serveur local (PC) ou fichier publié (version en ligne, GitHub Pages)
  async function loadRemote() {
    const found = [];
    for (const url of ['/api/last-analysis', 'en-ligne/dernier.json', 'https://vinc-bou.github.io/feuille-du-jour/en-ligne/dernier.json']) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok && (res.headers.get('content-type') || '').includes('json')) found.push(await res.json());
      } catch (e) { /* on essaie la source suivante */ }
    }
    if (!found.length) return null;
    // la plus récente journée, puis la plus complète (la version en ligne a les données marché)
    found.sort((a, b) => (b.W.key - a.W.key) || (b.analyses.length - a.analyses.length));
    return deserialize(found[0]);
  }

  // Score en direct d'un match de la sélection (rafraîchi toutes les minutes au plus)
  async function live(b) {
    if (b.ref.src === 'api') return null;
    const x = await findMatch(b.ref, 55000).catch(() => null);
    if (!x) return null;
    let result = null;
    if (paused(x)) return { x: { ...x, st: 'in', detail: /POSTPON/i.test(`${x.stName} ${x.detail}`) ? 'reporté' : 'suspendu' }, result };
    if (x.st === 'post') {
      const mod = b.sport === 'soccer' ? App.soccer : b.sport === 'tennis' ? App.tennis : App.basket;
      const r = mod.settle(b.settle, x);
      result = r === 'void' ? 'void' : r === true ? 'won' : r === false ? 'lost' : null;
    }
    return { x, result };
  }

  // Case « je joue ce pari » : enregistré dans l'historique (créé s'il n'y était pas : pari hors top 100)
  async function togglePlayed(dayKey, item, isCombo) {
    const k = `${dayKey}|${isCombo ? 'C' : 'B'}|${item.id}`;
    let v = await App.db.get('history', k);
    if (!v) v = isCombo
      ? { type: 'C', day: dayKey, p: item.p, legs: item.legs.map(slim), kind: item.kind || '', target: item.target, result: null, savedAt: Date.now(), at: Date.now(), extra: true }
      : { type: 'B', day: dayKey, bet: slim(item), result: null, savedAt: Date.now(), at: Date.now(), extra: true };
    v.played = !v.played;
    v.playedAt = v.played ? Date.now() : undefined;
    if (!v.played && v.extra) await App.db.del('history', k); else await App.db.put('history', k, v);
    return v.played;
  }

  return { run, settleAll, settings, saveHistory, saveRemote, loadRemote, live, togglePlayed, appPicks, SAFE_F, valueOf };
})();
