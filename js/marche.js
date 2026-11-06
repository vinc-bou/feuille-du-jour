/* Analyse « marché » : pour tous les matchs proposés par les bookmakers que l'app ne sait pas analyser
   en détail (petits championnats, autres sports), la probabilité de chaque pari est la moyenne des
   bookmakers, marge retirée (données API-Football, collectées chaque nuit par collecte_api.py). */
window.App = window.App || {};

App.marche = (() => {
  const { t, m, d } = App;
  const SPORT = { soccer: 'soccer', basketball: 'basket', hockey: 'hockey', handball: 'handball', volleyball: 'volley', rugby: 'rugby' };
  const UNIT = { basketball: 'points', hockey: 'buts', handball: 'buts', rugby: 'points', volleyball: 'points' };
  const PAGES = 'https://vinc-bou.github.io/feuille-du-jour/';
  const fl = l => t.num(Math.abs(l), 1);

  async function fetchFirst(urls) {
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) return await r.json();
      } catch (e) { /* source suivante */ }
    }
    return null;
  }
  const load = day => fetchFirst([`/api/marche?day=${day}`]);
  let scoresCache = null;
  async function scores() {
    if (!scoresCache) scoresCache = (await fetchFirst(['/api/scores-api', 'en-ligne/scores-api.json', PAGES + 'en-ligne/scores-api.json'])) || {};
    return scoresCache;
  }

  /* ---------- Libellés ---------- */
  function labelSoccer(s, H, A) {
    const sign = s.side === 'o' ? '+' : '-';
    const tm = w => w === 'h' ? H : A;
    switch (s.k) {
      case '1x2': return ['1N2', s.sel === '1' ? `Victoire ${H}` : s.sel === '2' ? `Victoire ${A}` : 'Match nul'];
      case 'dc': return ['Double chance', s.sel === '1X' ? `${H} ou nul` : s.sel === 'X2' ? `Nul ou ${A}` : `${H} ou ${A} (pas de nul)`];
      case 'tot': return ['Buts', `${sign}${fl(s.line)} buts`];
      case 'team': return ['Buts équipe', `${tm(s.who)} ${sign}${fl(s.line)} but${s.line > 1 ? 's' : ''}`];
      case 'btts': return ['Les deux marquent', s.sel ? 'Les deux équipes marquent' : 'Les deux équipes marquent : non'];
      case 'ht1x2': return ['Mi-temps', s.sel === '1' ? `${H} mène à la pause` : s.sel === '2' ? `${A} mène à la pause` : 'Nul à la pause'];
      case 'htot': return ['Mi-temps', `${sign}${fl(s.line)} but${s.line > 1 ? 's' : ''} en ${s.half === 1 ? '1re' : '2e'} mi-temps`];
      case 'hcp': return ['Handicap', `${tm(s.who)} ${s.line > 0 ? '+' : '-'}${fl(s.line)} (handicap)`];
      case 'htft': { const n = c => c === '1' ? H : c === '2' ? A : 'Nul'; return ['Mi-temps', `Mi-temps / fin : ${n(s.sel[0])} / ${n(s.sel[2])}`]; }
    }
    return null;
  }
  function labelOther(s, H, A, sport) {
    const u = UNIT[sport] || 'points';
    const tm = w => w === 'h' ? H : A;
    switch (s.k) {
      case '1x2': return ['Vainqueur', s.sel === 'X' ? 'Match nul (temps réglementaire)' : `Victoire ${s.sel === '1' ? H : A} (temps réglementaire)`];
      case 'win': return ['Vainqueur', `Victoire ${tm(s.who)}${sport === 'volleyball' ? '' : ' (prolongation incluse)'}`];
      case 'tot': return [u === 'buts' ? 'Buts' : 'Points', `${s.side === 'o' ? '+' : '-'}${fl(s.line)} ${u}`];
      case 'hcp': return ['Handicap', `${tm(s.who)} ${s.line > 0 ? '+' : '-'}${fl(s.line)} ${u}`];
    }
    return null;
  }

  /* ---------- Rapprochement avec les matchs déjà analysés en détail ---------- */
  const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'afc', 'club', 'de', 'la', 'le', 'ca', 'cd', 'sv', 'fk', 'sk', 'if', 'bk', 'us', 'rc', 'real', 'city', 'united', 'sporting', 'athletic', 'atletico', 'ud', 'sd', 'ssc', 'bc', 'basket', 'basketball']);
  const toks = n => t.norm(n).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  const same = (a, b) => { const A = toks(a), B = toks(b); return A.some(x => B.some(y => x === y || (x.length >= 5 && (y.startsWith(x) || x.startsWith(y))))); };
  function findApi(data, sport, h, a, ts) {
    const list = (data && data.sports && data.sports[sport]) || [];
    return list.find(x => Math.abs(x.ts - ts) < 3 * 3600000 && same(x.h.name, h) && same(x.a.name, a)) || null;
  }
  // Avis du marché (Pinnacle et autres) pour un match de foot analysé en détail
  function marketFor(data, fx) {
    const x = findApi(data, 'soccer', fx.h.name, fx.a.name, fx.ts);
    if (!x || !x.markets.length) return null;
    const g = (k, f) => { const q = x.markets.find(mk => mk.s.k === k && f(mk.s)); return q ? q.p : undefined; };
    const p1 = g('1x2', s => s.sel === '1'), pX = g('1x2', s => s.sel === 'X'), p2 = g('1x2', s => s.sel === '2');
    if (p1 === undefined || pX === undefined || p2 === undefined) return null;
    const pO = g('tot', s => s.side === 'o' && s.line === 2.5);
    const books = Math.max(...x.markets.map(mk => mk.n));
    return { p1, pX, p2, pO, books, pin: x.markets.some(mk => mk.pin) };
  }

  /* ---------- Construction des analyses « marché » ---------- */
  function build(data, W, existing) {
    const out = [];
    if (!data || !data.sports) return out;
    Object.entries(data.sports).forEach(([sport, list]) => {
      list.forEach(x => {
        if (x.status !== 'NS' || x.ts < W.start || x.ts >= W.end || !x.markets.length || x.ts < Date.now()) return;
        const sp = SPORT[sport];
        // déjà analysé en détail (ESPN) ?
        if (existing.some(a => a.sport === sp && a.match.h && Math.abs(a.match.ts - x.ts) < 3 * 3600000 && same(a.match.h.name, x.h.name) && same(a.match.a.name, x.a.name))) return;
        const short = n => n.length > 22 ? n.split(' ').slice(0, 2).join(' ') : n;
        const H = short(x.h.name), A = short(x.a.name);
        const match = { id: `api:${sport}:${x.id}`, src: 'api', apiSport: sport, apiId: x.id, sp: sp, lg: sport, ts: x.ts, st: 'pre',
          h: { id: 'api' + x.h.id, name: x.h.name, short: H, logo: x.h.logo || '' }, a: { id: 'api' + x.a.id, name: x.a.name, short: A, logo: x.a.logo || '' } };
        const books = Math.max(...x.markets.map(mk => mk.n));
        const pin = x.markets.some(mk => mk.pin);
        const conf = pin ? (books >= 3 ? 0.8 : 0.7) : books >= 3 ? 0.65 : books === 2 ? 0.5 : 0.35;
        const bets = [];
        x.markets.forEach(mk => {
          if (!(mk.p > 0.02 && mk.p < 0.995)) return;
          const lab = sport === 'soccer' ? labelSoccer(mk.s, H, A) : labelOther(mk.s, H, A, sport);
          if (!lab) return;
          // Moins de bookmakers sur ce pari précis = un peu moins de confiance
          const c = Math.min(conf, mk.pin ? 0.8 : mk.n >= 3 ? 0.65 : mk.n === 2 ? 0.5 : 0.35);
          bets.push({ group: lab[0], label: lab[1], p: mk.p, conf: c, settle: mk.s, notes: [] });
        });
        if (!bets.length) return;
        const g1 = bets.find(b => b.settle.k === '1x2' && b.settle.sel === '1'), g2 = bets.find(b => b.settle.k === '1x2' && b.settle.sel === '2');
        const gw = s => bets.find(b => b.settle.k === 'win' && b.settle.who === s);
        const pH = g1 ? g1.p : gw('h') ? gw('h').p : 0.5, pA = g2 ? g2.p : gw('a') ? gw('a').p : 0.5;
        const comp = `${x.league.country ? x.league.country + ' · ' : ''}${x.league.name}`;
        out.push({
          match, sport: sp, comp, compId: `api|${sport}|${x.league.id}`, country: x.league.country || '', conf, bets,
          p1: g1 ? g1.p : undefined, pX: (bets.find(b => b.settle.k === '1x2' && b.settle.sel === 'X') || {}).p, p2: g2 ? g2.p : undefined,
          analysisType: 'marche',
          factors: [`Analyse par le marché : moyenne de ${books} bookmaker${books > 1 ? 's' : ''}${pin ? ' dont Pinnacle (la référence)' : ''}, marge retirée.`,
            'Pas d\'historique détaillé disponible gratuitement pour cette compétition : la probabilité est celle des bookmakers.'],
          tags: ['Analyse marché'],
          fav: { side: pH >= pA ? 'h' : 'a', name: pH >= pA ? H : A, pWin: Math.max(pH, pA), fragility: Math.min(pH, pA), isFav: Math.max(pH, pA) >= 0.5 },
        });
      });
    });
    return out;
  }

  /* ---------- Résultats (historique) ---------- */
  async function settle(bet) {
    const sc = await scores();
    const e = sc[`${bet.ref.apiSport}|${bet.ref.apiId}`];
    if (!e) return Date.now() - bet.ts > 3 * d.DAY ? 'void' : null;
    if (!('h' in e) || e.h === null || e.h === undefined) return 'void';
    const s = bet.settle;
    if (bet.ref.apiSport === 'soccer') {
      const x = { st: 'post', h: { g: e.h, g1: e.h1, cards: 0 }, a: { g: e.a, g1: e.a1, cards: 0 }, detailsOk: e.h1 !== null && e.h1 !== undefined, goals: [], cards: [], hasStats: false };
      return App.soccer.settle(s, x);
    }
    const over = v => s.side === 'o' ? v > s.line : v < s.line;
    const rh = e.rh !== undefined ? e.rh : e.h, ra = e.ra !== undefined ? e.ra : e.a;
    switch (s.k) {
      case '1x2': return (rh > ra ? '1' : rh === ra ? 'X' : '2') === s.sel;
      case 'win': return s.who === 'h' ? e.h > e.a : e.a > e.h;
      case 'tot': return over(e.h + e.a);
      case 'hcp': return (s.who === 'h' ? e.h - e.a : e.a - e.h) + s.line > 0;
    }
    return null;
  }

  return { load, build, marketFor, settle, SPORT };
})();
