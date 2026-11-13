// KYRON · physique raquette, cordage, impact, trajectoire (v1)
// Unités SI sauf mention : masses en kg, longueurs en m (cm pour les specs raquette), angles en degrés en entrée.
//
// Ce module est un modèle physique SIMPLIFIÉ, calibré sur des ordres de grandeur publiés :
//   - Cross & Lindsey (Technical Tennis, 2005), Brody, Cross & Lindsey (The Physics and Technology of Tennis, 2002) :
//     COR apparent e_A ≈ 0,4 au centre du tamis, temps de contact ≈ 4–5 ms, roulement de la balle sur le cordage ;
//   - Štěpánek (1988), Goodwill et al. (2004) : coefficients de traînée et de portance (Magnus) d'une balle de tennis ;
//   - Cross & Bower (2006) : la vitesse de swing baisse quand le swingweight augmente (exposant ≈ 0,27).
// Limites assumées : impact 2D dans le plan de frappe (pas d'effet latéral), raquette libre (la main est négligée
// pendant les ~4 ms du contact, cf. Cross), cordage = ressort linéaire, balle = ressort linéaire en série,
// effet de la balle entrante ignoré, trajectoire 2D (pas de vent latéral ni de slice latéral).

export const BALL = { m: 0.0577, r: 0.0335, I: 0.55, kBall: 75000 }; // I = facteur k de I = k·m·r² (coque creuse ≈ 0,55) ; kBall en N/m
export const COURT = { net: 11.885, netH: 0.914, service: 18.285, base: 23.77, halfW: 4.115 };
const DEG = Math.PI / 180;
const G = 9.81;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Raquette ----------
export const RACKETS = [
  { id: 'ctrl98', name: 'Contrôle 98', mass: 315, balance: 31.5, sw: 325, tw: 14.0, ra: 64, head: 98, pattern: '16x19' },
  { id: 'tour97', name: 'Tour 97 lourde', mass: 340, balance: 31.0, sw: 340, tw: 14.5, ra: 66, head: 97, pattern: '16x19' },
  { id: 'pow100', name: 'Puissance 100', mass: 300, balance: 33.0, sw: 318, tw: 15.0, ra: 71, head: 100, pattern: '16x19' },
  { id: 'spin100', name: 'Spin 100 ouvert', mass: 300, balance: 32.5, sw: 320, tw: 14.8, ra: 68, head: 100, pattern: '16x19' },
  { id: 'prec18', name: 'Précision 18×20', mass: 305, balance: 32.0, sw: 322, tw: 14.2, ra: 65, head: 98, pattern: '18x20' },
  { id: 'light', name: 'Légère 102', mass: 285, balance: 33.5, sw: 305, tw: 15.5, ra: 70, head: 102, pattern: '16x19' },
];

// Positions de plomb (distance au bas du manche, écart latéral à l'axe)
export const LEAD_SPOTS = {
  h12: { label: '12 h (tête)', d: 67, lat: 0 },
  h10_2: { label: '10 h + 2 h', d: 61, lat: 9 },
  h9_3: { label: '9 h + 3 h', d: 54, lat: 13.5 },
  throat: { label: 'Cœur', d: 40, lat: 0 },
  handle: { label: 'Manche', d: 8, lat: 0 },
};

// Raquette physique : masse (g), équilibre (cm), SW (kg·cm² autour d'un axe à 10 cm), TW (kg·cm²)
export function customize(r, leads = {}) {
  let m = r.mass / 1000, bal = r.balance, sw = r.sw, tw = r.tw;
  for (const [k, g] of Object.entries(leads || {})) {
    if (!g || !LEAD_SPOTS[k]) continue;
    const s = LEAD_SPOTS[k], mp = g / 1000;
    bal = (m * bal + mp * s.d) / (m + mp);
    m += mp;
    sw += mp * (s.d - 10) ** 2;   // théorème de Huygens : plomb ponctuel à (d − 10) cm de l'axe du swingweight
    tw += mp * s.lat ** 2;        // idem autour de l'axe longitudinal (plombs latéraux uniquement)
  }
  const Icm = (sw - m * (bal - 10) ** 2) / 1e4; // kg·m² autour du centre de masse (axe transversal)
  // Centre de percussion depuis le bas du manche, pour un pivot à 10 cm : q = I_axe / (m·r_cm)
  const cop = 10 + (sw / 1e4) / (m * ((bal - 10) / 100)) * 100;
  return { mass: m * 1000, balance: bal, sw, tw, Icm, cop, ra: r.ra, head: r.head, pattern: r.pattern, name: r.name, id: r.id };
}

// Masse effective au point d'impact (distance au bas du manche en cm), pour un choc normal au tamis.
// Raquette libre : 1/Me = 1/m + x²/I_cm (translation + rotation autour du centre de masse).
export function effectiveMass(rk, impactCm = 54) {
  const m = rk.mass / 1000, x = (impactCm - rk.balance) / 100;
  return 1 / (1 / m + (x * x) / rk.Icm);
}

// ---------- Cordage ----------
// k : raideur relative ; e : correction de COR ; snap : surcroît d'effet par glissement/retour des cordes (« snapback »,
// mesuré surtout sur les polyesters lisses) ; mu : frottement balle/cordage ; tauH, keep, wearPerH : relaxation et usure.
export const STRINGS = {
  poly: { label: 'Polyester', k: 1.15, e: -0.012, snap: 1.14, mu: 0.45, comfort: 0.55, tauH: 8, keep: 0.8, wearPerH: 0.006 },
  copoly_soft: { label: 'Co-poly souple', k: 1.05, e: -0.006, snap: 1.12, mu: 0.45, comfort: 0.68, tauH: 10, keep: 0.82, wearPerH: 0.005 },
  multi: { label: 'Multifilament', k: 0.9, e: 0.01, snap: 0.98, mu: 0.4, comfort: 0.9, tauH: 24, keep: 0.86, wearPerH: 0.003 },
  gut: { label: 'Boyau naturel', k: 0.92, e: 0.016, snap: 1.06, mu: 0.42, comfort: 1, tauH: 48, keep: 0.92, wearPerH: 0.002 },
  hybrid: { label: 'Hybride poly / boyau', k: 1.03, e: 0.004, snap: 1.1, mu: 0.44, comfort: 0.8, tauH: 14, keep: 0.86, wearPerH: 0.004 },
};

