# PROGRESS — Feuille du jour (nom provisoire)

## État : V1 fonctionnelle et testée (2026-11-06)

## Structure
- `index.html` + `css/style.css` : interface (Sélection, Combinés, Matchs, Historique, Réglages).
- `js/config.js` : compétitions, coefficients de championnat, derbys, surfaces tennis, réglages.
- `js/core.js` : stockage IndexedDB, maths (Poisson, binomiale négative, loi normale), dates.
- `js/data.js` : téléchargement ESPN + cache (clé préfixée `v2|`, à changer si le format évolue).
- `js/soccer.js`, `js/tennis.js`, `js/basket.js` : modèles et vérification des résultats.
- `js/engine.js` : orchestration, top 100, combinés, historique.
- `Lancer.bat` : ouverture via un petit serveur local (python) si besoin.

## Fait
- Source gratuite ESPN validée (sans clé, CORS ouvert). Requêtes : `dates=AAAA&limit=1000` (foot),
  `dates=AAAAMM` (tennis, NBA), `dates=AAAAMMJJ` (jour).
- Foot : Poisson pondéré + Dixon-Coles, dom/ext, corners/cartons (binomiale négative), buteurs,
  revenants, trous d'air (saisons passées), enjeu de fin de saison, fatigue, trêve, derbys, séries,
  surprises par journée + matchs pièges.
- Tennis : Elo global + surface, face-à-face, fatigue, modèle jeu par jeu (sets, jeux, handicaps).
- NBA : forces att/déf, dos-à-dos, blessés, écart/total en loi normale.
- Cote juste minimale réglable (défaut 1,15) ; max 2 paris par match (assoupli si < 100).
- Backtest 6 semaines (foot 466 matchs, tennis 1491, NBA 107) : bien calibré
  (ex. foot 74,7 % annoncé / 77 % réel ; tennis 87 % / 87,6 %).
- Correctif : saisons ESPN identifiées par année + slug (certaines ligues : « regular-season »).

## Données ouvertes (2026-11-06, V1.1)
- `serveur.py` (Python standard) : sert l'app + /api/fd (football-data.co.uk), /api/fd-fixtures, /api/tm
  (résumé Transfermarkt construit une fois dans `cache/`, ~55 Mo de fichiers bruts). Lancer.bat l'utilise.
- `js/extras.js` : liaison des noms par date + score ; xG, arbitres (Angleterre/Écosse), cotes moyennes,
  revenants Transfermarkt confirmés par l'effectif ESPN (roster).
- Cotes du jour ESPN (DraftKings) en secours si football-data n'a pas publié (marché sur 16/19 matchs testés).
- Backtest : bookmakers poids 0,7 → Brier 1N2 0,580 → 0,567 ; xG poids 0,5 → léger gain. Réglés dans soccer.js (XGW, MKW).

## Euroligue + EuroCup (2026-11-06, V1.2)
- API officielle publique `api-live.euroleague.net/v1/schedules|results?seasonCode=E2026|U2026` (XML, 3 saisons).
- Autorisation navigateur (CORS) instable côté Euroligue → passage par `serveur.py` (/api/euro), lecture directe en secours.
- Heures données en heure d'Europe centrale. Pas de score par quart-temps → pas de paris mi-temps.
- Backtest 6 semaines : Euroligue 66,6 % annoncé / 66,8 % réel (60-75 %), EuroCup légèrement prudente.

## Test à l'aveugle (2026-11-06, V1.3)
- Boutons « Avant-hier » / « Hier » : l'app se place au jour J à 6 h, n'utilise que les matchs joués avant
  (cotes d'avant-match archivées football-data, pas d'effectifs ni de blessés actuels), puis note la sélection.
- Résultats : 5/11 → 79/100 (79 % réel / 83 % annoncé) ; 6/11 → 86/99 (87 % / 84 %).
- App déplacée sur le Bureau (OneDrive) : `Feuille du jour`. `serveur.py [port]` refuse un port déjà pris.

## Analyse automatique + compositions (2026-11-06, V1.4)
- Tâches Windows (installer-tache.ps1 / desinstaller-tache.ps1) : « analyse 00h10 » (quotidienne, réveil du PC,
  rattrapage si manquée) et « ouverture de session » (auto.py --si-besoin).
