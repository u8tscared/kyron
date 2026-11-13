// KYRON · cœur de calcul de l'optimiseur (pur, sans DOM) + point d'entrée Web Worker.
//
// Ce module est importable tel quel (navigateur, worker, node) : il n'exécute rien au chargement à part le
// branchement de self.onmessage QUAND il tourne dans un worker. optimizer.js l'importe directement sous node
// (exécution dans le thread courant) et le lance en N workers module dans le navigateur.
//
// Chaîne de modèles (chaque maillon est un modèle simplifié, documenté) :
//   paramètres du geste x = [flexion genoux, séparation, coude, hauteur de contact, d1, d2, d3, α, φ]
//   → vitesse de raquette V (chaîne cinétique multiplicative, calibrée : V(x_actuel) = V mesurée)
//   → impact (physics.impactSolveInto : masse effective, COR apparent, roulement de la balle)
//   → vitesse, angle de départ, effet de la balle
//   → probabilité de balle bonne sous la dispersion du joueur, par une table de fenêtres d'angle
//     (θ_min filet, θ_max ligne) précalculée avec la vraie intégration, et une approximation gaussienne linéarisée
//   → objectif (vitesse / effet / sécurité / équilibré) sous contraintes de sécurité articulaire.
// Les meilleurs candidats sont ensuite re-validés par Monte-Carlo sur la vraie intégration (flightFast).

import {
  RACKETS, STRINGS, COURT, customize, impactSetup, impactSolveInto, tensionAfter, airDensity,
  swingSpeedFactor, buildWindowTable, windowLookup, flightFast,
} from './physics.js';

// ---------------------------------------------------------------------------------------------
// Paramètres du geste
export const PARAM_KEYS = ['kneeFlex', 'separation', 'elbowImpact', 'contactRatio', 'd1', 'd2', 'd3', 'alphaDeg', 'phiDeg'];
export const PARAM_META = {
  kneeFlex: { label: 'Flexion des genoux', unit: '°' },
  separation: { label: 'Séparation hanches / épaules', unit: '°' },
  elbowImpact: { label: "Extension du coude à l'impact", unit: '°' },
  contactRatio: { label: 'Hauteur de contact', unit: '× taille' },
  d1: { label: 'Écart bassin → buste', unit: 'ms' },
  d2: { label: 'Écart buste → coude', unit: 'ms' },
  d3: { label: 'Écart coude → poignet', unit: 'ms' },
  alphaDeg: { label: 'Trajectoire de raquette', unit: '°' },
  phiDeg: { label: 'Angle de face', unit: '°' },
};
const NP = 9;

// Modèle par coup. Pour chaque segment : opt = valeur la plus efficace, wLo/wHi = demi-largeurs (en-dessous /
// au-dessus), A = perte relative maximale de vitesse si le segment ne contribue pas du tout.
// Ordres de grandeur : la littérature attribue ~50 % de l'énergie du service aux jambes et au tronc, mais un
// changement de technique RÉALISTE ne déplace la vitesse de balle que de quelques % (Elliott 2003, Girard 2005,
// Reid 2008) — d'où des amplitudes A modestes, et une enveloppe totale « mauvais → optimal » d'environ ×1,4.
const STROKES = {
  serve: {
    target: 'service', x0: 0, u: 0, h0: null, wristToCenter: 0.47,
    lo: [0, 0, 120, 1.0, -40, -40, -40, -10, -20], hi: [95, 60, 178, 1.55, 140, 140, 140, 30, 20],
    trust: [20, 15, 20, 0.1, 40, 40, 40, 5, 5],
    knee: { opt: 70, wLo: 30, wHi: 18, A: 0.08, reject: 95 },
    sep: { opt: 40, wLo: 20, wHi: 14, A: 0.07 },
    elbow: { opt: 172, wLo: 18, wHi: 30, A: 0.05 },
    reach: { opt: 1.45, w: 0.2, A: 0.03 },
    seq: { opt: 40, wLo: 22, wHi: 40, A: 0.12 },
    IRabs: 2500, IRref: 1700, Vref: 34, // °/s : pros ≈ 2 000–2 500 °/s (Fleisig 2003) ; seuil prudent
    disp: { angle: 0.9, speed: 0.035, spin: 0.12 },
    def: { kneeFlex: 45, separation: 25, elbowImpact: 158, contactRatio: 1.24, d1: 30, d2: 60, d3: 15, speed: 34, alphaDeg: 6, height: 1.78 },
  },
  forehand: {
    target: 'base', x0: -1, u: 18, h0: 0.95, wristToCenter: 0,
    lo: [0, 0, 90, 1, -40, -40, -40, 5, -10], hi: [75, 60, 178, 1, 140, 140, 140, 45, 15],
    trust: [20, 15, 25, 0, 40, 40, 40, 5, 5],
    knee: { opt: 45, wLo: 25, wHi: 15, A: 0.05, reject: 75 },
    sep: { opt: 40, wLo: 20, wHi: 14, A: 0.07 },
    elbow: { opt: 150, wLo: 30, wHi: 40, A: 0.03 },
    reach: null,
    seq: { opt: 35, wLo: 20, wHi: 35, A: 0.12 },
    IRabs: 1800, IRref: 1100, Vref: 26,
    disp: { angle: 1.3, speed: 0.04, spin: 0.12 },
    def: { kneeFlex: 28, separation: 22, elbowImpact: 135, contactRatio: 1, d1: 25, d2: 55, d3: 20, speed: 26, alphaDeg: 26, height: 1.78 },
  },
  backhand: {
    target: 'base', x0: -1, u: 18, h0: 0.9, wristToCenter: 0,
    lo: [0, 0, 100, 1, -40, -40, -40, 5, -10], hi: [75, 60, 178, 1, 140, 140, 140, 42, 15],
    trust: [20, 15, 20, 0, 40, 40, 40, 5, 5],
    knee: { opt: 42, wLo: 25, wHi: 15, A: 0.05, reject: 75 },
    sep: { opt: 35, wLo: 18, wHi: 14, A: 0.06 },
    elbow: { opt: 165, wLo: 30, wHi: 30, A: 0.03 },
    reach: null,
    seq: { opt: 35, wLo: 20, wHi: 35, A: 0.12 },
    IRabs: 1500, IRref: 900, Vref: 24,
    disp: { angle: 1.4, speed: 0.04, spin: 0.12 },
    def: { kneeFlex: 26, separation: 18, elbowImpact: 150, contactRatio: 1, d1: 25, d2: 50, d3: 20, speed: 24, alphaDeg: 22, height: 1.78 },
  },
};
export const SAFETY = { separationMax: 55, irExponent: 2.5, irGrowthMax: 1.1 };
const REJ = { none: 0, separation: 1, knee: 2, shoulder: 3, reach: 4 };
const GOALS = ['speed', 'spin', 'safety', 'balanced'];

