// KYRON · moteur d'analyse biomécanique (V0)
// Entrée : une suite d'images {t (s), world:[33 points {x,y,z} en m, y vers le haut, origine bassin], img:[33 {x,y,v}] }
// Sortie : phases, séries temporelles, métriques, constats, exercices, prise de vue suivante.

export const LM = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lIdx: 19, rIdx: 20,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lFoot: 31, rFoot: 32,
};

export const BONES = [
  [11, 12], [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32],
  [0, 11], [0, 12],
];

const D = 180 / Math.PI;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const mid = (a, b) => mul(add(a, b), 0.5);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function angleAt(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const d = len(u) * len(v);
  if (!d) return 180;
  return Math.acos(clamp(dot(u, v) / d, -1, 1)) * D;
}

function smooth(arr, w = 2) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = -w; k <= w; k++) {
      const j = i + k;
      if (j >= 0 && j < arr.length && Number.isFinite(arr[j])) { s += arr[j]; n++; }
    }
    out[i] = n ? s / n : arr[i];
  }
  return out;
}

function deriv(arr, t) {
  const out = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    const a = Math.max(0, i - 1), b = Math.min(arr.length - 1, i + 1);
    const dt = t[b] - t[a];
    out[i] = dt > 0 ? (arr[b] - arr[a]) / dt : 0;
  }
  return out;
}

function unwrapDeg(arr) {
  const out = arr.slice();
  for (let i = 1; i < out.length; i++) {
    let d = out[i] - out[i - 1];
    while (d > 180) { out[i] -= 360; d -= 360; }
    while (d < -180) { out[i] += 360; d += 360; }
  }
  return out;
}

function smoothPoints(frames, idx, w) {
  const xs = smooth(frames.map((f) => f.world[idx].x), w);
  const ys = smooth(frames.map((f) => f.world[idx].y), w);
  const zs = smooth(frames.map((f) => f.world[idx].z), w);
  return xs.map((x, i) => ({ x, y: ys[i], z: zs[i] }));
}

const argmax = (arr, from = 0, to = arr.length) => {
  let bi = from;
  for (let i = from; i < to; i++) if (arr[i] > arr[bi]) bi = i;
  return bi;
};
const argmin = (arr, from = 0, to = arr.length) => {
  let bi = from;
  for (let i = from; i < to; i++) if (arr[i] < arr[bi]) bi = i;
  return bi;
};

// Plages de référence indicatives, issues de la littérature biomécanique du tennis (ordres de grandeur).
export const REFS = {
  serve: {
    kneeFlex: { lo: 55, hi: 80, unit: '°', label: 'Flexion du genou avant (max)' },
    separation: { lo: 20, hi: 45, unit: '°', label: 'Séparation hanches / épaules (max)' },
    elbowImpact: { lo: 160, hi: 180, unit: '°', label: "Extension du coude à l'impact" },
    contactRatio: { lo: 1.18, hi: 1.45, unit: '× taille', label: "Hauteur du poignet à l'impact" },
    headDrift: { lo: 0, hi: 0.12, unit: 'm', label: "Déplacement de la tête autour de l'impact" },
    shoulderTurn: { lo: 60, hi: 140, unit: '°', label: 'Amplitude de rotation des épaules' },
  },
  forehand: {
    kneeFlex: { lo: 25, hi: 55, unit: '°', label: 'Flexion des genoux (max)' },
    separation: { lo: 20, hi: 50, unit: '°', label: 'Séparation hanches / épaules (max)' },
    elbowImpact: { lo: 100, hi: 180, unit: '°', label: "Angle du coude à l'impact" },
    shoulderTurn: { lo: 70, hi: 150, unit: '°', label: 'Amplitude de rotation des épaules' },
    headDrift: { lo: 0, hi: 0.08, unit: 'm', label: "Déplacement de la tête autour de l'impact" },
  },
  backhand: {
    kneeFlex: { lo: 25, hi: 55, unit: '°', label: 'Flexion des genoux (max)' },
    separation: { lo: 15, hi: 45, unit: '°', label: 'Séparation hanches / épaules (max)' },
    elbowImpact: { lo: 120, hi: 180, unit: '°', label: "Angle du coude à l'impact" },
    shoulderTurn: { lo: 70, hi: 150, unit: '°', label: 'Amplitude de rotation des épaules' },
    headDrift: { lo: 0, hi: 0.08, unit: 'm', label: "Déplacement de la tête autour de l'impact" },
  },
};