// ---------- D06 · Hybrides ----------
// Un cordage se décrit soit par une clé de STRINGS (format historique), soit par un hybride :
//   { mains: { material, gauge, tension }, crosses: { material, gauge, tension } }   (material = clé de STRINGS)
// Les montants (plus longs, plus nombreux au contact) pèsent un peu plus : 55 % / 45 %.
// Frottement corde/corde μ_ss (ordres de grandeur, Cross 2010 « string movement and spin ») : un polyester lisse
// glisse sur les travers puis revient (snapback) → plus d'effet ; un multifilament ou un boyau accroche.
// Le snapback est modélisé par une loi linéaire en μ_ss, calée pour retrouver les valeurs « plein lit » de STRINGS.
export const STRING_FRICTION = { poly: 0.12, copoly_soft: 0.14, multi: 0.3, gut: 0.21, hybrid: 0.165 };
const W_MAIN = 0.55;
export function isHybrid(s) { return !!(s && typeof s === 'object' && s.mains && s.crosses); }
function matOf(x) { return STRINGS[x?.material] ? x.material : 'poly'; }
// Propriétés effectives d'un cordage (clé ou hybride). Pour une clé, renvoie STRINGS[clé] tel quel.
export function stringProps(s) {
  if (!isHybrid(s)) return STRINGS[s] || STRINGS.poly;
  const a = STRINGS[matOf(s.mains)], b = STRINGS[matOf(s.crosses)];
  const mix = (k) => W_MAIN * a[k] + (1 - W_MAIN) * b[k];
  const muSS = (STRING_FRICTION[matOf(s.mains)] + STRING_FRICTION[matOf(s.crosses)]) / 2;
  // Travers plus détendus que les montants → les montants glissent plus facilement (+1 %/kg, borné à ±5 %)
  const dT = (s.mains.tension ?? 0) - (s.crosses.tension ?? 0);
  const snap = (1.14 - 0.889 * (muSS - 0.12)) * (1 + clamp(0.01 * dT, -0.05, 0.05));
  return {
    label: `${a.label} / ${b.label}`, k: mix('k'), e: mix('e'), snap, mu: (a.mu + b.mu) / 2, comfort: 0.6 * a.comfort + 0.4 * b.comfort,
    tauH: mix('tauH'), keep: mix('keep'), wearPerH: mix('wearPerH'), muSS, hybrid: true,
  };
}
export function stringLabel(s) { return stringProps(s).label; }
// Tension et calibre effectifs : pour un hybride, moyenne pondérée montants / travers, sauf si une tension
// scalaire explicite est fournie (par exemple la tension restante calculée par tensionAfter).
function effTension(s, T) {
  if (Number.isFinite(T)) return T;
  return isHybrid(s) ? W_MAIN * (s.mains.tension ?? 23) + (1 - W_MAIN) * (s.crosses.tension ?? 23) : 23;
}
function effGauge(s, g) {
  if (isHybrid(s)) return W_MAIN * (s.mains.gauge ?? 1.25) + (1 - W_MAIN) * (s.crosses.gauge ?? 1.25);
  return Number.isFinite(g) ? g : 1.25;
}

// Raideur du lit de cordage (N/m) — ordre de grandeur 25–40 kN/m pour un tamis de 98–100 po² (Brody, Cross).
export function bedStiffness(rk, s, tensionKg, gauge = 1.25) {
  const S = stringProps(s);
  const T = effTension(s, tensionKg), g = effGauge(s, gauge);
  const dens = rk.pattern === '18x20' ? 1.08 : 1;
  return 30000 * (T / 24) * S.k * dens * (100 / rk.head) * (1 + (g - 1.25) * 0.6);
}

// Tension restante (kg) après d jours depuis la pose et h heures de jeu (hybride : T0 facultatif)
export function tensionAfter(s, T0, days, hours) {
  const S = stringProps(s);
  T0 = effTension(s, T0);
  const tInf = T0 * S.keep;
  const relax = tInf + (T0 - tInf) * Math.exp(-(days * 24) / (S.tauH * 3));
  return Math.max(T0 * 0.55, relax * (1 - S.wearPerH * hours));
}

// ---------- Impact raquette / balle ----------
// Partie indépendante de la cinématique (calculée une fois par configuration matérielle) : masse effective,
// COR de référence balle/cordage, raideurs, facteurs d'effet. Séparée pour que l'optimiseur l'appelle une seule fois.
export function impactSetup({ rk, string, tension, gauge = 1.25, impactCm = 54, offCenter = 0 }) {
  const S = stringProps(string);
  tension = effTension(string, tension); gauge = effGauge(string, gauge);
  let Me = effectiveMass(rk, impactCm);
  // Impact décentré latéralement : la raquette tourne aussi autour de son axe longitudinal (twistweight).
  if (offCenter) { const tw = rk.tw / 1e4, d = offCenter / 100; Me = 1 / (1 / Me + (d * d) / tw); }
  const k = bedStiffness(rk, string, tension, gauge);
  // COR « vrai » balle / cordage sur cadre rigide, à ~20 m/s de vitesse relative : ≈ 0,88–0,90 (Cross).
  // Basses tensions → effet trampoline (la balle se déforme moins, ses pertes internes baissent).
  const eStr = 0.9 + 0.003 * (24 - tension) + S.e - (gauge - 1.25) * 0.05;
  // Pertes vibratoires du cadre : faibles au nœud de vibration (~centre du tamis), fortes vers la pointe / le cœur,
  // d'autant plus que le cadre est souple (RA faible). Décentrage latéral : pertes supplémentaires.
  const node = 53;
  const frameLoss = 0.0008 * Math.max(0, 75 - rk.ra) * (1 + ((impactCm - node) / 6) ** 2) + Math.abs(offCenter) * 0.006;
  const e0 = eStr - frameLoss;
  const spinF = S.snap * (rk.pattern === '18x20' ? 0.93 : 1) * (1 + (1.25 - gauge) * 0.6);
  const mred = (BALL.m * Me) / (BALL.m + Me);
  const kEff = (k * BALL.kBall) / (k + BALL.kBall); // cordage et balle : deux ressorts en série
  const comfort = clamp(S.comfort * (1 - Math.max(0, rk.ra - 62) * 0.012) * (1 - Math.abs(offCenter) * 0.04) * (1 - Math.max(0, tension - 21) * 0.025), 0, 1);
  return { Me, k, kEff, mred, e0, mu: S.mu, spinF, comfort };
}

