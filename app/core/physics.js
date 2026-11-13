// KYRON · physique raquette, cordage, impact, trajectoire (v0)
// Unités SI sauf mention : masses en kg, longueurs en m (cm pour les specs raquette), angles en degrés en entrée.

export const BALL = { m: 0.0577, r: 0.0335, I: 0.55 }; // I = k·m·r² (coque creuse ≈ 0,55)
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
  for (const [k, g] of Object.entries(leads)) {
    if (!g) continue;
    const s = LEAD_SPOTS[k], mp = g / 1000;
    bal = (m * bal + mp * s.d) / (m + mp);
    m += mp;
    sw += mp * (s.d - 10) ** 2;
    tw += mp * s.lat ** 2;
  }
  const Icm = (sw - m * (bal - 10) ** 2) / 1e4; // kg·m² autour du centre de masse
  // Point de percussion (centre de percussion) depuis l'axe à 10 cm : q = I_axe / (m·r_cm)
  const cop = 10 + (sw / 1e4) / (m * ((bal - 10) / 100)) * 100;
  return { mass: m * 1000, balance: bal, sw, tw, Icm, cop, ra: r.ra, head: r.head, pattern: r.pattern, name: r.name };
}

// Masse effective au point d'impact (distance au bas du manche en cm), pour un choc dans l'axe
export function effectiveMass(rk, impactCm = 54) {
  const m = rk.mass / 1000, x = (impactCm - rk.balance) / 100;
  return 1 / (1 / m + (x * x) / rk.Icm);
}

// ---------- Cordage ----------
export const STRINGS = {
  poly: { label: 'Polyester', k: 1.15, e: -0.012, snap: 1.14, comfort: 0.55, tauH: 8, keep: 0.8, wearPerH: 0.006 },
  copoly_soft: { label: 'Co-poly souple', k: 1.05, e: -0.006, snap: 1.12, comfort: 0.68, tauH: 10, keep: 0.82, wearPerH: 0.005 },
  multi: { label: 'Multifilament', k: 0.9, e: 0.01, snap: 0.98, comfort: 0.9, tauH: 24, keep: 0.86, wearPerH: 0.003 },
  gut: { label: 'Boyau naturel', k: 0.92, e: 0.016, snap: 1.06, comfort: 1, tauH: 48, keep: 0.92, wearPerH: 0.002 },
  hybrid: { label: 'Hybride poly / boyau', k: 1.03, e: 0.004, snap: 1.1, comfort: 0.8, tauH: 14, keep: 0.86, wearPerH: 0.004 },
};

// Raideur du lit de cordage (N/m)
export function bedStiffness(rk, s, tensionKg, gauge = 1.25) {
  const S = STRINGS[s];
  const dens = rk.pattern === '18x20' ? 1.08 : 1;
  return 30000 * (tensionKg / 24) * S.k * dens * (100 / rk.head) * (1 + (gauge - 1.25) * 0.6);
}

// Tension restante (kg) après d jours depuis la pose et h heures de jeu
export function tensionAfter(s, T0, days, hours) {
  const S = STRINGS[s];
  const tInf = T0 * S.keep;
  const relax = tInf + (T0 - tInf) * Math.exp(-(days * 24) / (S.tauH * 3));
  return Math.max(T0 * 0.55, relax * (1 - S.wearPerH * hours));
}