// Facteur de segment : 1 − A·z²/(1+z²) (cloche de Cauchy, sans Math.exp, bornée dans [1−A, 1])
function seg(x, opt, wLo, wHi, A) {
  const z = (x - opt) / (x < opt ? wLo : wHi);
  const z2 = z * z;
  return 1 - A * z2 / (1 + z2);
}
// Efficacité de la chaîne cinétique : chaque écart entre pics (ms) a un optimum ; un écart négatif (segment distal
// qui part AVANT le proximal) est pénalisé fortement — le transfert proximal → distal est cassé.
function seqEff(d1, d2, d3, Q) {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = i === 0 ? d1 : i === 1 ? d2 : d3;
    let z = (d - Q.opt) / (d < Q.opt ? Q.wLo : Q.wHi);
    if (d < 0) z -= d / 10;
    s += 1 / (1 + z * z);
  }
  return 1 - Q.A * (1 - s / 3);
}

// Φ (fonction de répartition normale) tabulée sur [−8, 8]
const PHI_N = 4096, PHI_Z = 8;
const PHI_TAB = new Float64Array(PHI_N + 1);
{
  // erf par Abramowitz & Stegun 7.1.26 (|ε| < 1,5e−7), une seule fois au chargement
  const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
  for (let i = 0; i <= PHI_N; i++) { const z = -PHI_Z + (2 * PHI_Z * i) / PHI_N; PHI_TAB[i] = 0.5 * (1 + erf(z / Math.SQRT2)); }
}
function Phi(z) {
  let f = (z + PHI_Z) * (PHI_N / (2 * PHI_Z));
  if (f <= 0) return 0;
  if (f >= PHI_N) return 1;
  const i = f | 0; f -= i;
  return PHI_TAB[i] + (PHI_TAB[i + 1] - PHI_TAB[i]) * f;
}

// Générateur pseudo-aléatoire (xorshift32) + table de 65 536 tirages normaux (Box-Muller une fois) :
// assez bon pour une recherche stochastique, ~10× plus rapide que Box-Muller à chaque tirage.
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const GT = new Float64Array(65536);
{
  const r = makeRng(12345);
  for (let i = 0; i < 65536; i += 2) {
    const u1 = (r() + 1) / 4294967297, u2 = r() / 4294967296;
    const R = Math.sqrt(-2 * Math.log(u1));
    GT[i] = R * Math.cos(2 * Math.PI * u2); GT[i + 1] = R * Math.sin(2 * Math.PI * u2);
  }
}

// ---------------------------------------------------------------------------------------------
// Construction du problème (déterministe à partir d'une configuration sérialisable)
const _tableCache = new Map();
function getTable(key, make) {
  if (!_tableCache.has(key)) { if (_tableCache.size > 6) _tableCache.clear(); _tableCache.set(key, make()); }
  return _tableCache.get(key);
}

function racketSpec(r) {
  if (r && typeof r === 'object' && r.mass) return r;
  return RACKETS.find((x) => x.id === r) || RACKETS[0];
}

