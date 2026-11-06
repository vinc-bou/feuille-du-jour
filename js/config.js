/* Configuration : compétitions, coefficients, derbys, surfaces. */
window.App = window.App || {};

App.config = {
  // Football : coef = niveau relatif du championnat (sert aux matchs entre championnats)
  soccer: [
    { id: 'fra.1', name: 'Ligue 1', country: 'France', type: 'league', coef: 0.90, on: true },
    { id: 'eng.1', name: 'Premier League', country: 'Angleterre', type: 'league', coef: 1.00, on: true },
    { id: 'esp.1', name: 'LaLiga', country: 'Espagne', type: 'league', coef: 0.96, on: true },
    { id: 'ita.1', name: 'Serie A', country: 'Italie', type: 'league', coef: 0.95, on: true },
    { id: 'ger.1', name: 'Bundesliga', country: 'Allemagne', type: 'league', coef: 0.94, on: true },
    { id: 'por.1', name: 'Liga Portugal', country: 'Portugal', type: 'league', coef: 0.84, on: true },
    { id: 'ned.1', name: 'Eredivisie', country: 'Pays-Bas', type: 'league', coef: 0.83, on: true },
    { id: 'bel.1', name: 'Pro League', country: 'Belgique', type: 'league', coef: 0.80, on: true },
    { id: 'tur.1', name: 'Süper Lig', country: 'Turquie', type: 'league', coef: 0.78, on: true },
    { id: 'sco.1', name: 'Premiership', country: 'Écosse', type: 'league', coef: 0.72, on: true },
    { id: 'fra.2', name: 'Ligue 2', country: 'France', type: 'league', coef: 0.70, on: true },
    { id: 'eng.2', name: 'Championship', country: 'Angleterre', type: 'league', coef: 0.78, on: true },
    { id: 'esp.2', name: 'LaLiga 2', country: 'Espagne', type: 'league', coef: 0.72, on: false },
    { id: 'ita.2', name: 'Serie B', country: 'Italie', type: 'league', coef: 0.70, on: false },
    { id: 'ger.2', name: '2. Bundesliga', country: 'Allemagne', type: 'league', coef: 0.74, on: false },
    { id: 'gre.1', name: 'Super League', country: 'Grèce', type: 'league', coef: 0.74, on: false },
    { id: 'aut.1', name: 'Bundesliga', country: 'Autriche', type: 'league', coef: 0.74, on: false },
    { id: 'den.1', name: 'Superliga', country: 'Danemark', type: 'league', coef: 0.72, on: false },
    { id: 'usa.1', name: 'MLS', country: 'États-Unis', type: 'league', coef: 0.72, on: false },
    { id: 'bra.1', name: 'Série A', country: 'Brésil', type: 'league', coef: 0.80, on: false },
    { id: 'arg.1', name: 'Liga Profesional', country: 'Argentine', type: 'league', coef: 0.76, on: false },
    { id: 'mex.1', name: 'Liga MX', country: 'Mexique', type: 'league', coef: 0.74, on: false },
    { id: 'ksa.1', name: 'Saudi Pro League', country: 'Arabie saoudite', type: 'league', coef: 0.70, on: false },
    { id: 'uefa.champions', name: 'Ligue des champions', country: 'Europe', type: 'euro', on: true },
    { id: 'uefa.europa', name: 'Ligue Europa', country: 'Europe', type: 'euro', on: true },
    { id: 'uefa.europa.conf', name: 'Ligue Conférence', country: 'Europe', type: 'euro', on: true },
    { id: 'fra.coupe_de_france', name: 'Coupe de France', country: 'France', type: 'cup', on: true },
    { id: 'eng.fa', name: 'FA Cup', country: 'Angleterre', type: 'cup', on: true },
    { id: 'eng.league_cup', name: 'League Cup', country: 'Angleterre', type: 'cup', on: true },
    { id: 'esp.copa_del_rey', name: 'Coupe du Roi', country: 'Espagne', type: 'cup', on: true },
    { id: 'ita.coppa_italia', name: 'Coupe d\'Italie', country: 'Italie', type: 'cup', on: true },
    { id: 'ger.dfb_pokal', name: 'Coupe d\'Allemagne', country: 'Allemagne', type: 'cup', on: true },
  ],
  tennis: [
    { id: 'atp', name: 'ATP', on: true },
    { id: 'wta', name: 'WTA', on: true },
  ],
  basket: [
    { id: 'nba', name: 'NBA', on: true },
    { id: 'euroleague', name: 'Euroligue', on: true },
    { id: 'eurocup', name: 'EuroCup', on: true },
    { id: 'wnba', name: 'WNBA', on: false },
  ],

  // Années d'historique foot (années civiles) et mois d'historique tennis
  soccerYears: 4,
  tennisMonths: 24,
  nbaSeasons: 2,

  // Derbys / rivalités (noms ESPN, sans accent, en minuscules, contenus dans le nom)
  derbies: [
    ['paris saint-germain', 'marseille'], ['lyon', 'saint-etienne'], ['marseille', 'lyon'],
    ['nice', 'monaco'], ['lens', 'lille'], ['rennes', 'nantes'], ['bordeaux', 'toulouse'],
    ['real madrid', 'barcelona'], ['real madrid', 'atletico'], ['sevilla', 'real betis'],
    ['barcelona', 'espanyol'], ['athletic club', 'real sociedad'], ['valencia', 'villarreal'],
    ['manchester united', 'manchester city'], ['liverpool', 'everton'], ['liverpool', 'manchester united'],
    ['arsenal', 'tottenham'], ['chelsea', 'tottenham'], ['arsenal', 'chelsea'], ['newcastle', 'sunderland'],
    ['inter milan', 'ac milan'], ['internazionale', 'ac milan'], ['roma', 'lazio'], ['juventus', 'torino'],
    ['juventus', 'internazionale'], ['napoli', 'roma'], ['genoa', 'sampdoria'],
    ['bayern', 'borussia dortmund'], ['schalke', 'borussia dortmund'], ['hamburg', 'werder'], ['cologne', 'monchengladbach'],
    ['benfica', 'sporting'], ['porto', 'benfica'], ['ajax', 'feyenoord'], ['ajax', 'psv'], ['psv', 'feyenoord'],
    ['celtic', 'rangers'], ['galatasaray', 'fenerbahce'], ['besiktas', 'galatasaray'], ['fenerbahce', 'besiktas'],
    ['club brugge', 'anderlecht'], ['standard', 'anderlecht'], ['olympiacos', 'panathinaikos'],
    ['boca juniors', 'river plate'], ['flamengo', 'fluminense'], ['corinthians', 'palmeiras'],
  ],

  // Surfaces tennis (mots-clés dans le nom du tournoi)
  clay: ['roland', 'french open', 'monte', 'madrid', 'rome', 'internazionali', 'italian open', 'barcelona',
    'hamburg', 'rio', 'buenos aires', 'santiago', 'estoril', 'geneva', 'lyon', 'bastad', 'nordea', 'gstaad',
    'umag', 'croatia', 'kitzbuhel', 'bucharest', 'marrakech', 'houston', 'cordoba', 'munich', 'bmw open',
    'parma', 'rabat', 'charleston', 'bogota', 'palermo', 'prague', 'warsaw', 'iasi', 'budapest', 'portoroz',
    'hungarian', 'tiriac', 'grand prix hassan', 'swedish open', 'generali open', 'swiss open', 'credit one'],
  grass: ['wimbledon', 'halle', 'queen', 'hertogenbosch', 'libema', 'eastbourne', 'mallorca', 'nottingham',
    'birmingham', 'bad homburg', 'newport', 'hall of fame', 'terra wortmann', 'cinch', 'lexus', 'rothesay'],
  grassJuneOnly: ['stuttgart', 'berlin'],
  slams: ['australian open', 'roland garros', 'french open', 'wimbledon', 'us open'],

  // Réglages par défaut (modifiables dans l'onglet Réglages)
  settings: {
    maxPerMatch: 2,   // paris max par match dans le top 100
    minOdd: 1.03,     // on écarte les paris dont la cote juste est trop basse (injouables chez le bookmaker)
    topN: 100,
  },
};
