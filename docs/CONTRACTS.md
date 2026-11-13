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

## Vague 2 — simulation

Propriétaire : agent simulation. Tous les modules sont des ES modules purs (sans DOM), testés par `node tests/sim.test.mjs` et `node tests/wave2-sim.test.mjs`.

### Précisions sur la vague 1 (optimizer.js, compatibles)

- `cloud` : `Float32Array` de pas **`cloudStride = 4`**, champs **`cloudFields = ['ballKmh', 'successRate', 'spinRpm', 'shoulderLoad']`** (`shoulderLoad` = rotation interne estimée / seuil, 0–1).
- `best.gainPct` dépend de l'objectif : `speed` → % de km/h ; `spin` → (effet − effet actuel) / max(1 500, effet actuel) en % ; `safety` → gain relatif de taux de réussite ; `balanced` → score composite × 100. Les gains détaillés sont dans `best.gains = { speedPct, spinPct, successPts, shoulderLoadPct }`.
- Champs ajoutés : `trialsPerSec`, `current/best.successSurrogate` (probabilité du modèle de substitution, `successRate` étant validé par Monte-Carlo sur la vraie trajectoire), `current/best.shoulderIR` (°/s estimés), `best.isCurrent`, `sensitivity[].feasible`, `equipment.current`, `equipment.best.{racketName, stringName, comfort}`, `rejected = { separation, knee, shoulder, reach, total, feasible }`.
- `equipment.string` peut être un hybride (voir D06). Options supplémentaires de `runOptimization` : `dispersion {angle, speed, spin}`, `workers`, `inline`.

### dynamics.js — dynamique inverse (une caméra)

```js
inverseDynamics(frames, res, profile = { heightM, massKg, sex?: 'male'|'female', racket?, leads? }) → {
  series: {
    t,                                                     // s
    grf: { vertical, horizontal, left, right },            // poids de corps (PC), réaction du sol estimée
    shoulderTorque: { ir, total },                         // N·m (ir > 0 = moment de rotation interne, bras de frappe)
    elbowValgus,                                           // N·m (valeur absolue, axe varus/valgus)
    lumbarTorque: { total, extension, lateral, axial },    // N·m à L5/S1 (axes du tronc)
    kneeTorque: { left, right },                           // N·m (norme)
    com                                                    // [x,y,z] m, centre de masse global
  },
  peaks: { grfVertical, grfHorizontal, shoulderIR, shoulderTotal, elbowValgus, lumbar, lumbarLateral, lumbarExtension,
           kneeLeft, kneeRight, knee },                    // { value, perKg?, idx, t, msFromImpact, side? }
  units, confidence /* 0–0,85 : plafonné, une seule caméra */, alerts: [{ key, label, detail, severity 1–3, value, unit }],
  model: { massKg, heightM, sex, scale, root: 'image'|'pieds', rootFitErr, smoothingMs, fps, window }
}
SEGMENTS, THRESHOLDS, sgWeights(t, h, deg)
```
Modèle : 14 segments de De Leva + raquette rigide dans l'axe de la main ; translation du bassin reconstruite depuis `img` (projection affine, caméra fixe) ; dérivées Savitzky-Golay (degré 5, coupure ≈ 15 Hz) sur les **rotations** des segments puis accélérations par la cinématique du solide ; moments par somme des segments distaux. Validé sur des mouvements analytiques (< 0,1 % d'écart) ; sur données réelles, ± 30–50 % sur les pics. Les seuils d'alerte (commentés dans le fichier) sont des repères publiés, pas des limites cliniques.

### load.js — charge cumulée

```js
computeLoad(history = [{ date, strokes: [{ type, peakShoulderTorque?, racketKmh? }] }], { today?, acuteDays = 7, chronicDays = 28 }) → {
  daily: [{ date, load, strokes, serves, acute, chronic }], acute, chronic /* UA/jour, EWMA */, acwr,
  zone: { key: 'under'|'optimal'|'caution'|'danger', label, detail }, weekLoad, prevWeekLoad, weekChangePct, monotony, strain,
  alerts: [{ key, label, detail, severity }], advice: { targetWeekLoad: [lo, hi], loadPerStroke, strokesPerWeek: [lo, hi], servesPerSession, text },
  lastDay, confidence, units }
strokeLoad(stroke) ; ZONES ; TYPE_WEIGHT ; LOAD_REF
```
Charge par frappe en UA (≈ un coup droit de référence) : (τ/40 N·m)² ou (v/100 km/h)², × 1,6 pour le service. ACWR présenté comme un indicateur de pilotage, pas un prédicteur de blessure.

