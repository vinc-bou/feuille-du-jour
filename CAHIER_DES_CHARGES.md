# Cahier des charges — App de pronostics sportifs (usage perso)

## Objectif
Chaque jour, analyser les matchs des compétitions proposées par Winamax et afficher
un **top 100 des paris les plus fiables**, du plus fiable au moins fiable, dans un
tableau clair. 100 % gratuit.

## Périmètre
- **Sports** : football, tennis, basket.
- **Compétitions** : liste fixe de celles proposées par Winamax (modifiable).
- **Paris** : catalogue Winamax complet (pas seulement 1N2 / +/- buts / buteur).
- **Pas de lecture du site Winamax** : pas de cotes Winamax dans l'app.
- **Données** : source publique gratuite, sans clé ni inscription.

## Affichage
- Top 100 des paris simples, sans seuil minimum de fiabilité.
- Combinés de 2 ou 3 paris, sur des matchs différents uniquement.
- Pour chaque pari : fiabilité (%), cote minimale conseillée (1 ÷ probabilité),
  indice de confiance, étiquette « match piège » si besoin.
- Filtres : sport, compétition, type de pari, heure du match.
- Bouton « Analyser ». Historique avec le taux de réussite réel par sport et par type de pari.
- PC et téléphone.
- **Style : ne doit pas faire « IA ».** Style stats sportives ou journal sportif :
  tableaux denses, logos réels, fond sombre neutre, une seule couleur d'accent,
  pas d'emojis, pas de dégradés violets, textes courts façon parieur.

## Critères d'analyse

### Football
- 10 à 20 derniers matchs, séparés domicile / extérieur.
- Buts marqués et encaissés par mi-temps ; tirs, tirs cadrés, possession, corners, cartons, fautes.
- Classement et enjeu (titre, Europe, maintien, équipe déjà sauvée ou reléguée).
- Confrontations directes.
- Calendrier chargé et fatigue (coupe d'Europe, retour de trêve internationale).
- Modèle de buts (Poisson pondéré par la récence) → 1N2, double chance, remboursé si nul,
  +/- buts, buts par équipe, les deux équipes marquent, mi-temps et fin de match,
  handicaps, score exact.
- Corners et cartons : moyennes des équipes et de leurs adversaires (+ arbitre si dispo).
- Classement des buteurs : buteurs probables, dépendance au meilleur buteur, séries.
- Ancien joueur face à son ancien club (comparaison des effectifs entre saisons) : bonus.
- Trous d'air ou périodes fortes répétés sur 3 à 5 saisons (points par match par mois),
  réduits si l'entraîneur a changé.
- Effet « nouvel entraîneur ». Derbys et rivalités. Séries en cours.

### Tennis
- Classement ATP ou WTA, forme récente, résultats par surface, confrontations directes,
  fatigue, format du match.
- Classement de force par surface (type Elo) → vainqueur, nombre de sets, score en sets,
  vainqueur du 1er set, +/- jeux, handicap de jeux.

### Basket
- Forme récente, points marqués et encaissés, rythme de jeu, domicile ou extérieur,
  matchs deux soirs de suite, blessés (NBA).
- Estimation du score → vainqueur, handicap, total de points, total par équipe,
  quart-temps et mi-temps.

### Surprise de la journée
- Nombre moyen de favoris battus par journée et par championnat (saisons passées).
- Affichage du nombre de surprises attendues ce jour-là.
- Repérage des matchs pièges (favoris fragiles).
- Combinés : ne pas empiler trop de favoris d'un même championnat le même jour.

## Limites connues
- Pas de compositions officielles ni de météo.
- Buteurs et score exact moins fiables.
- Moins de données sur les compétitions secondaires : paris souvent déclassés.
- Aucun gain garanti.