- auto.py : démarre serveur.py caché (pythonw), ouvre l'app dans Edge invisible (?auto=1, profil `profil-auto/`),
  attend resultats/dernier.json, notification Windows. Journal : resultats/auto.log.
- ESPN refuse les navigateurs invisibles (403) → en mode auto, requêtes ESPN relayées par /api/espn.
- Toute analyse (auto ou manuelle) est enregistrée sur le serveur ; l'app la recharge à l'ouverture.
- surveillance.py (dans le serveur) : compo ESPN (summary, ~1 h avant), alerte seulement si un pari est touché :
  buteur remplaçant/absent, joueur clé (≥ 30 % des buts) remplaçant/absent + pari qui compte sur son équipe,
  ≥ 5 titulaires changés vs dernier match de la même compétition, forfait tennis. Pas de doublon.
- Alertes : notification Windows + bandeau dans l'app (/api/alerts). Basket : pas de surveillance des compos.

## Version en ligne GitHub (2026-11-06, V1.5)
- Dépôt public github.com/vinc-bou/feuille-du-jour (identité git anonyme noreply), page :
  https://vinc-bou.github.io/feuille-du-jour/ (lit en-ligne/dernier.json et en-ligne/alertes.json).
- Workflows : analyse.yml (cron 22:10 et 23:10 UTC, ne tourne que s'il est 00-01 h à Paris ; Chrome invisible ;
  cache actions pour cache/ et profil-auto/), compos.yml (toutes les 15 min, seulement si un match de la
  sélection est dans 80 min). Résultats en ligne dans en-ligne/ (FEUILLE_RESULTATS), jamais dans resultats/.
- Alertes téléphone : application ntfy, sujet dans le secret NTFY_TOPIC (copie locale non publiée :
  abonnement-ntfy.txt). Premier essai sur GitHub : 100 paris, 44 matchs en 58 s, ESPN accepte GitHub.
- Fichiers de l'app versionnés (?v=5 dans index.html) : augmenter à chaque mise à jour.

## Tous les matchs des bookmakers : API-Football gratuit (2026-11-06, V1.6)
- Clé dans le secret GitHub APIFOOTBALL_KEY (jamais en clair). Formule Free : 100 req/jour/sport, 10/min,
  dates hier-aujourd'hui-demain seulement, saison en cours bloquée pour classements/historique,
  odds?date limité à 3 pages (30 matchs) ; odds?fixture OK ; quota remis à 0 h UTC.
