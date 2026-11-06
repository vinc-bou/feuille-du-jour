/* Football : modèle de buts, corners, cartons, buteurs + facteurs de contexte. */
window.App = window.App || {};

App.soccer = (() => {
  const { m, d, t } = App;
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const fmtLine = l => t.num(l, 1);

  /* ---------- Modèle d'un championnat ---------- */
  function buildLeague(lgCfg, matches, now) {
    const done = matches.filter(x => x.st === 'post' && now - x.ts < 800 * d.DAY);
    if (done.length < 20) return null;
    const w = x => Math.exp(-(now - x.ts) / (150 * d.DAY));
    const recent = done.filter(x => now - x.ts < 400 * d.DAY);

    // Moyennes du championnat
    let sw = 0, gh = 0, ga = 0, gs = 0, sots = 0, fh = 0, fhn = 0, corH = 0, corA = 0, corN = 0, kH = 0, kA = 0;
    recent.forEach(x => {
      const ww = w(x); sw += ww; gh += ww * x.h.g; ga += ww * x.a.g;
      if (x.hasStats && x.h.sot !== undefined) { gs += ww * (x.h.g + x.a.g); sots += ww * (x.h.sot + x.a.sot); }
      if (x.detailsOk && x.h.g + x.a.g > 0) { fh += x.h.g1 + x.a.g1; fhn += x.h.g + x.a.g; }
      if (x.hasStats) { corH += ww * x.h.cor; corA += ww * x.a.cor; kH += ww * x.h.cards; kA += ww * x.a.cards; corN += ww; }
    });
    const L = {
      cfg: lgCfg, avgH: gh / sw, avgA: ga / sw, conv: sots ? gs / sots : 0.3,
      fh: fhn > 30 ? fh / fhn : 0.45,
      corH: corN ? corH / corN : null, corA: corN ? corA / corN : null,
      kH: corN ? kH / corN : null, kA: corN ? kA / corN : null,
      statsShare: done.length ? done.filter(x => x.hasStats).length / done.length : 0,
      teams: {},
    };
    const mbar = (L.avgH + L.avgA) / 2;
    // « Buts effectifs » : on mélange les buts réels avec les xG (football-data) ou, à défaut, les tirs cadrés
    const eg = (side) => side.xg !== undefined ? (1 - App.soccer.XGW) * side.g + App.soccer.XGW * side.xg
      : (side.sot !== undefined && !isNaN(side.sot)) ? 0.7 * side.g + 0.3 * side.sot * L.conv : side.g;

    // Forces attaque / défense (méthode itérative, pondérée par la récence, ajustée à l'adversaire)
    const ids = new Set(); done.forEach(x => { ids.add(x.h.id); ids.add(x.a.id); });
    const att = {}, def = {}, info = {};
    ids.forEach(id => { att[id] = 1; def[id] = 1; });
    const K = 3;
    for (let it = 0; it < 12; it++) {
      const nA = {}, dA = {}, nD = {}, dD = {};
      ids.forEach(id => { nA[id] = K * mbar; dA[id] = K * mbar; nD[id] = K * mbar; dD[id] = K * mbar; });
      done.forEach(x => {
        const ww = w(x);
        nA[x.h.id] += ww * eg(x.h); dA[x.h.id] += ww * L.avgH * def[x.a.id];
        nA[x.a.id] += ww * eg(x.a); dA[x.a.id] += ww * L.avgA * def[x.h.id];
        nD[x.h.id] += ww * eg(x.a); dD[x.h.id] += ww * L.avgA * att[x.a.id];
        nD[x.a.id] += ww * eg(x.h); dD[x.a.id] += ww * L.avgH * att[x.h.id];
      });
      ids.forEach(id => { att[id] = nA[id] / dA[id]; def[id] = nD[id] / dD[id]; });
    }

    // Domicile / extérieur séparés (rapprochés de la note générale si peu de matchs)
    const K2 = 5;
    ids.forEach(id => {
      const T = { id, att: att[id], def: def[id], n: 0 };
      const acc = { hA: [0, 0], hD: [0, 0], aA: [0, 0], aD: [0, 0], cf: [0, 0], ca: [0, 0], kf: [0, 0], ka: [0, 0] };
      done.forEach(x => {
        const ww = w(x);
        if (x.h.id === id) {
          T.n += ww; T.name = x.h.name; T.logo = x.h.logo;
          acc.hA[0] += ww * eg(x.h); acc.hA[1] += ww * L.avgH * def[x.a.id];
          acc.hD[0] += ww * eg(x.a); acc.hD[1] += ww * L.avgA * att[x.a.id];
          if (x.hasStats) { acc.cf[0] += ww * x.h.cor / L.corH; acc.cf[1] += ww; acc.ca[0] += ww * x.a.cor / L.corA; acc.ca[1] += ww;
            acc.kf[0] += ww * x.h.cards / L.kH; acc.kf[1] += ww; acc.ka[0] += ww * x.a.cards / L.kA; acc.ka[1] += ww; }
        } else if (x.a.id === id) {
          T.n += ww; T.name = x.a.name; T.logo = x.a.logo;
          acc.aA[0] += ww * eg(x.a); acc.aA[1] += ww * L.avgA * def[x.h.id];
          acc.aD[0] += ww * eg(x.h); acc.aD[1] += ww * L.avgH * att[x.h.id];
          if (x.hasStats) { acc.cf[0] += ww * x.a.cor / L.corA; acc.cf[1] += ww; acc.ca[0] += ww * x.h.cor / L.corH; acc.ca[1] += ww;
            acc.kf[0] += ww * x.a.cards / L.kA; acc.kf[1] += ww; acc.ka[0] += ww * x.h.cards / L.kH; acc.ka[1] += ww; }
        }
      });
      const sh = (a, prior, k) => (a[0] + k * prior) / (a[1] + k);
      T.hAtt = (acc.hA[0] + K2 * mbar * T.att) / (acc.hA[1] + K2 * mbar);
      T.hDef = (acc.hD[0] + K2 * mbar * T.def) / (acc.hD[1] + K2 * mbar);
      T.aAtt = (acc.aA[0] + K2 * mbar * T.att) / (acc.aA[1] + K2 * mbar);
      T.aDef = (acc.aD[0] + K2 * mbar * T.def) / (acc.aD[1] + K2 * mbar);
      T.cf = sh(acc.cf, 1, 4); T.ca = sh(acc.ca, 1, 4); T.kf = sh(acc.kf, 1, 5); T.ka = sh(acc.ka, 1, 5);
      T.statN = acc.cf[1];
      L.teams[id] = T;
    });

    // Saison en cours : classement
    const last = done[done.length - 1];
    L.season = last.season;
    const cur = done.filter(x => x.season === L.season);
    const table = {};
    const row = (s) => table[s.id] || (table[s.id] = { id: s.id, name: s.name, pts: 0, gp: 0, gf: 0, ga: 0 });
    cur.forEach(x => {
      const H = row(x.h), A = row(x.a);
      H.gp++; A.gp++; H.gf += x.h.g; H.ga += x.a.g; A.gf += x.a.g; A.ga += x.h.g;
      if (x.h.g > x.a.g) H.pts += 3; else if (x.h.g < x.a.g) A.pts += 3; else { H.pts++; A.pts++; }
    });
    L.table = Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    L.table.forEach((r, i) => { r.rank = i + 1; if (L.teams[r.id]) L.teams[r.id].row = r; });

    // Buteurs (saison en cours et précédente)
    const seasons = [...new Set(done.map(x => x.season))];
    const prevSeason = seasons.length > 1 ? seasons[seasons.length - 2] : null;
    L.scorers = {}; // teamId -> [{pid, pn, g, gPrev, lastIdx}]
    const teamGoals = {}, teamGoalsPrev = {};
    const teamSeq = {}; // ordre des matchs de chaque équipe dans la saison
    cur.forEach(x => {
      [x.h, x.a].forEach(s => { (teamSeq[s.id] = teamSeq[s.id] || []).push(x.id); teamGoals[s.id] = (teamGoals[s.id] || 0) + s.g; });
    });
    const allScorers = {};
    done.forEach(x => {
      const isCur = x.season === L.season, isPrev = x.season === prevSeason;
      if (!isCur && !isPrev) return;
      if (isPrev) { teamGoalsPrev[x.h.id] = (teamGoalsPrev[x.h.id] || 0) + x.h.g; teamGoalsPrev[x.a.id] = (teamGoalsPrev[x.a.id] || 0) + x.a.g; }
      x.goals.forEach(g => {
        if (g.og || !g.pid || !g.t) return;
        const k = g.t + '|' + g.pid;
        const s = allScorers[k] || (allScorers[k] = { pid: g.pid, pn: g.pn, t: g.t, g: 0, gPrev: 0, pen: 0, matches: [] });
        if (isCur) { s.g++; if (g.pen) s.pen++; s.matches.push(x.id); } else s.gPrev++;
      });
    });
    Object.values(allScorers).forEach(s => {
      (L.scorers[s.t] = L.scorers[s.t] || []).push(s);
      const seq = teamSeq[s.t] || [];
      const lastIdx = Math.max(-1, ...s.matches.map(id => seq.indexOf(id)));
      s.since = lastIdx < 0 ? null : seq.length - 1 - lastIdx; // matchs sans marquer
      const last4 = seq.slice(-4);
      s.hot = s.matches.filter(id => last4.includes(id)).length;
    });
    const ranking = Object.values(allScorers).filter(s => s.g > 0).sort((a, b) => b.g - a.g);
    ranking.forEach((s, i) => { s.rank = i === 0 || s.g !== ranking[i - 1].g ? i + 1 : ranking[i - 1].rank; });
    L.teamGoals = teamGoals; L.teamGoalsPrev = teamGoalsPrev; L.teamSeq = teamSeq;

    // Périodes de l'année (trous d'air / périodes fortes) sur les saisons passées
    L.monthly = {}; // teamId -> month -> [{season, diff}]
    const bySeason = {};
    done.forEach(x => { (bySeason[x.season] = bySeason[x.season] || []).push(x); });
    Object.entries(bySeason).forEach(([s, list]) => {
      if (s === L.season || list.length < 100) return;
      const tot = {}, mon = {};
      list.forEach(x => {
        const mo = new Date(x.ts).getMonth();
        [[x.h, x.a], [x.a, x.h]].forEach(([me, op]) => {
          const p = me.g > op.g ? 3 : me.g === op.g ? 1 : 0;
          const T = tot[me.id] || (tot[me.id] = [0, 0]); T[0] += p; T[1]++;
          const M = (mon[me.id] = mon[me.id] || {}); const MM = M[mo] || (M[mo] = [0, 0]); MM[0] += p; MM[1]++;
        });
      });
      Object.keys(tot).forEach(id => {
        if (tot[id][1] < 15) return;
        const ppg = tot[id][0] / tot[id][1];
        Object.entries(mon[id] || {}).forEach(([mo, v]) => {
          if (v[1] < 2) return;
          const A = (L.monthly[id] = L.monthly[id] || {});
          (A[mo] = A[mo] || []).push({ season: s, diff: v[0] / v[1] - ppg });
        });
      });
    });

    // Surprises : part des favoris battus par match (classement « à la volée » de chaque saison)
    let nM = 0, nUp = 0, nFav = 0;
    Object.entries(bySeason).forEach(([s, list]) => {
      const pp = {};
      list.forEach(x => {
        const H = pp[x.h.id] || (pp[x.h.id] = [0, 0]), A = pp[x.a.id] || (pp[x.a.id] = [0, 0]);
        if (H[1] >= 4 && A[1] >= 4) {
          const diff = (H[0] / H[1] + 0.3) - A[0] / A[1];
          nM++;
          if (Math.abs(diff) >= 0.5) {
            nFav++;
            if ((diff > 0 && x.h.g < x.a.g) || (diff < 0 && x.a.g < x.h.g)) nUp++;
          }
        }
        const ph = x.h.g > x.a.g ? 3 : x.h.g === x.a.g ? 1 : 0, pa = x.a.g > x.h.g ? 3 : x.h.g === x.a.g ? 1 : 0;
        H[0] += ph; H[1]++; A[0] += pa; A[1]++;
      });
    });
    L.upsetRate = nM ? nUp / nM : 0.12;          // surprises par match joué
    L.favLoseRate = nFav ? nUp / nFav : 0.2;     // part des favoris nets qui perdent
    L.nTeams = L.table.length || ids.size;
    return L;
  }

  /* ---------- Données transversales (toutes compétitions) ---------- */
  function buildGlobal(allMatches) {
    const lastPlayed = {}; // teamId -> [ts...] (matchs joués)
    const career = {};     // pid -> [{season, t, ts}]
    const vsOld = {};      // pid|teamId -> buts contre cette équipe
    allMatches.forEach(x => {
      if (x.st !== 'post') return;
      [x.h.id, x.a.id].forEach(id => (lastPlayed[id] = lastPlayed[id] || []).push(x.ts));
      x.goals.forEach(g => {
        if (g.og || !g.pid) return;
        (career[g.pid] = career[g.pid] || []).push({ season: x.season, t: g.t, ts: x.ts, pn: g.pn });
        const opp = g.t === x.h.id ? x.a.id : x.h.id;
        vsOld[g.pid + '|' + opp] = (vsOld[g.pid + '|' + opp] || 0) + 1;
      });
    });
    Object.values(lastPlayed).forEach(a => a.sort((x, y) => x - y));
    return { lastPlayed, career, vsOld };
  }

  // Résultats récents d'une équipe, toutes compétitions
  function teamForm(teamId, allMatches, before) {
    return allMatches.filter(x => x.st === 'post' && x.ts < before && (x.h.id === teamId || x.a.id === teamId))
      .sort((a, b) => b.ts - a.ts).slice(0, 10)
      .map(x => {
        const me = x.h.id === teamId ? x.h : x.a, op = x.h.id === teamId ? x.a : x.h;
        return { id: x.id, r: me.g > op.g ? 'V' : me.g === op.g ? 'N' : 'D', gf: me.g, ga: op.g, opp: op.name, home: x.h.id === teamId, ts: x.ts, lg: x.lg };
      });
  }

  function streaks(form) {
    const run = (fn) => { let n = 0; for (const f of form) { if (fn(f)) n++; else break; } return n; };
    return { unbeaten: run(f => f.r !== 'D'), wins: run(f => f.r === 'V'), losses: run(f => f.r === 'D'),
      winless: run(f => f.r !== 'V'), clean: run(f => f.ga === 0), scoring: run(f => f.gf > 0), noScore: run(f => f.gf === 0) };
  }

  function isDerby(a, b) {
    const A = t.norm(a), B = t.norm(b);
    return App.config.derbies.some(([x, y]) => (A.includes(x) && B.includes(y)) || (A.includes(y) && B.includes(x)));
  }

  /* ---------- Probabilités de score ---------- */
  function scoreMatrix(lh, la, rho = -0.08, max = 10) {
    const ph = m.poissonPmf(lh, max), pa = m.poissonPmf(la, max);
    const M = [];
    let s = 0;
    for (let i = 0; i <= max; i++) {
      M[i] = [];
      for (let j = 0; j <= max; j++) {
        let p = ph[i] * pa[j];
        if (i === 0 && j === 0) p *= 1 - lh * la * rho;
        else if (i === 0 && j === 1) p *= 1 + lh * rho;
        else if (i === 1 && j === 0) p *= 1 + la * rho;
        else if (i === 1 && j === 1) p *= 1 - rho;
        M[i][j] = p; s += p;
      }
    }
    for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) M[i][j] /= s;
    return M;
  }
  const sumM = (M, fn) => { let s = 0; for (let i = 0; i < M.length; i++) for (let j = 0; j < M.length; j++) if (fn(i, j)) s += M[i][j]; return s; };

  /* ---------- Analyse d'un match ---------- */
  function analyzeMatch(fx, ctx) {
    const { leagues, global, all, lgCfg } = ctx;
    const X = ctx.X;
    const now = fx.ts;
    const domestic = (id) => ctx.teamLeague[id] ? leagues[ctx.teamLeague[id]] : null;
    const LH = domestic(fx.h.id), LA = domestic(fx.a.id);
    const TH = LH && LH.teams[fx.h.id], TA = LA && LA.teams[fx.a.id];
    const Lfx = leagues[fx.lg];
    const factors = [], tags = [];
    const unknownCoef = lgCfg.type === 'cup' ? 0.62 : 0.72;
    const coefH = LH ? (LH.cfg.coef || 0.8) : unknownCoef, coefA = LA ? (LA.cfg.coef || 0.8) : unknownCoef;

    const base = Lfx ? { h: Lfx.avgH, a: Lfx.avgA, fh: Lfx.fh } : { h: 1.42, a: 1.15, fh: 0.45 };
    const g = (T, k, dflt = 1) => T ? T[k] : dflt;
    let lh = base.h * g(TH, 'hAtt') * g(TA, 'aDef');
    let la = base.a * g(TA, 'aAtt') * g(TH, 'hDef');
    if (coefH !== coefA) {
      const r = Math.pow(coefH / coefA, 1.6);
      lh *= r; la /= r;
      factors.push(`Écart de niveau entre championnats (${t.num(coefH, 2)} contre ${t.num(coefA, 2)})`);
    }
    // Neutralise un peu l'avantage du terrain pour les finales sur terrain neutre (non détectable) : rien à faire ici.

    const mult = { h: { att: 1, def: 1 }, a: { att: 1, def: 1 } };
    const sides = { h: fx.h, a: fx.a };
    const month = new Date(fx.ts).getMonth();
    const forms = {}, strk = {};

    // Trêve : le championnat lui-même n'a pas joué depuis au moins 10 jours
    const leagueBreak = lgCfg.type === 'league' &&
      !all.some(x => x.lg === fx.lg && x.st === 'post' && x.ts < now && now - x.ts < 10 * d.DAY);

    ['h', 'a'].forEach(s => {
      const team = sides[s];
      const L = s === 'h' ? LH : LA;
      // Fatigue / trêve
      const played = (global.lastPlayed[team.id] || []).filter(x => x < now - 2 * 3600000);
      const lastTs = played[played.length - 1];
      if (lastTs) {
        const days = (now - lastTs) / d.DAY;
        if (days < 3.6) { mult[s].att *= 0.96; mult[s].def *= 1.04; factors.push(`${team.short} a joué il y a ${Math.round(days)} jours (fatigue)`); tags.push('Fatigue'); }
        else if (days >= 12 && leagueBreak) { mult[s].att *= 0.97; factors.push(`${team.short} reprend après ${Math.round(days)} jours sans match (trêve internationale)`); tags.push('Retour de trêve'); }
      }
      // Forme et séries
      const form = teamForm(team.id, all, now);
      forms[s] = form; strk[s] = streaks(form);
      const st = strk[s];
      if (st.unbeaten >= 6) { mult[s].att *= 1.02; factors.push(`${team.short} : ${st.unbeaten} matchs sans défaite`); }
      if (st.losses >= 3) { mult[s].att *= 0.97; mult[s].def *= 1.03; factors.push(`${team.short} : ${st.losses} défaites de suite`); }
      if (st.winless >= 5 && st.losses < 3) factors.push(`${team.short} : ${st.winless} matchs sans victoire`);
      if (st.clean >= 3) factors.push(`${team.short} : ${st.clean} matchs sans encaisser`);
      if (st.noScore >= 3) factors.push(`${team.short} : ${st.noScore} matchs sans marquer`);
      // Période de l'année
      const hist = L && L.monthly[team.id] && L.monthly[team.id][month];
      if (hist && hist.length >= 2) {
        const bad = hist.filter(x => x.diff <= -0.35).length, good = hist.filter(x => x.diff >= 0.35).length;
        const need = Math.max(2, Math.ceil(hist.length * 0.66));
        const avg = hist.reduce((a, b) => a + b.diff, 0) / hist.length;
        if (bad >= need) {
          mult[s].att *= 0.94; mult[s].def *= 1.05;
          factors.push(`${team.short} : trou d'air habituel en ${MONTHS[month]} (${bad} saisons sur ${hist.length}, ${t.num(avg, 2)} pt/match)`);
          tags.push(`Trou d'air ${team.short}`);
        } else if (good >= need) {
          mult[s].att *= 1.04; mult[s].def *= 0.97;
          factors.push(`${team.short} : souvent en forme en ${MONTHS[month]} (${good} saisons sur ${hist.length}, +${t.num(avg, 2)} pt/match)`);
          tags.push(`Période forte ${team.short}`);
        }
      }
      // Enjeu de fin de saison (championnat uniquement)
      if (L && lgCfg.type === 'league' && L === Lfx && L.table.length > 8) {
        const row = L.teams[team.id] && L.teams[team.id].row;
        const total = 2 * (L.nTeams - 1);
        if (row && row.gp / total >= 0.75) {
          const R = total - row.gp;
          const relPts = (L.table[L.nTeams - 3] || {}).pts || 0;
          const euroPts = (L.table[5] || {}).pts || 0;
          if (row.pts - relPts > 3 * R && euroPts - row.pts > 3 * R) {
            mult[s].att *= 0.95; mult[s].def *= 1.03;
            factors.push(`${team.short} n'a plus rien à jouer (ni Europe, ni maintien)`); tags.push('Sans enjeu');
          } else if (Math.abs(row.pts - relPts) <= 3) factors.push(`${team.short} joue son maintien`);
        }
      }
    });

    lh *= mult.h.att * mult.a.def; la *= mult.a.att * mult.h.def;
    const derby = isDerby(fx.h.name, fx.a.name);
    if (derby) { lh *= 0.93; la *= 0.93; factors.push('Derby : match souvent plus fermé et plus tendu'); tags.push('Derby'); }
    lh = m.clamp(lh, 0.15, 4.5); la = m.clamp(la, 0.15, 4.5);

    // Avis des bookmakers (cotes moyennes football-data) : mélangé au modèle
    let mk = ctx.market || (X && X.ok ? App.extras.market(X, fx) : null);
    let mkSrc = 'Bookmakers (moyenne)';
    if (!mk && fx.odds && !ctx.noEspnOdds) { mk = App.extras.implied(fx.odds); mkSrc = `Cotes ${fx.odds.book}`; }
    let marketInfo = null;
    if (mk && mk.p1 !== undefined) {
      const fit = App.extras.fitLambdas(mk);
      if (fit) {
        const w = App.soccer.MKW;
        const model = { lh, la };
        lh = Math.exp((1 - w) * Math.log(lh) + w * Math.log(fit.lh));
        la = Math.exp((1 - w) * Math.log(la) + w * Math.log(fit.la));
        marketInfo = mk;
        factors.push(`${mkSrc} : ${fx.h.short} ${t.pct(mk.p1)} · nul ${t.pct(mk.pX)} · ${fx.a.short} ${t.pct(mk.p2)}${mk.pO !== undefined ? ` · +2,5 buts ${t.pct(mk.pO)}` : ''}`);
      }
    }

    // Confiance selon la quantité de données
    const nH = TH ? TH.n : 0, nA = TA ? TA.n : 0;
    let conf = m.clamp(Math.min(nH, nA) / 9, 0, 1);
    if (!TH || !TA) conf = Math.min(conf, 0.3);
    if (lgCfg.type !== 'league') conf *= 0.9;

    /* ---- Marchés ---- */
    const bets = [];
    const H = fx.h.short, A = fx.a.short;
    const add = (group, label, p, settle, c = conf, extra = []) => {
      if (!(p > 0.02 && p < 0.995)) return;
      bets.push({ group, label, p: m.temper(p), conf: c, settle, notes: extra });
    };

    const M = scoreMatrix(lh, la);
    const p1 = sumM(M, (i, j) => i > j), pX = sumM(M, (i, j) => i === j), p2 = sumM(M, (i, j) => i < j);
    add('1N2', `Victoire ${H}`, p1, { k: '1x2', sel: '1' });
    add('1N2', 'Match nul', pX, { k: '1x2', sel: 'X' });
    add('1N2', `Victoire ${A}`, p2, { k: '1x2', sel: '2' });
    add('Double chance', `${H} ou nul`, p1 + pX, { k: 'dc', sel: '1X' });
    add('Double chance', `Nul ou ${A}`, p2 + pX, { k: 'dc', sel: 'X2' });
    add('Double chance', `${H} ou ${A} (pas de nul)`, p1 + p2, { k: 'dc', sel: '12' });
    [0.5, 1.5, 2.5, 3.5, 4.5].forEach(l => {
      const po = sumM(M, (i, j) => i + j > l);
      add('Buts', `+${fmtLine(l)} buts`, po, { k: 'tot', side: 'o', line: l });
      add('Buts', `-${fmtLine(l)} buts`, 1 - po, { k: 'tot', side: 'u', line: l });
    });
    [['h', H, 0], ['a', A, 1]].forEach(([who, nm]) => {
      [0.5, 1.5, 2.5].forEach(l => {
        const po = sumM(M, (i, j) => (who === 'h' ? i : j) > l);
        add('Buts équipe', `${nm} +${fmtLine(l)} but${l > 1 ? 's' : ''}`, po, { k: 'team', who, side: 'o', line: l });
        add('Buts équipe', `${nm} -${fmtLine(l)} but${l > 1 ? 's' : ''}`, 1 - po, { k: 'team', who, side: 'u', line: l });
      });
    });
    const btts = sumM(M, (i, j) => i > 0 && j > 0);
    add('Les deux marquent', 'Les deux équipes marquent', btts, { k: 'btts', sel: true });
    add('Les deux marquent', 'Les deux équipes marquent : non', 1 - btts, { k: 'btts', sel: false });
    add('Score', `${H} gagne sans encaisser`, sumM(M, (i, j) => i > j && j === 0), { k: 'nil', who: 'h' });
    add('Score', `${A} gagne sans encaisser`, sumM(M, (i, j) => j > i && i === 0), { k: 'nil', who: 'a' });
    [1.5, 2.5].forEach(l => {
      add('Handicap', `${H} -${fmtLine(l)} (handicap)`, sumM(M, (i, j) => i - j > l), { k: 'hcp', who: 'h', line: -l });
      add('Handicap', `${A} -${fmtLine(l)} (handicap)`, sumM(M, (i, j) => j - i > l), { k: 'hcp', who: 'a', line: -l });
      add('Handicap', `${H} +${fmtLine(l)} (handicap)`, sumM(M, (i, j) => i - j > -l), { k: 'hcp', who: 'h', line: l });
      add('Handicap', `${A} +${fmtLine(l)} (handicap)`, sumM(M, (i, j) => j - i > -l), { k: 'hcp', who: 'a', line: l });
    });
    // Score exact le plus probable
    let best = [0, 0, 0];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if (M[i][j] > best[2]) best = [i, j, M[i][j]];
    add('Score exact', `Score exact ${best[0]}-${best[1]}`, best[2], { k: 'cs', h: best[0], a: best[1] }, conf * 0.8);

    // Mi-temps (deux mi-temps indépendantes)
    const fhS = base.fh;
    const M1 = scoreMatrix(lh * fhS, la * fhS, 0, 8), M2 = scoreMatrix(lh * (1 - fhS), la * (1 - fhS), 0, 8);
    const h1 = sumM(M1, (i, j) => i > j), x1 = sumM(M1, (i, j) => i === j), a1 = sumM(M1, (i, j) => i < j);
    add('Mi-temps', `${H} mène à la pause`, h1, { k: 'ht1x2', sel: '1' });
    add('Mi-temps', 'Nul à la pause', x1, { k: 'ht1x2', sel: 'X' });
    add('Mi-temps', `${A} mène à la pause`, a1, { k: 'ht1x2', sel: '2' });
    [0.5, 1.5].forEach(l => {
      const o1 = sumM(M1, (i, j) => i + j > l), o2 = sumM(M2, (i, j) => i + j > l);
      add('Mi-temps', `+${fmtLine(l)} but${l > 1 ? 's' : ''} en 1re mi-temps`, o1, { k: 'htot', half: 1, side: 'o', line: l });
      add('Mi-temps', `-${fmtLine(l)} but${l > 1 ? 's' : ''} en 1re mi-temps`, 1 - o1, { k: 'htot', half: 1, side: 'u', line: l });
      add('Mi-temps', `+${fmtLine(l)} but${l > 1 ? 's' : ''} en 2e mi-temps`, o2, { k: 'htot', half: 2, side: 'o', line: l });
      add('Mi-temps', `-${fmtLine(l)} but${l > 1 ? 's' : ''} en 2e mi-temps`, 1 - o2, { k: 'htot', half: 2, side: 'u', line: l });
    });
    add('Mi-temps', 'But dans chaque mi-temps', (1 - M1[0][0]) * (1 - M2[0][0]), { k: 'bothHalves' });
    // Mi-temps / fin de match : on garde la combinaison la plus probable
    const res = (i, j) => i > j ? '1' : i === j ? 'X' : '2';
    const htft = {};
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) for (let k = 0; k < 9; k++) for (let l = 0; l < 9; l++) {
      const key = res(i, j) + '/' + res(i + k, j + l);
      htft[key] = (htft[key] || 0) + M1[i][j] * M2[k][l];
    }
    const nmR = r => r === '1' ? H : r === 'X' ? 'Nul' : A;
    const bestHF = Object.entries(htft).sort((a, b) => b[1] - a[1])[0];
    add('Mi-temps', `Mi-temps / fin : ${nmR(bestHF[0][0])} / ${nmR(bestHF[0][2])}`, bestHF[1], { k: 'htft', sel: bestHF[0] }, conf * 0.85);

    // Corners et cartons
    const LS = Lfx || LH || LA;
    if (LS && LS.corH && TH && TA && TH.statN > 3 && TA.statN > 3) {
      const ch = LS.corH * TH.cf * TA.ca, ca = LS.corA * TA.cf * TH.ca;
      const cconf = conf * m.clamp(Math.min(TH.statN, TA.statN) / 8, 0.4, 1) * 0.9;
      const tot = m.nbPmf(ch + ca, 20, 30);
      [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5].forEach(l => {
        const po = m.cdfOver(tot, l);
        add('Corners', `+${fmtLine(l)} corners`, po, { k: 'cor', side: 'o', line: l }, cconf);
        add('Corners', `-${fmtLine(l)} corners`, 1 - po, { k: 'cor', side: 'u', line: l }, cconf);
      });
      const ph = m.nbPmf(ch, 14, 25), pa = m.nbPmf(ca, 14, 25);
      let more = 0, less = 0;
      for (let i = 0; i <= 25; i++) for (let j = 0; j <= 25; j++) { if (i > j) more += ph[i] * pa[j]; else if (i < j) less += ph[i] * pa[j]; }
      add('Corners', `Plus de corners pour ${H}`, more, { k: 'cor1x2', sel: '1' }, cconf);
      add('Corners', `Plus de corners pour ${A}`, less, { k: 'cor1x2', sel: '2' }, cconf);
      let kh = LS.kH * TH.kf * TA.ka, ka = LS.kA * TA.kf * TH.ka;
      if (derby) { kh *= 1.25; ka *= 1.25; }
      const refName = (mk && mk.ref) || ctx.refName;
      const rf = X && X.ok ? App.extras.referee(X, fx.lg, refName) : null;
      if (rf) {
        kh *= rf.factor; ka *= rf.factor;
        factors.push(`Arbitre : ${rf.name}${rf.avg !== null ? ` (${t.num(rf.avg, 1)} cartons par match sur ${rf.n} matchs)` : ' (peu connu)'}`);
        if (rf.factor > 1.12) tags.push('Arbitre sévère'); else if (rf.factor < 0.88) tags.push('Arbitre clément');
      }
      const kt = m.nbPmf(kh + ka, 12, 20);
      [1.5, 2.5, 3.5, 4.5, 5.5, 6.5].forEach(l => {
        const po = m.cdfOver(kt, l);
        add('Cartons', `+${fmtLine(l)} cartons`, po, { k: 'card', side: 'o', line: l }, cconf);
        add('Cartons', `-${fmtLine(l)} cartons`, 1 - po, { k: 'card', side: 'u', line: l }, cconf);
      });
      factors.push(`Corners attendus : ${t.num(ch, 1)} - ${t.num(ca, 1)} · cartons attendus : ${t.num(kh + ka, 1)}`);
    }

    // Buteurs (+ anciens joueurs face à leur ancien club)
    const scorerInfo = [];
    const revenants = [];
    const keyPlayers = { h: [], a: [] }; // joueurs clés (≥ 30 % des buts) : surveillés dans la composition officielle
    // Revenants complets (Transfermarkt + effectif actuel) : buts et passes contre l'ancien club
    const tmRev = { h: [], a: [] };
    if (X && X.ok && X.tm) {
      tmRev.h = App.extras.revenants(X, fx.h.id, fx.a.id, ctx.rosters && ctx.rosters[fx.h.id]);
      tmRev.a = App.extras.revenants(X, fx.a.id, fx.h.id, ctx.rosters && ctx.rosters[fx.a.id]);
      [['h', fx.h, fx.a], ['a', fx.a, fx.h]].forEach(([s, team, opp]) => tmRev[s].forEach(r => {
        const dec = r.goals + r.assists;
        r.decisive = dec >= 2 || (dec >= 1 && r.apps <= 3);
        revenants.push(r.apps
          ? `${r.name} (${team.short}) retrouve ${opp.short}, son ancien club : ${r.apps} match${r.apps > 1 ? 's' : ''} contre eux, ${r.goals} but${r.goals > 1 ? 's' : ''}, ${r.assists} passe${r.assists > 1 ? 's' : ''} décisive${r.assists > 1 ? 's' : ''}`
          : `${r.name} (${team.short}) retrouve ${opp.short}, son ancien club (jamais affronté jusqu'ici)`);
      }));
    }
    [['h', fx.h, LH, lh, fx.a], ['a', fx.a, LA, la, fx.h]].forEach(([s, team, L, lam, opp]) => {
      if (!L || !L.scorers[team.id]) return;
      const TG = Math.max(L.teamGoals[team.id] || 0, 1), TGp = L.teamGoalsPrev[team.id] || 0;
      const list = L.scorers[team.id].filter(x => x.g > 0);
      keyPlayers[s] = list.filter(sc => sc.g >= 3 && sc.g / TG >= 0.3).map(sc => ({ pid: sc.pid, pn: sc.pn, share: sc.g / TG }));
      // Revenants : buteur cette saison pour cette équipe, buteur avant pour l'adversaire du jour
      list.forEach(sc => {
        const car = global.career[sc.pid] || [];
        const tr = tmRev[s].find(r => App.extras.sameName(r.name, sc.pn));
        if (tr) { sc._rev = { vs: tr.goals, decisive: tr.decisive }; return; }
        const wasOpp = car.some(c => c.t === opp.id);
        if (wasOpp) {
          const vs = global.vsOld[sc.pid + '|' + opp.id] || 0;
          sc._rev = { vs };
          revenants.push(`${sc.pn} (${team.short}) retrouve ${opp.short}, son ancien club${vs ? ` : déjà ${vs} but${vs > 1 ? 's' : ''} contre eux` : ''}`);
        } else sc._rev = null;
      });
      const cands = list.map(sc => {
        let share = (sc.g + 0.5 * sc.gPrev) / (TG + 0.5 * TGp);
        let mod = 0.88;
        if (sc.since !== null && sc.since >= 6) mod *= 0.9;
        if (sc.hot >= 3) mod *= 1.08;
        if (sc._rev) mod *= sc._rev.decisive || sc._rev.vs ? 1.25 : 1.10;
        const p = 1 - Math.exp(-lam * share * mod);
        return { sc, p, share };
      }).sort((a, b) => b.p - a.p);
      const top = cands.slice(0, 3);
      cands.filter(c => c.sc._rev && !top.includes(c)).forEach(c => top.push(c));
      top.forEach(({ sc, p, share }) => {
        const notes = [];
        if (sc._rev) notes.push(sc._rev.decisive ? 'Revenant décisif' : 'Revenant');
        if (sc.hot >= 3) notes.push('En série');
        add('Buteur', `${sc.pn} marque`, p, { k: 'scorer', pid: sc.pid, pn: sc.pn }, conf * 0.75, notes);
        scorerInfo.push({ team: team.short, name: sc.pn, g: sc.g, rank: sc.rank, share, since: sc.since, hot: sc.hot, rev: !!sc._rev });
      });
      // Dépendance au meilleur buteur
      if (list[0] && list[0].g >= 4 && list[0].g / TG >= 0.4) factors.push(`${team.short} dépend beaucoup de ${list[0].pn} (${Math.round(list[0].g / TG * 100)} % des buts)`);
      if (list[0] && list[0].since >= 5) factors.push(`${list[0].pn} (${team.short}) n'a plus marqué depuis ${list[0].since} matchs`);
    });
    revenants.forEach(r => factors.push(r));
    if (revenants.length) tags.push([...tmRev.h, ...tmRev.a].some(r => r.decisive) ? 'Revenant décisif' : 'Revenant');

    // Favori et fragilité (pour les « matchs pièges »)
    const favSide = p1 >= p2 ? 'h' : 'a';
    const favWin = Math.max(p1, p2);
    let fragility = favSide === 'h' ? p2 : p1;
    if (tags.includes('Fatigue')) fragility += 0.03;
    if (tags.some(x => x.startsWith('Trou d\'air') && x.includes(sides[favSide].short))) fragility += 0.05;
    if (derby) fragility += 0.03;

    return {
      match: fx, sport: 'soccer', comp: lgCfg.name, compId: fx.lg, country: lgCfg.country,
      lh, la, p1, pX, p2, conf, bets, market: marketInfo, keyPlayers, factors, tags: [...new Set(tags)], scorers: scorerInfo,
      forms, standings: { h: TH && TH.row, a: TA && TA.row },
      fav: { side: favSide, name: sides[favSide].short, pWin: favWin, fragility, isFav: favWin >= 0.5 },
    };
  }

  /* ---------- Résultat d'un pari (historique) ---------- */
  function settle(s, x) {
    if (!x || x.st !== 'post') return null;
    const hg = x.h.g, ag = x.a.g;
    const needHT = ['ht1x2', 'htot', 'bothHalves', 'htft'].includes(s.k);
    if (needHT && !x.detailsOk) return 'void';
    const h1 = x.h.g1, a1 = x.a.g1, h2 = hg - (h1 || 0), a2 = ag - (a1 || 0);
    const r = (i, j) => i > j ? '1' : i === j ? 'X' : '2';
    const over = (v) => s.side === 'o' ? v > s.line : v < s.line;
    switch (s.k) {
      case '1x2': return r(hg, ag) === s.sel;
      case 'dc': return s.sel.includes(r(hg, ag));
      case 'tot': return over(hg + ag);
      case 'team': return over(s.who === 'h' ? hg : ag);
      case 'btts': return (hg > 0 && ag > 0) === s.sel;
      case 'nil': return s.who === 'h' ? hg > ag && ag === 0 : ag > hg && hg === 0;
      case 'hcp': return (s.who === 'h' ? hg - ag : ag - hg) + s.line > 0;
      case 'cs': return hg === s.h && ag === s.a;
      case 'ht1x2': return r(h1, a1) === s.sel;
      case 'htot': return over(s.half === 1 ? h1 + a1 : h2 + a2);
      case 'bothHalves': return h1 + a1 > 0 && h2 + a2 > 0;
      case 'htft': return r(h1, a1) + '/' + r(hg, ag) === s.sel;
      case 'cor': if (!x.hasStats) return 'void'; return over(x.h.cor + x.a.cor);
      case 'cor1x2': if (!x.hasStats) return 'void'; return s.sel === '1' ? x.h.cor > x.a.cor : x.a.cor > x.h.cor;
      case 'card': if (!x.hasStats && !x.cards.length) return 'void'; return over(x.h.cards + x.a.cards);
      case 'scorer': return x.goals.some(g => !g.og && g.pid === s.pid);
    }
    return null;
  }

  return { buildLeague, buildGlobal, analyzeMatch, settle, XGW: 0.5, MKW: 0.7 }; // poids xG et bookmakers choisis par backtest (6 semaines, 12 championnats)
})();