// COR vrai en fonction de la vitesse relative normale : la balle perd plus d'énergie quand elle s'écrase davantage
// (pente choisie pour retrouver ~190–220 km/h au service avec 45 m/s de vitesse de tête).
export function corAt(e0, vRelN) {
  return clamp(e0 - 0.0022 * (vRelN - 20), 0.55, 0.93);
}

// Résolution de l'impact pour une cinématique donnée (V en m/s, alpha et phi en degrés, u vitesse balle entrante m/s).
// Géométrie : x vers le filet, y vers le haut ; normale du tamis n = (cos φ, sin φ) ; tangente t = (−sin φ, cos φ).
// La balle entrante arrive horizontalement vers le joueur : (−u, 0).
// Version sans allocation (boucle chaude de l'optimiseur) : out = Float64Array(9)
//   [vitesse, angle de départ °, effet tr/min, e_A, vn, vt, vitesse relative normale, e, glissement 0/1]
export function impactSolveInto(c, V, alpha, phi, u, out) {
  const p = phi * DEG, g = (alpha - phi) * DEG;
  const cp = Math.cos(p), sp = Math.sin(p);
  const Vn = V * Math.cos(g), Vt = V * Math.sin(g);
  const un = u * cp;            // vitesse normale entrante (vers la raquette)
  const ut = u * sp;            // composante tangentielle de la balle entrante (le long de t)
  const vRel = Vn + un;
  let e = c.e0 - 0.0022 * (vRel - 20); // = corAt(e0, vRel), écrit en ligne
  e = e < 0.55 ? 0.55 : e > 0.93 ? 0.93 : e;
  const eA = (e * c.Me - BALL.m) / (c.Me + BALL.m); // COR apparent (raquette libre), Cross : e_A = (e·M − m)/(M + m)
  const vn = eA * un + (1 + eA) * Vn;
  // Tangentiel : la balle glisse puis roule sur le cordage. Vitesse relative du point de contact q = Vt − ut.
  // Roulement atteint : impulsion tangentielle J/m = k/(1+k)·q (sphère creuse k = 0,55) → ω·r = J/(k·m).
  // Si le frottement ne suffit pas (|J| > μ·J_n), la balle glisse tout le contact : J/m = μ·(vn + un).
  // Le surcroît d'effet des cordes qui glissent puis reviennent (snapback) est un facteur empirique (c.spinF).
  const q = Vt - ut;
  const jRoll = ROLL_J * q;
  const jMax = c.mu * (vn + un);
  let j = jRoll, slip = 0;
  if (jRoll > jMax) { j = jMax; slip = 1; } else if (jRoll < -jMax) { j = -jMax; slip = 1; }
  const vt = ut + j;
  const spinRad = (j / (BALL.I * BALL.r)) * c.spinF; // > 0 = lift
  out[0] = Math.sqrt(vn * vn + vt * vt);
  out[1] = phi + Math.atan2(vt, vn) / DEG;
  out[2] = spinRad * RAD2RPM;
  out[3] = eA; out[4] = vn; out[5] = vt; out[6] = vRel; out[7] = e; out[8] = slip;
  return out;
}
const ROLL_J = BALL.I / (1 + BALL.I);
const RAD2RPM = 60 / (2 * Math.PI);

export function impactSolve(c, V, alpha, phi, u = 0) {
  const o = impactSolveInto(c, V, alpha, phi, u, new Float64Array(9));
  const vRel = o[6];
  // Temps de contact : demi-période d'un oscillateur masse réduite / ressorts en série ; raidissement
  // non linéaire de la balle aux fortes vitesses (≈ v^−0,08).
  const tContact = Math.PI * Math.sqrt(c.mred / c.kEff) * Math.pow(20 / Math.max(5, vRel), 0.08);
  // Force maximale pour une impulsion en demi-sinus : F_max = J·π / (2·t_c), J = m·(vn + un)
  const peakForce = BALL.m * (o[4] + u * Math.cos(phi * DEG)) * Math.PI / (2 * tContact);
  return { e: o[7], eA: o[3], speed: o[0], launch: o[1], spinRpm: o[2], spinRad: o[2] / RAD2RPM, tContact, peakForce, vn: o[4], vt: o[5], slip: o[8] === 1 };
}

// inp : { rk, string, tension, gauge, V (m/s, vitesse raquette au point d'impact), alpha (trajectoire raquette °, + = monte),
//         phi (normale de la face °, + = face ouverte), u (vitesse balle entrante m/s), impactCm, offCenter (cm latéral) }
export function impact(inp) {
  const { V, alpha, phi, u = 0 } = inp;
  const c = impactSetup(inp);
  const s = impactSolve(c, V, alpha, phi, u);
  return { Me: c.Me, k: c.k, kEff: c.kEff, e: s.e, eA: s.eA, speed: s.speed, launch: s.launch, spinRpm: s.spinRpm, spinRad: s.spinRad,
    tContact: s.tContact, peakForce: s.peakForce, comfort: c.comfort, vn: s.vn, vt: s.vt, slip: s.slip };
}

