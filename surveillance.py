"""Surveillance des compositions officielles pour les matchs de la sélection.

Tourne dans le serveur local (serveur.py). Toutes les minutes :
- relit la dernière sélection enregistrée (resultats/dernier.json) ;
- foot : à partir de 75 min avant le coup d'envoi, lit la composition officielle (publiée ~1 h avant) ;
- tennis : vérifie qu'aucun joueur n'a déclaré forfait.

Une alerte n'est émise que si un pari de la sélection est réellement concerné :
- pari buteur : le joueur est remplaçant ou absent de la feuille de match ;
- joueur clé (≥ 30 % des buts de son équipe) remplaçant ou absent, ET un pari de la sélection compte
  sur cette équipe pour gagner ou marquer ;
- au moins 5 titulaires changés par rapport au match précédent, ET un pari compte sur cette équipe ;
- tennis : forfait / match annulé (le pari sera en général annulé et remboursé).
"""
import json
import os
import subprocess
import threading
import time
import urllib.request

ESPN = 'https://site.api.espn.com/apis/site/v2/sports'
UA = {'User-Agent': 'feuille-du-jour/1.0 (usage personnel)'}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def ntfy_topic():
    """Sujet ntfy (notifications sur téléphone) : variable NTFY_TOPIC ou fichier ntfy.txt (non publié)."""
    t = os.environ.get('NTFY_TOPIC', '').strip()
    if not t:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ntfy.txt'), encoding='utf-8') as f:
                t = f.read().strip()
        except OSError:
            t = ''
    return t


