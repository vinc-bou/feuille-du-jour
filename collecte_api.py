"""Collecte quotidienne API-Football / API-Sports (formule gratuite : 100 requêtes par jour et par sport).

Produit, pour une journée de paris D (heure de Paris) :
  cache/api/AAAAMMJJ.json   -> matchs du jour de tous les sports + probabilités du marché (moyenne des
                               bookmakers, marge retirée, Pinnacle compté triple). Données dérivées, non publiées.
  en-ligne/scores-api.json   -> scores finaux récents (faits publics) pour vérifier l'historique sur téléphone.

Clé : variable APIFOOTBALL_KEY (secret GitHub) ou fichier cle-api-football.txt (non publié).
Usage : python collecte_api.py [AAAAMMJJ]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'cache', 'api')
PUB = os.path.join(ROOT, os.environ.get('FEUILLE_RESULTATS', 'resultats'))
TZ = 'Europe/Paris'
RESERVE = 3  # requêtes gardées en réserve par sport

SPORTS = {
    'soccer': 'v3.football.api-sports.io',
    'basketball': 'v1.basketball.api-sports.io',
    'hockey': 'v1.hockey.api-sports.io',
    'handball': 'v1.handball.api-sports.io',
    'volleyball': 'v1.volleyball.api-sports.io',
    'rugby': 'v1.rugby.api-sports.io',
}
# Compétitions prioritaires pour les cotes des autres sports (les plus proposées par les bookmakers français)
PRIO = {
    'basketball': ['euroleague', 'eurocup', 'lnb', 'pro a', 'betclic', 'acb', 'lega a', 'bbl', 'bsl', 'super league', 'nba', 'champions league', 'pro b', 'vtb', 'aba', 'nbl', 'lkl'],
    'hockey': ['nhl', 'khl', 'shl', 'liiga', 'del', 'national league', 'ligue magnus', 'extraliga', 'ice hockey league', 'champions hockey league', 'ahl'],
    'handball': ['starligue', 'lidl', 'champions league', 'bundesliga', 'liga asobal', 'ehf', 'proligue'],
    'volleyball': ['ligue a', 'marmara', 'superlega', 'plusliga', 'champions league', 'cev', 'serie a1', 'bundesliga'],
    'rugby': ['top 14', 'pro d2', 'premiership', 'united rugby', 'champions cup', 'challenge cup', 'super rugby', 'six nations', 'rugby championship'],
}
BOOK_W = {'Pinnacle': 3.0}


def key():
    k = os.environ.get('APIFOOTBALL_KEY', '').strip()
    if not k:
        try:
            with open(os.path.join(ROOT, 'cle-api-football.txt'), encoding='utf-8') as f:
                k = f.read().strip()
        except OSError:
            pass
    return k


class Client:
    def __init__(self, host, k):
        self.host, self.k, self.remaining, self.used = host, k, 100, 0

    def get(self, path):
        if self.remaining <= RESERVE:
            return None
        req = urllib.request.Request(f'https://{self.host}{path}', headers={'x-apisports-key': self.k})
        for i in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    rem = r.headers.get('x-ratelimit-requests-remaining')
                    if rem is not None and rem.isdigit():
                        self.remaining = int(rem)
                    self.used += 1
                    d = json.loads(r.read().decode('utf-8'))
                    if d.get('errors'):
                        print(f'  {self.host}{path} : {d["errors"]}', flush=True)
                    time.sleep(6.5)  # formule gratuite : 10 requêtes par minute
                    return d
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(30)
                    continue
                print(f'  HTTP {e.code} {path}', flush=True)
                return None
            except Exception as e:
                print(f'  erreur {path} : {e}', flush=True)
                time.sleep(5)
        return None


# ---------------------------------------------------------------- probabilités du marché
def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def line_of(s):
    try:
        return float(str(s).split()[-1])
    except ValueError:
        return None


def soccer_groups(bet):
    """Transforme un marché bookmaker en groupes {clé: [(spec, cote), ...]} d'issues complémentaires."""
    name, vals = bet['name'], bet['values']
    g = {}
    side = lambda v: {'Home': 'h', 'Away': 'a'}.get(v)
    if name == 'Match Winner':
        m = {'Home': '1', 'Draw': 'X', 'Away': '2'}
        g['1x2'] = [({'k': '1x2', 'sel': m[v['value']]}, num(v['odd'])) for v in vals if v['value'] in m]
    elif name == 'First Half Winner':
        m = {'Home': '1', 'Draw': 'X', 'Away': '2'}
        g['ht1x2'] = [({'k': 'ht1x2', 'sel': m[v['value']]}, num(v['odd'])) for v in vals if v['value'] in m]
    elif name == 'Both Teams Score':
        g['btts'] = [({'k': 'btts', 'sel': v['value'] == 'Yes'}, num(v['odd'])) for v in vals if v['value'] in ('Yes', 'No')]
    elif name in ('Goals Over/Under', 'Goals Over/Under First Half', 'Goals Over/Under - Second Half', 'Total - Home', 'Total - Away'):
        for v in vals:
            parts = str(v['value']).split()
            ln = line_of(v['value'])
            if len(parts) != 2 or ln is None or ln % 1 != 0.5:
                continue
            sd = 'o' if parts[0] == 'Over' else 'u' if parts[0] == 'Under' else None
            if not sd:
                continue
            if name == 'Goals Over/Under':
                spec = {'k': 'tot', 'side': sd, 'line': ln}
            elif name.startswith('Goals Over/Under'):
                spec = {'k': 'htot', 'half': 1 if 'First' in name else 2, 'side': sd, 'line': ln}
            else:
                spec = {'k': 'team', 'who': 'h' if 'Home' in name else 'a', 'side': sd, 'line': ln}
            g.setdefault(f'{name}|{ln}', []).append((spec, num(v['odd'])))
    elif name == 'Asian Handicap':
        for v in vals:
            parts = str(v['value']).split()
            if len(parts) != 2 or side(parts[0]) is None:
                continue
            ln = num(parts[1])
            if ln is None or abs(ln) % 1 != 0.5:
                continue
            who = side(parts[0])
            hl = ln if who == 'h' else -ln  # ligne vue du domicile
            g.setdefault(f'ah|{hl}', []).append(({'k': 'hcp', 'who': who, 'line': ln}, num(v['odd'])))
    elif name == 'HT/FT Double':
        m = {'Home': '1', 'Draw': 'X', 'Away': '2'}
        out = []
        for v in vals:
            p = str(v['value']).split('/')
            if len(p) == 2 and p[0] in m and p[1] in m:
                out.append(({'k': 'htft', 'sel': m[p[0]] + '/' + m[p[1]]}, num(v['odd'])))
        g['htft'] = out
    return g