// Vitesse de swing relative quand on change de raquette (Cross & Bower 2006 : V ∝ SW^−0,27, à effort égal).
export function swingSpeedFactor(rk, rkRef) {
  return Math.pow(rk.sw / rkRef.sw, -0.27);
}

// ---------- Air ----------
export function airDensity(altM = 0, tempC = 20, humidity = 0.5) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altM, 5.25588);
  const T = tempC + 273.15;
  const pv = humidity * 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  return (p - pv) / (287.05 * T) + pv / (461.5 * T);
}

export const SURFACES = {
  hard: { label: 'Dur', ey: 0.79, mu: 0.6 },
  clay: { label: 'Terre battue', ey: 0.76, mu: 0.8 },
  grass: { label: 'Gazon', ey: 0.72, mu: 0.45 },
  indoor: { label: 'Indoor rapide', ey: 0.78, mu: 0.5 },
};

// Coefficients aérodynamiques (Štěpánek 1988, ajustés : balle feutrée neuve Cd ≈ 0,55 sans effet).
// vs = r·|ω| (vitesse périphérique). Cd croît avec l'effet ; Cl = 1 / (2,022 + 0,981·v/vs).
const A_BALL = Math.PI * BALL.r ** 2;
// Cd tabulé en fonction du paramètre d'effet S = vs/v (Math.exp/log coûtent ~50 ns : trop pour la boucle chaude).
const CD_N = 512, CD_SMAX = 1.2;
const CD_TAB = new Float64Array(CD_N + 1);
for (let i = 0; i <= CD_N; i++) {
  const S = (i / CD_N) * CD_SMAX;
  CD_TAB[i] = S <= 0 ? 0.55 : 0.55 + 1 / Math.pow(22.053 + 4.196 * Math.pow(1 / S, 2.5), 0.4);
}
function aeroCd(sp, vs) {
  let f = (vs / sp) * (CD_N / CD_SMAX);
  if (f >= CD_N) return CD_TAB[CD_N];
  const i = f | 0; f -= i;
  return CD_TAB[i] + (CD_TAB[i + 1] - CD_TAB[i]) * f;
}
function aeroCl(sp, vs) {
  return vs / (2.022 * vs + 0.981 * sp); // = 1 / (2,022 + 0,981·v/vs), nul sans effet
}
// Décroissance de l'effet en vol : couple visqueux ∝ ρ·v·ω (≈ 4–5 %/s à 30 m/s). Ordre de grandeur, peu sensible.
const SPIN_DECAY = 0.0016 / 1.21;

// Dérivées de l'état (x, y, vx, vy) ; w (rad/s, > 0 = lift) supposé constant sur le pas.
function deriv4(vx, vy, w, rho, wind, out) {
  const rx = vx - wind, ry = vy, sp = Math.sqrt(rx * rx + ry * ry) || 1e-9;
  const vs = BALL.r * Math.abs(w);
  const kD = 0.5 * rho * A_BALL * aeroCd(sp, vs) * sp / BALL.m;
  const kL = 0.5 * rho * A_BALL * aeroCl(sp, vs) * sp / BALL.m * (w >= 0 ? 1 : -1);
  // Magnus : perpendiculaire à la vitesse relative ; lift (w > 0) pousse vers le bas en avançant
  out[0] = -kD * rx + kL * ry;
  out[1] = -kD * ry - kL * rx - G;
}

// Trajectoire 2D (x vers le filet, y vertical ; y = hauteur du CENTRE de la balle). spin > 0 = lift.
// Intégration RK4 à pas fixe de l'état complet. Renvoie points + évènements (filet, rebond, après rebond).
export function flight({ v, launch, spinRpm, h0, x0 = 0, rho = 1.2, wind = 0, surface = 'hard', dt = 0.002, maxT = 3, keepPts = true }) {
  const r = BALL.r;
  let x = x0, y = h0, vx = v * Math.cos(launch * DEG), vy = v * Math.sin(launch * DEG);
  let w = spinRpm * 2 * Math.PI / 60;
  const pts = keepPts ? [[x, y]] : null;
  let netY = null, bounce = null, after = null, t = 0;
  const S = SURFACES[surface] || SURFACES.hard;
  const a1 = [0, 0], a2 = [0, 0], a3 = [0, 0], a4 = [0, 0];
  while (t < maxT) {
    deriv4(vx, vy, w, rho, wind, a1);
    const v2x = vx + a1[0] * dt / 2, v2y = vy + a1[1] * dt / 2; deriv4(v2x, v2y, w, rho, wind, a2);
    const v3x = vx + a2[0] * dt / 2, v3y = vy + a2[1] * dt / 2; deriv4(v3x, v3y, w, rho, wind, a3);
    const v4x = vx + a3[0] * dt, v4y = vy + a3[1] * dt; deriv4(v4x, v4y, w, rho, wind, a4);
    const nx = x + dt * (vx + 2 * v2x + 2 * v3x + v4x) / 6, ny = y + dt * (vy + 2 * v2y + 2 * v3y + v4y) / 6;
    const nvx = vx + dt * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]) / 6, nvy = vy + dt * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]) / 6;
    if (netY === null && x < COURT.net && nx >= COURT.net) netY = y + (ny - y) * (COURT.net - x) / (nx - x);
    const yPrev = y, xPrev = x, tPrev = t;
    x = nx; y = ny; vx = nvx; vy = nvy; t += dt;
    w *= Math.exp(-SPIN_DECAY * rho * Math.hypot(vx, vy) * dt);
    if (keepPts) pts.push([x, Math.max(0, y)]);
    if (y <= r) {
      if (!bounce) {
        // Instant du contact interpolé dans le pas (précision ~ dt² sur la position)
        const f = (yPrev - r) / ((yPrev - y) || 1e-9);
        const bx = xPrev + (x - xPrev) * f, bt = tPrev + dt * f;
        bounce = { x: bx, t: bt, vx, vy, speed: Math.hypot(vx, vy) * 3.6 };
        // Rebond : restitution verticale + frottement. Vitesse du point de contact vSurf = vx − ω·r.
        // Si le frottement suffit, la balle finit en roulement (Δv = k/(1+k)·vSurf), sinon elle glisse (Δv = μ·(1+e)·|vy|).
        const vyOut = -vy * S.ey;
        const vSurf = vx - w * r;
        const dvMax = S.mu * (1 + S.ey) * Math.abs(vy);
        const dvRoll = vSurf * (BALL.I / (1 + BALL.I));
        const dv = Math.sign(vSurf) * Math.min(Math.abs(dvRoll), dvMax);
        vx -= dv; w += dv / (BALL.I * r); vy = vyOut; y = r + 1e-4;
        after = { vx, vy, peak: (vy * vy) / (2 * G) + r, angle: Math.atan2(vy, vx) / DEG, kmh: Math.hypot(vx, vy) * 3.6, spinRpm: w * 60 / (2 * Math.PI), slip: Math.abs(dvRoll) > dvMax };
      } else break;
    }
    if (x > COURT.base + 8) break;
  }
  return { pts, netY, bounce, after, flightTime: bounce ? bounce.t : t };
}