def notify(title, text):
    """Notification Windows sur le PC + notification téléphone (application ntfy) si configurée."""
    if os.name == 'nt':
        toast(title, text)
    topic = ntfy_topic()
    if topic:
        try:
            body = json.dumps({'topic': topic, 'title': title, 'message': text, 'tags': ['soccer']}).encode('utf-8')
            req = urllib.request.Request('https://ntfy.sh/', data=body, headers={**UA, 'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=20).read()
        except Exception as e:
            print('ntfy :', e, flush=True)


def toast(title, text):
    """Notification Windows (sans module à installer)."""
    esc = lambda s: s.replace("'", "''").replace('&', 'et').replace('<', '').replace('>', '')
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
        "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
        f"$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode('{esc(title)}')) > $null;"
        f"$t.Item(1).AppendChild($x.CreateTextNode('{esc(text)}')) > $null;"
        "$n = [Windows.UI.Notifications.ToastNotification]::new($x);"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
        "'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)"
    )
    try:
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', ps],
                       timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except Exception:
        pass


def harmed(s, side):
    """Le pari compte-t-il sur l'équipe `side` ('h' ou 'a') pour gagner ou marquer ?"""
    k = s.get('k')
    win = '1' if side == 'h' else '2'
    if k == '1x2':
        return s.get('sel') == win
    if k == 'dc':
        return win in s.get('sel', '')
    if k in ('hcp', 'nil'):
        return s.get('who') == side and (k == 'nil' or s.get('line', 0) < 0)
    if k == 'team':
        return s.get('who') == side and s.get('side') == 'o'
    if k == 'btts':
        return s.get('sel') is True
    if k in ('tot', 'htot'):
        return s.get('side') == 'o'
    if k == 'bothHalves':
        return True
    if k == 'ht1x2':
        return s.get('sel') == win
    if k == 'htft':
        return win in s.get('sel', '')
    return False


class Watcher(threading.Thread):
    def __init__(self, root):
        super().__init__(daemon=True)
        self.root = root
        self.res_dir = os.path.join(root, os.environ.get('FEUILLE_RESULTATS', 'resultats'))
        os.makedirs(self.res_dir, exist_ok=True)
        self.alerts_path = os.path.join(self.res_dir, 'alertes.json')
        self.state_path = os.path.join(self.res_dir, 'surveillance.json')
        self.lock = threading.Lock()
        self.sel = None
        self.sel_mtime = 0
        st = self._read(self.state_path, {})
        self.done = set(st.get('done', []))        # matchs dont la compo a été traitée
        self.sent = set(st.get('sent', []))        # alertes déjà envoyées
        self.last_try = {}

    @staticmethod
    def _read(path, default):
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return default

    def _save_state(self):
        with open(self.state_path, 'w', encoding='utf-8') as f:
            json.dump({'done': sorted(self.done)[-500:], 'sent': sorted(self.sent)[-2000:]}, f)

    def alerts(self):
        with self.lock:
            return self._read(self.alerts_path, [])

    def _add_alert(self, al):
        if al['id'] in self.sent:
            return
        with self.lock:
            lst = self._read(self.alerts_path, [])
            lst = [x for x in lst if x.get('kickoff', 0) > time.time() - 2 * 86400] + [al]
            with open(self.alerts_path, 'w', encoding='utf-8') as f:
                json.dump(lst, f, ensure_ascii=False)
        self.sent.add(al['id'])
        self._save_state()
        hm = time.strftime('%H:%M', time.localtime(al['kickoff']))
        notify(f"Alerte compo · {al['match']} ({hm})", al['text'] + (f" Paris : {', '.join(al['bets'][:3])}" if al['bets'] else ''))

    def _load_selection(self):
        path = os.path.join(self.res_dir, 'dernier.json')
        try:
            m = os.path.getmtime(path)
        except OSError:
            return
        if m != self.sel_mtime:
            self.sel = self._read(path, None)
            self.sel_mtime = m

    def run(self):
        while True:
            try:
                self.tick()
            except Exception as e:  # la surveillance ne doit jamais arrêter le serveur
                print('Surveillance :', e, flush=True)
            time.sleep(60)

    def tick(self):
        self._load_selection()
        if not self.sel:
            return
        now = time.time()
        sel = self.sel
        by_match = {}
        for b in sel.get('top', []):
            by_match.setdefault(b['ai'], []).append(b)
        for ai, bets in by_match.items():
            a = sel['analyses'][ai]
            x = a['match']
            ko = x['ts'] / 1000
            key = f"{a['sport']}|{x['id']}"
            if key in self.done or now > ko + 15 * 60:
                continue
            if a['sport'] == 'soccer' and ko - 75 * 60 <= now:
                if now - self.last_try.get(key, 0) >= 300:
                    self.last_try[key] = now
                    if self.check_soccer(a, bets):
                        self.done.add(key)
                        self._save_state()
            elif a['sport'] == 'tennis' and ko - 60 * 60 <= now:
                if now - self.last_try.get(key, 0) >= 600:
                    self.last_try[key] = now
                    self.check_tennis(a, bets)

    # ---------- Foot ----------
    def lineup(self, lg, event_id):
        d = get_json(f'{ESPN}/soccer/{lg}/summary?event={event_id}')
        out = {}
        for t in d.get('rosters') or []:
            players = {}
            for p in t.get('roster') or []:
                ath = p.get('athlete') or {}
                players[str(ath.get('id'))] = {'name': ath.get('displayName', ''), 'starter': bool(p.get('starter'))}
            if any(v['starter'] for v in players.values()):
                out[str(t['team']['id'])] = players
        return out

    def check_soccer(self, a, bets):
        x = a['match']
        lu = self.lineup(x['lg'], x['id'])
        if len(lu) < 2:
            return False  # composition pas encore publiée : on réessaiera
        name = f"{x['h']['short']} - {x['a']['short']}"
        base = {'match': name, 'match_id': str(x['id']), 'kickoff': x['ts'] / 1000, 'created': time.time()}
        sides = {'h': x['h'], 'a': x['a']}

        # 1) Paris buteur
        for b in bets:
            s = b['settle']
            if s.get('k') != 'scorer':
                continue
            pid = str(s.get('pid'))
            where = next((tid for tid, pl in lu.items() if pid in pl), None)
            if where is None:
                txt = f"{s.get('pn')} n'est pas sur la feuille de match (absent)."
            elif not lu[where][pid]['starter']:
                txt = f"{s.get('pn')} est remplaçant."
            else:
                continue
            self._add_alert({**base, 'id': f"{x['id']}|scorer|{pid}", 'level': 'forte', 'text': txt, 'bets': [b['label']]})

        for side, team in sides.items():
            pl = lu.get(str(team['id']))
            if not pl:
                continue
            hit = [b for b in bets if harmed(b['settle'], side)]
            if not hit:
                continue
            labels = [b['label'] for b in hit]
            # 2) Joueurs clés
            for kp in (a.get('keyPlayers') or {}).get(side, []):
                pid = str(kp['pid'])
                if pid in pl and pl[pid]['starter']:
                    continue
                etat = 'remplaçant' if pid in pl else 'absent'
                txt = f"{kp['pn']} ({round(kp['share'] * 100)} % des buts de {team['short']}) est {etat}."
                self._add_alert({**base, 'id': f"{x['id']}|key|{pid}", 'level': 'forte', 'text': txt, 'bets': labels})
            # 3) Grosse rotation par rapport au match précédent
            # on compare au dernier match de la MÊME compétition (sinon une rotation de coupe fausserait tout)
            forms = [f for f in ((a.get('forms') or {}).get(side) or []) if f.get('lg') == x['lg'] and f.get('id')]
            if forms:
                try:
                    prev = self.lineup(x['lg'], forms[0]['id']).get(str(team['id']))
                except Exception:
                    prev = None
                if prev:
                    now_st = {p for p, v in pl.items() if v['starter']}
                    prev_st = {p for p, v in prev.items() if v['starter']}
                    changes = len(prev_st - now_st)
                    if changes >= 5:
                        txt = f"{team['short']} change {changes} titulaires par rapport à son dernier match (contre {forms[0].get('opp', '?')})."
                        self._add_alert({**base, 'id': f"{x['id']}|rot|{team['id']}", 'level': 'moyenne', 'text': txt, 'bets': labels})
        return True

    # ---------- Tennis ----------
    def check_tennis(self, a, bets):
        x = a['match']
        day = time.strftime('%Y%m%d', time.localtime(x['ts'] / 1000))
        d = get_json(f"{ESPN}/tennis/{x['lg']}/scoreboard?dates={day}")
        for e in d.get('events', []):
            for g in e.get('groupings', []):
                for c in g.get('competitions', []):
                    if str(c.get('id')) != str(x['id']):
                        continue
                    st = (c.get('status', {}).get('type', {}).get('name') or '').upper()
                    if any(w in st for w in ('WALKOVER', 'CANCEL', 'FORFEIT', 'WITHDRAW', 'POSTPONED')):
                        p = x['players']
                        self._add_alert({'id': f"{x['id']}|wo", 'match': f"{p[0]['name']} - {p[1]['name']}", 'match_id': str(x['id']),
                                         'kickoff': x['ts'] / 1000, 'created': time.time(), 'level': 'forte',
                                         'text': "Forfait ou match annulé : le pari sera en général annulé et remboursé.",
                                         'bets': [b['label'] for b in bets]})
                        self.done.add(f"tennis|{x['id']}")
                        self._save_state()
                    return


if __name__ == '__main__':
    # Version en ligne (GitHub) : un seul passage, lancé toutes les 15 minutes par l'automatisation
    import sys
    os.environ.setdefault('TZ', 'Europe/Paris')
    w = Watcher(os.path.dirname(os.path.abspath(__file__)))
    if '--une-fois' in sys.argv:
        w.last_try = {}
        w.tick()
