// KYRON · signatures de style, alignement de courbes, geste cible (vague 2).
//
// IMPORTANT : les « signatures de référence » ci-dessous sont des ARCHÉTYPES SYNTHÉTIQUES, construits à partir des
// plages publiées en biomécanique du tennis (Elliott, Reid, Kibler, Landlinger, Martin…). Ce ne sont PAS des
// mesures de joueurs réels, et aucun joueur réel n'est nommé ni imité. Chaque archétype est un vecteur moyen et
// une matrice de covariance plausibles ; ils servent à décrire un style (« plutôt lifteur ») et à fournir des
// courbes de référence lisibles, pas à étalonner une performance.

export const SYNTHETIC_NOTICE = 'Archétype synthétique construit à partir de plages publiées — pas un joueur réel.';

export const FEATURES = {
  serve: ['kneeFlex', 'separation', 'elbowImpact', 'contactRatio', 'shoulderTurn', 'd1', 'd2', 'd3', 'racketSpeed'],
  forehand: ['kneeFlex', 'separation', 'elbowImpact', 'shoulderTurn', 'd1', 'd2', 'd3', 'racketSpeed'],
  backhand: ['kneeFlex', 'separation', 'elbowImpact', 'shoulderTurn', 'd1', 'd2', 'd3', 'racketSpeed'],
};
export const FEATURE_META = {
  kneeFlex: { label: 'Flexion des genoux', unit: '°', sd: 10 },
  separation: { label: 'Séparation hanches / épaules', unit: '°', sd: 8 },
  elbowImpact: { label: "Coude à l'impact", unit: '°', sd: 8 },
  contactRatio: { label: 'Hauteur de contact', unit: '× taille', sd: 0.06 },
  shoulderTurn: { label: 'Rotation des épaules', unit: '°', sd: 15 },
  d1: { label: 'Écart bassin → buste', unit: 'ms', sd: 15 },
  d2: { label: 'Écart buste → coude', unit: 'ms', sd: 15 },
  d3: { label: 'Écart coude → poignet', unit: 'ms', sd: 15 },
  racketSpeed: { label: 'Vitesse de raquette', unit: 'm/s', sd: 3 },
};
// Corrélations a priori (ordre de grandeur, choisies pour la cohérence : une grande séparation va avec une grande
// rotation des épaules, une forte flexion avec un contact haut au service, une chaîne étalée avec plus de vitesse)
const CORR = [['separation', 'shoulderTurn', 0.5], ['kneeFlex', 'contactRatio', 0.4], ['separation', 'racketSpeed', 0.3], ['d1', 'd2', 0.2], ['kneeFlex', 'racketSpeed', 0.25]];

// Phases de référence (ms) : armé, accélération, accompagnement
export const ARCHETYPES = {
  serve: [
    { key: 'power', label: 'Serveur puissant (plat)', mean: { kneeFlex: 70, separation: 40, elbowImpact: 172, contactRatio: 1.42, shoulderTurn: 110, d1: 35, d2: 40, d3: 25, racketSpeed: 42 }, phasesMs: { load: 420, accel: 230, follow: 300 } },
    { key: 'kick', label: 'Serveur liftant (kick)', mean: { kneeFlex: 75, separation: 42, elbowImpact: 165, contactRatio: 1.36, shoulderTurn: 120, d1: 40, d2: 45, d3: 30, racketSpeed: 38 }, phasesMs: { load: 450, accel: 250, follow: 320 } },
    { key: 'compact', label: 'Service compact (placement)', mean: { kneeFlex: 50, separation: 30, elbowImpact: 165, contactRatio: 1.32, shoulderTurn: 90, d1: 45, d2: 50, d3: 30, racketSpeed: 34 }, phasesMs: { load: 380, accel: 240, follow: 280 } },
    { key: 'arm', label: 'Service « bras » (chaîne courte)', mean: { kneeFlex: 25, separation: 15, elbowImpact: 150, contactRatio: 1.2, shoulderTurn: 70, d1: 10, d2: 20, d3: 20, racketSpeed: 32 }, phasesMs: { load: 300, accel: 200, follow: 250 }, risk: true },
  ],
  forehand: [
    { key: 'topspin', label: 'Lifteur (grosse rotation)', mean: { kneeFlex: 45, separation: 45, elbowImpact: 140, shoulderTurn: 130, d1: 30, d2: 45, d3: 30, racketSpeed: 30 }, phasesMs: { load: 380, accel: 180, follow: 300 } },
    { key: 'flat', label: 'Frappeur à plat (bras long)', mean: { kneeFlex: 40, separation: 40, elbowImpact: 165, shoulderTurn: 120, d1: 30, d2: 40, d3: 25, racketSpeed: 32 }, phasesMs: { load: 360, accel: 170, follow: 260 } },
    { key: 'counter', label: 'Contreur (compact, balle tôt)', mean: { kneeFlex: 35, separation: 25, elbowImpact: 130, shoulderTurn: 90, d1: 25, d2: 35, d3: 25, racketSpeed: 25 }, phasesMs: { load: 280, accel: 150, follow: 220 } },
  ],
  backhand: [
    { key: 'onehand', label: 'Revers à une main lifté', mean: { kneeFlex: 40, separation: 30, elbowImpact: 170, shoulderTurn: 120, d1: 35, d2: 45, d3: 30, racketSpeed: 28 }, phasesMs: { load: 380, accel: 180, follow: 280 } },
    { key: 'twohand', label: 'Revers à deux mains', mean: { kneeFlex: 40, separation: 35, elbowImpact: 140, shoulderTurn: 110, d1: 30, d2: 40, d3: 25, racketSpeed: 27 }, phasesMs: { load: 340, accel: 170, follow: 260 } },
    { key: 'slice', label: 'Slice / contreur', mean: { kneeFlex: 30, separation: 20, elbowImpact: 155, shoulderTurn: 90, d1: 35, d2: 40, d3: 25, racketSpeed: 22 }, phasesMs: { load: 300, accel: 160, follow: 240 } },
  ],
};

