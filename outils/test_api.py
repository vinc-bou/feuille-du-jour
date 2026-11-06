"""Test de la clé API-Football (lancé sur GitHub, la clé n'est jamais affichée)."""
import json
import os
import time
import urllib.error
import urllib.request

KEY = os.environ.get('APIFOOTBALL_KEY', '').strip()
TODAY = time.strftime('%Y-%m-%d')


def call(host, path):
    req = urllib.request.Request(f'https://{host}{path}', headers={'x-apisports-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'errors': {'http': e.code}}


if not KEY:
    print('Clé absente.')
    raise SystemExit(1)

st = call('v3.football.api-sports.io', '/status')
resp = st.get('response') or {}
sub = resp.get('subscription') or {}
req = resp.get('requests') or {}
print('Formule :', sub.get('plan'), '| active :', sub.get('active'), '| fin :', sub.get('end'))
print('Requêtes aujourd\'hui :', req.get('current'), '/', req.get('limit_day'))
if st.get('errors'):
    print('Erreurs status :', st['errors'])

fx = call('v3.football.api-sports.io', f'/fixtures?date={TODAY}&timezone=Europe/Paris')
items = fx.get('response') or []
print(f'\nMatchs de foot du {TODAY} :', len(items), '| erreurs :', fx.get('errors'))
leagues = {}
for f in items:
    lg = f['league']
    leagues.setdefault((lg['country'], lg['name'], lg['id'], lg['season']), 0)
    leagues[(lg['country'], lg['name'], lg['id'], lg['season'])] += 1
print('Compétitions différentes :', len(leagues))
ukr = [(k, v) for k, v in leagues.items() if k[0] == 'Ukraine']
print('Ukraine :', ukr)
for f in items:
    if f['league']['country'] == 'Ukraine':
        print('  ', f['fixture']['date'], f['teams']['home']['name'], '-', f['teams']['away']['name'], f['goals'])

# Classement du championnat ukrainien (test d'accès à la saison en cours)
upl = next((k for k in leagues if k[0] == 'Ukraine' and 'Premier' in k[1]), None)
lid, season = (upl[2], upl[3]) if upl else (333, int(time.strftime('%Y')))
sd = call('v3.football.api-sports.io', f'/standings?league={lid}&season={season}')
print(f'\nClassement ligue {lid} saison {season} : erreurs = {sd.get("errors")}')
try:
    table = sd['response'][0]['league']['standings'][0]
    for row in table[:3]:
        print('  ', row['rank'], row['team']['name'], row['points'], 'pts | forme', row.get('form'),
              '| dom', row['home']['goals'], '| ext', row['away']['goals'])
except Exception:
    print('   pas de classement accessible')

# Derniers matchs d'une équipe (historique de la saison en cours)
if upl:
    last = call('v3.football.api-sports.io', f'/fixtures?league={lid}&season={season}&status=FT')
    print('Matchs terminés cette saison (Ukraine) :', len(last.get('response') or []), '| erreurs :', last.get('errors'))

# Autres sports avec la même clé
for name, host in [('basket', 'v1.basketball.api-sports.io'), ('hockey', 'v1.hockey.api-sports.io'),
                   ('handball', 'v1.handball.api-sports.io'), ('volley', 'v1.volleyball.api-sports.io'),
                   ('rugby', 'v1.rugby.api-sports.io')]:
    g = call(host, f'/games?date={TODAY}&timezone=Europe/Paris')
    print(f'{name} : {len(g.get("response") or [])} matchs aujourd\'hui | erreurs : {g.get("errors")}')

st = call('v3.football.api-sports.io', '/status')
print('\nRequêtes foot utilisées après le test :', (st.get('response') or {}).get('requests'))
