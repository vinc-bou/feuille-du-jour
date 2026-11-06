"""Analyse automatique de la Feuille du jour (lancée par la tâche planifiée Windows à 00 h 10).

1. Démarre le serveur local en arrière-plan s'il ne tourne pas déjà (il héberge aussi la surveillance des compositions).
2. Ouvre l'app dans un navigateur invisible (Edge, sinon Chrome) en mode automatique.
3. Attend que l'analyse soit enregistrée (resultats/dernier.json), ferme le navigateur, envoie une notification.

Option --si-besoin : ne fait l'analyse que si celle du jour n'existe pas encore (utilisé à l'ouverture de session).
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('FEUILLE_PORT', '8765'))
URL = f'http://localhost:{PORT}'
RES = os.path.join(ROOT, os.environ.get('FEUILLE_RESULTATS', 'resultats'))
LOG = os.path.join(RES, 'auto.log')
WINDOWS = os.name == 'nt'
BROWSERS = [
    os.path.expandvars(r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe'),
    os.path.expandvars(r'%ProgramFiles%\Microsoft\Edge\Application\msedge.exe'),
    os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
    os.path.expandvars(r'%LocalAppData%\Google\Chrome\Application\chrome.exe'),
] if WINDOWS else [shutil.which(n) or '' for n in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser')]
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def log(msg):
    os.makedirs(RES, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')


def ping():
    try:
        with urllib.request.urlopen(URL + '/api/ping', timeout=3) as r:
            return r.read() == b'ok'
    except Exception:
        return False


def ensure_server():
    if ping():
        return True
    pyw = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    exe = pyw if os.path.exists(pyw) else sys.executable
    if WINDOWS:
        flags = NO_WINDOW | getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        for extra in (0x01000000, 0):  # CREATE_BREAKAWAY_FROM_JOB : le serveur survit à la fin de la tâche planifiée
            try:
                subprocess.Popen([exe, os.path.join(ROOT, 'serveur.py')], cwd=ROOT, creationflags=flags | extra,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
                break
            except OSError:
                continue
    else:
        subprocess.Popen([exe, os.path.join(ROOT, 'serveur.py')], cwd=ROOT, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        time.sleep(0.5)
        if ping():
            return True
    return False


def day_key():
    """Clé de la journée de paris analysée à cette heure-ci (même règle que l'app : de 6 h à 6 h)."""
    t = time.localtime()
    base = time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 6, 0, 0, 0, 0, -1))
    # avant 6 h : l'app analyse la journée qui commence à 6 h aujourd'hui
    return time.strftime('%Y%m%d', time.localtime(base))


def already_done():
    p = os.path.join(RES, 'dernier.json')
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)['W']['key'] == day_key()
    except Exception:
        return False


def toast(title, text):
    try:
        sys.path.insert(0, ROOT)
        from surveillance import notify
        notify(title, text)
    except Exception:
        pass


def main():
    if '--si-besoin' in sys.argv and already_done():
        ensure_server()
        return
    if not ensure_server():
        log('Serveur impossible à démarrer.')
        toast('Feuille du jour', "Analyse automatique impossible : le serveur local n'a pas démarré.")
        return
    browser = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not browser:
        log('Aucun navigateur Edge/Chrome trouvé.')
        return
    profile = os.path.join(ROOT, 'profil-auto')
    p_dernier = os.path.join(RES, 'dernier.json')
    before = os.path.getmtime(p_dernier) if os.path.exists(p_dernier) else 0
    start = time.time()
    log(f'Analyse automatique : lancement ({os.path.basename(browser)}).')
    args = [browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            f'--user-data-dir={profile}', f'{URL}/?auto=1']
    if not WINDOWS:
        args.insert(1, '--no-sandbox')  # nécessaire sur les serveurs Linux de GitHub
    proc = subprocess.Popen(args, creationflags=NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = False
    while time.time() - start < 25 * 60:  # la toute première fois, l'historique complet est téléchargé
        time.sleep(5)
        if os.path.exists(p_dernier) and os.path.getmtime(p_dernier) > before:
            ok = True
            break
        if os.path.exists(os.path.join(RES, 'erreur-auto.txt')) and os.path.getmtime(os.path.join(RES, 'erreur-auto.txt')) > start:
            break
    time.sleep(3)
    # ferme le navigateur invisible et tous ses sous-processus
    if WINDOWS:
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], creationflags=NO_WINDOW,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.kill()
    if '--quitter-serveur' in sys.argv:  # version en ligne : on n'a plus besoin du serveur après l'analyse
        try:
            urllib.request.urlopen(URL + '/api/stop', timeout=3)
        except Exception:
            pass
    if ok:
        try:
            with open(p_dernier, encoding='utf-8') as f:
                d = json.load(f)
            n, m = len(d.get('top', [])), len(d.get('analyses', []))
        except Exception:
            n = m = 0
        log(f'Analyse terminée en {round(time.time() - start)} s : {n} paris, {m} matchs.')
        toast('Feuille du jour', f'Analyse du jour prête : {n} paris sur {m} matchs. Surveillance des compositions active.')
    else:
        log('Analyse non terminée (délai dépassé ou erreur, voir erreur-auto.txt).')
        toast('Feuille du jour', "L'analyse automatique n'a pas abouti. Ouvrez l'app et cliquez sur Analyser.")


if __name__ == '__main__':
    main()
