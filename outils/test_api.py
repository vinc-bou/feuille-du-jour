import json, os, urllib.request
KEY = os.environ.get('APIFOOTBALL_KEY', '').strip()
def call(path):
    req = urllib.request.Request('https://v3.football.api-sports.io' + path, headers={'x-apisports-key': KEY})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode('utf-8')), r.headers.get('x-ratelimit-requests-remaining')
for p in ['/odds?league=333&date=2026-11-07', '/odds?league=333&season=2026&date=2026-11-07']:
    d, rem = call(p)
    print(p, '| erreurs', d.get('errors'), '| matchs', len(d.get('response') or []), '| paging', d.get('paging'), '| reste', rem)