// ---------- Impact raquette / balle ----------
// inp : { rk, string, tension, gauge, V (m/s, vitesse raquette au point d'impact), alpha (trajectoire raquette °, + = monte),
//         phi (normale de la face °, + = face ouverte), u (vitesse balle entrante m/s), impactCm, offCenter (cm latéral) }
export function impact(inp) {
  const { rk, string, tension, gauge = 1.25, V, alpha, phi, u = 0, impactCm = 54, offCenter = 0 } = inp;
  const S = STRINGS[string];
  let Me = effectiveMass(rk, impactCm);
  if (offCenter) { const tw = rk.tw / 1e4, d = offCenter / 100; Me = 1 / (1 / Me + (d * d) / tw); }
  const k = bedStiffness(rk, string, tension, gauge);
  // COR « vrai » balle / cordage tenu à la main : effet trampoline des basses tensions, pertes du cadre (RA)
  const eStr = 0.86 + 0.0035 * (24 - tension) + S.e - (gauge - 1.25) * 0.05;
  const frameLoss = 0.0016 * Math.max(0, 75 - rk.ra) * (impactCm > 58 || impactCm < 48 ? 1.8 : 1) + Math.abs(offCenter) * 0.006;
  const e = clamp(eStr - frameLoss, 0.6, 0.92);
  const eA = (e * Me - BALL.m) / (Me + BALL.m); // COR apparent
  const gamma = (alpha - phi) * DEG;
  const Vn = V * Math.cos(gamma), Vt = V * Math.sin(gamma);
  const un = u * Math.cos(phi * DEG);
  const vn = eA * un + (1 + eA) * Vn;
  // Tangentiel : roulement au contact (coque k = 0,55) ; part de la balle et part de rotation
  const kk = BALL.I;
  const roll = 1 / (1 + 1 / kk);
  const vt = Vt * roll;
  const spinRad = (Vt * (1 - roll)) / BALL.r * S.snap * (rk.pattern === '18x20' ? 0.93 : 1) * (1 + (1.25 - gauge) * 0.6);
  const mred = (BALL.m * Me) / (BALL.m + Me);
  const tContact = Math.PI * Math.sqrt(mred / k);
  const speed = Math.hypot(vn, vt);
  const launch = phi + Math.atan2(vt, vn) / DEG;
  const peakForce = mred * (vn + un) / tContact * Math.PI / 2;
  const comfort = clamp(S.comfort * (1 - Math.max(0, rk.ra - 62) * 0.012) * (1 - Math.abs(offCenter) * 0.04) * (1 - Math.max(0, tension - 21) * 0.025), 0, 1);
  return { Me, k, e, eA, speed, launch, spinRpm: spinRad * 60 / (2 * Math.PI), spinRad, tContact, peakForce, comfort, vn, vt };
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

// Trajectoire 2D (x vers le filet, y vertical). spin > 0 = lift. Renvoie points + évènements.
export function flight({ v, launch, spinRpm, h0, x0 = 0, rho = 1.2, wind = 0, surface = 'hard', dt = 0.002, maxT = 3, keepPts = true }) {
  const A = Math.PI * BALL.r ** 2, m = BALL.m, r = BALL.r;
  let x = x0, y = h0, vx = v * Math.cos(launch * DEG), vy = v * Math.sin(launch * DEG);
  let w = spinRpm * 2 * Math.PI / 60;
  const pts = keepPts ? [[x, y]] : null;
  let netY = null, bounce = null, after = null, t = 0;
  const S = SURFACES[surface];
  const acc = (vx, vy) => {
    const rx = vx - wind, ry = vy, sp = Math.hypot(rx, ry) || 1e-6;
    const Cd = 0.55, s = (r * Math.abs(w)) / sp, Cl = Math.sign(w) / (2 + 1 / Math.max(1e-4, s));
    const kD = 0.5 * rho * A * Cd * sp / m, kL = 0.5 * rho * A * Cl * sp / m;
    // Magnus : perpendiculaire à la vitesse ; lift (w>0) pousse vers le bas en avançant
    return [-kD * rx + kL * ry, -kD * ry - kL * rx - G];
  };
  while (t < maxT) {
    const [ax1, ay1] = acc(vx, vy);
    const [ax2, ay2] = acc(vx + ax1 * dt / 2, vy + ay1 * dt / 2);
    const [ax3, ay3] = acc(vx + ax2 * dt / 2, vy + ay2 * dt / 2);
    const [ax4, ay4] = acc(vx + ax3 * dt, vy + ay3 * dt);
    const nvx = vx + (ax1 + 2 * ax2 + 2 * ax3 + ax4) * dt / 6, nvy = vy + (ay1 + 2 * ay2 + 2 * ay3 + ay4) * dt / 6;
    const nx = x + (vx + nvx) / 2 * dt, ny = y + (vy + nvy) / 2 * dt;
    if (netY === null && x < COURT.net && nx >= COURT.net) netY = y + (ny - y) * (COURT.net - x) / (nx - x);
    x = nx; y = ny; vx = nvx; vy = nvy; t += dt;
    w *= 1 - 0.02 * dt; // amortissement du spin dans l'air
    if (keepPts) pts.push([x, Math.max(0, y)]);
    if (y <= 0) {
      if (!bounce) {
        bounce = { x, t, vx, vy, speed: Math.hypot(vx, vy) * 3.6 };
        // Rebond : restitution verticale + frottement (glissement ou roulement)
        const vyOut = -vy * S.ey;
        const vSurf = vx - w * r; // vitesse du point de contact
        const dvMax = S.mu * (1 + S.ey) * Math.abs(vy);
        const dvRoll = vSurf * (BALL.I / (1 + BALL.I));
        const dv = Math.sign(vSurf) * Math.min(Math.abs(dvRoll), dvMax);
        vx -= dv; w += dv / (BALL.I * r) ; vy = vyOut; y = 0.0001;
        after = { vx, vy, peak: (vy * vy) / (2 * G), angle: Math.atan2(vy, vx) / DEG, kmh: Math.hypot(vx, vy) * 3.6, spinRpm: w * 60 / (2 * Math.PI) };
      } else break;
    }
    if (x > COURT.base + 8) break;
  }
  return { pts, netY, bounce, after, flightTime: bounce ? bounce.t : t };
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

// Monte-Carlo : taux de réussite avec dispersion
export function successRate(nom, target, disp = { angle: 0.7, speed: 0.03, spin: 0.12 }, N = 1500) {
  let ok = 0, net = 0, long = 0;
  for (let i = 0; i < N; i++) {
    const g = () => { let s = 0; for (let k = 0; k < 6; k++) s += Math.random(); return (s - 3) / Math.sqrt(0.5); };
    const r = flight({ ...nom, v: nom.v * (1 + g() * disp.speed), launch: nom.launch + g() * disp.angle, spinRpm: nom.spinRpm * (1 + g() * disp.spin), keepPts: false, dt: 0.004 });
    const s = isIn(r, target);
    if (s.ok) ok++; else if (s.why === 'filet') net++; else long++;
  }
  return { rate: ok / N, net: net / N, long: long / N };
}

// Meilleur angle de départ pour une vitesse donnée (balayage) → frontière vitesse / sécurité
export function bestAngle(nom, target, disp, N = 600) {
  let best = { rate: -1 };
  for (let a = -14; a <= 18; a += 0.5) {
    const r = flight({ ...nom, launch: a, keepPts: false, dt: 0.004 });
    const s = isIn(r, target);
    if (!s.ok) continue;
    const mc = successRate({ ...nom, launch: a }, target, disp, N);
    if (mc.rate > best.rate) best = { ...mc, launch: a };
  }
  return best;
}

// ---------- Recommandation cordage ----------
export function recommendStrings(base, goal) {
  const out = [];
  for (const s of Object.keys(STRINGS)) for (const gauge of [1.2, 1.25, 1.3]) for (let T = 18; T <= 28; T += 1) {
    const im = impact({ ...base, string: s, tension: T, gauge });
    const control = clamp(0.45 + (T - 18) * 0.035 + (STRINGS[s].k - 1) * 0.5 + (gauge - 1.25) * 0.8, 0, 1);
    const sc = goal === 'speed' ? im.speed * 3.6 + control * 6 + im.comfort * 6
      : goal === 'spin' ? im.spinRpm / 20 + control * 12 + im.comfort * 6
      : goal === 'control' ? control * 60 + im.spinRpm / 200 + im.comfort * 8
      : im.comfort * 60 + im.speed * 3.6 / 10 + control * 6;
    const arm = Math.max(0, T - 25) ** 2 * 2 + Math.max(0, 20 - T) ** 2 * 1.5; // charge bras / perte de contrôle aux extrêmes
    out.push({ string: s, gauge, tension: T, score: sc - arm, speed: im.speed * 3.6, spin: im.spinRpm, control, comfort: im.comfort, tContact: im.tContact });
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set(), top = [];
  for (const o of out) { if (seen.has(o.string)) continue; seen.add(o.string); top.push(o); if (top.length === 3) break; }
  return top;
}