// cfg : { stroke, sim: {kneeFlex, separation, elbowImpact, contactRatio, d1, d2, d3, speed, height, ir, alphaDeg, phiDeg},
//         equipment: {racket, leads, string, tension, gauge, days, hours}, conditions: {alt, temp, wind, surface},
//         goal, disp? }
export function buildProblem(cfg) {
  const t0 = now();
  const stroke = STROKES[cfg.stroke] ? cfg.stroke : 'serve';
  const M = STROKES[stroke];
  const serve = stroke === 'serve';
  const sim = cfg.sim || {};
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const D = M.def;
  const H = Math.min(2.2, Math.max(1.4, num(sim.height, D.height)));
  // Vitesse mesurée : bornée à des valeurs humaines (le suivi 2D peut sortir des valeurs aberrantes)
  const V0 = Math.min(55, Math.max(12, num(sim.speed, D.speed)));
  const x0 = new Float64Array(NP);
  x0[0] = num(sim.kneeFlex, D.kneeFlex); x0[1] = num(sim.separation, D.separation); x0[2] = num(sim.elbowImpact, D.elbowImpact);
  x0[3] = serve ? num(sim.contactRatio, D.contactRatio) : 1;
  x0[4] = num(sim.d1, D.d1); x0[5] = num(sim.d2, D.d2); x0[6] = num(sim.d3, D.d3);
  x0[7] = num(sim.alphaDeg, D.alphaDeg); x0[8] = num(sim.phiDeg, NaN);
  for (let i = 0; i < NP; i++) if (i !== 8) x0[i] = Math.min(M.hi[i], Math.max(M.lo[i], x0[i]));
  const active = new Uint8Array(NP);
  for (let i = 0; i < NP; i++) active[i] = M.trust[i] > 0 ? 1 : 0;
  // Conditions
  const C = cfg.conditions || {};
  const rho = airDensity(num(C.alt, 0), num(C.temp, 20));
  const wind = num(C.wind, 0);
  const tKey = `${stroke}|${rho.toFixed(4)}|${wind.toFixed(2)}`;
  const table = getTable(tKey, () => serve
    ? buildWindowTable({ hMin: 2.0, hMax: 3.3, nh: 5, x0: M.x0, rho, wind, target: M.target })
    : buildWindowTable({ hMin: M.h0, hMax: M.h0, nh: 1, x0: M.x0, rho, wind, target: M.target }));
  // Matériel actuel (cordage usé selon jours / heures)
  const E = cfg.equipment || {};
  const eqCfg = {
    racket: racketSpec(E.spec && E.spec.mass ? E.spec : E.racket), leads: E.leads || {}, string: STRINGS[E.string] ? E.string : 'poly',
    tension: num(E.tension, 23), gauge: num(E.gauge, 1.25), days: num(E.days, 0), hours: num(E.hours, 0),
  };
  const rk0 = customize(eqCfg.racket, eqCfg.leads);
  const Pb = {
    stroke, M, serve, H, V0, x0, active, nActive: active.reduce((a, b) => a + b, 0), rho, wind, table, eqCfg, rk0,
    goal: GOALS.includes(cfg.goal) ? cfg.goal : 'balanced',
    goalId: GOALS.includes(cfg.goal) ? GOALS.indexOf(cfg.goal) : 3,
    disp: { ...M.disp, ...(cfg.disp || {}) },
    tmpI: new Float64Array(9), tmpW: new Float64Array(6), m: new Float64Array(10),
  };
  const T0now = tensionAfter(eqCfg.string, eqCfg.tension, eqCfg.days, eqCfg.hours);
  Pb.T0now = T0now;
  Pb.eq0 = makeEquip(Pb, rk0, eqCfg.string, T0now, eqCfg.gauge);
  // Calibration de la chaîne cinétique : K tel que V(x_actuel) = V mesurée
  Pb.K = 1;
  const f0 = speedFactors(Pb, x0);
  Pb.K = V0 / (f0.prox * f0.arm);
  Pb.prox0 = f0.prox;
  // Rotation interne d'épaule : mesurée si disponible, sinon estimée ∝ vitesse
  Pb.IR0 = num(sim.ir, M.IRref * V0 / M.Vref);
  Pb.IRlim = Pb.IR0 >= M.IRabs ? Pb.IR0 : Math.min(M.IRabs, SAFETY.irGrowthMax * Pb.IR0);
  // Box de recherche : bornes physiologiques ∩ région de confiance autour du geste actuel
  // (le modèle n'est pas extrapolable loin de ce que le joueur fait aujourd'hui)
  const lo = new Float64Array(NP), hi = new Float64Array(NP);
  Pb.lo = lo; Pb.hi = hi;
  Pb.ref = { kmh: 1, spin: 1, P: 0, load: 1, comfort: Pb.eq0.comfort };
  // Visée habituelle : si l'angle de face n'est pas mesuré, on suppose que le joueur s'est calé sur l'angle
  // qui lui donne le meilleur taux de réussite avec son geste (sinon les gains seraient artificiels).
  if (!Number.isFinite(x0[8])) {
    let bestP = -1, bestF = 0;
    for (let f = M.lo[8]; f <= M.hi[8]; f += 0.1) {
      x0[8] = f; evalX(Pb, x0, Pb.eq0, Pb.m);
      if (Pb.m[2] > bestP + 1e-9) { bestP = Pb.m[2]; bestF = f; }
    }
    x0[8] = bestF;
  }
  for (let i = 0; i < NP; i++) {
    lo[i] = active[i] ? Math.max(M.lo[i], x0[i] - M.trust[i]) : x0[i];
    hi[i] = active[i] ? Math.min(M.hi[i], x0[i] + M.trust[i]) : x0[i];
    if (hi[i] < lo[i]) { lo[i] = hi[i] = x0[i]; }
  }
  evalX(Pb, x0, Pb.eq0, Pb.m);
  Pb.ref = { kmh: Pb.m[0], spin: Pb.m[1], P: Pb.m[2], load: Pb.m[3], comfort: Pb.eq0.comfort };
  Pb.cur = metricsObj(Pb.m);
  Pb.J0 = objective(Pb, Pb.m, Pb.eq0);
  Pb.setupMs = now() - t0;
  return Pb;
}

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

// État matériel : setup d'impact + facteurs (vitesse de swing, dispersion, charge, confort)
function makeEquip(Pb, rk, string, tensionNow, gauge) {
  const imp = impactSetup({ rk, string, tension: tensionNow, gauge, impactCm: 54 });
  const rk0 = Pb.rk0;
  const T0n = Pb.T0now ?? tensionNow;
  // Modèle de contrôle (simplifié, assumé) : une raquette plus stable en torsion disperse moins (TW^−0,3) ;
  // une tension basse rend la sortie de balle moins prévisible (+2 %/kg sous 23 kg).
  const ctl = (r, T) => Math.pow(14 / r.tw, 0.3) * (1 + 0.02 * Math.max(0, 23 - T));
  return {
    imp, rk, string, tension: tensionNow, gauge,
    vF: swingSpeedFactor(rk, rk0),
    dispF: ctl(rk, tensionNow) / ctl(rk0, T0n),
    loadF: Math.sqrt(rk.sw / rk0.sw), // couple à l'épaule ∝ inertie de swing (à vitesse égale)
    comfort: imp.comfort,
  };
}

function speedFactors(Pb, x) {
  const M = Pb.M;
  const fL = seg(x[0], M.knee.opt, M.knee.wLo, M.knee.wHi, M.knee.A);
  const fT = seg(x[1], M.sep.opt, M.sep.wLo, M.sep.wHi, M.sep.A);
  const fQ = seqEff(x[4], x[5], x[6], M.seq);
  const fE = seg(x[2], M.elbow.opt, M.elbow.wLo, M.elbow.wHi, M.elbow.A);
  const fR = M.reach ? seg(x[3], M.reach.opt, M.reach.w, M.reach.w, M.reach.A) : 1;
  return { prox: fL * fT * fQ, arm: fE * fR };
}

