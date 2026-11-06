"""Test : la recherche de matchs par date fonctionne-t-elle pour les jours passés (saison en cours) ?"""
import json, os, urllib.request, urllib.error
KEY = os.environ.get('APIFOOTBALL_KEY', '').strip()
def call(host, path):
    req = urllib.request.Request(f'https://{host}{path}', headers={'x-apisports-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'errors': {'http': e.code}}
for d in ['2026-11-01', '2026-10-04', '2026-09-13', '2026-08-16']:
    fx = call('v3.football.api-sports.io', f'/fixtures?date={d}&timezone=Europe/Paris')
    it = fx.get('response') or []
    done = [f for f in it if f['fixture']['status']['short'] in ('FT', 'AET', 'PEN')]
    ukr = [f"{f['teams']['home']['name']} {f['goals']['home']}-{f['goals']['away']} {f['teams']['away']['name']}" for f in done if f['league']['id'] == 333]
    print(f'foot {d} : {len(it)} matchs, {len(done)} terminés | erreurs {fx.get("errors")} | Ukraine : {ukr[:3]}')
for name, host in [('basket', 'v1.basketball.api-sports.io'), ('hockey', 'v1.hockey.api-sports.io')]:
    g = call(host, '/games?date=2026-10-20&timezone=Europe/Paris')
    print(f'{name} 2026-10-20 : {len(g.get("response") or [])} matchs | erreurs {g.get("errors")}')
st = call('v3.football.api-sports.io', '/status')
print('Requêtes foot utilisées :', (st.get('response') or {}).get('requests'))
