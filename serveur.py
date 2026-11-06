"""Petit serveur local de la Feuille du jour.

- Sert les fichiers de l'app sur http://localhost:8765
- Récupère les données ouvertes que le navigateur ne peut pas lire directement :
    /api/ping                       -> "ok"
    /api/fd?code=F1&season=2627     -> CSV football-data.co.uk (xG, arbitres, cotes moyennes)
    /api/fd-fixtures                -> CSV des prochains matchs avec cotes moyennes
    /api/euro?kind=results&code=E2026 -> Euroligue (E) / EuroCup (U), calendrier ou résultats
    /api/tm                         -> résumé Transfermarkt (clubs, matchs, joueurs contre leurs anciens clubs)
Aucune dépendance : Python 3 standard uniquement.
"""
import csv
import gzip
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from surveillance import Watcher

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'cache')
os.makedirs(CACHE, exist_ok=True)
RESULTS = os.path.join(ROOT, os.environ.get('FEUILLE_RESULTATS', 'resultats'))  # « en-ligne » pour la version GitHub
os.makedirs(RESULTS, exist_ok=True)
WATCHER = None
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get('FEUILLE_PORT', '8765'))
FD = 'https://www.football-data.co.uk'
TM = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data'
UA = {'User-Agent': 'feuille-du-jour/1.0 (usage personnel)'}
# Compétitions utilisées pour relier les clubs Transfermarkt aux équipes de l'app
TM_COMPS = {'FR1', 'GB1', 'ES1', 'IT1', 'L1', 'PO1', 'NL1', 'BE1', 'TR1', 'SC1', 'GR1', 'A1', 'DK1', 'CL', 'EL', 'UCOL',
            'FAC', 'CDR', 'CIT', 'DFB', 'MLS1', 'BRA1', 'ARG1', 'MEX1', 'SA1'}


def download(url, path, ttl):
    """Télécharge url vers path si absent ou plus vieux que ttl secondes."""
    if os.path.exists(path) and (ttl is None or time.time() - os.path.getmtime(path) < ttl):
        return path
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    with open(path + '.tmp', 'wb') as f:
        f.write(data)
    os.replace(path + '.tmp', path)
    return path


def read_gz_csv(name):
    path = download(f'{TM}/{name}.csv.gz', os.path.join(CACHE, f'tm_{name}.csv.gz'), None)
    with gzip.open(path, 'rt', encoding='utf-8', errors='replace', newline='') as f:
        yield from csv.DictReader(f)


