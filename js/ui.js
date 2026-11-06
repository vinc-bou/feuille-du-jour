/* Interface : sélection du jour, combinés, matchs, historique, réglages. */
(() => {
  const { t, d } = App;
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const SP = { soccer: 'Foot', tennis: 'Tennis', basket: 'Basket', hockey: 'Hockey', handball: 'Handball', volley: 'Volley', rugby: 'Rugby' };
  const state = { tab: 'top', day: 0, result: null, running: false, alerts: [], filters: { sport: '', comp: '', group: '', time: '', q: '', oddMin: '', oddMax: '', mine: '' }, open: null,
    sort: 'rel', rev: false, live: {}, played: new Set(), liveMine: false, q: '', hopen: null, cfilters: { oddMin: '', oddMax: '', sort: 'rel' } };
  // Tri (Sélection) : [nom, ordre normal, ordre inversé, comparaison dans l'ordre normal]
  // Un clic sur un titre de colonne trie ; un 2e clic sur la même colonne inverse l'ordre.
  const RESO = { won: 0, lost: 1, void: 2 };
  const SORTS = {
    rel: ['Fiabilité', 'meilleurs d’abord', 'moins fiables d’abord', (a, b) => a.vr - b.vr],
    time: ['Heure', 'plus tôt d’abord', 'plus tard d’abord', (a, b) => a.ts - b.ts],
    odd: ['Cote', 'plus petite d’abord', 'plus grande d’abord', (a, b) => b.p - a.p],
    sport: ['Sport', 'A → Z', 'Z → A', (a, b) => (SP[a.sport] || '').localeCompare(SP[b.sport] || '')],
    comp: ['Compétition', 'A → Z', 'Z → A', (a, b) => a.comp.localeCompare(b.comp) || a.ts - b.ts],
    match: ['Match', 'A → Z', 'Z → A', (a, b) => a.matchName.localeCompare(b.matchName)],
    group: ['Type de pari', 'A → Z', 'Z → A', (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)],
    conf: ['Confiance', 'haute d’abord', 'faible d’abord', (a, b) => b.conf - a.conf],
    res: ['Résultat', 'gagnés d’abord', 'perdus d’abord', (a, b) => (RESO[a.result] ?? 3) - (RESO[b.result] ?? 3)],
  };
  const sorter = () => { const f = (SORTS[state.sort] || SORTS.rel)[3], k = state.rev ? -1 : 1; return (a, b) => (k * f(a, b)) || a.vr - b.vr; };
  const ODDS = [1.01, 1.03, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.40, 1.50, 1.60, 1.75, 2, 2.5, 3, 4, 5];
  const oddOk = (p, f) => { const o = 1 / p; return (!f.oddMin || o >= +f.oddMin - 1e-9) && (!f.oddMax || o <= +f.oddMax + 1e-9); };

  const confCls = c => c >= 0.7 ? 'h' : c >= 0.4 ? 'm' : 'l';
  const confTxt = c => c >= 0.7 ? 'Haute' : c >= 0.4 ? 'Moyenne' : 'Faible';
  const esc = t.esc;

  function teamsHtml(a) {
    const x = a.match;
    if (x.sp === 'tennis') {
      return `<span class="teams">${x.players.map(p => `${p.flag ? `<img class="flag" src="${esc(p.flag)}" alt="">` : ''}${esc(p.name)}`).join(' <span class="muted">-</span> ')}</span>`;
    }
    const img = s => s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : '';
    return `<span class="teams">${img(x.h)}${esc(x.h.short)} <span style="color:var(--dim)">-</span> ${img(x.a)}${esc(x.a.short)}</span>`;
  }

  function setStatus(txt, frac) {
    $('#status').hidden = !txt;
    $('#statusText').textContent = txt || '';
    if (frac !== undefined) $('#progressBar').style.width = Math.round(frac * 100) + '%';
  }

  function dateline() {
    const W = d.window(state.day);
    const r = state.result;
    $('#dateline').textContent = d.dayLabel(W.start) + (r && r.W.key === W.key ? ` · ${r.auto ? 'analyse automatique' : 'analysé'} à ${d.hm(r.ranAt)}` : '');
  }

  /* ---------- Lancer l'analyse ---------- */
  async function run() {
    if (state.running) return;
    state.running = true;
    $('#runBtn').disabled = true;
    let step = '';
    App.data.setProgress(s => setStatus(`${step} · ${s.done}/${s.total} téléchargements`, s.total ? s.done / s.total : 0));
    try {
      step = 'Vérification des résultats d\'hier';
      setStatus(step, 0);
      await App.engine.settleAll().catch(e => console.warn(e));
      const prev = state.result;
      state.result = await App.engine.run(state.day, s => { step = s; setStatus(s); });
      // les matchs déjà commencés ne sont plus analysés : on garde leurs pronostics pour le suivi en direct
      if (prev && !state.result.replay && prev.W.key === state.result.W.key) {
        const ids = new Set(state.result.top.map(b => b.id)), seen = new Set();
        state.result.started = [...(prev.started || []), ...prev.top].filter(b => b.ts <= Date.now() && !ids.has(b.id) && !seen.has(b.id) && seen.add(b.id));
      }
      pollLive();
      state.open = null;
      // Sélection transmise au serveur local : c'est elle que la surveillance des compositions suivra
      if (!state.result.replay) App.engine.saveRemote(state.result);
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('Erreur pendant l\'analyse : ' + e.message);
    }
    state.running = false;
    $('#runBtn').disabled = false;
    dateline();
    render();
  }

  /* ---------- Alertes compositions ---------- */
  const alertsFor = (r) => { const ids = new Set(r.analyses.map(a => String(a.match.id))); return state.alerts.filter(al => ids.has(String(al.match_id))); };
  function renderAlerts(r) {
    const list = alertsFor(r);
    if (!list.length) return '';
    return `<div class="alerts">${list.map(al => `<div class="al"><div class="h"><span class="when">${d.hm(al.kickoff * 1000)}</span> ${esc(al.match)}</div>
      <div>${esc(al.text)}</div>${al.bets && al.bets.length ? `<div class="b">Paris concernés : ${al.bets.map(esc).join(' · ')}</div>` : ''}</div>`).join('')}</div>`;
  }
  const betAlert = b => state.alerts.some(al => String(al.match_id) === String(b.ref.id) && (al.bets || []).includes(b.label));
  async function pollAlerts() {
    try {
      let res = await fetch('/api/alerts', { cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok || !(res.headers.get('content-type') || '').includes('json')) res = await fetch('en-ligne/alertes.json', { cache: 'no-store' });
      if (!res.ok) return;
      const list = await res.json();
      if (JSON.stringify(list) !== JSON.stringify(state.alerts)) { state.alerts = list; if (state.tab === 'top' && state.result) render(); }
    } catch (e) { /* serveur local absent */ }
  }

  /* ---------- Test à l'aveugle (jour passé) ---------- */
  const RES = { won: 'Gagné', lost: 'Perdu', void: 'Annulé' };
  function replaySummary(r) {
    const done = r.top.filter(b => b.result === 'won' || b.result === 'lost');
    const rate = l => l.length ? l.filter(b => b.result === 'won').length / l.length : 0;
    const exp = l => l.length ? l.reduce((a, b) => a + b.p, 0) / l.length : 0;
    const part = (label, l) => `<div class="kpi"><div class="l">${label}</div><div class="v num">${l.length ? `${l.filter(b => b.result === 'won').length}/${l.length}` : '-'}</div><div class="l">${l.length ? `${t.pct(rate(l))} réel · ${t.pct(exp(l))} annoncé` : ''}</div></div>`;
    const bySport = Object.keys(SP).filter(sp => done.some(b => b.sport === sp)).map(sp => part(SP[sp], done.filter(b => b.sport === sp))).join('');
    const cs = [...r.combos.doubles, ...r.combos.triples].filter(c => c.result !== 'void');
    return `<p class="warn" style="color:var(--text)"><strong>Test à l'aveugle.</strong> Sélection calculée comme si on était le ${esc(d.dayLabel(r.W.start))} à 6 h, avec uniquement les matchs joués avant. Les résultats ne servent qu'à noter.</p>
      <div class="kpis">${part('Sélection complète', done)}${part('Top 10', done.filter(b => b.rank <= 10))}${part('Top 30', done.filter(b => b.rank <= 30))}${bySport}
      <div class="kpi"><div class="l">Combinés</div><div class="v num">${cs.length ? `${cs.filter(c => c.result === 'won').length}/${cs.length}` : '-'}</div></div></div>`;
  }

  // Tennis : seul le 1er match d'un court a une heure fixe, les suivants commencent après le précédent
  const timeHtml = b => b.sport === 'tennis'
    ? `<span title="Heure indicative : au tennis, le match commence après la fin du précédent sur le même court (Winamax met l’heure à jour au fil de la journée)">≈ ${d.hm(b.ts)}</span>`
    : d.hm(b.ts);

  /* ---------- En direct : pronostics dont le match a commencé ---------- */
  const scoreOf = x => !x ? '' : x.sp === 'tennis' ? x.players[0].sets.map((v, i) => `${v}-${x.players[1].sets[i]}`).join(' ')
    : x.sp === 'basket' ? `${x.h.pts}-${x.a.pts}` : `${x.h.g}-${x.a.g}`;
  function liveBets(r) {
    if (!r || r.replay) return [];
    const now = Date.now(), seen = new Set();
    return [...r.top, ...(r.started || []), ...r.all.filter(b => state.played.has(b.id))].filter(b => b.ts <= now && b.ts > now - 6 * 3600000 && !seen.has(b.id) && seen.add(b.id));
  }
  let liveBusy = false;
  async function pollLive() {
    const list = liveBets(state.result);
    if (!list.length || liveBusy || document.hidden) return;
    liveBusy = true;
    let changed = false;
    for (const b of list) {
      const old = state.live[b.id];
      if (old && old.result) continue; // déjà terminé
      const l = await App.engine.live(b).catch(() => null);
      const v = l ? { st: l.x.st, score: scoreOf(l.x), detail: l.x.detail || '', result: l.result } : { st: 'na' };
      if (JSON.stringify(v) !== JSON.stringify(old)) { state.live[b.id] = v; changed = true; }
    }
    liveBusy = false;
    if (changed && state.tab === 'live' && !state.q.trim()) render();
  }
  function renderLive(r) {
    let list = liveBets(r);
    const mine = list.filter(b => state.played.has(b.id)).length;
    if (state.liveMine) list = list.filter(b => state.played.has(b.id));
    const bar = `<div class="filters"><label class="chk"><input type="checkbox" id="liveMine" ${state.liveMine ? 'checked' : ''}> Seulement mes paris joués (${mine})</label></div>`;
    if (!list.length) return bar + `<div class="empty">${state.liveMine ? 'Aucun de vos paris joués n’a commencé.' : 'Aucun match de la sélection n’a encore commencé.'}<br>Les pronostics apparaissent ici dès le coup d’envoi, avec le score mis à jour chaque minute.</div>`;
    const rank = b => { const l = state.live[b.id]; return !l ? 1 : l.st === 'in' ? 0 : l.result ? 2 : 1; };
    list.sort((a, b) => rank(a) - rank(b) || a.ts - b.ts);
    const status = b => {
      const l = state.live[b.id];
      if (!l) return '<span style="color:var(--muted)">chargement…</span>';
      if (l.st === 'na') return '<span style="color:var(--muted)">score non suivi</span>';
      if (l.result) return `<span class="res-${l.result}">${RES[l.result]}</span>`;
      if (l.st === 'pre') return `<span style="color:var(--muted)">pas encore commencé${b.sport === 'tennis' ? ' (après le match précédent sur le court)' : ''}</span>`;
      return '<span style="color:var(--accent)">en cours</span>';
    };
    return bar + `<div class="sect live"><h3>En direct <span style="color:var(--muted);font-size:14px">${list.length} pronostic${list.length > 1 ? 's' : ''} dont le match a commencé · mis à jour chaque minute</span></h3>
      <table class="mini">${list.map(b => { const l = state.live[b.id] || {}; return `<tr><td class="num" style="width:60px;color:var(--muted)">${timeHtml(b)}</td><td>${teamsHtml(b.a)}</td>
        <td class="num" style="font-weight:600">${esc(l.score || '')} <span style="color:var(--muted);font-weight:400">${esc(l.st === 'in' ? l.detail : '')}</span></td>
        <td>${state.played.has(b.id) ? '<span class="mine">Joué</span> ' : ''}${esc(b.label)}</td><td class="n">${t.pct(b.p)}</td><td class="n" style="width:150px">${status(b)}</td></tr>`; }).join('')}</table></div>`;
  }

  /* ---------- Sélection (top 100) ---------- */
  // Avec une fourchette de cotes : nouveau classement des 100 meilleurs paris DANS cette fourchette,
  // pris parmi tous les paris analysés (2 par match au plus, 4 si la journée est creuse)
  function rerank(f) {
    const pool = [...new Set([...state.result.top, ...state.result.all])].filter(b => oddOk(b.p, f))
      .sort((a, b) => (b.score ?? b.p) - (a.score ?? a.p));
    const per = {}, out = [], seen = new Set();
    [2, 4].forEach(lim => pool.forEach(b => {
      if (out.length >= 100 || seen.has(b.id) || (per[b.ref.id] || 0) >= lim) return;
      per[b.ref.id] = (per[b.ref.id] || 0) + 1; seen.add(b.id); out.push(b);
    }));
    out.sort((a, b) => (b.score ?? b.p) - (a.score ?? a.p));
    out.forEach((b, i) => { b.vr = i + 1; });
    return out;
  }
  function filtered() {
    const f = state.filters;
    const odds = f.oddMin || f.oddMax;
    if (!odds) state.result.top.forEach(b => { b.vr = b.rank; });
    let base = odds ? rerank(f) : state.result.top;
    if (f.mine) { const seen = new Set(); base = [...base, ...state.result.all].filter(b => state.played.has(b.id) && !seen.has(b.id) && seen.add(b.id)); base.forEach(b => { if (b.vr === undefined) b.vr = b.rank || 999; }); }
    return base.filter(b => {
      if (f.sport && b.sport !== f.sport) return false;
      if (f.comp && b.comp !== f.comp) return false;
      if (f.group && b.group !== f.group) return false;
      if (f.q && !t.norm(b.matchName + ' ' + b.label).includes(t.norm(f.q))) return false;
      if (f.time) {
        const h = new Date(b.ts).getHours();
        if (f.time === 'a' && !(h >= 6 && h < 15)) return false;
        if (f.time === 'b' && !(h >= 15 && h < 19)) return false;
        if (f.time === 'c' && !(h >= 19 && h < 23)) return false;
        if (f.time === 'n' && !(h >= 23 || h < 6)) return false;
      }
      return true;
    }).sort(sorter());
  }

  function realScore(a) {
    const x = a.real; if (!x) return '';
    if (x.sp === 'tennis') return x.players[0].sets.map((v, i) => `${v}-${x.players[1].sets[i]}`).join(' ');
    if (x.sp === 'basket') return `${x.h.pts}-${x.a.pts}`;
    return `${x.h.g}-${x.a.g}${x.detailsOk ? ` (mi-temps ${x.h.g1}-${x.a.g1})` : ''}`;
  }

  function options(list, val, all) {
    return `<option value="">${all}</option>` + list.map(v => `<option value="${esc(v[0])}" ${v[0] === val ? 'selected' : ''}>${esc(v[1])}</option>`).join('');
  }

  function renderSurprises(r) {
    if (!r.surprises.length) return '';
    return `<div class="surprises">${r.surprises.sort((a, b) => b.n - a.n).map(s => `
      <div class="s"><div class="c">${esc(s.comp)}</div>
        <div class="v">${s.n} match${s.n > 1 ? 's' : ''} · ${s.expected >= 0.5 ? `≈ ${Math.max(1, Math.round(s.expected))} surprise${Math.round(s.expected) > 1 ? 's' : ''} attendue${Math.round(s.expected) > 1 ? 's' : ''}` : 'peu de surprise attendue'}</div>
        ${s.traps.length ? `<div class="p">Piège : ${s.traps.map(esc).join(', ')}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  const findBet = id => state.result && ([...state.result.top, ...state.result.all].find(b => b.id === id) || null);
  const whyHtml = txt => txt ? `<p class="why"><b>Pourquoi ce pari</b>${esc(txt)}</p>` : '';
  function detailHtml(a, focusId) {
    const fb = focusId ? findBet(focusId) : null;
    const others = state.result.all.filter(b => b.a === a && b.id !== focusId).slice(0, 8);
    let form = '';
    if (a.forms) {
      const side = (k, nm) => a.forms[k] ? `<div>${esc(nm)} <span class="form">${a.forms[k].slice(0, 6).map(f => `<span class="${f.r}">${f.r}</span>`).join('')}</span></div>` : '';
      form = side('h', a.match.h && a.match.h.short) + side('a', a.match.a && a.match.a.short);
    }
    const st = a.standings && (a.standings.h || a.standings.a) ? `<div style="margin-top:6px;color:var(--muted)">Classement : ${a.standings.h ? `${esc(a.match.h.short)} ${a.standings.h.rank}e (${a.standings.h.pts} pts)` : ''}${a.standings.h && a.standings.a ? ' · ' : ''}${a.standings.a ? `${esc(a.match.a.short)} ${a.standings.a.rank}e (${a.standings.a.pts} pts)` : ''}</div>` : '';
    const sc = a.scorers && a.scorers.length ? `<h4 style="margin-top:12px">Buteurs</h4><table class="mini">${a.scorers.map(s => `<tr><td>${esc(s.name)} <span style="color:var(--dim)">${esc(s.team)}</span>${s.rev ? ' <span style="color:var(--accent)">revenant</span>' : ''}</td><td class="n">${s.g} but${s.g > 1 ? 's' : ''}</td><td class="n">${s.rank ? s.rank + 'e du championnat' : ''}</td></tr>`).join('')}</table>` : '';
    return `${fb ? whyHtml(App.why(fb)) : ''}<div class="cols">
      <div><h4>Analyse</h4><ul>${a.factors.map(f => `<li>${esc(f)}</li>`).join('') || '<li>Rien de particulier</li>'}</ul>${form ? `<h4 style="margin-top:12px">Forme (du plus récent au plus ancien)</h4>${form}` : ''}${st}</div>
      <div><h4>Autres paris sur ce match</h4><table class="mini">${others.map(b => `<tr><td>${esc(b.label)}</td><td class="n">${t.pct(b.p)}</td><td class="n">${t.odd(b.p)}</td></tr>`).join('')}</table>${sc}</div>
    </div>`;
  }

  function renderTop() {
    const r = state.result;
    const f = state.filters;
    const comps = [...new Set(r.top.map(b => b.comp))].sort().map(c => [c, c]);
    const groups = [...new Set(r.top.map(b => b.group))].sort().map(g => [g, g]);
    const rows = filtered();
    let html = r.replay ? replaySummary(r) : renderAlerts(r);
    const nLive = r.replay ? 0 : liveBets(r).length;
    if (nLive) html += `<p class="warn" style="color:var(--text)"><a href="#" data-gotab="live" style="color:var(--accent)">${nLive} match${nLive > 1 ? 's' : ''} de la sélection en cours ou terminé${nLive > 1 ? 's' : ''} : voir l’onglet En direct</a></p>`;
    html += renderSurprises(r);
    if (r.warnings.length) html += `<p class="warn">${r.warnings.map(esc).join(' · ')}</p>`;
    if (r.extras && !r.extras.ok) html += `<p class="warn">Données ouvertes inactives (xG, arbitres, transferts) : ouvrez l'app avec Lancer.bat pour en profiter.</p>`;
    html += `<div class="filters">
      <select data-f="sport">${options(Object.entries(SP).filter(([k]) => r.top.some(b => b.sport === k)).map(([k, v]) => [k, v]), f.sport, 'Tous les sports')}</select>
      <select data-f="comp">${options(comps, f.comp, 'Toutes les compétitions')}</select>
      <select data-f="group">${options(groups, f.group, 'Tous les types de paris')}</select>
      <select data-f="time">${options([['a', 'Avant 15 h'], ['b', '15 h - 19 h'], ['c', '19 h - 23 h'], ['n', 'Nuit (23 h - 6 h)']], f.time, 'Toute la journée')}</select>
      <select data-f="oddMin">${options(ODDS.map(o => [String(o), 'Cote dès ' + t.num(o, 2)]), f.oddMin, 'Cote : pas de minimum')}</select>
      <select data-f="oddMax">${options(ODDS.map(o => [String(o), 'Cote jusqu’à ' + t.num(o, 2)]), f.oddMax, 'Cote : pas de maximum')}</select>
      <select data-f="mine">${options([['1', `Mes paris joués (${state.played.size})`]], f.mine, 'Tous les paris')}</select>
      <input data-f="q" placeholder="Équipe, joueur…" value="${esc(f.q)}">
      <select data-sort-sel="top" class="sortsel">${Object.entries(SORTS).filter(([k]) => k !== 'res' || r.replay).map(([k, v]) => [0, 1].map(rv => `<option value="${k}|${rv}" ${k === state.sort && !!rv === state.rev ? 'selected' : ''}>Trier : ${v[0]} (${v[1 + rv]})</option>`).join('')).join('')}</select>
      <span class="count">${rows.length} pari${rows.length > 1 ? 's' : ''}${f.oddMin || f.oddMax ? ' dans cette fourchette de cotes' : ''} · ${r.analyses.length} matchs analysés</span>
    </div>`;
    if (!rows.length) return html + `<div class="empty">Aucun pari ne correspond à ces filtres.</div>`;
    const th = (k, txt, st) => `<th data-sort="${k}" class="${state.sort === k ? 'sorted' : ''}" ${st ? `style="${st}"` : ''} title="Trier (cliquer à nouveau pour inverser)">${txt}${state.sort === k ? (state.rev ? ' ▲' : ' ▼') : ''}</th>`;
    html += `<table class="grid"><thead><tr><th class="pl" title="Cochez les paris que vous jouez">Joué</th><th style="text-align:right">#</th>${th('time', 'Heure')}${th('comp', 'Compétition')}${th('match', 'Match')}${th('group', 'Pari')}${th('rel', 'Fiabilité')}${th('odd', 'Cote mini')}${th('conf', 'Confiance')}<th>À savoir</th>${r.replay ? th('res', 'Résultat') : ''}</tr></thead><tbody>`;
    rows.forEach(b => {
      const open = state.open === b.id;
      html += `<tr class="row ${b.vr <= 10 ? 't10' : ''}" data-id="${esc(b.id)}">
        <td class="pl"><input type="checkbox" data-play="${esc(b.id)}" ${state.played.has(b.id) ? 'checked' : ''} title="Je joue ce pari"></td>
        <td class="rk">${b.vr}</td>
        <td class="time num">${timeHtml(b)}</td>
        <td class="comp"><span class="sp">${SP[b.sport]}</span>${esc(b.comp)}</td>
        <td class="mt">${teamsHtml(b.a)}</td>
        <td class="bet">${esc(b.label)}</td>
        <td class="rel"><span class="v num">${t.pct(b.p)}</span><div class="bar"><div style="width:${Math.round(b.p * 100)}%"></div></div></td>
        <td class="odd num">${t.odd(b.p)}</td>
        <td class="conf ${confCls(b.conf)}"><i></i>${confTxt(b.conf)}</td>
        <td class="notes" data-meta="${esc(d.hm(b.ts) + ' · ' + b.comp)}">${betAlert(b) ? '<span class="trap">Alerte compo</span>' : ''}${[...b.notes, ...b.a.tags.filter(x => !b.notes.includes(x) && x !== 'Match piège')].slice(0, 3).map(n => `<span class="${n === 'Match piège' ? 'trap' : ''}">${esc(n)}</span>`).join('')}</td>
        ${r.replay ? `<td class="res res-${b.result}">${RES[b.result] || ''}<div style="color:var(--dim);font-size:12px">${esc(realScore(b.a))}</div></td>` : ''}
      </tr>`;
      if (open) html += `<tr class="detail"><td colspan="11">${detailHtml(b.a, b.id)}</td></tr>`;
    });
    html += `</tbody></table>
      <p class="warn" style="margin-top:14px">Heures du tennis (≈) : indicatives, le match commence à la suite du précédent sur le même court. Fiabilité : probabilité calculée que le pari passe. Cote mini : en dessous de cette cote sur Winamax, le pari ne vaut pas le coup sur la durée. Confiance : quantité de données disponibles (faible = pari déclassé).</p>`;
    return html;
  }

  /* ---------- Combinés ---------- */
  function renderCombos() {
    const cf = state.cfilters;
    const csorts = { rel: ['Fiabilité', (a, b) => b.p - a.p], oddAsc: ['Cote (plus petite d’abord)', (a, b) => b.p - a.p],
      oddDesc: ['Cote (plus grande d’abord)', (a, b) => a.p - b.p], time: ['Heure du premier match', (a, b) => Math.min(...a.legs.map(l => l.ts)) - Math.min(...b.legs.map(l => l.ts))] };
    const prep = list => list.filter(c => oddOk(c.p, cf)).sort((csorts[cf.sort] || csorts.rel)[1]);
    const doubles = prep(state.result.combos.doubles), triples = prep(state.result.combos.triples);
    const bar = `<div class="filters">
      <select data-cf="oddMin">${options(ODDS.map(o => [String(o), 'Cote dès ' + t.num(o, 2)]), cf.oddMin, 'Cote : pas de minimum')}</select>
      <select data-cf="oddMax">${options(ODDS.map(o => [String(o), 'Cote jusqu’à ' + t.num(o, 2)]), cf.oddMax, 'Cote : pas de maximum')}</select>
      <select data-cf="sort" class="sortsel">${Object.entries(csorts).map(([k, v]) => `<option value="${k}" ${k === cf.sort ? 'selected' : ''}>Trier : ${v[0]}</option>`).join('')}</select>
    </div>`;
    const playBox = c => `<label class="chk play"><input type="checkbox" data-playc="${esc(c.id)}" ${state.played.has(c.id) ? 'checked' : ''}> Je le joue</label>`;
    const block = (title, list) => `<h3>${title}</h3>` + (list.length ? list.map(c => `
      <div class="combo ${state.played.has(c.id) ? 'is-played' : ''}">
        <div class="legs">${playBox(c)}${c.legs.map(l => `<div><span class="bet">${esc(l.label)}</span> <span class="m">${esc(l.matchName)} · ${d.hm(l.ts)} · ${t.pct(l.p)}</span></div>`).join('')}</div>
        <div class="cf"><span class="rel"><span class="v num" style="font-family:var(--cond);font-weight:700;font-size:18px">${t.pct(c.p)}</span></span><div class="bar"><div style="width:${Math.round(c.p * 100)}%"></div></div></div>
        <div class="odd num">${t.odd(c.p)}<div style="font-size:11px;color:var(--muted);font-family:var(--body);font-weight:400">cote mini</div>${c.result ? `<div class="res-${c.result}" style="font-family:var(--body);font-size:13px">${RES[c.result]}</div>` : ''}</div>
      </div>`).join('') : '<div class="empty">Aucun combiné ne correspond (filtre de cote, ou pas assez de matchs différents).</div>');
    const H = state.result.combos.hard || [];
    const hard = `<h3>Grosses cotes du jour</h3>` + (H.length ? `<div class="hard">${[5, 10, 15].map(T => H.filter(c => c.target === T).map(c => `
      <div class="combo ${state.played.has(c.id) ? 'is-played' : ''}">
        <div class="legs">${playBox(c)}<div class="tgt">Cote visée ${T} · ${c.style === 'courte' ? 'version courte' : 'version sûre'} · ${c.legs.length} pari${c.legs.length > 1 ? 's' : ''}</div>${c.legs.map(l => `<div><span class="bet">${esc(l.label)}</span> <span class="m">${esc(l.matchName)} · ${esc(SP[l.sport] || '')} · ${d.hm(l.ts)} · ${t.pct(l.p)} · cote mini ${t.odd(l.p)}</span></div>`).join('')}</div>
        <div class="cf"><span class="rel"><span class="v num" style="font-family:var(--cond);font-weight:700;font-size:18px">${t.pct(c.p)}</span></span><div class="bar"><div style="width:${Math.max(2, Math.round(c.p * 100))}%"></div></div></div>
        <div class="odd num">${t.num(1 / c.p, 2)}<div style="font-size:11px;color:var(--muted);font-family:var(--body);font-weight:400">cote mini</div>${c.result ? `<div class="res-${c.result}" style="font-family:var(--body);font-size:13px">${RES[c.result]}</div>` : ''}</div>
      </div>`).join('')).join('')}</div>
      <p class="warn">Version sûre : beaucoup de paris parmi les plus fiables du jour. Version courte : moins de matchs (cotes de 1,40 à 2,30), donc moins de marge prise par Winamax. Un seul pari par match, deux matchs au plus d’un même championnat. Une grosse cote reste un pari risqué : à jouer petit.</p>`
      : '<div class="empty">Pas assez de paris fiables aujourd’hui pour construire une grosse cote.</div>');
    return `<div class="combos">${bar}${hard}${block('Combinés à 2 paris', doubles)}${block('Combinés à 3 paris', triples)}
      <p class="warn" style="margin-top:14px">Chaque combiné ne mélange que des matchs différents, et jamais deux matchs du même championnat de foot (pour ne pas empiler les favoris d'une même journée).</p></div>`;
  }

  /* ---------- Matchs ---------- */
  function renderMatches() {
    const r = state.result;
    const groups = {};
    r.analyses.forEach(a => { const k = SP[a.sport] + ' · ' + a.comp; (groups[k] = groups[k] || []).push(a); });
    let html = '';
    Object.entries(groups).sort().forEach(([g, list]) => {
      html += `<div class="mgroup"><h3>${esc(g)}</h3>`;
      list.forEach(a => {
        const id = 'm' + a.match.id;
        let probs;
        if (a.sport === 'soccer' && a.p1 !== undefined && a.pX !== undefined) probs = `1 <b>${t.pct(a.p1)}</b> · N <b>${t.pct(a.pX)}</b> · 2 <b>${t.pct(a.p2)}</b>`;
        else probs = `Favori : <b>${esc(a.fav.name)}</b> ${t.pct(a.fav.pWin)}`;
        html += `<div class="mrow" data-m="${id}"><div class="num" style="color:var(--muted)">${d.hm(a.match.ts)}</div><div>${teamsHtml(a)}</div><div class="probs">${probs}</div><div class="notes">${a.tags.map(x => `<span class="${x === 'Match piège' ? 'trap' : ''}">${esc(x)}</span>`).join('')}</div></div>`;
        if (state.open === id) html += `<div class="mdetail detail">${detailHtml(a, null)}</div>`;
      });
      html += '</div>';
    });
    return html || '<div class="empty">Aucun match à venir dans les compétitions choisies.</div>';
  }

  /* ---------- Historique ---------- */
  const RESTXT = v => ({ won: 'Gagné', lost: 'Perdu', void: 'Annulé' }[v.result] || 'En attente');
  const longDate = ts => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  function histDetail(v) {
    const b = v.bet;
    const at = v.at || v.savedAt;
    // pronostics enregistrés avant cette version : on retrouve l'analyse si elle est encore chargée
    const live = !b.why ? findBet(b.id) : null;
    const why = b.why || (live ? App.why(live) : '');
    const factors = (b.factors && b.factors.length) ? b.factors : live ? live.a.factors : [];
    return `<div style="color:var(--muted);margin-bottom:6px">Pronostic donné le ${esc(longDate(at))} à ${d.hm(at)} · match le ${esc(longDate(b.ts))} à ${d.hm(b.ts)} · ${esc(b.comp)} · fiabilité ${t.pct(b.p)} · cote mini ${t.odd(b.p)}</div>
      ${why ? whyHtml(why) : '<p class="why">Analyse détaillée non enregistrée pour ce pronostic (donné avant la mise à jour du 6 novembre).</p>'}
      ${factors.length ? `<h4>Analyse</h4><ul>${factors.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
  }
  function histRow(v) {
    const b = v.bet;
    return `<tr class="hrow ${v.played ? 'is-played' : ''}" data-h="${esc(v._k)}"><td class="n" style="width:30px;color:var(--muted)">${v.extra ? '' : b.rank}</td><td>${v.played ? '<span class="mine">Joué</span> ' : ''}${esc(b.label)}</td><td style="color:var(--muted)">${esc(b.matchName)}</td><td class="n" style="color:var(--muted)">${d.hm(b.ts)}</td><td class="n">${t.pct(b.p)}</td><td class="n res-${v.result || 'pending'}" style="width:80px">${RESTXT(v)}</td></tr>`
      + (state.hopen === v._k ? `<tr class="hdetail"><td colspan="6">${histDetail(v)}</td></tr>` : '');
  }
  async function renderHistory() {
    const raw = await App.db.all('history');
    raw.forEach(([k, v]) => { v._k = k; });
    const entries = raw.map(([k, v]) => v);
    const allBets = entries.filter(v => v.type === 'B');
    const myBets = allBets.filter(v => v.played), myCombos = entries.filter(v => v.type === 'C' && v.played);
    const bets = allBets.filter(v => !v.extra); // statistiques de la sélection : sans les paris ajoutés à la main
    const combos = entries.filter(v => v.type === 'C' && v.kind !== 'hard' && !v.extra);
    const hards = entries.filter(v => v.type === 'C' && v.kind === 'hard' && !v.extra);
    const done = bets.filter(v => v.result === 'won' || v.result === 'lost');
    const noPlay = '<div class="sect"><h3>Mes paris joués</h3><div class="empty" style="padding:18px">Aucun pari marqué pour l’instant. Cochez la case <strong>Joué</strong> devant un pari (Sélection) ou « Je le joue » sur un combiné : il apparaîtra ici avec son résultat et votre taux de réussite.</div></div>';
    if (!allBets.length) return noPlay + '<div class="empty"><strong>Pas encore d\'historique.</strong><br>Chaque analyse enregistre la sélection du jour. Le lendemain, en cliquant sur Analyser, l\'app vérifie automatiquement chaque pronostic et calcule son taux de réussite réel.</div>';
    const rate = l => { const w = l.filter(v => v.result === 'won').length; return l.length ? w / l.length : 0; };
    const exp = l => l.length ? l.reduce((a, b) => a + b.bet.p, 0) / l.length : 0;
    const cDone = combos.filter(v => v.result === 'won' || v.result === 'lost');
    const wl = l => l.filter(v => v.result === 'won' || v.result === 'lost');
    const myDone = wl(myBets), myCDone = wl(myCombos);
    let html = '';
    if (myBets.length || myCombos.length) {
      html += `<div class="sect"><h3>Mes paris joués</h3><div class="kpis">
        <div class="kpi"><div class="l">Paris simples gagnés</div><div class="v num">${myDone.length ? `${myDone.filter(v => v.result === 'won').length}/${myDone.length}` : '-'}</div><div class="l">${myDone.length ? `${t.pct(rate(myDone))} réel · ${t.pct(exp(myDone))} annoncé` : ''}</div></div>
        <div class="kpi"><div class="l">Combinés gagnés</div><div class="v num">${myCDone.length ? `${myCDone.filter(v => v.result === 'won').length}/${myCDone.length}` : '-'}</div></div>
        <div class="kpi"><div class="l">En attente</div><div class="v num">${myBets.filter(v => v.result === null).length + myCombos.filter(v => v.result === null).length}</div></div>
      </div>
      <table class="mini">${myBets.sort((a, b) => b.bet.ts - a.bet.ts).slice(0, 40).map(histRow).join('')}</table>
      ${myCombos.length ? `<table class="mini" style="margin-top:8px">${myCombos.sort((a, b) => b.legs[0].ts - a.legs[0].ts).slice(0, 20).map(v => `<tr><td><span class="mine">Joué</span> Combiné ${v.legs.length} paris : ${v.legs.map(l => esc(l.label)).join(' + ')}</td><td class="n">${t.num(1 / v.p, 2)}</td><td class="n res-${v.result || 'pending'}" style="width:80px">${RESTXT(v)}</td></tr>`).join('')}</table>` : ''}
      </div><h3 style="margin-top:26px;font-family:var(--cond);text-transform:uppercase">Toute la sélection</h3>`;
    } else html += noPlay + '<h3 style="margin-top:26px;font-family:var(--cond);text-transform:uppercase">Toute la sélection</h3>';
    html += `<div class="kpis">
      <div class="kpi"><div class="l">Paris vérifiés</div><div class="v num">${done.length}</div></div>
      <div class="kpi"><div class="l">Taux de réussite réel</div><div class="v num">${done.length ? t.pct(rate(done)) : '-'}</div></div>
      <div class="kpi"><div class="l">Fiabilité annoncée (moyenne)</div><div class="v num">${done.length ? t.pct(exp(done)) : '-'}</div></div>
      <div class="kpi"><div class="l">Top 10 : réussite</div><div class="v num">${(() => { const l = done.filter(v => v.bet.rank <= 10); return l.length ? t.pct(rate(l)) : '-'; })()}</div></div>
      <div class="kpi"><div class="l">Combinés gagnés</div><div class="v num">${cDone.length ? `${cDone.filter(v => v.result === 'won').length}/${cDone.length}` : '-'}</div></div>
      <div class="kpi"><div class="l">Grosses cotes gagnées</div><div class="v num">${(() => { const l = hards.filter(v => v.result === 'won' || v.result === 'lost'); return l.length ? `${l.filter(v => v.result === 'won').length}/${l.length}` : '-'; })()}</div></div>
      <div class="kpi"><div class="l">En attente</div><div class="v num">${bets.filter(v => v.result === null).length}</div></div>
    </div>`;
    const table = (title, keyFn) => {
      const g = {};
      done.forEach(v => { const k = keyFn(v); (g[k] = g[k] || []).push(v); });
      const rows = Object.entries(g).sort((a, b) => b[1].length - a[1].length);
      return `<div class="sect"><h3>${title}</h3><table class="mini"><tr><td style="color:var(--muted)"></td><td class="n" style="color:var(--muted)">Paris</td><td class="n" style="color:var(--muted)">Annoncé</td><td class="n" style="color:var(--muted)">Réel</td></tr>${rows.map(([k, l]) => `<tr><td>${esc(k)}</td><td class="n">${l.length}</td><td class="n">${t.pct(exp(l))}</td><td class="n ${rate(l) >= exp(l) - 0.03 ? 'res-won' : 'res-lost'}">${t.pct(rate(l))}</td></tr>`).join('')}</table></div>`;
    };
    if (done.length) {
      html += `<div class="two">
        ${table('Par sport', v => SP[v.bet.sport])}
        ${table('Par type de pari', v => v.bet.group)}
        ${table('Par niveau de fiabilité', v => { const p = v.bet.p; return p >= 0.9 ? '90 % et plus' : p >= 0.8 ? '80 - 89 %' : p >= 0.7 ? '70 - 79 %' : p >= 0.6 ? '60 - 69 %' : 'moins de 60 %'; })}
      </div>`;
    }
    // Liste par jour
    const days = [...new Set(bets.map(v => v.day))].sort().reverse();
    days.forEach(day => {
      const l = bets.filter(v => v.day === day).sort((a, b) => a.bet.rank - b.bet.rank);
      const dd = l.filter(v => v.result === 'won' || v.result === 'lost');
      const label = new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      html += `<div class="sect"><h3>${label} <span style="color:var(--muted);font-size:14px">${dd.length ? `${dd.filter(v => v.result === 'won').length}/${dd.length} gagnés` : 'en attente'}</span></h3>
        <table class="mini">${l.map(histRow).join('')}</table></div>`;
    });
    html += `<p style="margin-top:20px"><button class="btn2" id="clearHist">Effacer l'historique</button></p>`;
    return html;
  }

  /* ---------- Recherche (barre en haut, toujours visible) ---------- */
  const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MO = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const REL = { 'aujourd’hui': 0, "aujourd'hui": 0, 'aujourdhui': 0, 'avant-hier': -2, 'demain': 1, 'hier': -1 };
  // Repère une date dans la recherche ; renvoie { key: AAAAMMJJ, date, rest: mots restants }
  function parseDate(qn) {
    const now = new Date(); let date = null; let rest = qn;
    const take = re => { const m = rest.match(re); if (m) rest = rest.replace(m[0], ' '); return m; };
    let m;
    if ((m = take(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      date = new Date(y, +m[2] - 1, +m[1]);
    } else if ((m = take(new RegExp(`\\b(\\d{1,2})(?:er)? (${MO.join('|')})(?: (\\d{4}))?\\b`)))) {
      date = new Date(m[3] ? +m[3] : now.getFullYear(), MO.indexOf(m[2]), +m[1]);
    } else {
      for (const [w, o] of Object.entries(REL)) {
        if (rest.includes(w)) { rest = rest.replace(w, ' '); date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o); break; }
      }
      if (!date) {
        const i = WD.findIndex(w => new RegExp(`\\b${w}\\b`).test(rest));
        if (i >= 0) {
          rest = rest.replace(WD[i], ' ');
          for (let o = 1; o >= -6; o--) { const x = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o); if (x.getDay() === i) { date = x; break; } }
        }
      }
    }
    return { key: date ? d.ymd(date) : null, date, rest: rest.split(/\s+/).filter(Boolean) };
  }
  const hasAll = (txt, words) => { const n = t.norm(txt); return words.every(w => n.includes(w)); };
  async function renderSearch() {
    const qn = t.norm(state.q.trim());
    const { key, date, rest } = parseDate(qn);
    let html = '<div class="sres">';
    let found = 0;
    // 1. Matchs du jour affiché
    const r = state.result;
    if (r && rest.length && (!key || key === r.W.key)) {
      const list = r.analyses.filter(a => hasAll([
        a.match.h ? `${a.match.h.name} ${a.match.h.short} ${a.match.a.name} ${a.match.a.short}` : (a.match.players || []).map(p => p.name).join(' '),
        a.comp, SP[a.sport], (a.scorers || []).map(x => x.name).join(' '),
      ].join(' '), rest)).slice(0, 30);
      if (list.length) {
        found += list.length;
        html += `<h3>Matchs · ${esc(d.dayLabel(r.W.start))}</h3>`;
        list.forEach(a => {
          const bets = r.top.filter(b => b.a === a);
          const id = 's' + a.match.id;
          html += `<div class="hit" data-s="${esc(id)}"><div class="num m">${d.hm(a.match.ts)}</div><div>${teamsHtml(a)} <span class="m">· ${esc(SP[a.sport])} · ${esc(a.comp)}</span></div>
            <div class="m">${bets.length ? `${bets.length} pari${bets.length > 1 ? 's' : ''} dans la sélection` : 'hors sélection'}</div></div>`;
          if (state.open === id) {
            const best = bets[0] || r.all.find(b => b.a === a);
            html += `<div class="detail" style="padding:12px 4px">${bets.length ? `<table class="mini" style="margin-bottom:10px">${bets.map(b => `<tr><td class="n" style="width:30px;color:var(--muted)">${b.rank}</td><td>${esc(b.label)}</td><td class="n">${t.pct(b.p)}</td><td class="n">${t.odd(b.p)}</td></tr>`).join('')}</table>` : ''}${detailHtml(a, best ? best.id : null)}</div>`;
          }
        });
      }
    }
    // 2. Historique
    const hist = (await App.db.all('history')).map(([k, v]) => { v._k = k; return v; }).filter(v => v.type === 'B')
      .filter(v => (!key || v.day === key || d.ymd(new Date(v.bet.ts)) === key) && (!rest.length || hasAll(`${v.bet.label} ${v.bet.matchName} ${v.bet.comp} ${SP[v.bet.sport]}`, rest)))
      .sort((a, b) => b.bet.ts - a.bet.ts || a.bet.rank - b.bet.rank).slice(0, 60);
    if (hist.length) {
      found += hist.length;
      html += `<h3>Historique des pronostics${key ? ` · ${esc(longDate(date))}` : ''}</h3>`;
      [...new Set(hist.map(v => v.day))].forEach(day => {
        const l = hist.filter(v => v.day === day);
        html += `<div style="color:var(--muted);margin:10px 0 4px">${esc(longDate(new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6))))}</div><table class="mini">${l.map(histRow).join('')}</table>`;
      });
    }
    // 3. Date : proposer d'ouvrir ce jour
    if (key) {
      const off = [-2, -1, 0, 1].find(o => d.window(o).key === key);
      if (off !== undefined && (!r || r.W.key !== key)) html += `<p style="margin-top:16px"><button class="btn2" data-goday="${off}">Afficher la journée du ${esc(longDate(date))}</button></p>`;
      else if (off === undefined && !hist.length) html += `<div class="empty">Aucun pronostic enregistré pour le ${esc(longDate(date))}.</div>`;
    }
    if (!found && !key) html += `<div class="empty">Rien trouvé pour « ${esc(state.q)} ». Essayez un nom d’équipe, de joueur, une compétition ou une date (7/11, samedi, hier).</div>`;
    return html + '</div>';
  }

  /* ---------- Réglages ---------- */
  async function renderSettings() {
    const S = await App.engine.settings();
    const saved = S.raw.comps || {};
    const box = (sp, c) => {
      const on = saved[sp + ':' + c.id] !== undefined ? saved[sp + ':' + c.id] : c.on;
      return `<label><input type="checkbox" data-comp="${sp}:${c.id}" ${on ? 'checked' : ''}> ${esc(c.name)}${c.country ? ` <span class="muted">${esc(c.country)}</span>` : ''}</label>`;
    };
    return `<div class="settings">
      <fieldset><legend>Football</legend>${App.config.soccer.map(c => box('soccer', c)).join('')}</fieldset>
      <fieldset><legend>Tennis</legend>${App.config.tennis.map(c => box('tennis', c)).join('')}</fieldset>
      <fieldset><legend>Basket</legend>${App.config.basket.map(c => box('basket', c)).join('')}
        <div class="muted" style="margin-top:6px">Euroligue et EuroCup : API officielle publique (scores finaux seulement, donc pas de paris à la mi-temps). La Betclic Élite n'est pas couverte.</div></fieldset>
      <fieldset><legend>Sélection</legend>
        <label style="width:auto">Paris maximum par match dans le top 100
          <select id="maxPer">${[1, 2, 3, 4, 5].map(n => `<option ${n === S.maxPerMatch ? 'selected' : ''}>${n}</option>`).join('')}</select></label><br>
        <label style="width:auto">Cote juste minimale (en dessous, le pari est écarté)
          <select id="minOdd">${[1.01, 1.03, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.40, 1.50].map(n => `<option value="${n}" ${n === S.minOdd ? 'selected' : ''}>${t.num(n, 2)}</option>`).join('')}</select></label>
        <div class="muted" style="margin-top:4px">Winamax propose des cotes dès 1,01 - 1,03 sur les grands favoris. Montez ce réglage pour voir moins de paris à toute petite cote dans le top 100.</div>
      </fieldset>
      <fieldset><legend>Sources</legend>
        <div class="muted" style="line-height:1.6">
          Résultats, calendriers, effectifs et cotes du jour : ESPN (public).<br>
          xG, arbitres (Angleterre, Écosse) et cotes moyennes des bookmakers : football-data.co.uk.<br>
          Anciens clubs des joueurs et bilan contre eux : jeu de données Transfermarkt sur GitHub (arrêté au 6 juillet 2026, complété par les effectifs ESPN).<br>
          Ces deux dernières sources demandent d'ouvrir l'app avec <strong>Lancer.bat</strong>.
        </div>
      </fieldset>
      <fieldset><legend>Données</legend>
        <div class="muted" style="margin-bottom:8px">La première analyse télécharge plusieurs saisons d'historique (quelques minutes). Les suivantes sont bien plus rapides.</div>
        <button class="btn2" id="clearCache">Vider le cache des données</button> <span class="muted">(l'historique de vos pronostics est conservé)</span>
      </fieldset>
    </div>`;
  }

  /* ---------- Rendu ---------- */
  let renderTok = 0;
  async function render() {
    const searching = !!state.q.trim();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', !searching && b.dataset.tab === state.tab));
    // une seule mise à jour gagne si plusieurs rendus se chevauchent (frappe rapide dans la recherche)
    const tok = ++renderTok;
    const put = html => { if (tok === renderTok) view.innerHTML = html; };
    if (searching) { put(await renderSearch().catch(e => { console.error(e); return `<div class="empty">Erreur de recherche : ${esc(e.message)}</div>`; })); return; }
    if (state.tab === 'history') { put(await renderHistory()); return; }
    if (state.tab === 'settings') { view.innerHTML = await renderSettings(); return; }
    if (!state.result) {
      if (state.day < 0) {
        view.innerHTML = `<div class="empty"><strong>Test à l'aveugle.</strong> Cliquez sur Analyser : l'app se place au matin ${state.day === -1 ? "d'hier" : "d'avant-hier"}, fait sa sélection avec uniquement les données connues à ce moment-là, puis la compare aux vrais résultats.</div>`;
        return;
      }
      view.innerHTML = `<div class="empty"><strong>Cliquez sur Analyser</strong> pour lancer l'étude des matchs ${state.day ? 'de demain' : 'du jour'} : football, tennis et basket.<br><br>La première fois, l'app télécharge l'historique des saisons passées : comptez quelques minutes. Ensuite, tout est gardé sur cet appareil.</div>`;
      return;
    }
    if (state.tab === 'top') view.innerHTML = renderTop();
    else if (state.tab === 'live') view.innerHTML = renderLive(state.result);
    else if (state.tab === 'combos') view.innerHTML = renderCombos();
    else if (state.tab === 'matches') view.innerHTML = renderMatches();
  }

  /* ---------- Événements ---------- */
  $('#runBtn').addEventListener('click', run);
  $('#daySeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.day = +b.dataset.day;
    document.querySelectorAll('#daySeg button').forEach(x => x.classList.toggle('on', x === b));
    if (state.result && state.result.W.key !== d.window(state.day).key) state.result = null;
    dateline(); render();
  });
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab; state.open = null; state.hopen = null; clearSearch(); render();
    if (state.tab === 'live') pollLive();
  });
  const sInput = $('#search');
  const clearSearch = () => { state.q = ''; sInput.value = ''; };
  let sTimer;
  sInput.addEventListener('input', () => {
    clearTimeout(sTimer);
    sTimer = setTimeout(() => { state.q = sInput.value; state.open = null; state.hopen = null; render(); }, 250);
  });
  sInput.addEventListener('keydown', e => { if (e.key === 'Escape') { clearSearch(); render(); } });
  view.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.f) { state.filters[el.dataset.f] = el.value; render(); return; }
    if (el.dataset.cf) { state.cfilters[el.dataset.cf] = el.value; render(); return; }
    if (el.dataset.sortSel) { const [k, rv] = el.value.split('|'); state.sort = k; state.rev = rv === '1'; render(); return; }
    if (el.dataset.comp || el.id === 'maxPer' || el.id === 'minOdd') {
      const s = (await App.db.get('kv', 'settings')) || {};
      s.comps = s.comps || {};
      if (el.dataset.comp) s.comps[el.dataset.comp] = el.checked;
      if (el.id === 'maxPer') s.maxPerMatch = +el.value;
      if (el.id === 'minOdd') s.minOdd = +el.value;
      await App.db.put('kv', 'settings', s);
      state.result = null;
    }
  });
  let qTimer;
  view.addEventListener('input', e => {
    if (e.target.dataset.f !== 'q') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.filters.q = e.target.value; render();
      const i = view.querySelector('input[data-f="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    }, 250);
  });
  view.addEventListener('click', async e => {
    const pb = e.target.closest('input[data-play], input[data-playc]');
    if (pb) {
      const isC = !!pb.dataset.playc, id = isC ? pb.dataset.playc : pb.dataset.play;
      const r = state.result, C = r.combos;
      const item = isC ? [...C.doubles, ...C.triples, ...(C.hard || [])].find(c => c.id === id) : findBet(id);
      if (!item) return;
      const on = await App.engine.togglePlayed(r.W.key, item, isC);
      if (on) state.played.add(id); else state.played.delete(id);
      render(); return;
    }
    // Clic sur un titre de colonne : tri (un 2e clic sur « Cote mini » inverse l'ordre)
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      if (state.sort === k) state.rev = !state.rev; else { state.sort = k; state.rev = false; }
      render(); return;
    }
    const row = e.target.closest('tr.row');
    if (row) { state.open = state.open === row.dataset.id ? null : row.dataset.id; render(); return; }
    if (e.target.id === 'liveMine') { state.liveMine = e.target.checked; render(); return; }
    const gt = e.target.closest('[data-gotab]');
    if (gt) { e.preventDefault(); document.querySelector(`#tabs button[data-tab="${gt.dataset.gotab}"]`).click(); return; }
    const gd = e.target.closest('[data-goday]');
    if (gd) { clearSearch(); document.querySelector(`#daySeg button[data-day="${gd.dataset.goday}"]`).click(); return; }
    const hit = e.target.closest('.hit');
    if (hit) { state.open = state.open === hit.dataset.s ? null : hit.dataset.s; render(); return; }
    const hr = e.target.closest('tr.hrow');
    if (hr) { state.hopen = state.hopen === hr.dataset.h ? null : hr.dataset.h; render(); return; }
    const mr = e.target.closest('.mrow');
    if (mr) { state.open = state.open === mr.dataset.m ? null : mr.dataset.m; render(); return; }
    if (e.target.id === 'clearCache') {
      if (!confirm('Vider le cache ? La prochaine analyse retéléchargera tout l\'historique.')) return;
      await App.db.clear('cache'); e.target.textContent = 'Cache vidé';
    }
    if (e.target.id === 'clearHist') {
      if (!confirm('Effacer tout l\'historique des pronostics ?')) return;
      await App.db.clear('history'); render();
    }
  });

  /* ---------- Mode automatique (lancé à 00 h 10 par la tâche planifiée, navigateur invisible) ---------- */
  if (new URLSearchParams(location.search).get('auto')) {
    const off = new Date().getHours() < 6 ? 1 : 0; // à 00 h 10, la journée de paris qui commence est celle de 6 h
    document.title = 'FDJ-EN-COURS';
    App.data.useProxy = true;
    App.engine.settleAll().catch(() => {})
      .then(() => App.engine.run(off, () => {}))
      .then(async r => { r.auto = true; const ok = await App.engine.saveRemote(r); document.title = ok ? 'FDJ-OK' : 'FDJ-ERREUR'; })
      .catch(async e => { document.title = 'FDJ-ERREUR'; try { await fetch('/api/auto-error', { method: 'POST', body: String(e && e.stack || e) }); } catch (x) {} });
    return;
  }

  // À l'ouverture : reprend la dernière analyse enregistrée (automatique ou non) si elle concerne le jour affiché
  (async () => {
    const r = await App.engine.loadRemote();
    if (r && !state.result && r.W.key === d.window(state.day).key) {
      state.result = r;
      const flag = `hist|${r.W.key}|${r.ranAt}`;
      if (!(await App.db.get('kv', flag))) { await App.engine.saveHistory(r.W.key, r.top, r.combos); await App.db.put('kv', flag, 1); }
      dateline(); render(); await pollLive();
    }
    // Vérifie en arrière-plan les résultats des jours précédents (historique), y compris sur téléphone
    App.engine.settleAll().catch(() => {});
  })();
  // Paris cochés « je joue » (gardés sur cet appareil, dans l'historique)
  App.db.all('history').then(list => { list.forEach(([k, v]) => { if (v.played) state.played.add(v.type === 'B' ? v.bet.id : k.split('|').slice(2).join('|')); }); if (state.played.size && state.result) render(); });
  pollAlerts();
  setInterval(pollAlerts, 120000);
  setInterval(pollLive, 60000);

  dateline();
  render();
})();
