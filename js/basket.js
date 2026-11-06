/* Basket : forces attaque / défense pondérées, écart et total de points en loi normale. */
window.App = window.App || {};

App.basket = (() => {
  const { m, d, t } = App;

  function build(history, now) {
    const done = history.filter(x => x.st === 'post' && x.h.pts > 0 && now - x.ts < 500 * d.DAY);
    if (done.length < 30) return null;
    const w = x => Math.exp(-(now - x.ts) / (65 * d.DAY));
    let sw = 0, sp = 0, hm = 0, h1 = 0, h1n = 0;
    done.forEach(x => {
      const ww = w(x); sw += ww; sp += ww * (x.h.pts + x.a.pts) / 2; hm += ww * (x.h.pts - x.a.pts);
      if (x.h.q.length >= 4) { h1 += x.h.q[0] + x.h.q[1] + x.a.q[0] + x.a.q[1]; h1n += x.h.pts + x.a.pts; }
    });
    const mu = sp / sw, hca = m.clamp(hm / sw, 0.5, 4.5), h1share = h1n ? h1 / h1n : 0.5;
    const ids = new Set(); done.forEach(x => { ids.add(x.h.id); ids.add(x.a.id); });
    const off = {}, dff = {}, n = {}, info = {};
    ids.forEach(id => { off[id] = 0; dff[id] = 0; n[id] = 0; });
    const K = 4;
    for (let it = 0; it < 15; it++) {
      const so = {}, sd = {}, ws = {};
      ids.forEach(id => { so[id] = 0; sd[id] = 0; ws[id] = K; });
      done.forEach(x => {
        const ww = w(x);
        so[x.h.id] += ww * (x.h.pts - mu - hca / 2 - dff[x.a.id]);
        so[x.a.id] += ww * (x.a.pts - mu + hca / 2 - dff[x.h.id]);
        sd[x.a.id] += ww * (x.h.pts - mu - hca / 2 - off[x.h.id]);
        sd[x.h.id] += ww * (x.a.pts - mu + hca / 2 - off[x.a.id]);
        ws[x.h.id] += ww; ws[x.a.id] += ww;
      });
      ids.forEach(id => { off[id] = so[id] / ws[id]; dff[id] = sd[id] / ws[id]; n[id] = ws[id] - K; });
    }
    done.forEach(x => { info[x.h.id] = x.h; info[x.a.id] = x.a; });
    // Écart-type réel des erreurs du modèle (sur les 300 derniers matchs)
    const last = done.slice(-300);
    let em = 0, et = 0;
    last.forEach(x => {
      const pm = hca + off[x.h.id] + dff[x.a.id] - off[x.a.id] - dff[x.h.id];
      const pt = 2 * mu + off[x.h.id] + dff[x.a.id] + off[x.a.id] + dff[x.h.id];
      em += Math.pow(x.h.pts - x.a.pts - pm, 2); et += Math.pow(x.h.pts + x.a.pts - pt, 2);
    });
    return { mu, hca, h1share, off, dff, n, done,
      sdM: m.clamp(Math.sqrt(em / last.length), 9, 16), sdT: m.clamp(Math.sqrt(et / last.length), 13, 24) };
  }

  function form(id, done, before) {
    return done.filter(x => x.ts < before && (x.h.id === id || x.a.id === id)).slice(-10).reverse()
      .map(x => { const me = x.h.id === id ? x.h : x.a, op = x.h.id === id ? x.a : x.h; return { r: me.pts > op.pts ? 'V' : 'D', ts: x.ts, gf: me.pts, ga: op.pts, opp: op.name, home: x.h.id === id }; });
  }

  function analyzeMatch(fx, B, injuries, lgName) {
    const factors = [], tags = [];
    const g = (o, id) => o[id] || 0;
    let ph = B.mu + B.hca / 2 + g(B.off, fx.h.id) + g(B.dff, fx.a.id);
    let pa = B.mu - B.hca / 2 + g(B.off, fx.a.id) + g(B.dff, fx.h.id);
    const forms = {};
    [['h', fx.h], ['a', fx.a]].forEach(([s, team]) => {
      const f = form(team.id, B.done, fx.ts);
      forms[s] = f;
      if (f[0] && fx.ts - f[0].ts < 30 * 3600000) {
        if (s === 'h') { ph -= 1.0; pa += 0.8; } else { pa -= 1.0; ph += 0.8; }
        factors.push(`${team.short} a joué la veille (2 matchs en 2 soirs)`); tags.push('Fatigue');
      }
      const out = (injuries[team.id] || []).filter(i => /out/i.test(i.status || ''));
      if (out.length) {
        const pen = Math.min(out.length * 0.8, 3);
        if (s === 'h') ph -= pen; else pa -= pen;
        factors.push(`${team.short} : absents annoncés : ${out.slice(0, 4).map(i => i.name).join(', ')}${out.length > 4 ? '…' : ''}`);
      }
      let wins = 0; for (const x of f) { if (x.r === 'V') wins++; else break; }
      let losses = 0; for (const x of f) { if (x.r === 'D') losses++; else break; }
      if (wins >= 4) factors.push(`${team.short} : ${wins} victoires de suite`);
      if (losses >= 4) factors.push(`${team.short} : ${losses} défaites de suite`);
      if (f.length >= 5) factors.push(`${team.short} : ${f.filter(x => x.r === 'V').length} victoires sur ${f.length} derniers matchs`);
    });
    const mm = ph - pa, mt = ph + pa;
    factors.unshift(`Score attendu : ${Math.round(ph)} - ${Math.round(pa)} (écart ${t.num(mm, 1)}, total ${Math.round(mt)})`);
    const conf = m.clamp(Math.min(g(B.n, fx.h.id), g(B.n, fx.a.id)) / 10, 0, 1);

    const bets = [];
    const add = (group, label, p, settle, c = conf) => {
      if (!(p > 0.02 && p < 0.995)) return;
      bets.push({ group, label, p: m.temper(p), conf: c, settle, notes: [] });
    };
    const H = fx.h.short, A = fx.a.short;
    const pOver = (mean, sd, line) => 1 - m.normCdf((line - mean) / sd);
    const pH = pOver(mm, B.sdM, 0);
    add('Vainqueur', `Victoire ${H} (prolongation incluse)`, pH, { k: 'win', who: 'h' });
    add('Vainqueur', `Victoire ${A} (prolongation incluse)`, 1 - pH, { k: 'win', who: 'a' });
    const c = Math.round(mm) + 0.5;
    [-9, -6, -3, 0, 3, 6, 9].forEach(o => {
      const l = c + o; // handicap pour l'équipe à domicile : -l
      const p = pOver(mm, B.sdM, l);
      const fmt = v => (v > 0 ? '+' : '') + t.num(v, 1);
      add('Handicap', `${H} ${fmt(-l)} points`, p, { k: 'hcp', who: 'h', line: -l });
      add('Handicap', `${A} ${fmt(l)} points`, 1 - p, { k: 'hcp', who: 'a', line: l });
    });
    const ct = Math.round(mt) + 0.5;
    [-15, -10, -5, 0, 5, 10, 15].forEach(o => {
      const l = ct + o, p = pOver(mt, B.sdT, l);
      add('Points', `+${t.num(l, 1)} points`, p, { k: 'tot', side: 'o', line: l });
      add('Points', `-${t.num(l, 1)} points`, 1 - p, { k: 'tot', side: 'u', line: l });
    });
    [['h', H, ph], ['a', A, pa]].forEach(([who, nm, mean]) => {
      const cc = Math.round(mean) + 0.5;
      [-10, -5, 0, 5, 10].forEach(o => {
        const l = cc + o, p = pOver(mean, B.sdT * 0.62, l);
        add('Points équipe', `${nm} +${t.num(l, 1)} points`, p, { k: 'team', who, side: 'o', line: l });
        add('Points équipe', `${nm} -${t.num(l, 1)} points`, 1 - p, { k: 'team', who, side: 'u', line: l });
      });
    });
    // Mi-temps : seulement si la source donne le score par quart-temps (pas le cas de l'Euroligue)
    if (!fx.noQuarters) {
    const m1 = mm * B.h1share, t1 = mt * B.h1share;
    const pH1 = pOver(m1, B.sdM * 0.72, 0.5), pA1 = 1 - pOver(m1, B.sdM * 0.72, -0.5);
    add('Mi-temps', `${H} mène à la mi-temps`, pH1, { k: 'h1win', who: 'h' });
    add('Mi-temps', `${A} mène à la mi-temps`, pA1, { k: 'h1win', who: 'a' });
    const c1 = Math.round(t1) + 0.5;
    [-8, -4, 0, 4, 8].forEach(o => {
      const l = c1 + o, p = pOver(t1, B.sdT * 0.7, l);
      add('Mi-temps', `+${t.num(l, 1)} points en 1re mi-temps`, p, { k: 'h1tot', side: 'o', line: l });
      add('Mi-temps', `-${t.num(l, 1)} points en 1re mi-temps`, 1 - p, { k: 'h1tot', side: 'u', line: l });
    });
    }
    const favSide = pH >= 0.5 ? 'h' : 'a';
    return {
      match: fx, sport: 'basket', comp: lgName, compId: fx.lg, country: '',
      conf, bets, factors, tags, forms,
      fav: { side: favSide, name: (favSide === 'h' ? fx.h : fx.a).short, pWin: Math.max(pH, 1 - pH), fragility: Math.min(pH, 1 - pH), isFav: true },
    };
  }

  function settle(s, x) {
    if (!x || x.st !== 'post') return null;
    const hp = x.h.pts, ap = x.a.pts;
    const over = v => s.side === 'o' ? v > s.line : v < s.line;
    const h1 = (x.h.q[0] || 0) + (x.h.q[1] || 0), a1 = (x.a.q[0] || 0) + (x.a.q[1] || 0);
    switch (s.k) {
      case 'win': return s.who === 'h' ? hp > ap : ap > hp;
      case 'hcp': return (s.who === 'h' ? hp - ap : ap - hp) + s.line > 0;
      case 'tot': return over(hp + ap);
      case 'team': return over(s.who === 'h' ? hp : ap);
      case 'h1win': if (x.h.q.length < 2) return 'void'; return s.who === 'h' ? h1 > a1 : a1 > h1;
      case 'h1tot': if (x.h.q.length < 2) return 'void'; return over(h1 + a1);
    }
    return null;
  }

  return { build, analyzeMatch, settle };
})();