// ---------- Trajectoire RAPIDE (utilisable des millions de fois) ----------
// RK4 à grand pas (adapté à la vitesse) + localisation des évènements (filet, sol) par interpolation de Hermite
// cubique (position ET vitesse aux deux bouts du pas → erreur O(dt⁴) sur l'évènement). Effet supposé constant
// pendant un pas, décroissance appliquée entre les pas. Pas de liste de points, aucune allocation dans la boucle.
// Renvoie { netY, bounce: { x, t, vx, vy } | null, flightTime } — compatible avec isIn().
const _a1 = [0, 0], _a2 = [0, 0], _a3 = [0, 0], _a4 = [0, 0];
export function flightFast({ v, launch, spinRpm, h0, x0 = 0, rho = 1.2, wind = 0, xNet = COURT.net, xStop = COURT.base + 4, maxT = 4 }) {
  const r = BALL.r;
  let x = x0, y = h0, vx = v * Math.cos(launch * DEG), vy = v * Math.sin(launch * DEG);
  let w = spinRpm * 2 * Math.PI / 60;
  // Pas : ≈ 2,5 m de parcours, borné ; RK4 + Hermite reste à quelques cm du rebond de référence (voir tests).
  const dt = clamp(2.5 / Math.max(5, v), 0.025, 0.08);
  let netY = null, t = 0;
  while (t < maxT) {
    deriv4(vx, vy, w, rho, wind, _a1);
    const v2x = vx + _a1[0] * dt / 2, v2y = vy + _a1[1] * dt / 2; deriv4(v2x, v2y, w, rho, wind, _a2);
    const v3x = vx + _a2[0] * dt / 2, v3y = vy + _a2[1] * dt / 2; deriv4(v3x, v3y, w, rho, wind, _a3);
    const v4x = vx + _a3[0] * dt, v4y = vy + _a3[1] * dt; deriv4(v4x, v4y, w, rho, wind, _a4);
    const nx = x + dt * (vx + 2 * v2x + 2 * v3x + v4x) / 6, ny = y + dt * (vy + 2 * v2y + 2 * v3y + v4y) / 6;
    const nvx = vx + dt * (_a1[0] + 2 * _a2[0] + 2 * _a3[0] + _a4[0]) / 6, nvy = vy + dt * (_a1[1] + 2 * _a2[1] + 2 * _a3[1] + _a4[1]) / 6;
    if (netY === null && x < xNet && nx >= xNet) {
      const s = hermiteRoot(x, vx, nx, nvx, dt, xNet);
      netY = hermite(y, vy, ny, nvy, dt, s);
    }
    if (ny <= r) {
      const s = hermiteRoot(y, vy, ny, nvy, dt, r);
      const bx = hermite(x, vx, nx, nvx, dt, s);
      return { netY, bounce: { x: bx, t: t + s * dt, vx: vx + (nvx - vx) * s, vy: vy + (nvy - vy) * s }, flightTime: t + s * dt };
    }
    x = nx; y = ny; vx = nvx; vy = nvy; t += dt;
    w *= 1 - SPIN_DECAY * rho * Math.sqrt(vx * vx + vy * vy) * dt; // ≈ exp(−λ·dt), λ·dt ≪ 1
    if (x > xStop) break;
  }
  return { netY, bounce: null, flightTime: t };
}
// Hermite cubique sur [0,1] : p(s) avec p(0)=p0, p(1)=p1, p'(0)=v0·dt, p'(1)=v1·dt
function hermite(p0, v0, p1, v1, dt, s) {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * v0 * dt + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * v1 * dt;
}
function hermiteRoot(p0, v0, p1, v1, dt, target) {
  let s = (target - p0) / ((p1 - p0) || 1e-12);
  s = clamp(s, 0, 1);
  for (let i = 0; i < 4; i++) { // Newton (la fonction est quasi linéaire sur un pas)
    const s2 = s * s;
    const f = hermite(p0, v0, p1, v1, dt, s) - target;
    const df = (6 * s2 - 6 * s) * p0 + (3 * s2 - 4 * s + 1) * v0 * dt + (-6 * s2 + 6 * s) * p1 + (3 * s2 - 2 * s) * v1 * dt;
    if (Math.abs(df) < 1e-12) break;
    s = clamp(s - f / df, 0, 1);
  }
  return s;
}