// Écarts idéaux entre pics successifs de la chaîne cinétique (ms).
export const SEQ_IDEAL = { lo: 15, hi: 90, opt: 45 };

export const EXERCISES = {
  legs: { name: 'Squat jump + lancer de médecine-ball au-dessus de la tête', dose: '4 × 6, ballon 3 kg', goal: 'Charger plus bas puis pousser vers le haut avant que le bras parte.', check: 'Flexion du genou ≥ 55° à la prochaine séance' },
  separation: { name: 'Rotation médecine-ball contre un mur, hanches d’abord', dose: '3 × 8 par côté', goal: 'Laisser les hanches tourner pendant que les épaules restent armées.', check: 'Séparation hanches / épaules ≥ 25°' },
  sequence: { name: 'Shadow « 1-2-3 » : bassin, buste, bras', dose: '3 × 10 au ralenti puis 3 × 10 vitesse réelle', goal: 'Chaque segment démarre quand le précédent atteint son pic.', check: 'Ordre bassin → buste → coude → poignet respecté' },
  extension: { name: 'Lancer de balle lestée vers le haut, bras tendu', dose: '3 × 8', goal: 'Frapper au point le plus haut, coude entièrement allongé.', check: "Coude ≥ 160° à l'impact" },
  contact: { name: 'Frappe sous cible suspendue (contact au point haut)', dose: '20 services', goal: 'Aller chercher la balle, ne pas la laisser redescendre.', check: 'Hauteur de poignet ≥ 1,18 × taille' },
  head: { name: 'Frappe « tête fixe » : regard sur le point d’impact 0,5 s', dose: '30 frappes', goal: 'Stabiliser la tête pour un contact plus propre.', check: 'Déplacement de la tête < 8 cm' },
  turn: { name: 'Unit turn avec bâton sur les épaules', dose: '3 × 12 par côté', goal: 'Tourner les épaules plus tôt et plus loin dans la préparation.', check: 'Rotation des épaules ≥ 70°' },
};

function scoreRange(v, r) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= r.lo && v <= r.hi) return 100;
  const span = (r.hi - r.lo) || 1;
  const d = v < r.lo ? (r.lo - v) / span : (v - r.hi) / span;
  return Math.round(clamp(100 - d * 120, 0, 100));
}

// Détecte les frappes : pics de vitesse du poignet de frappe, séparés d'au moins 0,8 s.
export function detectStrokes(frames, hand = 'right') {
  const t = frames.map((f) => f.t);
  const wi = hand === 'right' ? LM.rWr : LM.lWr;
  const w = smoothPoints(frames, wi, 2);
  const dx = deriv(w.map((p) => p.x), t), dy = deriv(w.map((p) => p.y), t), dz = deriv(w.map((p) => p.z), t);
  const sp = smooth(dx.map((v, i) => Math.hypot(v, dy[i], dz[i])), 1);
  const max = Math.max(...sp);
  const peaks = [];
  for (let i = 1; i < sp.length - 1; i++) {
    if (sp[i] >= sp[i - 1] && sp[i] >= sp[i + 1] && sp[i] > 0.6 * max) {
      const last = peaks[peaks.length - 1];
      if (last && t[i] - t[last] < 0.8) { if (sp[i] > sp[last]) peaks[peaks.length - 1] = i; } else peaks.push(i);
    }
  }
  return peaks.map((i) => ({ idx: i, t: t[i], speed: sp[i] }));
}