// Évaluation d'un geste. m (Float64Array(10)) ← [km/h, tr/min, P(bonne), charge épaule (IR/IR_lim), angle de départ,
// V raquette (m/s), hauteur d'impact, code de rejet, IR estimée (°/s), σ angle effectif]. Renvoie l'objectif ou −∞.
export function evalX(Pb, x, eq, m) {
  const M = Pb.M;
  const k = x[0], s = x[1], el = x[2], c = x[3];
  m[7] = REJ.none;
  // --- Contraintes de sécurité articulaire (rejet dur) ---
  if (s > SAFETY.separationMax) { m[7] = REJ.separation; return -Infinity; } // charge lombaire (Campbell 2013)
  if (k > M.knee.reject) { m[7] = REJ.knee; return -Infinity; }
  if (Pb.serve) {
    // Allonge atteignable : épaule ≈ 0,82 H + bras ≈ 0,44 H, moins le coude fléchi, plus la poussée des jambes
    const cMax = Math.max(1.3 + 0.0018 * k - 0.004 * (180 - el), Pb.x0[3] + 0.02);
    if (c > cMax) { m[7] = REJ.reach; return -Infinity; }
  }
  // --- Chaîne cinétique → vitesse de raquette ---
  const fL = seg(k, M.knee.opt, M.knee.wLo, M.knee.wHi, M.knee.A);
  const fT = seg(s, M.sep.opt, M.sep.wLo, M.sep.wHi, M.sep.A);
  const fQ = seqEff(x[4], x[5], x[6], M.seq);
  const fE = seg(el, M.elbow.opt, M.elbow.wLo, M.elbow.wHi, M.elbow.A);
  const fR = M.reach ? seg(c, M.reach.opt, M.reach.w, M.reach.w, M.reach.A) : 1;
  const prox = fL * fT * fQ;
  const V = Pb.K * prox * fE * fR * eq.vF;
  // --- Rotation interne d'épaule estimée ---
  // Moins les jambes et le tronc contribuent, plus le bras doit produire la vitesse : IR ∝ V · (prox0/prox)^2,5
  // (Elliott 2003 : sans flexion des genoux, couple de rotation interne +23 % pour la même vitesse).
  const r = Pb.prox0 / prox;
  const IR = Pb.IR0 * (V / Pb.V0) * r * r * Math.sqrt(r) * eq.loadF;
  m[8] = IR;
  if (IR > Pb.IRlim) { m[7] = REJ.shoulder; return -Infinity; }
  // --- Impact ---
  const o = impactSolveInto(eq.imp, V, x[7], x[8], M.u, Pb.tmpI);
  const speed = o[0], launch = o[1], spin = o[2];
  const h0 = Pb.serve ? c * Pb.H + M.wristToCenter : M.h0; // centre du tamis ≈ 0,47 m au-dessus du poignet
  // --- Probabilité de balle bonne (surrogate) ---
  const w = windowLookup(Pb.table, speed, spin, h0, Pb.tmpW);
  // Dispersion : vitesse–précision (σ ∝ V), et geste nouveau = moins régulier (distance à l'habitude)
  let u2 = 0;
  for (let i = 0; i < NP; i++) if (Pb.active[i]) { const d = (x[i] - Pb.x0[i]) / Pb.M.trust[i]; u2 += d * d; }
  const fam = 1 + 0.6 * u2 / Pb.nActive;
  const D = Pb.disp;
  const sa = D.angle * (V / Pb.V0) * fam * eq.dispF;
  const sv = D.speed * fam * speed, ss = D.spin * fam * (spin < 0 ? -spin : spin);
  const a2 = w[2] * sv, a4 = w[4] * ss, a3 = w[3] * sv, a5 = w[5] * ss;
  const sLo = Math.sqrt(sa * sa + a2 * a2 + a4 * a4);
  const sHi = Math.sqrt(sa * sa + a3 * a3 + a5 * a5);
  let P = w[1] > w[0] ? Phi((w[1] - launch) / sHi) - Phi((w[0] - launch) / sLo) : 0;
  if (P < 0) P = 0;
  m[0] = speed * 3.6; m[1] = spin; m[2] = P; m[3] = IR / Pb.IRlim; m[4] = launch; m[5] = V; m[6] = h0; m[9] = sa;
  return objective(Pb, m, eq);
}

// Objectif à maximiser (sans dimension). Les contraintes « ne pas perdre en réussite / en vitesse » sont des
// pénalités raides, pour que l'optimiseur ne « gagne » pas en dégradant l'autre axe.
function objective(Pb, m, eq) {
  const R = Pb.ref;
  const kmhR = m[0] / R.kmh, P = m[2];
  const spinN = Math.max(1500, Math.abs(R.spin));
  const lossP = Math.max(0, R.P - 0.01 - P);
  switch (Pb.goalId) {
    case 0: return kmhR - 1 - 4 * lossP;
    case 1: return (m[1] - R.spin) / spinN - 4 * lossP - 3 * Math.max(0, 0.93 - kmhR);
    case 2: return (P - R.P) - 0.4 * (m[3] - R.load) - 3 * Math.max(0, 0.97 - kmhR) + 0.3 * (eq.comfort - R.comfort);
    default: return 0.5 * (kmhR - 1) + 0.2 * (m[1] - R.spin) / spinN + (P - R.P) - 0.2 * (m[3] - R.load) + 0.15 * (eq.comfort - R.comfort);
  }
}

// Gain affiché (en %) sur la métrique principale de l'objectif
export function gainPct(Pb, mo, ref = Pb.ref) {
  switch (Pb.goal) {
    case 'speed': return (mo.ballKmh / ref.kmh - 1) * 100;
    case 'spin': return ((mo.spinRpm - ref.spin) / Math.max(1500, Math.abs(ref.spin))) * 100;
    case 'safety': return ((mo.successRate - ref.P) / Math.max(0.1, ref.P)) * 100;
    default: return (0.5 * (mo.ballKmh / ref.kmh - 1) + 0.2 * (mo.spinRpm - ref.spin) / Math.max(1500, Math.abs(ref.spin)) + (mo.successRate - ref.P) - 0.2 * (mo.load - ref.load) + 0.15 * ((mo.comfort ?? ref.comfort) - ref.comfort)) * 100;
  }
}

function metricsObj(m) {
  return { ballKmh: m[0], spinRpm: m[1], successRate: m[2], load: m[3], launchDeg: m[4], racketKmh: m[5] * 3.6, h0: m[6], ir: m[8], sigmaAngle: m[9] };
}

// ---------------------------------------------------------------------------------------------
// Recherche : Monte-Carlo (exploration) puis CMA-ES (affinage) autour des meilleurs, avec redémarrages.
// Générateur : rend la main toutes les ~CHUNK évaluations (progression, annulation en mode thread courant).
const CHUNK = 1 << 16;
const KMH0 = 40, KMH_STEP = 0.5, NBIN = 560; // frontière : cases de 0,5 km/h de 40 à 320 km/h

// Générateur public : fine enveloppe autour d'un état de recherche « par tranches » (les boucles chaudes vivent
// dans des fonctions ordinaires, mieux optimisées par les moteurs JS que le corps d'un générateur).
export function* searchGen(Pb, opts) {
  const S = makeSearch(Pb, opts);
  while (!S.step(CHUNK)) yield S.progress();
  return S.result();
}

