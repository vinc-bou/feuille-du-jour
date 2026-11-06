"""Test : cotes et pronostics API-Football pour un match à venir (formule gratuite)."""
import json, os, urllib.request, urllib.error
KEY = os.environ.get('APIFOOTBALL_KEY', '').strip()
def call(host, path):
    req = urllib.request.Request(f'https://{host}{path}', headers={'x-apisports-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'errors': {'http': e.code}}
F = 'v3.football.api-sports.io'
fx = call(F, '/fixtures?date=2026-11-07&timezone=Europe/Paris').get('response') or []
ukr = [f for f in fx if f['league']['country'] == 'Ukraine' and f['fixture']['status']['short'] == 'NS']
f = ukr[0] if ukr else next(x for x in fx if x['fixture']['status']['short'] == 'NS')
fid = f['fixture']['id']
print('Match testé :', f['league']['name'], '|', f['teams']['home']['name'], '-', f['teams']['away']['name'], f['fixture']['date'])
p = call(F, f'/predictions?fixture={fid}')
print('\nPRONOSTIC erreurs :', p.get('errors'))
for r in (p.get('response') or [])[:1]:
    pr = r['predictions']
    print('  1N2 % :', pr['percent'], '| conseil :', pr['advice'], '| +/- :', pr['under_over'])
    cmp = r.get('comparison') or {}
    print('  comparaison :', {k: v for k, v in cmp.items()})
    print('  forme saison dom :', (r['teams']['home'].get('league') or {}).get('form'), '| ext :', (r['teams']['away'].get('league') or {}).get('form'))
    lg = r['teams']['home'].get('league') or {}
    print('  buts dom (pour/contre moyenne) :', (lg.get('goals') or {}).get('for', {}).get('average'), (lg.get('goals') or {}).get('against', {}).get('average'))
    print('  confrontations :', len(r.get('h2h') or []))
o = call(F, f'/odds?fixture={fid}')
print('\nCOTES erreurs :', o.get('errors'))
for r in (o.get('response') or [])[:1]:
    print('  bookmakers :', len(r['bookmakers']), [b['name'] for b in r['bookmakers']][:8])
    b = r['bookmakers'][0]
    print('  marchés chez', b['name'], ':', len(b['bets']), [x['name'] for x in b['bets']][:25])
od = call(F, '/odds?date=2026-11-07&page=1')
print('\nCOTES DU JOUR erreurs :', od.get('errors'), '| pages :', (od.get('paging') or {}), '| matchs page 1 :', len(od.get('response') or []))
st = call(F, '/status')
print('Requêtes foot utilisées :', (st.get('response') or {}).get('requests'))