// ---------- algèbre linéaire minimale ----------
function covOf(keys) {
  const n = keys.length, C = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) C[i][i] = FEATURE_META[keys[i]].sd ** 2;
  for (const [a, b, r] of CORR) {
    const i = keys.indexOf(a), j = keys.indexOf(b);
    if (i < 0 || j < 0) continue;
    C[i][j] = C[j][i] = r * FEATURE_META[a].sd * FEATURE_META[b].sd;
  }
  return C;
}
function cholesky(A) {
  const n = A.length, Lm = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= Lm[i][k] * Lm[j][k];
    Lm[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / Lm[j][j];
  }
  return Lm;
}
// d² = xᵀ Σ⁻¹ x via Cholesky ; renvoie aussi log|Σ|
function mahal2(x, C) {
  const Lm = cholesky(C), n = x.length, y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = x[i]; for (let k = 0; k < i; k++) s -= Lm[i][k] * y[k]; y[i] = s / Lm[i][i]; }
  let d2 = 0, logDet = 0;
  for (let i = 0; i < n; i++) { d2 += y[i] * y[i]; logDet += 2 * Math.log(Lm[i][i]); }
  return { d2, logDet };
}
// Fonction de répartition du χ² (k ddl) : série de la gamma incomplète régularisée
function chi2cdf(x, k) {
  if (x <= 0) return 0;
  const a = k / 2, z = x / 2;
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n < 200; n++) { term *= z / (a + n); sum += term; if (term < sum * 1e-12) break; }
  return Math.min(1, Math.exp(-z + a * Math.log(z) - lgamma(a)) * sum);
}
function lgamma(x) { // Lanczos
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Vecteur de caractéristiques d'un résultat d'analyze (champs manquants ignorés)
export function featuresOf(res) {
  const m = res?.metrics || {}, si = res?.simInput || {};
  const g = res?.gaps || [si.d1, si.d2, si.d3];
  return {
    kneeFlex: m.kneeFlex, separation: m.separation, elbowImpact: m.elbowImpact, contactRatio: m.contactRatio,
    shoulderTurn: m.shoulderTurn, d1: g[0], d2: g[1], d3: g[2], racketSpeed: m.racketSpeed ?? si.speed,
  };
}

/**
 * classifyStyle(res | features, stroke) → { stroke, ranking: [{ key, label, d (Mahalanobis), p (probabilité
 *   a posteriori, a priori uniformes), typicality (1 − F_χ²(d²) : 1 = au centre de l'archétype), risk?, synthetic:true }],
 *   used: [clés utilisées], contributions: [{ key, label, z }] (écarts standardisés au meilleur archétype), notice }
 */
export function classifyStyle(resOrFeatures, stroke) {
  const st = stroke || resOrFeatures?.stroke || 'serve';
  const F = resOrFeatures?.metrics ? featuresOf(resOrFeatures) : (resOrFeatures || {});
  const keys = (FEATURES[st] || FEATURES.serve).filter((k) => Number.isFinite(F[k]));
  if (keys.length < 2) return { stroke: st, ranking: [], used: keys, contributions: [], notice: SYNTHETIC_NOTICE };
  const C = covOf(keys);
  const rows = (ARCHETYPES[st] || ARCHETYPES.serve).map((a) => {
    const x = keys.map((k) => F[k] - a.mean[k]);
    const { d2, logDet } = mahal2(x, C);
    return { key: a.key, label: a.label, d: Math.sqrt(d2), d2, ll: -0.5 * d2 - 0.5 * logDet, typicality: 1 - chi2cdf(d2, keys.length), risk: !!a.risk, synthetic: true };
  });
  const mx = Math.max(...rows.map((r) => r.ll));
  const Z = rows.reduce((s, r) => s + Math.exp(r.ll - mx), 0);
  rows.forEach((r) => { r.p = Math.exp(r.ll - mx) / Z; delete r.ll; delete r.d2; });
  rows.sort((a, b) => a.d - b.d);
  const best = (ARCHETYPES[st] || ARCHETYPES.serve).find((a) => a.key === rows[0].key);
  const contributions = keys.map((k) => ({ key: k, label: FEATURE_META[k].label, z: (F[k] - best.mean[k]) / FEATURE_META[k].sd }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return { stroke: st, ranking: rows, used: keys, contributions, notice: SYNTHETIC_NOTICE };
}

// ---------- DTW ----------
/**
 * dtw(A, B, { band = 0.2 }) : alignement temporel dynamique (bande de Sakoe-Chiba, fraction de la longueur).
 * A, B : tableaux de nombres ou de vecteurs (même dimension). Distance euclidienne locale.
 * → { distance, normDistance (par pas du chemin), path: [[i, j], …] }
 */
export function dtw(A, B, { band = 0.2 } = {}) {
  const n = A.length, m = B.length;
  if (!n || !m) return { distance: Infinity, normDistance: Infinity, path: [] };
  const vec = Array.isArray(A[0]);
  const cost = (i, j) => { if (!vec) return Math.abs(A[i] - B[j]); let s = 0; for (let k = 0; k < A[i].length; k++) s += (A[i][k] - B[j][k]) ** 2; return Math.sqrt(s); };
  const w = Math.max(Math.abs(n - m), Math.ceil(band * Math.max(n, m)));
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    const jc = Math.round(i * m / n);
    for (let j = Math.max(1, jc - w); j <= Math.min(m, jc + w); j++) D[i][j] = cost(i - 1, j - 1) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  }
  const path = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const a = D[i - 1][j - 1], b = D[i - 1][j], c = D[i][j - 1];
    if (a <= b && a <= c) { i--; j--; } else if (b <= c) i--; else j--;
  }
  path.reverse();
  return { distance: D[n][m], normDistance: D[n][m] / Math.max(1, path.length), path };
}

// ---------- Courbes de vitesses segmentaires ----------
export const CHANNELS = [
  { key: 'pelvis', label: 'Bassin', unit: '°/s', series: 'pelvisOmega', widthMs: 90 },
  { key: 'thorax', label: 'Buste', unit: '°/s', series: 'thoraxOmega', widthMs: 70 },
  { key: 'elbow', label: 'Coude', unit: '°/s', series: 'elbowVel', widthMs: 45 },
  { key: 'wrist', label: 'Poignet', unit: 'm/s', series: 'wristSpeed', widthMs: 35 },
];
const WIN = { t0: -0.5, t1: 0.15, K: 100 };

// Courbes du joueur autour de l'impact, rééchantillonnées sur K points (forme : chaque canal divisé par son pic)
export function playerCurves(res, { t0 = WIN.t0, t1 = WIN.t1, K = WIN.K } = {}) {
  const S = res?.series || {}, t = S.t;
  if (!t || !Number.isInteger(res.impact)) return null;
  const ti = t[res.impact];
  const tt = Array.from({ length: K }, (_, k) => t0 + (t1 - t0) * k / (K - 1));
  const channels = {}, peaks = {};
  for (const c of CHANNELS) {
    const y = S[c.series];
    if (!y) continue;
    const vals = tt.map((x) => interp(t, y.map(Math.abs), ti + x));
    const pk = Math.max(1e-9, ...vals);
    channels[c.key] = vals.map((v) => v / pk);
    peaks[c.key] = { value: pk, ms: Math.round(tt[vals.indexOf(pk)] * 1000) };
  }
  return { t: tt, channels, peaks };
}
function interp(t, y, x) {
  if (x <= t[0]) return y[0];
  if (x >= t[t.length - 1]) return y[y.length - 1];
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
  const k = (x - t[lo]) / ((t[hi] - t[lo]) || 1);
  return y[lo] + (y[hi] - y[lo]) * k;
}

/**
 * referenceCurves(archetypeOrParams, stroke, { t0, t1, K }) : courbes de forme synthétiques (cloches gaussiennes)
 * dont les pics respectent l'enchaînement proximal → distal : poignet à −5 ms de l'impact, coude = poignet − d3,
 * buste = coude − d2, bassin = buste − d1. Accepte une clé d'archétype, un archétype, ou { d1, d2, d3 }.
 * → { t, channels: { pelvis, thorax, elbow, wrist } (0–1), peaksMs, label, synthetic: true }
 */
export function referenceCurves(a, stroke = 'serve', { t0 = WIN.t0, t1 = WIN.t1, K = WIN.K } = {}) {
  const arch = typeof a === 'string' ? (ARCHETYPES[stroke] || []).find((x) => x.key === a) : a;
  const p = arch?.mean || arch || {};
  const d1 = p.d1 ?? 35, d2 = p.d2 ?? 40, d3 = p.d3 ?? 25;
  const wrist = -5, elbow = wrist - d3, thorax = elbow - d2, pelvis = thorax - d1;
  const peaksMs = { pelvis, thorax, elbow, wrist };
  const tt = Array.from({ length: K }, (_, k) => t0 + (t1 - t0) * k / (K - 1));
  const channels = {};
  for (const c of CHANNELS) {
    const mu = peaksMs[c.key] / 1000, s = c.widthMs / 1000;
    // décélération après le pic plus rapide que l'accélération (freinage excentrique)
    channels[c.key] = tt.map((x) => Math.exp(-0.5 * ((x - mu) / (x < mu ? s : s * 0.7)) ** 2));
  }
  return { t: tt, channels, peaksMs, label: arch?.label || 'Référence', synthetic: true };
}

/**
 * compareToReference(res, ref, { stroke }) — ref : clé d'archétype, archétype ou sortie de referenceCurves.
 * → { dtw: { combined, byChannel: { pelvis, … } }, timing: [{ key, label, playerMs, refMs, deltaMs }],
 *     phases: [{ key, label, playerMs, refMs, deltaMs, cost }], ref: { label, synthetic } }
 * Les coûts DTW sont calculés sur des courbes de FORME (normalisées à leur pic) : 0 = même forme.
 */
export function compareToReference(res, ref, { stroke } = {}) {
  const st = stroke || res?.stroke || 'serve';
  const arch = typeof ref === 'string' ? (ARCHETYPES[st] || []).find((x) => x.key === ref) : (ref?.mean ? ref : null);
  const R = ref?.channels ? ref : referenceCurves(arch || ref, st);
  const Pc = playerCurves(res);
  if (!Pc) return null;
  const keys = CHANNELS.map((c) => c.key).filter((k) => Pc.channels[k] && R.channels[k]);
  const byChannel = {};
  for (const k of keys) byChannel[k] = dtw(Pc.channels[k], R.channels[k]).normDistance;
  const A = Pc.t.map((_, i) => keys.map((k) => Pc.channels[k][i]));
  const B = R.t.map((_, i) => keys.map((k) => R.channels[k][i]));
  const comb = dtw(A, B);
  const timing = keys.map((k) => {
    const meta = CHANNELS.find((c) => c.key === k);
    const pm = res.sequence?.find((s) => s.key === k)?.ms ?? Pc.peaks[k].ms;
    return { key: k, label: meta.label, playerMs: pm, refMs: R.peaksMs[k], deltaMs: pm - R.peaksMs[k] };
  });
  // Phases : durées du joueur (res.phases) vs référence, et coût DTW moyen des points du chemin dans la phase
  const fps = res.fps || 120, ti = res.series.t[res.impact];
  const phases = [];
  const refPh = arch?.phasesMs || { load: 400, accel: 220, follow: 280 };
  for (const ph of res.phases || []) {
    if (!(ph.key in refPh)) continue;
    const ms = Math.round((res.series.t[ph.i1] - res.series.t[ph.i0]) * 1000);
    const a0 = res.series.t[ph.i0] - ti, a1 = res.series.t[ph.i1] - ti;
    let c = 0, cnt = 0;
    for (const [i, j] of comb.path) {
      if (Pc.t[i] < a0 || Pc.t[i] > a1) continue;
      let s = 0; for (let q = 0; q < keys.length; q++) s += (A[i][q] - B[j][q]) ** 2;
      c += Math.sqrt(s); cnt++;
    }
    phases.push({ key: ph.key, label: ph.label, playerMs: ms, refMs: refPh[ph.key], deltaMs: ms - refPh[ph.key], cost: cnt ? c / cnt : null });
  }
  void fps;
  return { dtw: { combined: comb.normDistance, byChannel }, timing, phases, ref: { label: R.label, synthetic: true } };
}

/**
 * targetGesture(opt, res) : sortie de runOptimization → geste cible pour un « fantôme ».
 * → { label, params: { clé: { from, to, delta, unit, label } }, curves (referenceCurves des écarts optimisés),
 *     timeMap: [{ tPlayer, tGhost }] (s, relatifs à l'impact : rejouer le squelette du joueur en remplaçant t par
 *     tGhost recale les pics de la chaîne cinétique sur la cible), keyframes: [{ phase, targets }], speedScale,
 *     simulated: true }
 */
export function targetGesture(opt, res = null) {
  const b = opt?.best?.params, c = opt?.current?.params || {};
  if (!b) return null;
  const meta = { kneeFlex: ['Flexion des genoux', '°'], separation: ['Séparation hanches / épaules', '°'], elbowImpact: ["Coude à l'impact", '°'], contactRatio: ['Hauteur de contact', '× taille'], d1: ['Écart bassin → buste', 'ms'], d2: ['Écart buste → coude', 'ms'], d3: ['Écart coude → poignet', 'ms'], alphaDeg: ['Trajectoire de raquette', '°'], phiDeg: ['Angle de face', '°'] };
  const si = res?.simInput || {};
  const params = {};
  for (const [k, [label, unit]] of Object.entries(meta)) {
    const from = c[k] ?? si[k] ?? null, to = b[k];
    if (!Number.isFinite(to)) continue;
    params[k] = { from, to, delta: Number.isFinite(from) ? to - from : null, unit, label };
  }
  const stroke = opt.stroke || res?.stroke || 'serve';
  const curves = referenceCurves({ d1: b.d1, d2: b.d2, d3: b.d3 }, stroke);
  curves.label = 'Geste cible (simulation)';
  // Carte temporelle : pics du joueur (res.sequence) → pics cibles ; interpolation linéaire par morceaux,
  // extrémités fixes (début de fenêtre et fin d'accompagnement inchangés)
  const seq = res?.sequence || [];
  const knots = [[-1.0, -1.0]];
  for (const k of ['pelvis', 'thorax', 'elbow', 'wrist']) {
    const s = seq.find((x) => x.key === k);
    if (s && Number.isFinite(s.ms)) knots.push([s.ms / 1000, curves.peaksMs[k] / 1000]);
  }
  knots.push([0, 0], [0.6, 0.6]);
  knots.sort((x, y) => x[0] - y[0]);
  // garantit une carte croissante (sinon le fantôme reculerait dans le temps)
  for (let i = 1; i < knots.length; i++) if (knots[i][1] <= knots[i - 1][1]) knots[i][1] = knots[i - 1][1] + 0.001;
  const timeMap = knots.map(([tPlayer, tGhost]) => ({ tPlayer, tGhost }));
  const speedScale = opt.current?.racketKmh && opt.best?.racketKmh ? opt.best.racketKmh / opt.current.racketKmh : 1;
  const keyframes = [
    { phase: 'load', targets: { kneeFlex: b.kneeFlex, separation: b.separation } },
    { phase: 'impact', targets: { elbowImpact: b.elbowImpact, contactRatio: b.contactRatio, alphaDeg: b.alphaDeg, phiDeg: b.phiDeg } },
  ];
  return { label: 'Geste cible (simulation)', params, curves, timeMap, keyframes, speedScale, simulated: true };
}

// Applique une carte temporelle (timeMap) à un instant relatif à l'impact
export function mapTime(timeMap, tRel) {
  const k = timeMap;
  if (tRel <= k[0].tPlayer) return tRel - k[0].tPlayer + k[0].tGhost;
  for (let i = 1; i < k.length; i++) {
    if (tRel <= k[i].tPlayer) {
      const a = k[i - 1], b = k[i], f = (tRel - a.tPlayer) / ((b.tPlayer - a.tPlayer) || 1);
      return a.tGhost + f * (b.tGhost - a.tGhost);
    }
  }
  const l = k[k.length - 1];
  return tRel - l.tPlayer + l.tGhost;
}
