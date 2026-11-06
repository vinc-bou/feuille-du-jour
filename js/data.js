/* Récupération des données (source publique gratuite ESPN) + mise en cache locale. */
window.App = window.App || {};

App.data = (() => {
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
  const H = 3600000;
  let active = 0;
  const queue = [];
  const stats = { done: 0, total: 0 };
  let onProgress = () => {};

  function limit(fn) {
    return new Promise((res, rej) => {
      queue.push({ fn, res, rej });
      pump();
    });
  }
  function pump() {
    while (active < 6 && queue.length) {
      const { fn, res, rej } = queue.shift();
      active++;
      fn().then(res, rej).finally(() => { active--; stats.done++; onProgress(stats); pump(); });
    }
  }

  async function getJSON(url) {
    // Mode automatique : passage par le serveur local (ESPN refuse les navigateurs invisibles)
    if (App.data.useProxy && url.startsWith('https://site.api.espn.com')) url = '/api/espn?u=' + encodeURIComponent(url.slice('https://site.api.espn.com'.length));
    stats.total++; onProgress(stats);
    return limit(async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(url);
          if (r.status === 400 || r.status === 404) return null;
          if (!r.ok) throw new Error(r.status);
          return await r.json();
        } catch (e) {
          if (i === 2) { console.warn('Échec', url, e); return null; }
          await new Promise(s => setTimeout(s, 800 * (i + 1)));
        }
      }
    });
  }

  // Lecture avec cache : ttl en ms (Infinity = jamais périmé)
  async function cached(key, ttl, loader) {
    key = 'v2|' + key; // à changer si le format des données enregistrées évolue
    const hit = await App.db.get('cache', key);
    if (hit && (Date.now() - hit.ts) < ttl) return hit.v;
    const v = await loader();
    if (v === null || v === undefined) return hit ? hit.v : null;
    await App.db.put('cache', key, { ts: Date.now(), v });
    return v;
  }

  /* ---------- Football ---------- */
  function parseMin(dv) {
    const s = String(dv || '');
    const m = s.match(/(\d+)'?(?:\+(\d+))?/);
    if (!m) return { min: 0, half: 0 };
    const base = +m[1];
    const half = base <= 45 ? 1 : (base <= 90 ? 2 : 3);
    return { min: base + (m[2] ? +m[2] / 100 : 0), half };
  }

  function team(t) {
    return { id: t.id, name: t.displayName, short: t.shortDisplayName || t.displayName, abbr: t.abbreviation, logo: t.logo || '' };
  }

  function normSoccer(e, lg) {
    const c = e.competitions && e.competitions[0];
    if (!c || !c.competitors || c.competitors.length !== 2) return null;
    const hc = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0];
    const ac = c.competitors.find(x => x !== hc);
    const side = (x) => {
      const st = {};
      (x.statistics || []).forEach(s => { st[s.name] = parseFloat(s.displayValue); });
      return { ...team(x.team), g: +x.score || 0, form: x.form || '',
        cor: st.wonCorners, sh: st.totalShots, sot: st.shotsOnTarget, fouls: st.foulsCommitted, poss: st.possessionPct };
    };
    const h = side(hc), a = side(ac);
    const goals = [], cards = [];
    (c.details || []).forEach(d => {
      const txt = (d.type && d.type.text || '').toLowerCase();
      const { min, half } = parseMin(d.clock && d.clock.displayValue);
      const tid = d.team && d.team.id;
      const ath = (d.athletesInvolved || [])[0];
      if (d.scoringPlay || txt.includes('goal')) {
        if (txt.includes('shootout') || d.shootout) return;
        goals.push({ t: tid, min, half, pid: ath && ath.id, pn: ath && ath.displayName,
          og: !!d.ownGoal || txt.includes('own'), pen: !!d.penaltyKick || txt.includes('penalty') });
      } else if (d.yellowCard || d.redCard || txt.includes('card')) {
        cards.push({ t: tid, min, red: !!d.redCard || txt.includes('red') });
      }
    });
    // Contrôle : les buts détaillés doivent correspondre au score final (sinon on n'utilise pas les mi-temps)
    const gh = goals.filter(g => g.t === h.id).length, ga = goals.filter(g => g.t === a.id).length;
    const detailsOk = gh === h.g && ga === a.g;
    if (detailsOk) {
      h.g1 = goals.filter(g => g.t === h.id && g.half === 1).length;
      a.g1 = goals.filter(g => g.t === a.id && g.half === 1).length;
    }
    h.cards = cards.filter(x => x.t === h.id).length;
    a.cards = cards.filter(x => x.t === a.id).length;
    // Cotes du jour publiées par ESPN (un bookmaker américain) : servent d'avis du marché en secours
    let odds = null;
    const o = c.odds && c.odds[0];
    if (o && o.moneyline && e.status.type.state === 'pre') {
      const dec = v => { const n = parseFloat(v); if (!n) return null; return n > 0 ? 1 + n / 100 : 1 + 100 / -n; };
      const cl = x => x && (x.close || x.open) && dec((x.close || x.open).odds);
      const ml = o.moneyline;
      const oh = cl(ml.home), oa = cl(ml.away), od = cl(ml.draw) || (o.drawOdds && dec(o.drawOdds.moneyLine));
      if (oh && oa && od) {
        odds = { o1x2: [oh, od, oa], book: (o.provider && o.provider.name) || 'bookmaker' };
        const ov = o.total && o.total.over, un = o.total && o.total.under;
        const line = ov && (ov.close || ov.open) && (ov.close || ov.open).line;
        if (line === 'o2.5') { const a2 = cl(ov), b2 = cl(un); if (a2 && b2) odds.oOU = [a2, b2]; }
      }
    }
    return {
      odds,
      id: e.id, sp: 'soccer', lg, ts: Date.parse(e.date), st: e.status.type.state,
      stName: e.status.type.name, season: `${(e.season && e.season.year) || ''}|${(e.season && e.season.slug) || ''}`,
      h, a, goals, cards, detailsOk,
      hasStats: h.cor !== undefined && !isNaN(h.cor),
      venue: c.venue && c.venue.fullName,
    };
  }

  function normSoccerList(j, lg) {
    if (!j || !j.events) return null;
    return j.events.map(e => normSoccer(e, lg)).filter(Boolean);
  }

  async function soccerYear(lg, year) {
    const cur = new Date().getFullYear();
    const ttl = year < cur ? Infinity : 12 * H;
    return (await cached(`s|${lg}|${year}`, ttl, async () =>
      normSoccerList(await getJSON(`${BASE}/soccer/${lg}/scoreboard?dates=${year}&limit=1000`), lg))) || [];
  }
  async function soccerMonth(lg, ym) {
    return (await cached(`sm|${lg}|${ym}`, 0.5 * H, async () =>
      normSoccerList(await getJSON(`${BASE}/soccer/${lg}/scoreboard?dates=${ym}&limit=1000`), lg))) || [];
  }
  async function soccerDay(lg, ymd, ttl = 10 * 60000) {
    return (await cached(`sd|${lg}|${ymd}`, ttl, async () =>
      normSoccerList(await getJSON(`${BASE}/soccer/${lg}/scoreboard?dates=${ymd}&limit=200`), lg))) || [];
  }

  // Tout l'historique d'un championnat (années passées + mois récents rafraîchis)
  async function soccerHistory(lg) {
    const now = new Date();
    const years = [];
    for (let i = 0; i < App.config.soccerYears; i++) years.push(now.getFullYear() - i);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const parts = await Promise.all([
      ...years.map(y => soccerYear(lg, y)),
      soccerMonth(lg, App.d.ym(now)), soccerMonth(lg, App.d.ym(prev)),
    ]);
    const map = new Map();
    parts.flat().forEach(m => map.set(m.id, m));
    return [...map.values()].sort((x, y) => x.ts - y.ts);
  }

  /* ---------- Tennis ---------- */
  function normTennis(e, feed) {
    const out = [];
    (e.groupings || []).forEach(g => {
      const gn = (g.grouping && g.grouping.displayName) || '';
      if (!/singles/i.test(gn)) return;
      const gender = /women/i.test(gn) ? 'F' : 'M';
      (g.competitions || []).forEach(c => {
        if (!c.competitors || c.competitors.length !== 2) return;
        const players = c.competitors.map(p => {
          const a = p.athlete || {};
          const name = a.displayName || a.fullName || '';
          return { name, key: App.t.norm(name), flag: (a.flag && a.flag.href) || '', winner: !!p.winner,
            sets: (p.linescores || []).map(l => l.value) };
        });
        if (!players[0].name || !players[1].name || /tbd|bye/i.test(players[0].name + players[1].name)) return;
        out.push({
          id: c.id, sp: 'tennis', lg: feed, tour: e.name, tourId: e.id, ts: Date.parse(c.date || e.date),
          st: c.status.type.state, stName: c.status.type.name || '', round: c.round && c.round.displayName,
          gender, players,
        });
      });
    });
    return out;
  }
  function normTennisList(j, feed) {
    if (!j || !j.events) return null;
    return j.events.flatMap(e => normTennis(e, feed));
  }
  async function tennisMonth(feed, ym, isPast) {
    return (await cached(`t|${feed}|${ym}`, isPast ? Infinity : 2 * H, async () =>
      normTennisList(await getJSON(`${BASE}/tennis/${feed}/scoreboard?dates=${ym}`), feed))) || [];
  }
  async function tennisDay(feed, ymd, ttl = 10 * 60000) {
    return (await cached(`td|${feed}|${ymd}`, ttl, async () =>
      normTennisList(await getJSON(`${BASE}/tennis/${feed}/scoreboard?dates=${ymd}`), feed))) || [];
  }
  async function tennisHistory(feed) {
    const now = new Date();
    const jobs = [];
    for (let i = 0; i < App.config.tennisMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      jobs.push(tennisMonth(feed, App.d.ym(d), i > 1));
    }
    return (await Promise.all(jobs)).flat();
  }
  async function tennisRanks(feed) {
    return (await cached(`tr|${feed}`, 12 * H, async () => {
      const j = await getJSON(`${BASE}/tennis/${feed}/rankings`);
      if (!j || !j.rankings || !j.rankings[0]) return null;
      const map = {};
      j.rankings[0].ranks.forEach(r => {
        const n = r.athlete && r.athlete.displayName;
        if (n) map[App.t.norm(n)] = { rank: r.current, pts: r.points };
      });
      return map;
    })) || {};
  }

  /* ---------- Basket ---------- */
  function normBasket(e, lg) {
    const c = e.competitions && e.competitions[0];
    if (!c || !c.competitors || c.competitors.length !== 2) return null;
    const hc = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0];
    const ac = c.competitors.find(x => x !== hc);
    const side = x => ({ ...team(x.team), pts: +x.score || 0, q: (x.linescores || []).map(l => l.value) });
    return { id: e.id, sp: 'basket', lg, ts: Date.parse(e.date), st: e.status.type.state,
      stName: e.status.type.name, season: String(e.season && e.season.year || ''),
      seasonType: e.season && e.season.type, h: side(hc), a: side(ac) };
  }
  function normBasketList(j, lg) {
    if (!j || !j.events) return null;
    return j.events.map(e => normBasket(e, lg)).filter(Boolean);
  }
  /* ---------- Euroligue / EuroCup (API officielle publique, XML) ---------- */
  const EURO = { euroleague: 'E', eurocup: 'U' };
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const titleCase = s => (s || '').toLowerCase().replace(/(^|[\s\-'.])(\p{L})/gu, (m0, a, b) => a + b.toUpperCase());
  async function getXML(url) {
    stats.total++; onProgress(stats);
    return limit(async () => {
      for (let i = 0; i < 3; i++) {
        try { const r = await fetch(url); if (r.ok) return new DOMParser().parseFromString(await r.text(), 'text/xml'); }
        catch (e) { if (i === 2) console.warn('Échec', url, e); }
        await new Promise(s => setTimeout(s, 700 * (i + 1)));
      }
      return null;
    });
  }
  const tx = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
  const euroTs = (date, time) => { // heure d'Europe centrale = heure de Paris
    const m = (date || '').match(/(\w{3}) (\d+), (\d{4})/);
    if (!m) return null;
    const [hh, mi] = (time || '20:00').split(':').map(Number);
    return new Date(+m[3], MON[m[1]] - 1, +m[2], hh || 20, mi || 0).getTime();
  };
  async function euroSeason(lg, year, isPast) {
    const code = EURO[lg] + year;
    return (await cached(`eu|${code}`, isPast ? Infinity : 0.5 * H, async () => {
      // Passage par le serveur local si possible (l'API officielle n'autorise pas toujours la lecture directe)
      const viaLocal = await localAvailable();
      const url = kind => viaLocal ? `/api/euro?kind=${kind}&code=${code}` : `https://api-live.euroleague.net/v1/${kind}?seasonCode=${code}`;
      const [sch, res] = await Promise.all([getXML(url('schedules')), getXML(url('results'))]);
      if (!sch) return null;
      const scores = {};
      if (res) [...res.getElementsByTagName('game')].forEach(g => {
        if (tx(g, 'played') === 'true') scores[tx(g, 'gamecode')] = [+tx(g, 'homescore'), +tx(g, 'awayscore')];
      });
      const team = (name, c) => ({ id: lg + ':' + c, name: titleCase(name), short: titleCase(name).split(' ').slice(0, 2).join(' '), abbr: c, logo: '', q: [] });
      return [...sch.getElementsByTagName('item')].map(it => {
        const gc = tx(it, 'gamecode'), sc = scores[gc];
        const h = team(tx(it, 'hometeam'), tx(it, 'homecode')), a = team(tx(it, 'awayteam'), tx(it, 'awaycode'));
        h.pts = sc ? sc[0] : 0; a.pts = sc ? sc[1] : 0;
        return { id: gc, sp: 'basket', lg, ts: euroTs(tx(it, 'date'), tx(it, 'startime')), st: sc ? 'post' : (tx(it, 'played') === 'true' ? 'in' : 'pre'),
          stName: '', season: String(year), h, a, noQuarters: true };
      }).filter(x => x.ts);
    })) || [];
  }
  const euroYear = () => { const n = new Date(); return n.getMonth() >= 7 ? n.getFullYear() : n.getFullYear() - 1; };

  async function basketMonth(lg, ym, isPast) {
    return (await cached(`b|${lg}|${ym}`, isPast ? Infinity : 2 * H, async () =>
      normBasketList(await getJSON(`${BASE}/basketball/${lg}/scoreboard?dates=${ym}&limit=1000`), lg))) || [];
  }
  async function basketDay(lg, ymd, ttl = 10 * 60000) {
    if (EURO[lg]) {
      const list = await euroSeason(lg, euroYear(), false);
      return list.filter(x => App.d.ymd(new Date(x.ts)) === ymd);
    }
    return (await cached(`bd|${lg}|${ymd}`, ttl, async () =>
      normBasketList(await getJSON(`${BASE}/basketball/${lg}/scoreboard?dates=${ymd}&limit=200`), lg))) || [];
  }
  async function basketHistory(lg) {
    if (EURO[lg]) {
      const y = euroYear();
      const parts = await Promise.all([euroSeason(lg, y, false), euroSeason(lg, y - 1, true), euroSeason(lg, y - 2, true)]);
      return parts.flat().sort((a, b) => a.ts - b.ts);
    }
    const now = new Date();
    const jobs = [];
    const months = lg === 'wnba' ? [5, 6, 7, 8, 9, 10] : [10, 11, 12, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 12 * App.config.nbaSeasons; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      if (!months.includes(d.getMonth() + 1)) continue;
      jobs.push(basketMonth(lg, App.d.ym(d), i > 1));
    }
    const map = new Map();
    (await Promise.all(jobs)).flat().forEach(m => map.set(m.id, m));
    return [...map.values()].sort((x, y) => x.ts - y.ts);
  }
  async function nbaInjuries() {
    return (await cached('inj|nba', 1 * H, async () => {
      const j = await getJSON(`${BASE}/basketball/nba/injuries`);
      if (!j || !j.injuries) return null;
      const map = {};
      j.injuries.forEach(t => {
        map[t.id] = (t.injuries || []).map(i => ({ name: i.athlete && i.athlete.displayName, status: i.status }));
      });
      return map;
    })) || {};
  }

  async function soccerRoster(lg, teamId) {
    return (await cached(`ro|${lg}|${teamId}`, 24 * H, async () => {
      const j = await getJSON(`${BASE}/soccer/${lg}/teams/${teamId}/roster`);
      if (!j || !j.athletes) return null;
      return j.athletes.map(a => a.displayName).filter(Boolean);
    })) || null;
  }

  // Données ouvertes via le petit serveur local (serveur.py) : null si l'app n'est pas ouverte avec Lancer.bat
  async function local(path, key, ttl, asJson) {
    return cached(`loc|${key}`, ttl, async () => {
      try {
        stats.total++; onProgress(stats);
        const r = await fetch(path);
        stats.done++; onProgress(stats);
        if (!r.ok) return null;
        return asJson ? await r.json() : await r.text();
      } catch (e) { return null; }
    });
  }
  async function localAvailable() {
    try { const r = await fetch('/api/ping', { cache: 'no-store' }); return r.ok && (await r.text()) === 'ok'; } catch (e) { return false; }
  }

  return {
    soccerRoster, local, localAvailable,
    setProgress(fn) { onProgress = fn; stats.done = 0; stats.total = 0; },
    soccerHistory, soccerDay, tennisHistory, tennisDay, tennisRanks, basketHistory, basketDay, nbaInjuries,
  };
})();