def build_tm():
    """Résumé compact : matchs (pour relier les clubs) + bilan des joueurs contre leurs anciens clubs."""
    out = os.path.join(CACHE, 'tm_summary.json')
    if os.path.exists(out):
        return out
    print('Transfermarkt : préparation du résumé (une seule fois, ~1 minute)…', flush=True)
    games = {}
    game_rows = []
    for g in read_gz_csv('games'):
        if g.get('competition_type') == 'national_team_competition' or not g['date'] or g['date'] < '2019-07-01':
            continue
        try:
            hg, ag = int(float(g['home_club_goals'])), int(float(g['away_club_goals']))
        except ValueError:
            continue
        games[g['game_id']] = (g['home_club_id'], g['away_club_id'], g['date'])
        if g['competition_id'] in TM_COMPS:
            game_rows.append([g['date'], g['competition_id'], g['home_club_id'], g['away_club_id'], hg, ag])
    clubs = {c['club_id']: c['name'] for c in read_gz_csv('clubs')}
    # Bilan de chaque joueur contre chaque adversaire, et clubs fréquentés
    stats = {}   # player -> {opp: [matchs, buts, passes]}
    played = {}  # player -> {club: dernière date}
    for a in read_gz_csv('appearances'):
        g = games.get(a['game_id'])
        if not g:
            continue
        pid, club = a['player_id'], a['player_club_id']
        opp = g[1] if club == g[0] else g[0]
        p = played.setdefault(pid, {})
        if a['date'] > p.get(club, ''):
            p[club] = a['date']
        s = stats.setdefault(pid, {}).setdefault(opp, [0, 0, 0])
        s[0] += 1
        s[1] += int(a['goals'] or 0)
        s[2] += int(a['assists'] or 0)
    players = {}
    for p in read_gz_csv('players'):
        pid = p['player_id']
        if pid not in played or (p['last_season'] or '0') < '2024':
            continue
        cur = p['current_club_id']
        past = [c for c in played[pid] if c != cur]
        if not past:
            continue
        vs = {c: stats[pid][c] for c in past if c in stats.get(pid, {})}
        # buts/passes contre d'anciens clubs (joués après les avoir quittés ou non : bilan global)
        players[pid] = {'n': p['name'], 'cur': cur, 'past': past, 'vs': vs}
    data = {'snapshot': max(r[0] for r in game_rows), 'clubs': clubs, 'games': game_rows, 'players': players}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('Transfermarkt : résumé prêt.', flush=True)
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, fmt, *args):
        pass

    def send_body(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length') or 0)
        if n > 50_000_000:
            return self.send_body(b'trop gros', 'text/plain', 413)
        body = self.rfile.read(n)
        if u.path == '/api/save-analysis':
            try:
                data = json.loads(body.decode('utf-8'))
                key = str(data['W']['key'])
                if not re.fullmatch(r'\d{8}', key):
                    raise ValueError('clé')
            except Exception:
                return self.send_body(b'json invalide', 'text/plain', 400)
            for name in (f'{key}.json', 'dernier.json'):
                tmp = os.path.join(RESULTS, name + '.tmp')
                with open(tmp, 'wb') as f:
                    f.write(body)
                os.replace(tmp, os.path.join(RESULTS, name))
            return self.send_body(b'ok', 'text/plain')
        if u.path == '/api/auto-error':
            with open(os.path.join(RESULTS, 'erreur-auto.txt'), 'wb') as f:
                f.write(body[:100000])
            return self.send_body(b'ok', 'text/plain')
        return self.send_body(b'inconnu', 'text/plain', 404)

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith('/api/'):
            if u.path.startswith(('/cache/', '/resultats/', '/profil-auto/')) or u.path.endswith('.py'):
                return self.send_body(b'interdit', 'text/plain', 403)
            return super().do_GET()
        q = parse_qs(u.query)
        try:
            if u.path == '/api/ping':
                return self.send_body(b'ok', 'text/plain')
            if u.path == '/api/stop' and os.environ.get('FEUILLE_CLOUD'):
                self.send_body(b'ok', 'text/plain')
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if u.path == '/api/espn':
                # Relais vers l'API publique ESPN (utilisé par l'analyse automatique : ESPN refuse les navigateurs invisibles)
                target = q.get('u', [''])[0]
                if not target.startswith('/apis/site/v2/sports/') or '..' in target:
                    return self.send_body(b'interdit', 'text/plain', 403)
                req = urllib.request.Request('https://site.api.espn.com' + target, headers={**UA, 'Accept-Encoding': 'identity'})
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        return self.send_body(r.read(), 'application/json; charset=utf-8')
                except urllib.error.HTTPError as e:
                    return self.send_body(b'{}', 'application/json', e.code)
            if u.path == '/api/last-analysis':
                p = os.path.join(RESULTS, 'dernier.json')
                if not os.path.exists(p):
                    return self.send_body(b'aucune', 'text/plain', 404)
                return self.send_body(open(p, 'rb').read(), 'application/json; charset=utf-8')
            if u.path == '/api/alerts':
                body = json.dumps(WATCHER.alerts() if WATCHER else [], ensure_ascii=False).encode('utf-8')
                return self.send_body(body, 'application/json; charset=utf-8')
            if u.path == '/api/fd':
                code, season = q.get('code', [''])[0], q.get('season', [''])[0]
                if not re.fullmatch(r'[A-Z]{1,3}\d?', code) or not re.fullmatch(r'\d{4}', season):
                    return self.send_body(b'parametres', 'text/plain', 400)
                now = time.localtime()
                cur = f'{now.tm_year % 100:02d}{(now.tm_year + 1) % 100:02d}' if now.tm_mon >= 7 else f'{(now.tm_year - 1) % 100:02d}{now.tm_year % 100:02d}'
                ttl = 6 * 3600 if season == cur else None
                path = download(f'{FD}/mmz4281/{season}/{code}.csv', os.path.join(CACHE, f'fd_{code}_{season}.csv'), ttl)
                return self.send_body(open(path, 'rb').read(), 'text/csv; charset=utf-8')
            if u.path == '/api/euro':
                kind, code = q.get('kind', [''])[0], q.get('code', [''])[0]
                if kind not in ('schedules', 'results') or not re.fullmatch(r'[EU]\d{4}', code):
                    return self.send_body(b'parametres', 'text/plain', 400)
                y = time.localtime()
                cur_year = y.tm_year if y.tm_mon >= 8 else y.tm_year - 1
                ttl = 1800 if int(code[1:]) >= cur_year else None
                path = download(f'https://api-live.euroleague.net/v1/{kind}?seasonCode={code}', os.path.join(CACHE, f'eu_{kind}_{code}.xml'), ttl)
                return self.send_body(open(path, 'rb').read(), 'text/xml; charset=utf-8')
            if u.path == '/api/fd-fixtures':
                path = download(f'{FD}/fixtures.csv', os.path.join(CACHE, 'fd_fixtures.csv'), 3600)
                return self.send_body(open(path, 'rb').read(), 'text/csv; charset=utf-8')
            if u.path == '/api/tm':
                path = build_tm()
                return self.send_body(open(path, 'rb').read(), 'application/json; charset=utf-8')
        except Exception as e:  # source indisponible : l'app continue sans
            return self.send_body(str(e).encode('utf-8', 'replace'), 'text/plain', 502)
        return self.send_body(b'inconnu', 'text/plain', 404)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--prepare':
        build_tm()
        sys.exit(0)
    class Server(ThreadingHTTPServer):
        allow_reuse_address = False  # sous Windows, évite que deux serveurs partagent le même port
    try:
        srv = Server(('127.0.0.1', PORT), Handler)
    except OSError:
        print(f"Le port {PORT} est déjà utilisé : l'app est sans doute déjà ouverte (http://localhost:{PORT}).", flush=True)
        sys.exit(1)
    WATCHER = Watcher(ROOT)
    if not os.environ.get('FEUILLE_CLOUD'):  # en ligne, la surveillance a sa propre automatisation (toutes les 15 min)
        WATCHER.start()
    print(f'Feuille du jour : http://localhost:{PORT}  (fermez cette fenêtre pour arrêter)', flush=True)
    srv.serve_forever()