### physics.js — ajouts (compatibles)

```js
// C09 vibrations
vibration(rk, impactCm = 54, offCenter = 0, impactRes?) → { freqHz, nodesCm: [manche, tamis], amplitudeMm /* raquette libre, borne haute */,
  amplitudeRel /* 1 = Contrôle 98 frappée à 63 cm, même impulsion */, armShockN, twistNm, copCm, impulseNs, comfortIndex /* 0–100 */ }
// D06 hybrides — partout où un cordage est attendu (bedStiffness, tensionAfter, impact, impactSetup, runOptimization.equipment.string) :
string = 'poly' | … | { mains: { material, gauge, tension }, crosses: { material, gauge, tension } }   // material = clé de STRINGS
stringProps(string) → { label, k, e, snap, mu, comfort, tauH, keep, wearPerH, muSS?, hybrid? } ; stringLabel(string) ; isHybrid(string) ; STRING_FRICTION
recommendStrings(base, goal, { hybrids?: true })   // sans option : sortie inchangée ; chaque entrée a désormais `label`
tensionAfter(hybride, T0?, days, hours)            // T0 facultatif pour un hybride (moyenne montants 55 % / travers 45 %)
// E07 rebond
bounceProfile(v, launch, spinRpm, surface, { h0 = 1, x0 = -1, rho, wind, receiverX = COURT.base }) → {
  bounceX, netY, flightTime, in: { kmh, angleDeg }, out: { kmh, angleDeg, spinRpm, vx, vy }, slide, peakH, heightAtReceiver, kick, speedKeptPct, courtPace }
courtPace(surface)   // indice ITF 100·(1 − μ) + 150·(0,81 − e)
flight(...).after.slip   // nouveau champ
```

### style.js — signatures, DTW, geste cible

Les signatures de référence sont des **archétypes synthétiques** (`synthetic: true`, `SYNTHETIC_NOTICE`), construits à partir de plages publiées ; aucun joueur réel n'est nommé ni imité.

```js
ARCHETYPES[stroke] = [{ key, label, mean: {…}, phasesMs: { load, accel, follow }, risk? }] ; FEATURES ; FEATURE_META ; CHANNELS
featuresOf(res) → { kneeFlex, separation, elbowImpact, contactRatio, shoulderTurn, d1, d2, d3, racketSpeed }
classifyStyle(res | features, stroke?) → { stroke, ranking: [{ key, label, d /* Mahalanobis */, p /* a posteriori */, typicality, risk, synthetic }],
  used, contributions: [{ key, label, z }], notice }
dtw(A, B, { band = 0.2 }) → { distance, normDistance, path: [[i, j]] }      // A, B : nombres ou vecteurs
playerCurves(res, { t0 = -0.5, t1 = 0.15, K = 100 }) → { t, channels: { pelvis, thorax, elbow, wrist } /* forme 0–1 */, peaks }
referenceCurves(archetype | key | { d1, d2, d3 }, stroke) → { t, channels, peaksMs, label, synthetic }
compareToReference(res, ref, { stroke? }) → { dtw: { combined, byChannel }, timing: [{ key, label, playerMs, refMs, deltaMs }],
  phases: [{ key, label, playerMs, refMs, deltaMs, cost }], ref }
targetGesture(optResult, res) → { label, params: { clé: { from, to, delta, unit, label } }, curves, timeMap: [{ tPlayer, tGhost }],
  keyframes: [{ phase, targets }], speedScale, simulated: true }
mapTime(timeMap, tRel) → tGhost   // rejouer le squelette du joueur avec t → mapTime(t) donne le « fantôme » recalé
```