// ---------- Fenêtre d'angle de départ ----------
// Pour (v, effet, hauteur de frappe) donnés, la balle est bonne si l'angle de départ θ est dans [θlo, θhi] :
// θlo = angle minimal qui passe le filet (+ rayon de balle), θhi = angle maximal qui retombe avant la ligne.
// Les deux bornes sont monotones en θ sur [−20°, 40°] (hors lobs), on les trouve par dichotomie.
export function launchWindow({ v, spinRpm, h0, x0 = 0, rho = 1.2, wind = 0, target = 'base', iters = 12, guess = null }) {
  const lim = target === 'service' ? COURT.service : COURT.base;
  const clear = COURT.netH + BALL.r;
  const base = { v, spinRpm, h0, x0, rho, wind, launch: 0, xStop: COURT.net + 0.5 };
  const netOk = (th) => { base.launch = th; base.xStop = COURT.net + 0.5; const f = flightFast(base); return f.netY !== null && f.netY >= clear; };
  const inLong = (th) => { base.launch = th; base.xStop = lim + 0.5; const f = flightFast(base); return f.bounce !== null && f.bounce.x <= lim; };
  const LO = -20, HI = 40;
  // Dichotomie sur un prédicat monotone (faux puis vrai si up, vrai puis faux sinon) ; crochet resserré si on a
  // une estimation (cellule voisine de la table), élargi au domaine complet si le crochet ne contient pas la borne.
  const solve = (pred, up, g) => {
    let a = LO, b = HI, n = iters;
    if (g !== null && g > LO + 2 && g < HI - 2) {
      const ga = g - 2, gb = g + 2;
      if (pred(ga) !== up && pred(gb) === up) { a = ga; b = gb; n = Math.max(6, iters - 4); }
    }
    if (a === LO) { if (pred(LO) === up) return LO; if (pred(HI) !== up) return HI; }
    for (let i = 0; i < n; i++) { const m = (a + b) / 2; if (pred(m) === up) b = m; else a = m; }
    return (a + b) / 2;
  };
  const lo = solve(netOk, true, guess ? guess.lo : null);
  const hi = solve(inLong, false, guess ? guess.hi : null);
  return { lo, hi };
}

// Table de substitution (surrogate) des fenêtres : grille v × effet × h0 → (θlo, θhi), interpolée trilinéairement.
// Construite une fois par condition (densité de l'air, vent, distance, cible) ; ~0,2–0,5 s.
export function buildWindowTable({ vMin = 10, vMax = 80, nv = 36, sMin = -3000, sMax = 6000, ns = 31, hMin = 1, hMax = 1, nh = 1, x0 = 0, rho = 1.2, wind = 0, target = 'base', iters = 11 }) {
  const lo = new Float32Array(nv * ns * nh), hi = new Float32Array(nv * ns * nh);
  const dv = (vMax - vMin) / (nv - 1), ds = (sMax - sMin) / (ns - 1), dh = nh > 1 ? (hMax - hMin) / (nh - 1) : 1;
  for (let ih = 0; ih < nh; ih++) for (let iv = 0; iv < nv; iv++) {
    let guess = null;
    for (let is = 0; is < ns; is++) {
      const wdw = launchWindow({ v: vMin + iv * dv, spinRpm: sMin + is * ds, h0: hMin + ih * dh, x0, rho, wind, target, iters, guess });
      const id = (ih * nv + iv) * ns + is;
      lo[id] = wdw.lo; hi[id] = wdw.hi;
      guess = wdw;
    }
  }
  return { vMin, dv, nv, sMin, ds, ns, hMin, dh, nh, x0, rho, wind, target, lo, hi };
}

// Interpolation trilinéaire + gradients ∂/∂v (°/(m/s)) et ∂/∂spin (°/rpm). out = Float64Array(6) :
// [θlo, θhi, dlo/dv, dhi/dv, dlo/ds, dhi/ds]. Sans allocation (appelée des millions de fois).
export function windowLookup(T, v, spin, h, out) {
  let fv = (v - T.vMin) / T.dv, fs = (spin - T.sMin) / T.ds, fh = T.nh > 1 ? (h - T.hMin) / T.dh : 0;
  fv = fv < 0 ? 0 : fv > T.nv - 1.0001 ? T.nv - 1.0001 : fv;
  fs = fs < 0 ? 0 : fs > T.ns - 1.0001 ? T.ns - 1.0001 : fs;
  fh = fh < 0 ? 0 : fh > T.nh - 1.0001 ? Math.max(0, T.nh - 1.0001) : fh;
  const iv = fv | 0, is = fs | 0, ih = fh | 0;
  const a = fv - iv, b = fs - is, c = T.nh > 1 ? fh - ih : 0;
  const ns = T.ns, nvs = T.nv * ns;
  const i000 = ih * nvs + iv * ns + is, i100 = i000 + ns, i010 = i000 + 1, i110 = i100 + 1;
  const ih1 = T.nh > 1 ? nvs : 0;
  for (let k = 0; k < 2; k++) {
    const A = k === 0 ? T.lo : T.hi;
    // plan h = ih
    const p00 = A[i000], p10 = A[i100], p01 = A[i010], p11 = A[i110];
    const q00 = A[i000 + ih1], q10 = A[i100 + ih1], q01 = A[i010 + ih1], q11 = A[i110 + ih1];
    const f00 = p00 + (q00 - p00) * c, f10 = p10 + (q10 - p10) * c, f01 = p01 + (q01 - p01) * c, f11 = p11 + (q11 - p11) * c;
    const f0 = f00 + (f10 - f00) * a, f1 = f01 + (f11 - f01) * a;
    out[k] = f0 + (f1 - f0) * b;
    out[2 + k] = ((f10 - f00) * (1 - b) + (f11 - f01) * b) / T.dv;
    out[4 + k] = (f1 - f0) / T.ds;
  }
  return out;
}

