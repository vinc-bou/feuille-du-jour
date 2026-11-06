import json, os, urllib.request, urllib.error
KEY = os.environ.get('APIFOOTBALL_KEY', '').strip()
def call(path):
    req = urllib.request.Request('https://v3.football.api-sports.io' + path, headers={'x-apisports-key': KEY})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode('utf-8')), r.headers.get('x-ratelimit-requests-remaining')
d, rem = call('/odds/mapping?page=1')
it = d.get('response') or []
print('mapping : erreurs', d.get('errors'), '| paging', d.get('paging'), '| par page', len(it), '| reste', rem)
print('exemple', it[:2])
dates = {}
for x in it:
    dates[x['fixture']['date'][:10]] = dates.get(x['fixture']['date'][:10], 0) + 1
print('dates page 1 :', dict(sorted(dates.items())[:10]))
fid = next((x['fixture']['id'] for x in it if x['fixture']['date'][:10] == '2026-11-07'), it[0]['fixture']['id'] if it else None)
o, rem = call(f'/odds?fixture={fid}')
r = o.get('response') or []
print('odds?fixture : erreurs', o.get('errors'), '| bookmakers', [b['name'] for b in (r[0]['bookmakers'] if r else [])], '| reste', rem)