export function analyze(frames, opts = {}) {
  const stroke = opts.stroke || 'serve';
  const hand = opts.hand || 'right';
  const R = hand === 'right';
  const n = frames.length;
  if (n < 12) throw new Error('Séquence trop courte pour analyser un geste (moins de 12 images).');
  const t = frames.map((f) => f.t);
  const fps = (n - 1) / (t[n - 1] - t[0]);
  const P = (i) => smoothPoints(frames, i, 2);

  const lHip = P(LM.lHip), rHip = P(LM.rHip), lSh = P(LM.lSh), rSh = P(LM.rSh);
  const lKn = P(LM.lKn), rKn = P(LM.rKn), lAn = P(LM.lAn), rAn = P(LM.rAn);
  const sh = R ? rSh : lSh, el = P(R ? LM.rEl : LM.lEl), wr = P(R ? LM.rWr : LM.lWr);
  const nose = P(LM.nose);

  // Rotations dans le plan horizontal (x, z)
  const yaw = (a, b) => a.map((p, i) => Math.atan2(b[i].z - p.z, b[i].x - p.x) * D);
  const pelvisYaw = unwrapDeg(yaw(lHip, rHip));
  const thoraxYaw = unwrapDeg(yaw(lSh, rSh));
  const separation = thoraxYaw.map((v, i) => v - pelvisYaw[i]);
  const pelvisOmega = smooth(deriv(pelvisYaw, t), 1).map(Math.abs);
  const thoraxOmega = smooth(deriv(thoraxYaw, t), 1).map(Math.abs);

  const elbowAngle = sh.map((s, i) => angleAt(s, el[i], wr[i]));
  const elbowVel = smooth(deriv(elbowAngle, t), 1);
  const kneeL = lHip.map((h, i) => 180 - angleAt(h, lKn[i], lAn[i]));
  const kneeR = rHip.map((h, i) => 180 - angleAt(h, rKn[i], rAn[i]));

  const vx = deriv(wr.map((p) => p.x), t), vy = deriv(wr.map((p) => p.y), t), vz = deriv(wr.map((p) => p.z), t);
  const wristSpeed = smooth(vx.map((v, i) => Math.hypot(v, vy[i], vz[i])), 1);

  // Vitesse angulaire de l'avant-bras (rad/s) → estimation de la vitesse de tête de raquette
  const fore = el.map((e, i) => { const d = sub(wr[i], e); const l = len(d) || 1; return mul(d, 1 / l); });
  const foreOmega = smooth(fore.map((f, i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const c = clamp(dot(fore[a], fore[b]), -1, 1);
    return Math.acos(c) / ((t[b] - t[a]) || 1);
  }), 1);
  const RACKET_ARM = 0.55; // poignet → centre du tamis (m)
  const racketSpeed = wristSpeed.map((v, i) => v + foreOmega[i] * RACKET_ARM);

  // Impact = pic de vitesse de raquette estimée (dans la frappe choisie)
  let impact = opts.impactIdx != null ? opts.impactIdx : argmax(racketSpeed, Math.floor(n * 0.1), Math.ceil(n * 0.95));
  if (stroke === 'serve') {
    // Au service, l'impact est le point le plus haut du poignet autour du pic de vitesse
    const k = Math.round(fps * 0.07);
    impact = argmax(wr.map((p) => p.y), Math.max(0, impact - k), Math.min(n, impact + k + 1));
  }
  const win = Math.round(fps * 0.6);
  const from = Math.max(0, impact - win * 2), to = Math.min(n, impact + win);

  // Phases
  const pkR = argmax(racketSpeed, Math.max(0, impact - Math.round(fps * 0.04)), Math.min(n, impact + Math.round(fps * 0.02) + 1));
  const peakV = racketSpeed[pkR];
  let accel = pkR;
  while (accel > from && racketSpeed[accel] > 0.35 * peakV) accel--;
  const kneeFront = R ? kneeL : kneeR; // genou avant pour un droitier = gauche
  const kneeMaxIdx = argmax(stroke === 'serve' ? kneeFront : kneeL.map((v, i) => Math.max(v, kneeR[i])), from, impact + 1);
  const loadIdx = Math.min(kneeMaxIdx, accel);
  let prep = from;
  while (prep < loadIdx && wristSpeed[prep] < 0.06 * peakV) prep++;
  const finish = Math.min(n - 1, impact + Math.round(fps * 0.3));
  const phases = [
    { key: 'prep', label: 'Préparation', i0: prep, i1: loadIdx },
    { key: 'load', label: stroke === 'serve' ? 'Armé (trophée)' : 'Armé', i0: loadIdx, i1: accel },
    { key: 'accel', label: 'Accélération', i0: accel, i1: impact },
    { key: 'impact', label: 'Impact', i0: impact, i1: impact },
    { key: 'follow', label: 'Accompagnement', i0: impact, i1: finish },
  ];

  // Chaîne cinétique : pics successifs avant l'impact
  const s0 = Math.max(from, loadIdx - Math.round(fps * 0.1));
  const e0 = Math.min(n, impact + Math.round(fps * 0.03) + 1);
  const pkPelvis = argmax(pelvisOmega, s0, e0);
  const pkThorax = argmax(thoraxOmega, s0, e0);
  const pkElbow = argmax(elbowVel, s0, e0);
  const pkWrist = argmax(wristSpeed, s0, e0);
  const sequence = [
    { key: 'pelvis', label: 'Bassin', idx: pkPelvis, value: pelvisOmega[pkPelvis], unit: '°/s' },
    { key: 'thorax', label: 'Buste', idx: pkThorax, value: thoraxOmega[pkThorax], unit: '°/s' },
    { key: 'elbow', label: 'Coude', idx: pkElbow, value: elbowVel[pkElbow], unit: '°/s' },
    { key: 'wrist', label: 'Poignet', idx: pkWrist, value: wristSpeed[pkWrist], unit: 'm/s' },
  ].map((s) => ({ ...s, t: t[s.idx], ms: Math.round((t[s.idx] - t[impact]) * 1000) }));
  const gaps = sequence.slice(1).map((s, i) => Math.round((s.t - sequence[i].t) * 1000));
  const inOrder = gaps.every((g) => g >= 0);

  // Taille du joueur : nez → chevilles en position initiale + 10 cm
  const ankleY0 = Math.min(lAn[from].y, rAn[from].y);
  const height = clamp(nose[from].y - ankleY0 + 0.08 + 0.1, 1.2, 2.3);
  const groundY = (i) => Math.min(lAn[i].y, rAn[i].y) - 0.08; // cheville → sol
  const contactRatio = (wr[impact].y - groundY(impact)) / height;

  const a0 = Math.max(0, impact - Math.round(fps * 0.1)), a1 = Math.min(n - 1, impact + Math.round(fps * 0.1));
  const headDrift = len(sub(sub(nose[a1], mid(lHip[a1], rHip[a1])), sub(nose[a0], mid(lHip[a0], rHip[a0]))));

  const tYawSlice = thoraxYaw.slice(prep, impact + 1);
  const shoulderTurn = Math.max(...tYawSlice) - Math.min(...tYawSlice);
  const sepSlice = separation.slice(loadIdx, impact + 1).map(Math.abs);

  const metrics = {
    kneeFlex: stroke === 'serve' ? kneeFront[kneeMaxIdx] : Math.max(kneeL[kneeMaxIdx], kneeR[kneeMaxIdx]),
    separation: sepSlice.length ? Math.max(...sepSlice) : 0,
    elbowImpact: elbowAngle[impact],
    contactRatio: stroke === 'serve' ? contactRatio : null,
    headDrift,
    shoulderTurn,
    wristSpeed: wristSpeed[pkWrist],
    racketSpeed: peakV,
    ballSpeedKmh: peakV * (stroke === 'serve' ? 1.32 : 1.18) * 3.6,
    pelvisOmega: pelvisOmega[pkPelvis],
    thoraxOmega: thoraxOmega[pkThorax],
    height,
  };

  // Score et constats
  const refs = REFS[stroke];
  const items = Object.entries(refs).map(([k, r]) => ({ key: k, ...r, value: metrics[k], score: scoreRange(metrics[k], r) })).filter((x) => x.score != null);
  const seqScore = inOrder ? Math.round(gaps.reduce((s, g) => s + scoreRange(g, SEQ_IDEAL), 0) / gaps.length) : 35;
  items.push({ key: 'sequence', label: 'Chaîne cinétique', value: gaps.join(' / '), unit: 'ms', lo: SEQ_IDEAL.lo, hi: SEQ_IDEAL.hi, score: seqScore });
  const weights = { sequence: 3, kneeFlex: 2, separation: 2, elbowImpact: 1.5, contactRatio: 1.5, shoulderTurn: 1.5, headDrift: 1 };
  const wsum = items.reduce((s, x) => s + (weights[x.key] || 1), 0);
  const score = Math.round(items.reduce((s, x) => s + x.score * (weights[x.key] || 1), 0) / wsum);

  const findings = buildFindings(stroke, metrics, refs, sequence, gaps, inOrder);

  const visArm = frames.slice(from, to).reduce((s, f) => s + ((f.img?.[R ? LM.rEl : LM.lEl]?.v ?? 1) + (f.img?.[R ? LM.rWr : LM.lWr]?.v ?? 1)) / 2, 0) / Math.max(1, to - from);
  const visLegs = frames.slice(from, to).reduce((s, f) => s + ((f.img?.[LM.lKn]?.v ?? 1) + (f.img?.[LM.rKn]?.v ?? 1)) / 2, 0) / Math.max(1, to - from);

  return {
    stroke, hand, fps, n, impact, phases, sequence, gaps, inOrder, metrics, items, score, findings,
    exercises: findings.slice(0, 3).map((f) => ({ ...EXERCISES[f.exercise], forKey: f.key })),
    camera: cameraRequest(stroke, fps, visArm, visLegs, opts.source),
    series: { t, wristSpeed, racketSpeed, pelvisOmega, thoraxOmega, elbowAngle, elbowVel, kneeL, kneeR, separation, pelvisYaw, thoraxYaw },
    simInput: {
      stroke, kneeFlex: metrics.kneeFlex, separation: metrics.separation, elbowImpact: metrics.elbowImpact,
      contactRatio: metrics.contactRatio ?? 1, d1: gaps[0], d2: gaps[1], d3: gaps[2], speed: metrics.racketSpeed,
    },
  };
}

