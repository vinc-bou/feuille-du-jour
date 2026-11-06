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
