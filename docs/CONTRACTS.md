# KYRON V1 — contrats entre modules

Application web statique, **sans étape de build** : modules ES natifs, servis tels quels (publication en Artifact claude.ai et GitHub Pages). Tout tourne dans le navigateur, aucune vidéo n'est envoyée.

Contraintes d'hébergement (CSP de l'Artifact) :
- aucun `fetch` vers un autre domaine ; tout fichier chargé (modèle, wasm, worker) est un fichier du dossier `app/` chargé en URL relative ;
- scripts externes uniquement depuis cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com (version exacte) ; polices via Google Fonts ;
- extensions servies : .html .css .js .mjs .wasm .json .svg .png… (le modèle de pose est donc `models/pose_model.wasm`) ;
- Web Workers en module autorisés depuis un fichier du dossier (`new Worker(new URL('./core/x.js', import.meta.url), {type:'module'})`) ;
- pas de `alert/confirm/prompt`, pas de téléchargement par lien ; le stockage local est optionnel (try/catch).

Conventions : coordonnées monde en mètres, **y vers le haut**, origine au centre des hanches (MediaPipe world, y et z inversés à l'ingestion). Images : `{t, img:[33 {x,y,v}] normalisés 0–1, world:[33 {x,y,z}]}`. Angles en degrés dans les API publiques. Tout le texte visible est en français.

## Fichiers et propriétaires

| Fichier | Propriétaire | Rôle |
|---|---|---|
| `app/core/engine.js` | Agent analyse | Analyse biomécanique d'une frappe (existe, à enrichir) |
| `app/core/session.js` | Agent analyse | Analyse d'une séance entière, classification des coups, fatigue, qualité de prise |
| `app/core/ball.js` | Agent analyse | Suivi de balle dans la vidéo, vitesse et angle de départ |
| `app/core/sync.js` | Agent analyse | Synchronisation de deux vidéos (multi-caméras) et fusion 3D simple |
| `app/core/physics.js` | Agent simulation | Raquette, cordage, impact, trajectoire (existe, à enrichir) |
| `app/core/optimizer.js` + `app/core/opt-worker.js` | Agent simulation | Optimisation massive multi-workers |
| `app/index.html`, `app/ui/*.js`, `app/ui/*.css` | Agent application | L'application complète |
| `app/core/demo.js` | Agent analyse | Données de démonstration (service ; ajouter coup droit et revers) |

Ne modifiez pas les fichiers d'un autre propriétaire ; si un contrat doit changer, ajoutez-le en compatibilité ascendante et notez-le dans votre rapport.

## Contrat — analyse (engine.js, session.js, ball.js, sync.js)

```js
// engine.js (existant, conserver ces exports et leur forme)
analyze(frames, { stroke: 'serve'|'forehand'|'backhand', hand: 'right'|'left', source: 'demo'|'video', impactIdx? }) → res
// res existant : { stroke, hand, fps, n, impact, phases[], sequence[], gaps[], inOrder, metrics{}, items[], score, findings[], exercises[], camera[], series{}, simInput{} }
// À AJOUTER dans res (champs optionnels, jamais de rupture) :
//   res.metrics.shoulderElev / shoulderAbdH / shoulderRotExt (°, à l'armé) et shoulderIRVel (°/s, pic de rotation interne)
//   res.metrics.comShift (m, transfert du centre de masse arrière→avant), res.metrics.balance (0–1 à l'impact)
//   res.metrics.tossApex (m au-dessus du sol, service), res.metrics.tossForward (m devant le pied avant)
//   res.series.com : [{x,y,z}] par image
//   res.confidence : 0–1 (confiance globale de la mesure)
detectStrokes(frames, hand) → [{ idx, t, speed }]
LM, BONES, REFS, EXERCISES, SIM_SOURCE   // inchangés

// session.js
classifyStroke(frames, hand) → { type: 'serve'|'forehand'|'backhand'|'volley'|'smash', conf }
qualityScore(frames, meta = { width, height, duration }) → { score: 0–100, fps, issues: [{ key, label, detail }] }
analyzeSession(allFrames, { hand, forceStroke? }) → {
  strokes: [{ i, t, type, conf, frames, res }],   // res = analyze(...) de la frappe
  fatigue: { slopePct, metric, alert: bool, detail },  // dérive de la vitesse sur la séance
  summary: { count, byType: { serve: n, ... }, bestIdx, meanScore }
}

// ball.js — suivi de balle sans réseau : couleur jaune-vert + différence d'images + filtre de Kalman
createBallTracker({ width, height }) → { push(t, imageData), result() → { track: [{ t, x, y, r, conf }], fps } }
estimateBallFlight(track, res, { heightM }) → { speedKmh, launchDeg, conf, points } | null   // échelle métrique via la taille du joueur

// sync.js
syncByWrist(framesA, framesB, hand) → { offset /* s à ajouter à B */, corr }
fuseViews(framesA, framesB, offset) → frames   // moyenne pondérée par la visibilité, profondeur améliorée
```

## Contrat — simulation (physics.js, optimizer.js)

```js
// physics.js (existant ; conserver les exports actuels)
RACKETS, LEAD_SPOTS, STRINGS, SURFACES, COURT, BALL
customize(racket, leads) → rk ; effectiveMass(rk, cm) ; bedStiffness(rk, s, T, gauge) ; tensionAfter(s, T0, days, hours)
impact({ rk, string, tension, gauge, V, alpha, phi, u, impactCm, offCenter }) → { speed, spinRpm, launch, eA, tContact, peakForce, comfort, ... }
airDensity(alt, tempC, hum) ; flight({...}) ; isIn(res, target) ; successRate(...) ; bestAngle(...) ; recommendStrings(base, goal)

// optimizer.js
runOptimization({
  res,                     // résultat d'analyze (ou null : profil par défaut selon stroke)
  stroke,                  // 'serve'|'forehand'|'backhand'
  equipment: { racket, leads, string, tension, gauge, days, hours },
  conditions: { alt, temp, wind, surface },
  goal: 'speed'|'spin'|'safety'|'balanced',
  budget: 'quick'|'full'|'max',   // ≈ 1 M / 10 M / 50 M évaluations
  onProgress: ({ p, trials, trialsPerSec, best }) => void,
  signal                   // AbortSignal
}) → Promise<{
  trials, ms, workers,
  current:  { racketKmh, ballKmh, spinRpm, successRate },
  best:     { params: { kneeFlex, separation, elbowImpact, contactRatio, d1, d2, d3, alphaDeg, phiDeg, launchDeg }, ballKmh, spinRpm, successRate, gainPct },
  sensitivity: [{ key, label, gainPct, unit, from, to }],     // trié décroissant
  equipment: { best: { racket, leads, string, tension, gauge, ballKmh, spinRpm, successRate }, gainPct },
  frontier: [{ ballKmh, successRate, launchDeg }],            // vitesse ↔ sécurité
  cloud: Float32Array                                          // échantillon ≤ 4000 points [ballKmh, successRate, ...] pour un nuage de points
}>
```

## Contrat — application (index.html)

Onglets : **Séance** (filmer / importer 1 ou 2 vidéos, analyse, frappes, verdict), **Optimiseur** (millions d'essais), **Matériel** (raquette, plombs, cordage, recommandation), **Balle** (trajectoire, rebond, marge), **Progression** (historique, objectifs), **Coach** (questions en langage naturel sur la séance). Bascule **Simple / Avancé** globale. Quand une vidéo est analysée, l'optimiseur se lance automatiquement en arrière-plan (budget « full »).

DA : noir, blanc, orange `#FF4D1A` uniquement sur les articulations et les points d'attention ; titres Michroma, texte IBM Plex Sans, données IBM Plex Mono ; symbole « Actuateur » (voir `app/ui/brand.svg`). Sobre, précis, instrument de labo.