function buildFindings(stroke, m, refs, seq, gaps, inOrder) {
  const out = [];
  const push = (key, sev, title, detail, exercise, gain) => out.push({ key, sev, title, detail, exercise, gain });
  const r = refs;
  if (!inOrder) {
    const bad = seq.findIndex((s, i) => i > 0 && s.t < seq[i - 1].t);
    push('sequence', 3, `${seq[bad].label} part avant ${seq[bad - 1].label.toLowerCase()}`,
      `L'ordre idéal est bassin → buste → coude → poignet. Ici le pic du ${seq[bad].label.toLowerCase()} arrive ${Math.abs(gaps[bad - 1])} ms trop tôt : l'énergie des jambes et du tronc n'est pas transmise au bras.`, 'sequence', 8);
  } else {
    const worst = gaps.map((g, i) => ({ g, i })).sort((a, b) => Math.abs(b.g - SEQ_IDEAL.opt) - Math.abs(a.g - SEQ_IDEAL.opt))[0];
    if (worst.g < SEQ_IDEAL.lo || worst.g > SEQ_IDEAL.hi) {
      const a = seq[worst.i].label.toLowerCase(), b = seq[worst.i + 1].label.toLowerCase();
      push('sequence', 2, worst.g < SEQ_IDEAL.lo ? `${seq[worst.i + 1].label} et ${a} tournent en bloc` : `Temps mort entre ${a} et ${b}`,
        `Écart mesuré ${worst.g} ms, cible ${SEQ_IDEAL.lo}–${SEQ_IDEAL.hi} ms. ${worst.g < SEQ_IDEAL.lo ? 'Les segments partent ensemble au lieu de se relayer.' : "L'élan se perd avant d'arriver au segment suivant."}`, 'sequence', 5);
    }
  }
  if (m.kneeFlex < r.kneeFlex.lo) push('kneeFlex', 2, 'Pas assez de charge dans les jambes', `Flexion mesurée ${Math.round(m.kneeFlex)}°, cible ${r.kneeFlex.lo}–${r.kneeFlex.hi}°. Les jambes sont le moteur : moins de charge, moins de poussée vers la balle.`, 'legs', stroke === 'serve' ? 6 : 4);
  if (m.separation < r.separation.lo) push('separation', 2, 'Hanches et épaules tournent ensemble', `Séparation max ${Math.round(m.separation)}°, cible ${r.separation.lo}–${r.separation.hi}°. Sans torsion, le tronc ne stocke pas d'énergie élastique.`, 'separation', 5);
  if (m.separation > r.separation.hi + 8) push('separation', 1, 'Torsion excessive du tronc', `Séparation ${Math.round(m.separation)}° : au-delà de ${r.separation.hi + 8}°, la charge sur les lombaires augmente sans gain de vitesse.`, 'separation', 0);
  if (m.elbowImpact < r.elbowImpact.lo) push('elbowImpact', stroke === 'serve' ? 2 : 1, stroke === 'serve' ? "Bras plié à l'impact" : "Coude trop fermé à l'impact", `Angle ${Math.round(m.elbowImpact)}°, cible ≥ ${r.elbowImpact.lo}°. ${stroke === 'serve' ? 'Tu perds de la hauteur et du levier.' : 'Le contact est trop près du corps.'}`, 'extension', 3);
  if (stroke === 'serve' && m.contactRatio < r.contactRatio.lo) push('contactRatio', 2, 'Point de contact trop bas', `Poignet à ${m.contactRatio.toFixed(2)} × ta taille à l'impact, cible ≥ ${r.contactRatio.lo}. Plus haut = angle d'attaque plus ouvert pour faire passer le service.`, 'contact', 3);
  if (m.shoulderTurn < r.shoulderTurn.lo) push('shoulderTurn', 2, 'Rotation des épaules trop courte', `Amplitude ${Math.round(m.shoulderTurn)}°, cible ≥ ${r.shoulderTurn.lo}°. La préparation ne laisse pas assez de distance pour accélérer.`, 'turn', 4);
  if (m.headDrift > r.headDrift.hi) push('headDrift', 1, "La tête bouge à l'impact", `${Math.round(m.headDrift * 100)} cm de déplacement autour de l'impact, cible < ${Math.round(r.headDrift.hi * 100)} cm. Une tête stable donne un contact plus régulier.`, 'head', 1);
  out.sort((a, b) => b.sev - a.sev || b.gain - a.gain);
  if (!out.length) push('ok', 0, 'Geste dans les plages de référence', 'Aucun écart majeur détecté sur cette prise. Passe au mode avancé pour affiner au milliseconde.', 'sequence', 0);
  return out;
}