function makeSearch(Pb, { evals, seed = 1, part = 0, nParts = 1, cloudMax = 4000 }) {
  const rng = makeRng(seed * 2654435761 + part * 97 + 1);
  const U = () => rng() / 4294967296;
  const N = () => GT[rng() & 65535];
  const n = NP, x = new Float64Array(n), m = Pb.m;
  const lo = Pb.lo, hi = Pb.hi, x0 = Pb.x0, act = Pb.active, trust = Pb.M.trust;
  const eq = Pb.eq0;
  // Suivis
  let trials = 0, feasible = 0;
  const rejected = [0, 0, 0, 0, 0];
  const frP = new Float32Array(NBIN).fill(-1), frL = new Float32Array(NBIN), frS = new Float32Array(NBIN);
  const cloud = new Float32Array(cloudMax * 4); let cloudN = 0, seen = 0;
  const K = 16, el = new Float64Array(K * n), elJ = new Float64Array(K).fill(-Infinity);
  let best = { J: -Infinity };
  let elWorst = 0, elWorstJ = -Infinity;

  const record = (J, xx) => {
    trials++;
    if (J === -Infinity) { rejected[m[7]]++; return; }
    feasible++;
    // frontière vitesse ↔ réussite
    const b = Math.floor((m[0] - KMH0) / KMH_STEP);
    if (b >= 0 && b < NBIN && m[2] > frP[b]) { frP[b] = m[2]; frL[b] = m[4]; frS[b] = m[1]; }
    // nuage : échantillonnage par réservoir
    seen++;
    if (cloudN < cloudMax) { const o = cloudN * 4; cloud[o] = m[0]; cloud[o + 1] = m[2]; cloud[o + 2] = m[1]; cloud[o + 3] = m[3]; cloudN++; }
    else { const j = rng() % seen; if (j < cloudMax) { const o = j * 4; cloud[o] = m[0]; cloud[o + 1] = m[2]; cloud[o + 2] = m[1]; cloud[o + 3] = m[3]; } }
    // élites (diversifiées) ; la plus faible est mise en cache (test en O(1) pour l'immense majorité des essais)
    if (J <= elWorstJ) return;
    let slot = elWorst;
    for (let i = 0; i < K; i++) {
      if (elJ[i] === -Infinity) continue;
      let d = 0;
      for (let j = 0; j < n; j++) if (act[j]) { const q = (xx[j] - el[i * n + j]) / trust[j]; d += q * q; }
      if (d < 0.02) { if (J <= elJ[i]) return; slot = i; break; }
    }
    elJ[slot] = J; for (let j = 0; j < n; j++) el[slot * n + j] = xx[j];
    if (J > best.J) best = { J, ballKmh: m[0], spinRpm: m[1], successRate: m[2], load: m[3] };
    elWorst = 0; for (let i = 1; i < K; i++) if (elJ[i] < elJ[elWorst]) elWorst = i;
    elWorstJ = elJ[elWorst];
  };
  const progress = () => ({ trials, best: best.J > -Infinity ? { ...best, gainPct: gainPct(Pb, best) } : null });

  // --- Phase 1 : Monte-Carlo (55 % du budget) — moitié uniforme dans la boîte, moitié gaussienne autour de l'actuel
  const nMC = Math.floor(evals * 0.55);
  let iMC = 0;
  const mcChunk = (stopAt) => {
    while (iMC < nMC && trials < stopAt) {
      if (iMC & 1) { for (let j = 0; j < n; j++) x[j] = act[j] ? lo[j] + (hi[j] - lo[j]) * U() : x0[j]; }
      else {
        for (let j = 0; j < n; j++) {
          if (!act[j]) { x[j] = x0[j]; continue; }
          const v = x0[j] + N() * trust[j] * 0.4;
          x[j] = v < lo[j] ? lo[j] : v > hi[j] ? hi[j] : v;
        }
      }
      record(evalX(Pb, x, eq, m), x);
      iMC++;
    }
  };

  // --- Phase 2 : CMA-ES (μ/μ_w, λ) en coordonnées normalisées, redémarré depuis les élites (Hansen 2016)
  const idx = []; for (let j = 0; j < n; j++) if (act[j] && hi[j] > lo[j]) idx.push(j);
  const d = idx.length;
  const lam = 32, mu = 16;
  const wts = new Float64Array(mu); let ws = 0;
  for (let i = 0; i < mu; i++) { wts[i] = Math.log(mu + 0.5) - Math.log(i + 1); ws += wts[i]; }
  let w2 = 0; for (let i = 0; i < mu; i++) { wts[i] /= ws; w2 += wts[i] * wts[i]; }
  const mueff = 1 / w2;
  const dd = Math.max(1, d);
  const cc = (4 + mueff / dd) / (dd + 4 + 2 * mueff / dd), cs = (mueff + 2) / (dd + mueff + 5);
  const c1 = 2 / ((dd + 1.3) ** 2 + mueff), cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((dd + 2) ** 2 + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (dd + 1)) - 1) + cs;
  const chiN = Math.sqrt(dd) * (1 - 1 / (4 * dd) + 1 / (21 * dd * dd));
  const mean = new Float64Array(dd), old = new Float64Array(dd), pc = new Float64Array(dd), ps = new Float64Array(dd);
  const Cm = new Float64Array(dd * dd), B = new Float64Array(dd * dd), Dg = new Float64Array(dd);
  const Y = new Float64Array(lam * dd), Xn = new Float64Array(lam * dd), Jv = new Float64Array(lam);
  const order = new Int32Array(lam), tmp = new Float64Array(dd), yw = new Float64Array(dd);
  const span = new Float64Array(dd); for (let a = 0; a < d; a++) span[a] = hi[idx[a]] - lo[idx[a]];
  let restart = 0, sigma = 0, gen = 0, stall = 0, bestRun = -Infinity, running = false;
  const cmaStart = () => {
    // départ : élite (rotation sur les 6 meilleures), perturbée et plus large après le premier tour
    let ranked = [];
    for (let i = 0; i < K; i++) if (elJ[i] > -Infinity) ranked.push(i);
    ranked.sort((p, q) => elJ[q] - elJ[p]);
    const src = ranked.length ? ranked[restart % Math.min(ranked.length, 6)] : -1;
    for (let a = 0; a < d; a++) {
      const j = idx[a];
      const v0 = src >= 0 ? el[src * n + j] : x0[j];
      mean[a] = Math.min(1, Math.max(0, (v0 - lo[j]) / span[a] + (restart >= 6 ? N() * 0.05 : 0)));
      pc[a] = 0; ps[a] = 0;
    }
    Cm.fill(0); B.fill(0); for (let a = 0; a < d; a++) { Cm[a * d + a] = 1; B[a * d + a] = 1; Dg[a] = 1; }
    sigma = restart < 6 ? 0.12 : 0.25; gen = 0; stall = 0; bestRun = -Infinity; running = true;
    restart++;
  };
  // Une génération : λ tirages, évaluation, mise à jour de la moyenne, des chemins, de C et de σ
  const cmaGeneration = () => {
    for (let k = 0; k < lam; k++) {
      for (let a = 0; a < d; a++) tmp[a] = Dg[a] * N();
      let pen = 0;
      for (let a = 0; a < d; a++) {
        let s = 0; for (let b = 0; b < d; b++) s += B[a * d + b] * tmp[b];
        Y[k * d + a] = s;
        const v = mean[a] + sigma * s;
        Xn[k * d + a] = v;
        const vc = v < 0 ? 0 : v > 1 ? 1 : v;   // réparation par projection + pénalité quadratique
        pen += (v - vc) * (v - vc);
        x[idx[a]] = lo[idx[a]] + vc * span[a];
      }
      for (let j = 0; j < n; j++) if (!act[j] || hi[j] <= lo[j]) x[j] = x0[j];
      const J = evalX(Pb, x, eq, m);
      record(J, x);
      Jv[k] = J === -Infinity ? -1e6 - pen : J - 2 * pen;
    }
    // tri par insertion décroissant (λ = 32 : plus rapide qu'un sort à comparateur)
    for (let k = 0; k < lam; k++) {
      let i = k; const jk = Jv[k];
      while (i > 0 && Jv[order[i - 1]] < jk) { order[i] = order[i - 1]; i--; }
      order[i] = k;
    }
    if (Jv[order[0]] > bestRun + 1e-7) { bestRun = Jv[order[0]]; stall = 0; } else stall++;
    for (let a = 0; a < d; a++) { old[a] = mean[a]; let s = 0; for (let i = 0; i < mu; i++) s += wts[i] * Xn[order[i] * d + a]; mean[a] = s; yw[a] = (mean[a] - old[a]) / sigma; }
    // C^−1/2 · yw = B · D^−1 · Bᵀ · yw
    for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += B[b * d + a] * yw[b]; tmp[a] = s / Dg[a]; }
    let psn = 0;
    const kps = Math.sqrt(cs * (2 - cs) * mueff);
    for (let a = 0; a < d; a++) {
      let s = 0; for (let b = 0; b < d; b++) s += B[a * d + b] * tmp[b];
      ps[a] = (1 - cs) * ps[a] + kps * s; psn += ps[a] * ps[a];
    }
    psn = Math.sqrt(psn);
    gen++;
    const hsig = psn / Math.sqrt(1 - Math.pow(1 - cs, 2 * gen)) / chiN < 1.4 + 2 / (d + 1) ? 1 : 0;
    const kpc = hsig * Math.sqrt(cc * (2 - cc) * mueff);
    for (let a = 0; a < d; a++) pc[a] = (1 - cc) * pc[a] + kpc * yw[a];
    for (let a = 0; a < d; a++) for (let b = 0; b <= a; b++) {
      let r1 = 0; for (let i = 0; i < mu; i++) { const o = order[i] * d; r1 += wts[i] * Y[o + a] * Y[o + b]; }
      const v = (1 - c1 - cmu) * Cm[a * d + b] + c1 * (pc[a] * pc[b] + (1 - hsig) * cc * (2 - cc) * Cm[a * d + b]) + cmu * r1;
      Cm[a * d + b] = v; Cm[b * d + a] = v;
    }
    sigma *= Math.exp((cs / damps) * (psn / chiN - 1));
    // Décomposition propre paresseuse (toutes les 3 générations) : B, D restent valides entre-temps
    if (gen % 3 === 0 || gen < 3) {
      jacobiEig(Cm, d, B, Dg);
      for (let a = 0; a < d; a++) Dg[a] = Math.sqrt(Math.max(1e-20, Dg[a]));
    }
    let dmax = 0; for (let a = 0; a < d; a++) if (Dg[a] > dmax) dmax = Dg[a];
    if (sigma * dmax < 2e-4 || stall > 40 || gen > 400 || sigma > 2) running = false;
  };
  const cmaChunk = (stopAt) => {
    while (trials < stopAt && trials < evals) {
      if (d === 0) { for (let j = 0; j < n; j++) x[j] = x0[j]; record(evalX(Pb, x, eq, m), x); continue; }
      if (!running) cmaStart();
      cmaGeneration();
    }
  };

  // Avance d'environ `chunk` évaluations ; renvoie true quand le budget est consommé
  const step = (chunk) => {
    const stopAt = Math.min(evals, trials + chunk);
    if (iMC < nMC) mcChunk(stopAt);
    if (iMC >= nMC) cmaChunk(stopAt);
    return trials >= evals;
  };
  const result = () => {
    const elites = [];
    for (let i = 0; i < K; i++) if (elJ[i] > -Infinity) elites.push({ J: elJ[i], x: Array.from(el.subarray(i * n, i * n + n)) });
    elites.sort((p, q) => q.J - p.J);
    return { trials, feasible, rejected, elites, frP, frL, frS, cloud: cloud.slice(0, cloudN * 4), cloudSeen: seen, best: progress().best };
  };
  return { step, progress, result };
}