- collecte_api.py (avant l'analyse de nuit) : foot = matchs du jour + 3 pages de cotes + ~80 cotes match par
  match (priorité : non couverts par ESPN, D1, pays européens, sans jeunes/réserves) ; basket, hockey, handball,
  volley, rugby = matchs du jour + cotes match par match (compétitions prioritaires). Probabilités = moyenne
  des bookmakers marge retirée (Pinnacle ×3). Sortie privée cache/api/AAAAMMJJ.json (non publiée, conditions
  API) + en-ligne/scores-api.json (scores, pour l'historique).
- js/marche.js : analyses « marché » pour les matchs non analysés en détail ; Pinnacle sert aussi d'avis du
  marché pour les matchs ESPN. Test 06/11 : 108 matchs analysés (44 avant), 6 sports.
- PC sans clé : pas de données marché en local ; l'app du PC affiche la version en ligne si plus complète.

## Tri et filtre de cotes (2026-11-06, V1.7)
- Sélection : tri au choix (fiabilité, heure, cote ↑/↓, sport, compétition, confiance, type) par liste ou clic
  sur les titres de colonnes ; fourchette de cotes (dès / jusqu'à) = nouveau top 100 dans la fourchette, pris
  parmi tous les paris (30 par match gardés dans l'analyse enregistrée). Combinés : tri + fourchette.
- Attention aux apostrophes dans les chaînes JS (utiliser ’) ; vérifier avec `node -e "new Function(...)"`.

## Explications, recherche, grosses cotes (2026-11-06, V1.8)
- Tri : clic sur une colonne = tri, 2e clic = ordre inverse (flèche ▼/▲) ; la liste propose les deux sens.
- js/pourquoi.js (App.why) : paragraphe « Pourquoi ce pari » (buts attendus, chances 1N2, forme, classement,
  bookmakers, contexte, cote mini) affiché dans le détail ; enregistré dans l'historique avec les facteurs et l'heure.
- Historique : clic sur un pronostic = heure de publication + explication + analyse.
- Barre de recherche fixe en haut : équipe, joueur, compétition, date (7/11, 7 novembre, samedi, hier).
- Combinés grosse cote 5 / 10 / 15 (engine.hardCombos) : version sûre (paris les plus fiables) et courte
  (cotes 1,40-2,30), 1 pari par match, 2 matchs max par championnat ; suivis dans l'historique (kind 'hard').

## Filtre « jamais sur Winamax » (2026-11-06, V1.9)
- Exclus (collecte_api.hors_winamax + marche.js horsWinamax/exclu, aussi sur les analyses déjà enregistrées) :
  pays Russia / Belarus (ANJ depuis 2022, KHL et VTB retirés des priorités), jeunes et réserves (U15-U23, Sub-20,
  Youth, Junior, Primavera, Reserve). Attention : pas de  dans un heredoc Python non brut (devient ).

## Cotes basses, direct, heures tennis (2026-11-06, V1.10)
- Cote mini par défaut 1,03 (Winamax propose 1,01-1,03) ; filtres « Cote dès » dès 1,01. Grosses cotes : legs ≥ 1,15.
- Bloc « En direct » (Sélection) : pronostics dont le match a commencé (< 6 h), score + minute ESPN chaque minute
  (engine.live), Gagné/Perdu à la fin ; une nouvelle analyse garde les matchs commencés (r.started).
  Marché (API-Football) : score non suivi en direct. Matchs suspendus/reportés jamais réglés (engine.paused).
- Tennis : heure « ≈ » (ESPN donne l'heure estimée ; le match suit le précédent sur le court).

## Onglet En direct + paris joués (2026-11-06, V1.11)
- Onglet « En direct » (le bloc quitte la Sélection, lien rappel) ; option « seulement mes paris joués ».
- Case « Joué » (Sélection, Combinés, grosses cotes) : engine.togglePlayed → entrée d'historique played:true
  (créée avec extra:true si hors top 100 ; extra exclu des stats de la sélection, jamais supprimée par saveHistory).
  Filtre « Mes paris joués » ; Historique : bloc « Mes paris joués » (taux réel, combinés). Stocké par appareil.

## Bilans, calendrier, portefeuille + retards GitHub (2026-11-07, V1.12)
- 7/11 : crons GitHub retardés de 3 h → analyse sautée (contrôle « minuit »). analyse.yml : crons de secours
  jusqu'à 4 h 25 UTC, lance si 0-7 h Paris et en-ligne/AAAAMMJJ.json absent ; workflow_dispatch toujours.
- Historique refait : Hier / semaine / mois / année / depuis le début (texte simple + barre empilée + SVG par
  sport, fiabilité, type, jour par jour), calendrier mensuel cliquable, « Mes paris joués » par période.
- Portefeuille simulé (kv 'wallet') : capital, mise fixe ou %, Top 10/20/50/100 ou mes paris, cote = cote mini
  − marge (0-8 %) ; courbe du solde, bilan par jour. Combinés non comptés.

## Sources étudiées et écartées (2026-11-06)
- API-Football (blessés, entraîneurs) : gratuit avec compte + clé personnelle → proposé, non intégré.
- Archive tennis Sackmann (miroir) : arrêtée au 25/06/2026. TML-Database : 2026 incomplet. ClubElo : en panne.

## Limites connues
- Pas d'Euroligue / Betclic Élite (absentes de la source), pas de changement d'entraîneur (aucune source
  gratuite à jour : Transfermarkt arrêté au 6/07/2026), arbitres seulement Angleterre/Écosse,
  pas de compositions, pas de cotes Winamax. Tennis : pas de source ouverte joignable (JeffSackmann introuvable).
- Accès téléphone : nécessite d'héberger les fichiers (ex. GitHub Pages, gratuit) — non fait.

## À faire / idées
- Nom définitif de l'app.
- Hébergement gratuit pour le téléphone.
- Suivre l'historique réel quelques semaines puis réajuster les modèles.