function cameraRequest(stroke, fps, visArm, visLegs, source) {
  const asks = [];
  if (source === 'video' && fps < 100) asks.push({ title: 'Passe en ralenti 240 i/s', why: `Analyse échantillonnée à ${Math.round(fps)} i/s : le bras et la raquette sont flous à l'impact. Réglages iPhone › Appareil photo › Ralenti 240 i/s.` });
  if (visArm < 0.7) asks.push({ title: stroke === 'serve' ? 'Refilme de dos, derrière la ligne de fond' : 'Refilme du côté du bras de frappe', why: `Le bras de frappe est mal visible (confiance ${Math.round(visArm * 100)} %). Place le téléphone à 4 m, hauteur de hanche.` });
  if (visLegs < 0.7) asks.push({ title: 'Recule pour cadrer les pieds', why: `Les genoux et les chevilles sortent du cadre (confiance ${Math.round(visLegs * 100)} %). Il faut voir le joueur entier, raquette comprise.` });
  const second = stroke === 'serve'
    ? { title: 'Ajoute une vue de dos (2e appareil)', why: 'Profil + dos = mesure 3D de la rotation du buste et de la pronation. Tablette à 5 m derrière la ligne de fond, centrée sur le joueur.' }
    : { title: 'Ajoute une vue de face, filet derrière toi', why: 'La vue de face mesure la rotation des épaules et la distance de la balle au corps, invisibles de profil.' };
  asks.push(second);
  return asks;
}