def other_groups(bet, sport):
    name, vals = bet['name'], bet['values']
    g = {}
    if name in ('3Way Result', 'Match Winner') and sport != 'volleyball':
        m = {'Home': '1', 'Draw': 'X', 'Away': '2'}
        if {v['value'] for v in vals} >= {'Home', 'Draw', 'Away'}:
            g['1x2'] = [({'k': '1x2', 'sel': m[v['value']]}, num(v['odd'])) for v in vals if v['value'] in m]
    elif name == 'Home/Away':
        m = {'Home': 'h', 'Away': 'a'}
        g['win'] = [({'k': 'win', 'who': m[v['value']]}, num(v['odd'])) for v in vals if v['value'] in m]
    elif name == 'Over/Under' and sport != 'volleyball':
        for v in vals:
            parts = str(v['value']).split()
            ln = line_of(v['value'])
            if len(parts) != 2 or ln is None or ln % 1 != 0.5 or parts[0] not in ('Over', 'Under'):
                continue
            g.setdefault(f'ou|{ln}', []).append(({'k': 'tot', 'side': 'o' if parts[0] == 'Over' else 'u', 'line': ln}, num(v['odd'])))
    elif name == 'Asian Handicap' and sport in ('basketball', 'rugby', 'handball'):
        for v in vals:
            parts = str(v['value']).split()
            if len(parts) != 2 or parts[0] not in ('Home', 'Away'):
                continue
            ln = num(parts[1])
            if ln is None or abs(ln) % 1 != 0.5:
                continue
            who = 'h' if parts[0] == 'Home' else 'a'
            g.setdefault(f'ah|{ln if who == "h" else -ln}', []).append(({'k': 'hcp', 'who': who, 'line': ln}, num(v['odd'])))
    return g


