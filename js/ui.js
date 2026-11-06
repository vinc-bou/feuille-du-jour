/* Interface : sélection du jour, combinés, matchs, historique, réglages. */
(() => {
  const { t, d } = App;
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const SP = { soccer: 'Foot', tennis: 'Tennis', basket: 'Basket', hockey: 'Hockey', handball: 'Handball', volley: 'Volley', rugby: 'Rugby' };
  const state = { tab: 'top', day: 0, result: null, running: false, alerts: [], filters: { sport: '', comp: '', group: '', time: '', q: '', oddMin: '', oddMax: '' }, open: null,
    sort: 'rel', cfilters: { oddMin: '', oddMax: '', sort: 'rel' } };
  // Choix de tri (Sélection) : libellé + fonction de comparaison
  const SORTS = {
    rel: ['Fiabilité (meilleurs d’abord)', (a, b) => a.vr - b.vr],
    time: ['Heure du match', (a, b) => a.ts - b.ts || a.vr - b.vr],
    oddAsc: ['Cote (plus petite d’abord)', (a, b) => b.p - a.p],
    oddDesc: ['Cote (plus grande d’abord)', (a, b) => a.p - b.p],
    sport: ['Sport', (a, b) => a.sport.localeCompare(b.sport) || a.vr - b.vr],
    comp: ['Compétition', (a, b) => a.comp.localeCompare(b.comp) || a.ts - b.ts],
    conf: ['Confiance', (a, b) => b.conf - a.conf || a.vr - b.vr],
    group: ['Type de pari', (a, b) => a.group.localeCompare(b.group) || a.vr - b.vr],
  };
  const ODDS = [1.10, 1.15, 1.20, 1.25, 1.30, 1.40, 1.50, 1.60, 1.75, 2, 2.5, 3, 4, 5];
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
      state.result = await App.engine.run(state.day, s => { step = s; setStatus(s); });
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
    return (odds ? rerank(f) : state.result.top).filter(b => {
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
    }).sort(SORTS[state.sort] ? SORTS[state.sort][1] : SORTS.rel[1]);
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

  function detailHtml(a, focusId) {
    const others = state.result.all.filter(b => b.a === a && b.id !== focusId).slice(0, 8);
    let form = '';
    if (a.forms) {
      const side = (k, nm) => a.forms[k] ? `<div>${esc(nm)} <span class="form">${a.forms[k].slice(0, 6).map(f => `<span class="${f.r}">${f.r}</span>`).join('')}</span></div>` : '';
      form = side('h', a.match.h && a.match.h.short) + side('a', a.match.a && a.match.a.short);
    }
    const st = a.standings && (a.standings.h || a.standings.a) ? `<div style="margin-top:6px;color:var(--muted)">Classement : ${a.standings.h ? `${esc(a.match.h.short)} ${a.standings.h.rank}e (${a.standings.h.pts} pts)` : ''}${a.standings.h && a.standings.a ? ' · ' : ''}${a.standings.a ? `${esc(a.match.a.short)} ${a.standings.a.rank}e (${a.standings.a.pts} pts)` : ''}</div>` : '';
    const sc = a.scorers && a.scorers.length ? `<h4 style="margin-top:12px">Buteurs</h4><table class="mini">${a.scorers.map(s => `<tr><td>${esc(s.name)} <span style="color:var(--dim)">${esc(s.team)}</span>${s.rev ? ' <span style="color:var(--accent)">revenant</span>' : ''}</td><td class="n">${s.g} but${s.g > 1 ? 's' : ''}</td><td class="n">${s.rank ? s.rank + 'e du championnat' : ''}</td></tr>`).join('')}</table>` : '';
    return `<div class="cols">
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
      <input data-f="q" placeholder="Équipe, joueur…" value="${esc(f.q)}">
      <select data-sort-sel="top" class="sortsel">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === state.sort ? 'selected' : ''}>Trier : ${v[0]}</option>`).join('')}</select>
      <span class="count">${rows.length} pari${rows.length > 1 ? 's' : ''}${f.oddMin || f.oddMax ? ' dans cette fourchette de cotes' : ''} · ${r.analyses.length} matchs analysés</span>
    </div>`;
    if (!rows.length) return html + `<div class="empty">Aucun pari ne correspond à ces filtres.</div>`;
    html += `<table class="grid"><thead><tr><th style="text-align:right" data-sort="rel">#</th><th data-sort="time">Heure</th><th data-sort="comp">Compétition</th><th>Match</th><th data-sort="group">Pari</th><th data-sort="rel">Fiabilité</th><th data-sort="odd">Cote mini</th><th data-sort="conf">Confiance</th><th>À savoir</th>${r.replay ? '<th>Résultat</th>' : ''}</tr></thead><tbody>`;
    rows.forEach(b => {
      const open = state.open === b.id;
      html += `<tr class="row ${b.vr <= 10 ? 't10' : ''}" data-id="${esc(b.id)}">
        <td class="rk">${b.vr}</td>
        <td class="time num">${d.hm(b.ts)}</td>
        <td class="comp"><span class="sp">${SP[b.sport]}</span>${esc(b.comp)}</td>
        <td class="mt">${teamsHtml(b.a)}</td>
        <td class="bet">${esc(b.label)}</td>
        <td class="rel"><span class="v num">${t.pct(b.p)}</span><div class="bar"><div style="width:${Math.round(b.p * 100)}%"></div></div></td>
        <td class="odd num">${t.odd(b.p)}</td>
        <td class="conf ${confCls(b.conf)}"><i></i>${confTxt(b.conf)}</td>
        <td class="notes" data-meta="${esc(d.hm(b.ts) + ' · ' + b.comp)}">${betAlert(b) ? '<span class="trap">Alerte compo</span>' : ''}${[...b.notes, ...b.a.tags.filter(x => !b.notes.includes(x) && x !== 'Match piège')].slice(0, 3).map(n => `<span class="${n === 'Match piège' ? 'trap' : ''}">${esc(n)}</span>`).join('')}</td>
        ${r.replay ? `<td class="res res-${b.result}">${RES[b.result] || ''}<div style="color:var(--dim);font-size:12px">${esc(realScore(b.a))}</div></td>` : ''}
      </tr>`;
      if (open) html += `<tr class="detail"><td colspan="10">${detailHtml(b.a, b.id)}</td></tr>`;
    });
    html += `</tbody></table>
      <p class="warn" style="margin-top:14px">Fiabilité : probabilité calculée que le pari passe. Cote mini : en dessous de cette cote sur Winamax, le pari ne vaut pas le coup sur la durée. Confiance : quantité de données disponibles (faible = pari déclassé).</p>`;
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
    const block = (title, list) => `<h3>${title}</h3>` + (list.length ? list.map(c => `
      <div class="combo">
        <div class="legs">${c.legs.map(l => `<div><span class="bet">${esc(l.label)}</span> <span class="m">${esc(l.matchName)} · ${d.hm(l.ts)} · ${t.pct(l.p)}</span></div>`).join('')}</div>
        <div class="cf"><span class="rel"><span class="v num" style="font-family:var(--cond);font-weight:700;font-size:18px">${t.pct(c.p)}</span></span><div class="bar"><div style="width:${Math.round(c.p * 100)}%"></div></div></div>
        <div class="odd num">${t.odd(c.p)}<div style="font-size:11px;color:var(--muted);font-family:var(--body);font-weight:400">cote mini</div>${c.result ? `<div class="res-${c.result}" style="font-family:var(--body);font-size:13px">${RES[c.result]}</div>` : ''}</div>
      </div>`).join('') : '<div class="empty">Aucun combiné ne correspond (filtre de cote, ou pas assez de matchs différents).</div>');
    return `<div class="combos">${bar}${block('Combinés à 2 paris', doubles)}${block('Combinés à 3 paris', triples)}
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
  async function renderHistory() {
    const entries = (await App.db.all('history')).map(([k, v]) => v);
    const bets = entries.filter(v => v.type === 'B');
    const combos = entries.filter(v => v.type === 'C');
    const done = bets.filter(v => v.result === 'won' || v.result === 'lost');
    if (!bets.length) return '<div class="empty"><strong>Pas encore d\'historique.</strong><br>Chaque analyse enregistre la sélection du jour. Le lendemain, en cliquant sur Analyser, l\'app vérifie automatiquement chaque pronostic et calcule son taux de réussite réel.</div>';
    const rate = l => { const w = l.filter(v => v.result === 'won').length; return l.length ? w / l.length : 0; };
    const exp = l => l.length ? l.reduce((a, b) => a + b.bet.p, 0) / l.length : 0;
    const cDone = combos.filter(v => v.result === 'won' || v.result === 'lost');
    let html = `<div class="kpis">
      <div class="kpi"><div class="l">Paris vérifiés</div><div class="v num">${done.length}</div></div>
      <div class="kpi"><div class="l">Taux de réussite réel</div><div class="v num">${done.length ? t.pct(rate(done)) : '-'}</div></div>
      <div class="kpi"><div class="l">Fiabilité annoncée (moyenne)</div><div class="v num">${done.length ? t.pct(exp(done)) : '-'}</div></div>
      <div class="kpi"><div class="l">Top 10 : réussite</div><div class="v num">${(() => { const l = done.filter(v => v.bet.rank <= 10); return l.length ? t.pct(rate(l)) : '-'; })()}</div></div>
      <div class="kpi"><div class="l">Combinés gagnés</div><div class="v num">${cDone.length ? `${cDone.filter(v => v.result === 'won').length}/${cDone.length}` : '-'}</div></div>
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
        <table class="mini">${l.map(v => `<tr><td class="n" style="width:30px;color:var(--muted)">${v.bet.rank}</td><td>${esc(v.bet.label)}</td><td style="color:var(--muted)">${esc(v.bet.matchName)}</td><td class="n">${t.pct(v.bet.p)}</td><td class="n res-${v.result || 'pending'}" style="width:80px">${{ won: 'Gagné', lost: 'Perdu', void: 'Annulé' }[v.result] || 'En attente'}</td></tr>`).join('')}</table></div>`;
    });
    html += `<p style="margin-top:20px"><button class="btn2" id="clearHist">Effacer l'historique</button></p>`;
    return html;
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
          <select id="minOdd">${[1.01, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.40, 1.50].map(n => `<option value="${n}" ${n === S.minOdd ? 'selected' : ''}>${t.num(n, 2)}</option>`).join('')}</select></label>
        <div class="muted" style="margin-top:4px">Winamax ne propose quasiment jamais de cote sous 1,10 : ces paris très « sûrs » ne sont pas jouables.</div>
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
  async function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
    if (state.tab === 'history') { view.innerHTML = await renderHistory(); return; }
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
    state.tab = b.dataset.tab; state.open = null; render();
  });
  view.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.f) { state.filters[el.dataset.f] = el.value; render(); return; }
    if (el.dataset.cf) { state.cfilters[el.dataset.cf] = el.value; render(); return; }
    if (el.dataset.sortSel) { state.sort = el.value; render(); return; }
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
    // Clic sur un titre de colonne : tri (un 2e clic sur « Cote mini » inverse l'ordre)
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      state.sort = k === 'odd' ? (state.sort === 'oddAsc' ? 'oddDesc' : 'oddAsc') : k;
      render(); return;
    }
    const row = e.target.closest('tr.row');
    if (row) { state.open = state.open === row.dataset.id ? null : row.dataset.id; render(); return; }
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
      dateline(); render();
    }
    // Vérifie en arrière-plan les résultats des jours précédents (historique), y compris sur téléphone
    App.engine.settleAll().catch(() => {});
  })();
  pollAlerts();
  setInterval(pollAlerts, 120000);

  dateline();
  render();
})();
