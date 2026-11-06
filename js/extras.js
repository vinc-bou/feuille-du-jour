/* Données ouvertes complémentaires (via serveur.py) :
   - football-data.co.uk : xG, arbitres, cotes moyennes des bookmakers
   - Transfermarkt (jeu de données GitHub) : anciens clubs des joueurs et bilan contre eux */
window.App = window.App || {};

App.extras = (() => {
  const { d, t, m } = App;
  const D = App.data;
  const H = 3600000;

  // Codes football-data.co.uk des championnats
  const FD = { 'fra.1': 'F1', 'fra.2': 'F2', 'eng.1': 'E0', 'eng.2': 'E1', 'esp.1': 'SP1', 'esp.2': 'SP2', 'ita.1': 'I1',
    'ita.2': 'I2', 'ger.1': 'D1', 'ger.2': 'D2', 'por.1': 'P1', 'ned.1': 'N1', 'bel.1': 'B1', 'tur.1': 'T1', 'sco.1': 'SC0', 'gre.1': 'G1' };
  const FD_REV = Object.fromEntries(Object.entries(FD).map(([k, v]) => [v, k]));
  // Compétitions Transfermarkt -> compétitions de l'app
  const TMC = { FR1: 'fra.1', GB1: 'eng.1', ES1: 'esp.1', IT1: 'ita.1', L1: 'ger.1', PO1: 'por.1', NL1: 'ned.1', BE1: 'bel.1',
    TR1: 'tur.1', SC1: 'sco.1', GR1: 'gre.1', A1: 'aut.1', DK1: 'den.1', CL: 'uefa.champions', EL: 'uefa.europa',
    UCOL: 'uefa.europa.conf', FAC: 'eng.fa', CDR: 'esp.copa_del_rey', CIT: 'ita.coppa_italia', DFB: 'ger.dfb_pokal',
    MLS1: 'usa.1', BRA1: 'bra.1', ARG1: 'arg.1', MEX1: 'mex.1', SA1: 'ksa.1' };

  function parseCSV(txt) {
    if (!txt) return [];
    const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const head = lines.shift().split(',');
    return lines.map(l => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
  }
  const num = v => (v === undefined || v === '' ? null : +v);
  function fdDate(s, time) {
    const [dd, mm, yy] = (s || '').split('/').map(Number);
    if (!dd) return null;
    const y = yy < 100 ? 2000 + yy : yy;
    const [hh, mi] = (time || '15:00').split(':').map(Number);
    return Date.UTC(y, mm - 1, dd, (hh || 15) - 1, mi || 0); // heure anglaise ≈ UTC+0/+1
  }
  function fdRow(r) {
    const odds = (a, b, c) => { const x = [num(r[a]), num(r[b]), num(r[c])]; return x.every(v => v > 1) ? x : null; };
    return {
      ts: fdDate(r.Date, r.Time), day: r.Date, home: r.HomeTeam, away: r.AwayTeam,
      hg: num(r.FTHG), ag: num(r.FTAG), ref: r.Referee || null,
      xg: r.HxG && r.AxG ? [+r.HxG, +r.AxG] : null,
      cards: r.HY !== undefined && r.HY !== '' ? (+r.HY + +r.AY + +r.HR + +r.AR) : null,
      o1x2: odds('AvgH', 'AvgD', 'AvgA') || odds('B365H', 'B365D', 'B365A'),
      oOU: (num(r['Avg>2.5']) > 1 && num(r['Avg<2.5']) > 1) ? [+r['Avg>2.5'], +r['Avg<2.5']] : null,
    };
  }

  function seasons(n) {
    const now = new Date(); const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const out = [];
    for (let i = 0; i < n; i++) { const a = (y - i) % 100, b = (y - i + 1) % 100; out.push(String(a).padStart(2, '0') + String(b).padStart(2, '0')); }
    return out;
  }

  /* ---------- Liens noms football-data -> équipes ESPN (par date + score) ---------- */
  function linkFD(rows, espn) {
    const byDay = {};
    espn.forEach(x => { if (x.st !== 'post') return; const k = new Date(x.ts).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(x); });
    const votes = {};
    const vote = (name, id) => { const v = votes[name] || (votes[name] = {}); v[id] = (v[id] || 0) + 1; };
    rows.forEach(r => {
      if (r.hg === null || !r.ts) return;
      const cands = [];
      [-1, 0, 1].forEach(o => { const k = new Date(r.ts + o * d.DAY).toISOString().slice(0, 10); (byDay[k] || []).forEach(x => { if (x.h.g === r.hg && x.a.g === r.ag) cands.push(x); }); });
      if (cands.length === 1) { vote(r.home, cands[0].h.id); vote(r.away, cands[0].a.id); }
    });
    const map = {};
    Object.entries(votes).forEach(([n, v]) => { const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; if (best[1] >= 2) map[n] = best[0]; });
    return map;
  }

  /* ---------- Chargement ---------- */
  async function load(soccerHist, leagueIds) {
    const ok = await D.localAvailable();
    if (!ok) return { ok: false };
    const out = { ok: true, byMatch: {}, refs: {}, fixtures: [], tm: null, nameMap: {} };

    // football-data : saisons en cours + 3 précédentes
    const ss = seasons(4);
    await Promise.all(leagueIds.filter(lg => FD[lg]).map(async lg => {
      const texts = await Promise.all(ss.map((s, i) => D.local(`/api/fd?code=${FD[lg]}&season=${s}`, `fd|${lg}|${s}`, i === 0 ? 6 * H : Infinity, false)));
      const rows = texts.flatMap(tx => parseCSV(tx).map(fdRow)).filter(r => r.ts);
      if (!rows.length) return;
      const espn = soccerHist[lg] || [];
      const map = linkFD(rows, espn);
      out.nameMap[lg] = map;
      // Rattache xG / arbitre / cotes à chaque match ESPN
      const idx = {};
      espn.forEach(x => { idx[x.h.id + '|' + x.a.id + '|' + new Date(x.ts).toISOString().slice(0, 10)] = x; });
      rows.forEach(r => {
        const h = map[r.home], a = map[r.away];
        if (!h || !a) return;
        for (const o of [0, -1, 1]) {
          const x = idx[h + '|' + a + '|' + new Date(r.ts + o * d.DAY).toISOString().slice(0, 10)];
          if (x) { out.byMatch[x.id] = r; break; }
        }
      });
      // Arbitres : cartons par match comparés à la moyenne du championnat
      const withCards = rows.filter(r => r.cards !== null && r.ref);
      if (withCards.length > 50) {
        const avg = withCards.reduce((a, r) => a + r.cards, 0) / withCards.length;
        const per = {};
        withCards.forEach(r => { const p = per[r.ref] || (per[r.ref] = [0, 0]); p[0] += r.cards; p[1]++; });
        out.refs[lg] = { avg, per };
      }
    }));
    // Prochains matchs avec cotes
    const fx = parseCSV(await D.local('/api/fd-fixtures', 'fdfx', 1 * H, false));
    out.fixtures = fx.map(r => ({ ...fdRow(r), lg: FD_REV[r.Div] })).filter(r => r.lg);

    // Transfermarkt
    const tm = await D.local('/api/tm', 'tm', 7 * 24 * H, true);
    if (tm && tm.games) {
      out.tm = tm;
      // Lien clubs TM -> équipes ESPN (même compétition, même jour, même score)
      const byKey = {};
      Object.values(soccerHist).flat().forEach(x => { if (x.st !== 'post') return; const k = x.lg + '|' + new Date(x.ts).toISOString().slice(0, 10); (byKey[k] = byKey[k] || []).push(x); });
      const votes = {};
      const vote = (c, id) => { const v = votes[c] || (votes[c] = {}); v[id] = (v[id] || 0) + 1; };
      tm.games.forEach(([date, comp, h, a, hg, ag]) => {
        const lg = TMC[comp]; if (!lg) return;
        const base = Date.parse(date + 'T12:00:00Z');
        const cands = [];
        [-1, 0, 1].forEach(o => { (byKey[lg + '|' + new Date(base + o * d.DAY).toISOString().slice(0, 10)] || []).forEach(x => { if (x.h.g === hg && x.a.g === ag) cands.push(x); }); });
        if (cands.length === 1) { vote(h, cands[0].h.id); vote(a, cands[0].a.id); }
      });
      const club2espn = {}, espn2club = {};
      Object.entries(votes).forEach(([c, v]) => { const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; if (best[1] >= 2) { club2espn[c] = best[0]; espn2club[best[0]] = c; } });
      out.club2espn = club2espn; out.espn2club = espn2club;
      // Index joueurs par ancien club
      out.byPast = {};
      Object.entries(tm.players).forEach(([pid, p]) => p.past.forEach(c => { (out.byPast[c] = out.byPast[c] || []).push(p); }));
    }
    return out;
  }

  /* ---------- Outils pour l'analyse ---------- */
  const sameName = (a, b) => {
    const A = t.norm(a), B = t.norm(b);
    if (A === B) return true;
    const pa = A.split(' '), pb = B.split(' ');
    if (pa.length < 2 || pb.length < 2) return pa[pa.length - 1] === pb[pb.length - 1] && (pa.length === 1 || pb.length === 1);
    return pa[pa.length - 1] === pb[pb.length - 1] && pa[0][0] === pb[0][0];
  };

  // Joueurs de « team » ayant joué pour « opp » (Transfermarkt), confirmés par l'effectif ESPN si disponible
  function revenants(X, teamId, oppId, roster) {
    if (!X || !X.tm || !X.espn2club) return [];
    const tc = X.espn2club[teamId], oc = X.espn2club[oppId];
    if (!oc) return [];
    const cands = X.byPast[oc] || [];
    const res = [];
    cands.forEach(p => {
      const inRoster = roster ? roster.some(n => sameName(n, p.n)) : null;
      const atClub = tc && p.cur === tc;
      if (inRoster === true || (inRoster === null && atClub)) {
        const v = p.vs[oc] || [0, 0, 0];
        res.push({ name: p.n, apps: v[0], goals: v[1], assists: v[2], confirmed: inRoster === true });
      }
    });
    return res.sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists) || b.apps - a.apps);
  }

  // Probabilités des bookmakers (marge retirée) pour un match du jour
  function market(X, fx) {
    if (!X || !X.fixtures || !X.nameMap[fx.lg]) return null;
    const map = X.nameMap[fx.lg];
    const r = X.fixtures.find(f => f.lg === fx.lg && map[f.home] === fx.h.id && map[f.away] === fx.a.id && Math.abs(f.ts - fx.ts) < 2 * d.DAY);
    if (!r) return null;
    return { ...implied(r), ref: r.ref };
  }
  function implied(r) {
    const o = {};
    if (r.o1x2) { const inv = r.o1x2.map(x => 1 / x), s = inv[0] + inv[1] + inv[2]; o.p1 = inv[0] / s; o.pX = inv[1] / s; o.p2 = inv[2] / s; }
    if (r.oOU) { const a = 1 / r.oOU[0], b = 1 / r.oOU[1]; o.pO = a / (a + b); }
    return o;
  }

  // Trouve les buts attendus (λ domicile, λ extérieur) qui reproduisent les probabilités des bookmakers
  function fitLambdas(mk, start) {
    if (mk.p1 === undefined) return null;
    const pO = mk.pO !== undefined ? mk.pO : null;
    let best = null;
    const evalL = (lh, la) => {
      const ph = m.poissonPmf(lh, 10), pa = m.poissonPmf(la, 10);
      let p1 = 0, p2 = 0, po = 0;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = ph[i] * pa[j]; if (i > j) p1 += p; else if (j > i) p2 += p; if (i + j > 2.5) po += p; }
      return (p1 - mk.p1) ** 2 + (p2 - mk.p2) ** 2 + (pO !== null ? (po - pO) ** 2 : 0);
    };
    for (let lh = 0.2; lh <= 4; lh += 0.05) for (let la = 0.2; la <= 4; la += 0.05) {
      const e = evalL(lh, la);
      if (!best || e < best[2]) best = [lh, la, e];
    }
    return best ? { lh: best[0], la: best[1] } : null;
  }

  function referee(X, lg, name) {
    const R = X && X.refs[lg];
    if (!R || !name) return null;
    const p = R.per[name];
    const n = p ? p[1] : 0;
    const K = 6;
    const f = ((p ? p[0] : 0) + K * R.avg) / (n + K) / R.avg;
    return { name, n, avg: p ? p[0] / p[1] : null, factor: f };
  }

  return { load, revenants, market, implied, fitLambdas, referee, sameName, FD };
})();
