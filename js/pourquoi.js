/* « Pourquoi ce pari » : un court paragraphe en français courant, construit à partir des chiffres
   de l'analyse (buts attendus, forme, classement, bookmakers, points d'attention). */
window.App = window.App || {};

App.why = (() => {
  const { t } = App;
  const n1 = v => t.num(v, 1);
  const fois = p => { const x = Math.round(p * 20) / 2; return `${t.num(x, x % 1 ? 1 : 0)} fois sur 10`; };
  const wins = f => f ? `${f.slice(0, 6).filter(x => x.r === 'V').length} victoire${f.slice(0, 6).filter(x => x.r === 'V').length > 1 ? 's' : ''} sur ${Math.min(6, f.length)}` : '';
  const has = (s, words) => words.some(w => s.toLowerCase().includes(w));

  function soccer(b, a) {
    const s = b.settle, out = [];
    const H = a.match.h.short, A = a.match.a.short;
    const resultKinds = ['1x2', 'dc', 'hcp', 'ht1x2', 'htft'];
    if (['cor', 'cor1x2', 'card'].includes(s.k)) {
      a.factors.filter(f => has(f, ['corners attendus', 'arbitre'])).forEach(f => out.push(f + '.'));
    } else if (s.k === 'scorer') {
      const sc = (a.scorers || []).find(x => x.name === s.pn);
      if (sc) out.push(`${sc.name} a marqué ${sc.g} but${sc.g > 1 ? 's' : ''} cette saison${sc.rank ? ` (${sc.rank}e du classement des buteurs)` : ''}${sc.share ? `, soit ${Math.round(sc.share * 100)} % des buts de ${sc.team}` : ''}.`);
      if (sc && sc.since >= 3) out.push(`Il reste sur ${sc.since} matchs sans marquer.`);
      if (sc && sc.hot >= 3) out.push(`Il a marqué lors de ses ${sc.hot} derniers matchs.`);
      if (sc && sc.rev) out.push('Il retrouve un ancien club.');
    } else if (a.lh !== undefined) {
      let txt = `Le calcul attend environ ${n1(a.lh)} but${a.lh >= 2 ? 's' : ''} pour ${H} et ${n1(a.la)} pour ${A}`;
      if (s.k === 'tot' || s.k === 'htot') {
        const tot = s.k === 'htot' ? (a.lh + a.la) * (s.half === 1 ? 0.45 : 0.55) : a.lh + a.la;
        const gap = Math.abs(tot - s.line);
        txt += `, soit ${n1(tot)} ${s.k === 'htot' ? 'dans cette mi-temps' : 'au total'}${gap >= 0.8 ? `, nettement ${tot < s.line ? 'sous' : 'au-dessus de'} la limite de ${n1(s.line)}` : ''}`;
      }
      out.push(txt + '.');
    }
    if (resultKinds.includes(s.k) || s.k === 'team' || s.k === 'btts' || s.k === 'nil') {
      if (a.p1 !== undefined) out.push(`Chances de victoire : ${H} ${t.pct(a.p1)}, nul ${t.pct(a.pX)}, ${A} ${t.pct(a.p2)}.`);
      if (a.forms && (a.forms.h || a.forms.a)) out.push(`Derniers matchs : ${H} ${wins(a.forms.h)}, ${A} ${wins(a.forms.a)}.`);
      const sh = a.standings && a.standings.h, sa = a.standings && a.standings.a;
      if (sh && sa) out.push(`Au classement, ${H} est ${sh.rank}e et ${A} ${sa.rank}e.`);
    }
    if (a.market) out.push(`Les bookmakers donnent ${H} ${t.pct(a.market.p1)}, nul ${t.pct(a.market.pX)}, ${A} ${t.pct(a.market.p2)} : leur avis est pris en compte.`);
    // un ou deux éléments de contexte (série, trou d'air, fatigue, derby, enjeu…)
    a.factors.filter(f => has(f, ['série', 'sans défaite', 'défaites de suite', 'sans victoire', 'sans encaisser', 'sans marquer', 'trou d', 'en forme en', 'fatigue', 'trêve', 'derby', 'maintien', 'rien à jouer', 'dépend', 'revenant', 'retrouve', 'ancien']))
      .slice(0, 2).forEach(f => out.push(f + '.'));
    return out;
  }

  function tennis(b, a) {
    const s = b.settle, out = [];
    out.push(`${a.fav.name} est donné gagnant ${fois(a.fav.pWin)}${a.surface ? ` sur ${a.surface}` : ''}.`);
    const keys = ['games', 'ghcp'].includes(s.k) ? ['jeux attendus', 'face-à-face', 'indice de force'] : ['indice de force', 'victoires sur', 'face-à-face', 'sets joués'];
    a.factors.filter(f => has(f, keys)).slice(0, 3).forEach(f => out.push(f + '.'));
    return out;
  }

  function basket(b, a) {
    const out = [`${a.fav.name} est donné gagnant ${fois(a.fav.pWin)}.`];
    a.factors.slice(0, 3).forEach(f => out.push(f + '.'));
    return out;
  }

  return function why(b) {
    const a = b.a;
    if (!a) return '';
    let out = [`D'après le calcul, ce pari passe environ ${fois(b.p)}.`];
    if (a.analysisType === 'marche') {
      out.push(`Ce match n'a pas d'historique détaillé gratuit : la fiabilité est l'avis moyen des bookmakers, marge retirée.`);
      if (a.factors[0]) out.push(a.factors[0].replace('Analyse par le marché : ', 'Source : '));
    } else {
      try { out = out.concat(a.sport === 'soccer' ? soccer(b, a) : a.sport === 'tennis' ? tennis(b, a) : basket(b, a)); } catch (e) { /* données incomplètes */ }
    }
    if ((b.notes || []).includes('Match piège')) out.push('Attention : c\'est le match piège de la journée dans ce championnat, le favori est plus fragile qu\'il n\'y paraît.');
    if (b.conf < 0.4) out.push('Peu de données sur ce match : à jouer petit.');
    out.push(`À jouer si Winamax propose au moins ${t.odd(b.p)}. En dessous, le gain ne compense pas le risque.`);
    return [...new Set(out)].join(' ');
  };
})();