// ---------- E07 · Rebond et kick par surface ----------
// Indice de vitesse de court de l'ITF (Court Pace Rating) : CPR = 100·(1 − μ) + 150·(0,81 − e_y).
export function courtPace(surface) {
  const S = SURFACES[surface] || SURFACES.hard;
  return 100 * (1 - S.mu) + 150 * (0.81 - S.ey);
}
// Profil de rebond d'une frappe : arrivée (vitesse, angle), sortie (vitesse, angle, effet), glissement ou roulement,
// hauteur maximale après rebond, et hauteur de la balle quand elle passe la ligne de fond adverse (≈ là où le
// relanceur frappe, réglable par receiverX). Modèle de rebond : restitution verticale e_y + frottement de Coulomb
// jusqu'au roulement (Cross 2005) ; pas de déformation du court ni de dépendance de e_y à la vitesse.
export function bounceProfile(v, launch, spinRpm, surface = 'hard', { h0 = 1, x0 = -1, rho = 1.2, wind = 0, receiverX = COURT.base } = {}) {
  const tr = flight({ v, launch, spinRpm, h0, x0, rho, wind, surface, dt: 0.001, maxT: 4, keepPts: true });
  if (!tr.bounce) return null;
  const b = tr.bounce, a = tr.after;
  let heightAtReceiver = null;
  const P = tr.pts;
  for (let i = 1; i < P.length; i++) {
    if (P[i - 1][0] > b.x && P[i - 1][0] < receiverX && P[i][0] >= receiverX) {
      const k = (receiverX - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
      heightAtReceiver = P[i - 1][1] + k * (P[i][1] - P[i - 1][1]);
      break;
    }
  }
  const inAngle = Math.atan2(-b.vy, b.vx) / DEG;
  return {
    bounceX: b.x, netY: tr.netY, flightTime: b.t,
    in: { kmh: b.speed, angleDeg: inAngle, spinRpm: null },
    out: { kmh: a.kmh, angleDeg: a.angle, spinRpm: a.spinRpm, vx: a.vx, vy: a.vy },
    slide: a.slip,                       // true : la balle glisse pendant tout le contact (pas de roulement)
    peakH: a.peak,                       // hauteur max. du centre après rebond (m)
    heightAtReceiver,                    // m, null si la balle retombe avant receiverX
    kick: a.angle - inAngle,             // ° : rebond plus raide (+) ou plus rasant (−) que l'arrivée
    speedKeptPct: (a.kmh / b.speed) * 100,
    courtPace: courtPace(surface),
  };
}

// ---------- C09 · Vibrations et confort du bras ----------
// Raquette = poutre libre-libre uniforme (longueur L, masse m, rigidité EI). Premier mode de flexion :
// f₁ = (β₁L)² / (2π L²) · √(EI / μ), β₁L = 4,730, μ = m/L. Nœuds à 0,224 L et 0,776 L du bout du manche
// (≈ 15 et 53 cm pour 68,6 cm : le second tombe au centre du tamis — « sweet spot » vibratoire).
// EI est déduit du RA (indice de rigidité Babolat) par une loi de puissance calée pour qu'une raquette de RA 64
// et 315 g vibre à ≈ 145 Hz (raquettes modernes : ~120–180 Hz libres, Cross & Lindsey 2005).
// Limites : poutre uniforme (une vraie raquette est plus rigide au cœur), main = appui ignoré pour la fréquence
// (tenue en main, la fréquence baisse de 10–20 % et l'amortissement augmente fortement), un seul mode.
const BETA1 = 4.730041, SIG1 = 0.982502;
function modeShape(xi) { // normalisé à ±1 aux extrémités
  const b = BETA1 * xi;
  return (Math.cosh(b) + Math.cos(b) - SIG1 * (Math.sinh(b) + Math.sin(b))) / 2;
}
const GRIP_CM = 7; // centre de la prise (cm depuis le bout du manche)
function beamOf(rk) {
  const L = (rk.length || 68.6) / 100, m = rk.mass / 1000;
  const EI = 168.7 * Math.pow(rk.ra / 64, 2.5);
  const f = (BETA1 * BETA1) / (2 * Math.PI * L * L) * Math.sqrt(EI / (m / L));
  return { L, m, EI, f };
}
let _vibRef = null;
// Réponse brute (sans indice de confort) — utilisée aussi pour la référence de normalisation
function vibRaw(rk, impactCm, offCenter, J, tc) {
  const { L, m, f } = beamOf(rk);
  const phiI = modeShape(clamp(impactCm / 100 / L, 0, 1)), phiH = modeShape(GRIP_CM / 100 / L);
  // Réponse modale à une impulsion : amplitude au manche A = J·φ(impact)·φ(main) / (M_modale·ω), M_modale = m/4
  const ampM = Math.abs(J * phiI * phiH / ((m / 4) * 2 * Math.PI * f));
  // Choc rigide transmis à la main (pivot au manche) : impulsion P = J·(1 − x/q), nulle au centre de percussion
  const Ip = rk.Icm + m * ((rk.balance - GRIP_CM) / 100) ** 2;
  const q = Ip / (m * (rk.balance - GRIP_CM) / 100);
  const Pimp = J * (1 - ((impactCm - GRIP_CM) / 100) / q);
  // Décentrage latéral : couple de torsion J·d autour de l'axe du manche, repris par la prise (pic demi-sinus)
  return { f, L, ampM, q, armShockN: Math.abs(Pimp) * Math.PI / (2 * tc), twistNm: J * Math.abs(offCenter) / 100 / tc * Math.PI / 2 };
}
export function vibration(rk, impactCm = 54, offCenter = 0, impactRes = null) {
  // Impulsion de la balle (N·s) : celle de l'impact fourni, sinon un échange de fond de court typique (~2,6 N·s)
  const J = impactRes && Number.isFinite(impactRes.peakForce) && Number.isFinite(impactRes.tContact)
    ? impactRes.peakForce * 2 * impactRes.tContact / Math.PI : 2.6;
  const tc = impactRes?.tContact ?? 0.0042;
  const r = vibRaw(rk, impactCm, offCenter, J, tc);
  // Référence : raquette « Contrôle 98 » frappée en haut du tamis (63 cm), même impulsion → amplitudeRel = 1
  if (!_vibRef) _vibRef = customize(RACKETS[0], {});
  const ref = vibRaw(_vibRef, 63, 0, J, tc);
  const amplitudeRel = r.ampM / ref.ampM;
  // Indice de confort 0–100 (choix de modélisation, pas une mesure clinique) : vibration au manche, choc rigide,
  // torsion, et confort propre du cordage (impactRes.comfort) s'il est fourni.
  const disc = 0.55 * amplitudeRel + 0.35 * r.armShockN / ref.armShockN + 0.1 * r.twistNm / 40;
  const strComfort = impactRes?.comfort ?? 0.75;
  const comfortIndex = clamp(100 * (1 - 0.45 * disc) * (0.75 + 0.25 * strComfort), 0, 100);
  const { f, L, ampM, q, armShockN, twistNm } = r;
  return {
    // amplitudeMm : raquette LIBRE, sans amortissement de la main → borne haute, à lire en relatif
    freqHz: f, nodesCm: [0.2242 * L * 100, 0.7758 * L * 100], amplitudeMm: ampM * 1000, amplitudeRel,
    armShockN, twistNm, copCm: GRIP_CM + q * 100, impulseNs: J, comfortIndex,
  };
}

// Est-ce que la frappe est bonne ? target : 'service' ou 'base'
export function isIn(res, target) {
  if (res.netY === null || res.netY < COURT.netH + BALL.r) return { ok: false, why: 'filet' };
  if (!res.bounce) return { ok: false, why: 'long' };
  const lim = target === 'service' ? COURT.service : COURT.base;
  if (res.bounce.x < COURT.net) return { ok: false, why: 'filet' };
  if (res.bounce.x > lim) return { ok: false, why: 'long' };
  return { ok: true };
}

// Tirage gaussien (Box-Muller)
function gauss() {
  let u = 0; while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

// Monte-Carlo : taux de réussite avec dispersion (σ angle en °, σ vitesse et σ effet relatifs). Intégration rapide.
export function successRate(nom, target, disp = { angle: 0.7, speed: 0.03, spin: 0.12 }, N = 1500) {
  let ok = 0, net = 0, long = 0;
  const lim = target === 'service' ? COURT.service : COURT.base;
  for (let i = 0; i < N; i++) {
    const r = flightFast({ ...nom, v: nom.v * (1 + gauss() * disp.speed), launch: nom.launch + gauss() * disp.angle, spinRpm: nom.spinRpm * (1 + gauss() * disp.spin), xStop: lim + 0.5 });
    const s = isIn(r, target);
    if (s.ok) ok++; else if (s.why === 'filet') net++; else long++;
  }
  return { rate: ok / N, net: net / N, long: long / N };
}

// Meilleur angle de départ pour une vitesse donnée (balayage) → frontière vitesse / sécurité
export function bestAngle(nom, target, disp, N = 600) {
  let best = { rate: -1 };
  for (let a = -14; a <= 18; a += 0.5) {
    const r = flightFast({ ...nom, launch: a });
    const s = isIn(r, target);
    if (!s.ok) continue;
    const mc = successRate({ ...nom, launch: a }, target, disp, N);
    if (mc.rate > best.rate) best = { ...mc, launch: a };
  }
  return best;
}

// ---------- Recommandation cordage ----------
// opts.hybrids = true : ajoute des hybrides courants (montants / travers de matériaux différents, travers 1 kg
// plus bas). Dans ce cas l'entrée « string » peut être un objet hybride ; « label » est toujours fourni.
export function recommendStrings(base, goal, opts = {}) {
  const out = [];
  const cands = [];
  for (const s of Object.keys(STRINGS)) for (const gauge of [1.2, 1.25, 1.3]) for (let T = 18; T <= 28; T += 1) cands.push({ string: s, gauge, tension: T });
  if (opts.hybrids) {
    const mats = ['poly', 'copoly_soft', 'multi', 'gut'];
    for (const m of mats) for (const c of mats) if (m !== c) for (let T = 19; T <= 27; T += 1) {
      const hy = { mains: { material: m, gauge: 1.25, tension: T }, crosses: { material: c, gauge: 1.25, tension: T - 1 } };
      cands.push({ string: hy, gauge: effGauge(hy), tension: effTension(hy) });
    }
  }
  for (const { string: s, gauge, tension: T } of cands) {
    const im = impact({ ...base, string: s, tension: T, gauge });
    const S = stringProps(s);
    const control = clamp(0.45 + (T - 18) * 0.035 + (S.k - 1) * 0.5 + (gauge - 1.25) * 0.8, 0, 1);
    const sc = goal === 'speed' ? im.speed * 3.6 + control * 6 + im.comfort * 6
      : goal === 'spin' ? im.spinRpm / 20 + control * 12 + im.comfort * 6
      : goal === 'control' ? control * 60 + im.spinRpm / 200 + im.comfort * 8
      : im.comfort * 60 + im.speed * 3.6 / 10 + control * 6;
    const arm = Math.max(0, T - 25) ** 2 * 2 + Math.max(0, 20 - T) ** 2 * 1.5; // charge bras / perte de contrôle aux extrêmes
    out.push({ string: s, label: S.label, gauge, tension: T, score: sc - arm, speed: im.speed * 3.6, spin: im.spinRpm, control, comfort: im.comfort, tContact: im.tContact });
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set(), top = [];
  for (const o of out) { const key = o.label; if (seen.has(key)) continue; seen.add(key); top.push(o); if (top.length === 3) break; }
  return top;
}