def consensus(bookmakers, sport):
    """Probabilité moyenne de chaque issue, marge retirée pour chaque bookmaker."""
    acc = {}
    for b in bookmakers:
        w = BOOK_W.get(b.get('name'), 1.0)
        for bet in b.get('bets', []):
            groups = soccer_groups(bet) if sport == 'soccer' else other_groups(bet, sport)
            for gk, outs in groups.items():
                outs = [(s, o) for s, o in outs if o and o > 1.0]
                need = 9 if gk == 'htft' else 3 if gk in ('1x2', 'ht1x2') else 2
                if len(outs) != need:
                    continue
                inv = [1 / o for _, o in outs]
                tot = sum(inv)
                if not 1.0 <= tot <= 1.25:  # marché incohérent
                    continue
                for (s, _), x in zip(outs, inv):
                    k = json.dumps(s, sort_keys=True)
                    a = acc.setdefault(k, [0.0, 0.0, set()])
                    a[0] += w * x / tot
                    a[1] += w
                    a[2].add(b.get('name'))
    out = []
    for k, (sp, sw, books) in acc.items():
        out.append({'s': json.loads(k), 'p': round(sp / sw, 4), 'n': len(books), 'pin': 'Pinnacle' in books})
    # Double chance déduite du 1N2
    if sport == 'soccer':
        one = {m['s']['sel']: m for m in out if m['s']['k'] == '1x2'}
        if len(one) == 3:
            for sel, a, b in (('1X', '1', 'X'), ('X2', 'X', '2'), ('12', '1', '2')):
                out.append({'s': {'k': 'dc', 'sel': sel}, 'p': round(one[a]['p'] + one[b]['p'], 4), 'n': one[a]['n'], 'pin': one[a]['pin']})
    return out


# ---------------------------------------------------------------- collecte
def team(t):
    return {'id': t.get('id'), 'name': t.get('name'), 'logo': t.get('logo')}


def soccer(c, day, prev):
    fx = c.get(f'/fixtures?date={day}&timezone={TZ}') or {}
    matches = {}
    for f in fx.get('response') or []:
        st = f['fixture']['status']['short']
        matches[f['fixture']['id']] = {
            'id': f['fixture']['id'], 'ts': f['fixture']['timestamp'] * 1000, 'status': st,
            'league': {'id': f['league']['id'], 'name': f['league']['name'], 'country': f['league']['country'],
                       'logo': f['league'].get('logo'), 'round': f['league'].get('round')},
            'h': team(f['teams']['home']), 'a': team(f['teams']['away']), 'markets': []}
    page, total = 1, 1
    while page <= total:
        d = c.get(f'/odds?date={day}&timezone={TZ}&page={page}')
        if not d:
            break
        total = (d.get('paging') or {}).get('total') or 1
        for r in d.get('response') or []:
            m = matches.get(r['fixture']['id'])
            if m:
                m['markets'] = consensus(r.get('bookmakers') or [], 'soccer')
        page += 1
    scores = {}
    res = c.get(f'/fixtures?date={prev}&timezone={TZ}') or {}
    for f in (res.get('response') or []) + (fx.get('response') or []):
        st = f['fixture']['status']['short']
        if st in ('FT', 'AET', 'PEN'):
            ht = f['score'].get('halftime') or {}
            ft = f['score'].get('fulltime') or {}
            scores[f'soccer|{f["fixture"]["id"]}'] = {'st': st, 'h': ft.get('home', f['goals']['home']), 'a': ft.get('away', f['goals']['away']),
                                                      'h1': ht.get('home'), 'a1': ht.get('away')}
        elif st in ('PST', 'CANC', 'ABD', 'AWD', 'WO'):
            scores[f'soccer|{f["fixture"]["id"]}'] = {'st': st}
    return list(matches.values()), scores, total


