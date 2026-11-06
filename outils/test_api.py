"""Test : contenu des cotes du jour (types de paris, bookmakers) et coût en requêtes."""
import json, os, urllib.request, urllib.error
from collections import Counter
KEY = os.environ.get('APIFOOTBALL_KEY', '').strip()
def call(host, path):
    req = urllib.request.Request(f'https://{host}{path}', headers={'x-apisports-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode('utf-8')), dict(r.headers)
    except urllib.error.HTTPError as e:
        return {'errors': {'http': e.code}}, {}
F = 'v3.football.api-sports.io'
d, h = call(F, '/odds?date=2026-11-07&page=1')
print('Quota restant (en-têtes) :', h.get('x-ratelimit-requests-remaining'), '/', h.get('x-ratelimit-requests-limit'))
bets, books, leagues = Counter(), Counter(), Counter()
for r in d.get('response') or []:
    leagues[r['league']['country'] + ' ' + r['league']['name']] += 1
    for b in r['bookmakers']:
        books[b['name']] += 1
        for x in b['bets']:
            bets[x['name']] += 1
print('Compétitions page 1 :', dict(leagues))
print('Bookmakers :', books.most_common(12))
print('Types de paris :', len(bets), [k for k, _ in bets.most_common(60)])
ex = (d.get('response') or [{}])[0]
if ex:
    b = ex['bookmakers'][0]
    for x in b['bets'][:3]:
        print('  ex.', x['name'], x['values'][:4])
for name, host in [('basket', 'v1.basketball.api-sports.io'), ('hockey', 'v1.hockey.api-sports.io'), ('handball', 'v1.handball.api-sports.io'), ('volley', 'v1.volleyball.api-sports.io'), ('rugby', 'v1.rugby.api-sports.io')]:
    g, gh = call(host, '/odds?date=2026-11-07')
    print(f"{name} cotes : erreurs {g.get('errors')} | pages {g.get('paging')} | matchs {len(g.get('response') or [])} | quota restant {gh.get('x-ratelimit-requests-remaining')}")
d, h = call(F, '/status')
print('Status :', (d.get('response') or {}).get('requests'), '| restant en-tête :', h.get('x-ratelimit-requests-remaining'))