// Valeurs propres d'une matrice symétrique (Jacobi cyclique). A est copiée ; V ← vecteurs propres (colonnes), w ← valeurs.
const _eigA = new Float64Array(81);
function jacobiEig(Ain, n, V, w) {
  const A = _eigA;
  for (let i = 0; i < n * n; i++) A[i] = Ain[i];
  V.fill(0); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k * n + p], akq = A[k * n + q];
        A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p * n + k], aqk = A[q * n + k];
        A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k * n + p], vkq = V[k * n + q];
        V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  for (let i = 0; i < n; i++) w[i] = A[i * n + i];
}

// ---------------------------------------------------------------------------------------------
// Matériel : grille discrète raquettes × plombs × cordage × calibre × tension (cordage neuf), à geste égal,
// avec re-visée de l'angle de face (le joueur s'adapte en quelques séances).
const LEAD_SETS = [{}, { h12: 3 }, { h12: 6 }, { h10_2: 4 }, { h9_3: 4 }, { handle: 6 }, { h12: 3, handle: 6 }];
const GAUGES = [1.2, 1.25, 1.3];
const TENSIONS = [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
export function equipmentCount() { return RACKETS.length * LEAD_SETS.length * Object.keys(STRINGS).length * GAUGES.length * TENSIONS.length; }
function comboAt(i) {
  const S = Object.keys(STRINGS);
  const t = i % TENSIONS.length; i = (i / TENSIONS.length) | 0;
  const g = i % GAUGES.length; i = (i / GAUGES.length) | 0;
  const s = i % S.length; i = (i / S.length) | 0;
  const l = i % LEAD_SETS.length; i = (i / LEAD_SETS.length) | 0;
  return { racket: RACKETS[i], leads: LEAD_SETS[l], string: S[s], gauge: GAUGES[g], tension: TENSIONS[t] };
}
const AIM = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
export const EQUIP_EVALS_PER_COMBO = AIM.length;

function evalEquip(Pb, eq, out) {
  const x = Float64Array.from(Pb.x0), m = Pb.m;
  let bJ = -Infinity, bM = null, bPhi = x[8];
  for (const da of AIM) {
    x[8] = Pb.x0[8] + da;
    const J = evalX(Pb, x, eq, m);
    if (J > bJ) { bJ = J; bM = metricsObj(m); bPhi = x[8]; }
  }
  out.J = bJ; out.m = bM; out.phi = bPhi;
  return out;
}

export function searchEquipment(Pb, { part = 0, nParts = 1 }) {
  const total = equipmentCount();
  let trials = 0, best = null;
  const o = {};
  for (let i = part; i < total; i += nParts) {
    const c = comboAt(i);
    const rk = customize(c.racket, c.leads);
    const eq = makeEquip(Pb, rk, c.string, c.tension, c.gauge);
    evalEquip(Pb, eq, o); trials += AIM.length;
    if (o.J > -Infinity && (!best || o.J > best.J)) best = { J: o.J, i, ...o.m, phi: o.phi };
  }
  return { trials, best };
}

// ---------------------------------------------------------------------------------------------
// Validation par la vraie intégration (flightFast) : Monte-Carlo gaussien sur (angle, vitesse, effet).
function validateP(Pb, mo, sigmaAngle, fam, N, rng) {
  const D = Pb.disp, M = Pb.M;
  const lim = M.target === 'service' ? COURT.service : COURT.base, clear = COURT.netH + 0.0335;
  const nom = { v: 0, launch: 0, spinRpm: 0, h0: mo.h0, x0: M.x0, rho: Pb.rho, wind: Pb.wind, xStop: lim + 0.5 };
  const v = mo.ballKmh / 3.6;
  let ok = 0;
  const g = () => { const u1 = (rng() + 1) / 4294967297, u2 = rng() / 4294967296; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
  for (let i = 0; i < N; i++) {
    nom.v = v * (1 + g() * D.speed * fam);
    nom.launch = mo.launchDeg + g() * sigmaAngle;
    nom.spinRpm = mo.spinRpm * (1 + g() * D.spin * fam);
    const f = flightFast(nom);
    if (f.netY !== null && f.netY >= clear && f.bounce && f.bounce.x <= lim && f.bounce.x >= COURT.net) ok++;
  }
  return ok / N;
}

function famOf(Pb, x) {
  let u2 = 0;
  for (let i = 0; i < NP; i++) if (Pb.active[i]) { const d = (x[i] - Pb.x0[i]) / Pb.M.trust[i]; u2 += d * d; }
  return 1 + 0.6 * u2 / Pb.nActive;
}

export function paramsObj(Pb, x, launchDeg) {
  const p = {};
  PARAM_KEYS.forEach((k, i) => { p[k] = x[i]; });
  p.launchDeg = launchDeg;
  return p;
}

// Finalisation : validation des meilleurs, sensibilité, matériel. elites = [{J, x}], equipBest = {i, ...}
export function finalize(Pb, { elites, equipBest, nValidate = 10, mcN = 3000, seed = 7 }) {
  const rng = makeRng(seed * 7919 + 3);
  let flights = 0;
  const m = Pb.m;
  const evalFull = (x, eq = Pb.eq0) => { const J = evalX(Pb, x, eq, m); return { J, mo: metricsObj(m), rej: m[7] }; };
  // actuel validé
  const cur = evalFull(Pb.x0);
  const P0v = validateP(Pb, cur.mo, cur.mo.sigmaAngle, 1, mcN, rng); flights += mcN;
  const refV = { ...Pb.ref, P: P0v };
  const J = (mo, eq = Pb.eq0) => {
    const mm = new Float64Array(10);
    mm[0] = mo.ballKmh; mm[1] = mo.spinRpm; mm[2] = mo.successRate; mm[3] = mo.load;
    const save = Pb.ref; Pb.ref = refV; const j = objective(Pb, mm, eq); Pb.ref = save; return j;
  };
  const curOut = { ...cur.mo, successRate: P0v, successSurrogate: cur.mo.successRate };
  let best = { J: J(curOut), x: Array.from(Pb.x0), mo: curOut, isCurrent: true };
  for (const e of elites.slice(0, nValidate)) {
    const r = evalFull(Float64Array.from(e.x));
    if (r.J === -Infinity) continue;
    const Pv = validateP(Pb, r.mo, r.mo.sigmaAngle, famOf(Pb, e.x), mcN, rng); flights += mcN;
    const mo = { ...r.mo, successRate: Pv, successSurrogate: r.mo.successRate };
    const j = J(mo);
    if (j > best.J) best = { J: j, x: e.x, mo, isCurrent: false };
  }
  // Sensibilité : un seul paramètre du geste déplacé vers sa valeur optimale, les autres restant actuels ;
  // la visée (angle de face φ) se réajuste, comme le fait spontanément un joueur. Évaluée sur le surrogate ;
  // les effets ne sont PAS additifs (couplages vitesse ↔ fenêtre d'angle).
  const sensitivity = [];
  const xb = best.x;
  const reAim = (x) => {
    let bJ = -Infinity, bMo = null;
    for (const da of AIM) {
      x[8] = Math.min(Pb.hi[8], Math.max(Pb.lo[8], Pb.x0[8] + da));
      const r = evalFull(x);
      if (r.J > bJ) { bJ = r.J; bMo = r.mo; }
    }
    return bJ === -Infinity ? null : bMo;
  };
  const base = reAim(Float64Array.from(Pb.x0));
  const g0 = base ? gainPct(Pb, base) : 0; // part due à la seule re-visée, retranchée
  for (let i = 0; i < NP; i++) {
    if (i === 8 || !Pb.active[i] || Math.abs(xb[i] - Pb.x0[i]) < 1e-9) continue;
    const x = Float64Array.from(Pb.x0); x[i] = xb[i];
    const mo = reAim(x);
    const key = PARAM_KEYS[i];
    sensitivity.push({
      key, label: PARAM_META[key].label, unit: PARAM_META[key].unit, from: Pb.x0[i], to: xb[i],
      gainPct: mo ? gainPct(Pb, mo) - g0 : 0,
      feasible: !!mo,
    });
  }
  sensitivity.sort((a, b) => b.gainPct - a.gainPct);
  // Matériel : validation du meilleur et de l'actuel (même procédure de re-visée)
  let equipment = null;
  {
    const o = {};
    evalEquip(Pb, Pb.eq0, o);
    const curEq = o.m;
    const PcurEq = validateP(Pb, curEq, curEq.sigmaAngle, 1, mcN, rng); flights += mcN;
    curEq.comfort = Pb.eq0.comfort;
    let bestEq = { ...curEq, successRate: PcurEq }, combo = null, isCurrent = true;
    if (equipBest) {
      const c = comboAt(equipBest.i);
      const rk = customize(c.racket, c.leads);
      const eq = makeEquip(Pb, rk, c.string, c.tension, c.gauge);
      evalEquip(Pb, eq, o);
      const Pv = validateP(Pb, o.m, o.m.sigmaAngle, 1, mcN, rng); flights += mcN;
      const cand = { ...o.m, successRate: Pv, comfort: eq.comfort };
      if (J(cand, eq) > J({ ...curEq, successRate: PcurEq }, Pb.eq0)) { bestEq = cand; combo = c; isCurrent = false; }
    }
    const E = Pb.eqCfg;
    const refEq = { ...refV, kmh: curEq.ballKmh, spin: curEq.spinRpm, P: PcurEq, load: curEq.load };
    equipment = {
      best: combo
        ? { racket: combo.racket.id, racketName: combo.racket.name, leads: combo.leads, string: combo.string, stringName: STRINGS[combo.string].label, tension: combo.tension, gauge: combo.gauge, ballKmh: bestEq.ballKmh, spinRpm: bestEq.spinRpm, successRate: bestEq.successRate, comfort: bestEq.comfort }
        : { racket: E.racket.id ?? null, racketName: E.racket.name, leads: E.leads, string: E.string, stringName: STRINGS[E.string].label, tension: E.tension, gauge: E.gauge, ballKmh: bestEq.ballKmh, spinRpm: bestEq.spinRpm, successRate: bestEq.successRate, comfort: bestEq.comfort },
      current: { ballKmh: curEq.ballKmh, spinRpm: curEq.spinRpm, successRate: PcurEq, tensionNow: Pb.T0now, comfort: curEq.comfort },
      gainPct: isCurrent ? 0 : gainPct(Pb, bestEq, refEq),
      isCurrent,
    };
  }
  const bo = best.mo;
  const gains = {
    speedPct: (bo.ballKmh / curOut.ballKmh - 1) * 100,
    spinPct: ((bo.spinRpm - curOut.spinRpm) / Math.max(1500, Math.abs(curOut.spinRpm))) * 100,
    successPts: (bo.successRate - curOut.successRate) * 100,
    shoulderLoadPct: (bo.ir / curOut.ir - 1) * 100,
  };
  return {
    flights,
    current: { racketKmh: curOut.racketKmh, ballKmh: curOut.ballKmh, spinRpm: curOut.spinRpm, successRate: curOut.successRate, successSurrogate: curOut.successSurrogate, launchDeg: curOut.launchDeg, shoulderIR: curOut.ir, params: paramsObj(Pb, Pb.x0, curOut.launchDeg) },
    best: {
      params: paramsObj(Pb, best.x, bo.launchDeg), ballKmh: bo.ballKmh, spinRpm: bo.spinRpm, successRate: bo.successRate,
      successSurrogate: bo.successSurrogate, racketKmh: bo.racketKmh, shoulderIR: bo.ir,
      gainPct: best.isCurrent ? 0 : gainPct(Pb, bo, refV), gains, isCurrent: best.isCurrent,
    },
    sensitivity, equipment,
  };
}

// ---------------------------------------------------------------------------------------------
// Point d'entrée Web Worker (uniquement si ce module tourne dans un worker)
const inWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
if (inWorker) {
  let Pb = null, PbKey = '';
  const problem = (cfg) => { const k = JSON.stringify(cfg); if (k !== PbKey) { Pb = buildProblem(cfg); PbKey = k; } return Pb; };
  self.onmessage = (e) => {
    const msg = e.data;
    try {
      if (msg.type === 'search') {
        const P = problem(msg.cfg);
        const eqRes = searchEquipment(P, { part: msg.part, nParts: msg.nParts });
        self.postMessage({ type: 'progress', trials: eqRes.trials, best: null });
        const it = searchGen(P, { evals: Math.max(0, msg.evals - eqRes.trials), seed: msg.seed, part: msg.part, nParts: msg.nParts, cloudMax: msg.cloudMax });
        let r, last = now();
        while (!(r = it.next()).done) {
          const t = now();
          if (t - last > 120) { last = t; self.postMessage({ type: 'progress', trials: eqRes.trials + r.value.trials, best: r.value.best }); }
        }
        const out = r.value;
        out.trials += eqRes.trials;
        out.equipBest = eqRes.best;
        out.setupMs = P.setupMs;
        self.postMessage({ type: 'done', result: out }, [out.frP.buffer, out.frL.buffer, out.frS.buffer, out.cloud.buffer]);
      } else if (msg.type === 'finalize') {
        const P = problem(msg.cfg);
        self.postMessage({ type: 'final', result: finalize(P, msg) });
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  };
}