// Monte-Carlo : modèle simplifié de chaîne cinétique, calibré sur la vitesse estimée du joueur.
export const SIM_SOURCE = `
self.onmessage = (e) => {
  const x0 = e.data.input, N = e.data.trials;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const eff = (d) => d < 0 ? 0.25 : Math.exp(-0.5 * Math.pow((d - 45) / 32, 2));
  const serve = x0.stroke === 'serve';
  const M = (k, s, e1, c, d1, d2, d3) =>
    (1 + 0.0022 * cl(k, 0, 75)) * (1 + 0.003 * cl(s, 0, 45)) *
    (0.85 + 0.15 * (eff(d1) + eff(d2) + eff(d3)) / 3) *
    (serve ? 0.92 + 0.08 * cl((c - 1.0) / 0.35, 0, 1) : 1) *
    (0.95 + 0.05 * cl((e1 - 110) / 65, 0, 1));
  const base = M(x0.kneeFlex, x0.separation, x0.elbowImpact, x0.contactRatio, x0.d1, x0.d2, x0.d3);
  const k0 = x0.speed / base;
  let best = null, bestObj = -1e9, ok = 0, rejected = 0;
  const top = [];
  const t0 = Date.now();
  const chunk = 200000;
  for (let i = 0; i < N; i++) {
    const k = cl(x0.kneeFlex + (Math.random() * 2 - 1) * 20, 5, serve ? 90 : 65);
    const s = cl(x0.separation + (Math.random() * 2 - 1) * 15, 0, 70);
    const e1 = cl(x0.elbowImpact + (Math.random() * 2 - 1) * 20, 90, 179);
    const c = serve ? cl(x0.contactRatio + (Math.random() * 2 - 1) * 0.12, 0.9, 1.42) : 1;
    const d1 = x0.d1 + (Math.random() * 2 - 1) * 50, d2 = x0.d2 + (Math.random() * 2 - 1) * 50, d3 = x0.d3 + (Math.random() * 2 - 1) * 50;
    if (s > 55 || k > (serve ? 85 : 60)) { rejected++; continue; }
    ok++;
    const v = k0 * M(k, s, e1, c, d1, d2, d3);
    const effort = Math.abs(k - x0.kneeFlex) / 30 + Math.abs(s - x0.separation) / 25 + Math.abs(e1 - x0.elbowImpact) / 40 + (serve ? Math.abs(c - x0.contactRatio) / 0.2 : 0) + (Math.abs(d1 - x0.d1) + Math.abs(d2 - x0.d2) + Math.abs(d3 - x0.d3)) / 120;
    const obj = v - 0.6 * effort;
    if (obj > bestObj) { bestObj = obj; best = { k, s, e1, c, d1, d2, d3, v }; }
    if ((i + 1) % chunk === 0) self.postMessage({ progress: (i + 1) / N, done: false });
  }
  // Sensibilité : gain si on corrige un seul paramètre vers la meilleure valeur
  const sens = [
    ['kneeFlex', M(best.k, x0.separation, x0.elbowImpact, x0.contactRatio, x0.d1, x0.d2, x0.d3)],
    ['separation', M(x0.kneeFlex, best.s, x0.elbowImpact, x0.contactRatio, x0.d1, x0.d2, x0.d3)],
    ['elbowImpact', M(x0.kneeFlex, x0.separation, best.e1, x0.contactRatio, x0.d1, x0.d2, x0.d3)],
    ['contactRatio', M(x0.kneeFlex, x0.separation, x0.elbowImpact, best.c, x0.d1, x0.d2, x0.d3)],
    ['timing', M(x0.kneeFlex, x0.separation, x0.elbowImpact, x0.contactRatio, best.d1, best.d2, best.d3)],
  ].map(([key, m]) => ({ key, gainPct: (m / base - 1) * 100 })).filter((s) => serve || s.key !== 'contactRatio');
  self.postMessage({ done: true, trials: N, ok, rejected, ms: Date.now() - t0, base: x0.speed, best, gainPct: (best.v / x0.speed - 1) * 100, sens });
};`;