def other(c, sport, day, prev):
    g = c.get(f'/games?date={day}&timezone={TZ}') or {}
    games = []
    for x in g.get('response') or []:
        lg = x.get('league') or {}
        games.append({'id': x['id'], 'ts': (x.get('timestamp') or 0) * 1000, 'status': (x.get('status') or {}).get('short'),
                      'league': {'id': lg.get('id'), 'name': lg.get('name'), 'country': (x.get('country') or {}).get('name'), 'logo': lg.get('logo')},
                      'h': team(x['teams']['home']), 'a': team(x['teams']['away']), 'markets': []})

    def prio(m):
        n = f"{m['league']['name']} {m['league']['country']}".lower()
        for i, k in enumerate(PRIO.get(sport, [])):
            if k in n:
                return i
        return 99
    todo = sorted([m for m in games if m['status'] == 'NS'], key=lambda m: (prio(m), m['ts']))
    for m in todo:
        if prio(m) == 99 and sport in ('basketball', 'hockey'):
            break  # beaucoup de petits matchs sans intérêt : on garde le quota
        d = c.get(f'/odds?game={m["id"]}')
        if d is None:
            break
        r = (d.get('response') or [])
        if r:
            m['markets'] = consensus(r[0].get('bookmakers') or [], sport)
    scores = {}
    res = c.get(f'/games?date={prev}&timezone={TZ}') or {}
    for x in (res.get('response') or []) + (g.get('response') or []):
        st = (x.get('status') or {}).get('short')
        sc = x.get('scores') or {}

        def tot(s):
            v = sc.get(s)
            if isinstance(v, dict):
                return v.get('total')
            return v
        if st in ('FT', 'AOT', 'AP', 'AET', 'AW', 'PEN'):
            e = {'st': st, 'h': tot('home'), 'a': tot('away')}
            per = x.get('periods') or {}
            if sport == 'hockey' and per:  # score du temps réglementaire (pour le 1N2)
                try:
                    hs = sum(int(str(per[p]).split('-')[0]) for p in ('first', 'second', 'third') if per.get(p))
                    as_ = sum(int(str(per[p]).split('-')[1]) for p in ('first', 'second', 'third') if per.get(p))
                    e['rh'], e['ra'] = hs, as_
                except Exception:
                    pass
            scores[f'{sport}|{x["id"]}'] = e
        elif st in ('POST', 'CANC', 'ABD', 'AWD', 'WO', 'PST'):
            scores[f'{sport}|{x["id"]}'] = {'st': st}
    return games, scores


def main():
    k = key()
    if not k:
        print('Pas de clé API-Football : collecte ignorée.')
        return
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        d = sys.argv[1]
        day = f'{d[:4]}-{d[4:6]}-{d[6:]}'
        t0 = time.mktime(time.strptime(day, '%Y-%m-%d'))
    else:
        t0 = time.time()
        day = time.strftime('%Y-%m-%d', time.localtime(t0))
    prev = time.strftime('%Y-%m-%d', time.localtime(t0 - 86400))
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PUB, exist_ok=True)
    out = {'day': day.replace('-', ''), 'collected': int(time.time()), 'sports': {}}
    sc_path = os.path.join(PUB, 'scores-api.json')
    try:
        with open(sc_path, encoding='utf-8') as f:
            scores = json.load(f)
    except Exception:
        scores = {}
    # Chaque sport a son propre quota (100/jour, 10/minute) : on les interroge en parallèle
    import threading
    lock = threading.Lock()

    def run(sport, host):
        c = Client(host, k)
        t = time.time()
        try:
            if sport == 'soccer':
                ms, sc, _ = soccer(c, day, prev)
            else:
                ms, sc = other(c, sport, day, prev)
        except Exception as e:
            print(f'{sport} : échec {e}', flush=True)
            return
        with lock:
            scores.update(sc)
            out['sports'][sport] = ms
        print(f'{sport} : {len(ms)} matchs, {sum(1 for m in ms if m["markets"])} avec cotes, {len(sc)} scores, '
              f'{c.used} requêtes, reste {c.remaining} ({round(time.time() - t)} s)', flush=True)
    th = [threading.Thread(target=run, args=sp) for sp in SPORTS.items()]
    for x in th:
        x.start()
    for x in th:
        x.join()
    with open(os.path.join(OUT, out['day'] + '.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    # scores : on garde 10 jours
    with open(sc_path, 'w', encoding='utf-8') as f:
        json.dump(dict(list(scores.items())[-6000:]), f, separators=(',', ':'))


if __name__ == '__main__':
    main()
