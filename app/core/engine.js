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

const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a) => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 }; };
// Composante de a orthogonale à l'axe unitaire n
const reject = (a, n) => sub(a, mul(n, dot(a, n)));
const lerp3 = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
const median = (arr) => {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mean = (arr) => { let s = 0, n = 0; for (const v of arr) if (Number.isFinite(v)) { s += v; n++; } return n ? s / n : NaN; };

// Remplace les NaN par interpolation linéaire entre voisins valides (bords : valeur valide la plus proche).
function fillNaN(arr) {
  const out = arr.slice();
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (last < 0) for (let k = 0; k < i; k++) out[k] = out[i];
    else for (let k = last + 1; k < i; k++) out[k] = out[last] + (out[i] - out[last]) * (k - last) / (i - last);
    last = i;
  }
  if (last < 0) return out.fill(0);
  for (let k = last + 1; k < out.length; k++) out[k] = out[last];
  return out;
}

// Enveloppe convexe 2D (chaîne monotone d'Andrew), points [u, v].
function hull2(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Vecteur (point le plus proche de l'enveloppe → q) ; [0,0] si q est dedans.
function outsideHull(q, h) {
  if (!h.length) return [0, 0];
  if (h.length >= 3) {
    let inside = true;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < 0) { inside = false; break; }
    }
    if (inside) return [0, 0];
  }
  let best = null, bd = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
    const k = l2 > 0 ? clamp(((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2, 0, 1) : 0;
    const dx = q[0] - (a[0] + k * ex), dy = q[1] - (a[1] + k * ey), d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = [dx, dy]; }
  }
  return best;
}

// Modèle segmentaire de De Leva (1996, J. Biomech. 29:1223) — 14 segments, masses relatives et position du
// centre de masse le long du segment (fraction depuis l'extrémité proximale). Les repères anatomiques de De Leva
// sont approximés par les points MediaPipe : tête = milieu des oreilles, tronc = milieu des épaules (≈ C7) →
// milieu des hanches, main = poignet → milieu index / auriculaire (≈ MET3), pied = talon → bout du pied.
export const DE_LEVA = {
  male: { head: [0.0694], trunk: [0.4346, 0.5138], upperArm: [0.0271, 0.5772], forearm: [0.0162, 0.4574], hand: [0.0061, 0.79], thigh: [0.1416, 0.4095], shank: [0.0433, 0.4459], foot: [0.0137, 0.4415] },
  female: { head: [0.0668], trunk: [0.4257, 0.4964], upperArm: [0.0255, 0.5754], forearm: [0.0138, 0.4559], hand: [0.0056, 0.7474], thigh: [0.1478, 0.3612], shank: [0.0481, 0.4416], foot: [0.0129, 0.4014] },
};

// Centre de masse corps entier d'une image (coordonnées monde). w = world landmarks lissés pour cette image.
function centerOfMass(w, sex = 'male') {
  const T = DE_LEVA[sex] || DE_LEVA.male;
  const seg = (a, b, k) => lerp3(a, b, k);
  let acc = { x: 0, y: 0, z: 0 }, m = 0;
  const addSeg = (mass, p) => { acc = add(acc, mul(p, mass)); m += mass; };
  addSeg(T.head[0], mid(w[7], w[8]));
  addSeg(T.trunk[0], seg(mid(w[11], w[12]), mid(w[23], w[24]), T.trunk[1]));
  for (const [s, e, wr, ix, pk, h, k, a, he, ft] of [[11, 13, 15, 19, 17, 23, 25, 27, 29, 31], [12, 14, 16, 20, 18, 24, 26, 28, 30, 32]]) {
    addSeg(T.upperArm[0], seg(w[s], w[e], T.upperArm[1]));
    addSeg(T.forearm[0], seg(w[e], w[wr], T.forearm[1]));
    addSeg(T.hand[0], seg(w[wr], mid(w[ix], w[pk]), T.hand[1]));
    addSeg(T.thigh[0], seg(w[h], w[k], T.thigh[1]));
    addSeg(T.shank[0], seg(w[k], w[a], T.shank[1]));
    addSeg(T.foot[0], seg(w[he], w[ft], T.foot[1]));
  }
  return mul(acc, 1 / m);
}

// Plages de référence indicatives, issues de la littérature biomécanique du tennis (ordres de grandeur).
export const REFS = {
  serve: {
    kneeFlex: { lo: 55, hi: 80, unit: '°', label: 'Flexion du genou avant (max)' },
    separation: { lo: 20, hi: 45, unit: '°', label: 'Séparation hanches / épaules (max)' },
    elbowImpact: { lo: 160, hi: 180, unit: '°', label: "Extension du coude à l'impact" },
    contactRatio: { lo: 1.18, hi: 1.45, unit: '× taille', label: "Hauteur du poignet à l'impact" },
    headDrift: { lo: 0, hi: 0.12, unit: 'm', label: "Déplacement de la tête autour de l'impact" },
    shoulderTurn: { lo: 60, hi: 140, unit: '°', label: 'Amplitude de rotation des épaules' },
    // --- Ajouts V1 (champs optionnels). Ordres de grandeur, à valider sur nos propres mesures :
    // · épaule : Fleisig et al. 2003 (Sports Biomech., serveurs de niveau mondial) rapportent ≈ 100° d'abduction
    //   à l'armé et à l'impact, une rotation externe maximale ≈ 170° (± 12°) et un pic de vitesse de rotation interne
    //   de l'ordre de 2 000–2 500 °/s ; Elliott et al. 1995 (J. Appl. Biomech.) montrent que la rotation interne est
    //   la principale contribution segmentaire à la vitesse de raquette. Kibler (« hyperangulation ») : coude
    //   nettement derrière le plan de l'omoplate à l'armé = contrainte capsulaire antérieure.
    //   Notre rotation externe est mesurée humérus / thorax à partir de points de surface : elle sous-estime
    //   typiquement les valeurs de laboratoire de 10 à 25° (lissage, point d'épaule qui suit l'omoplate), d'où des
    //   bornes basses plus larges que la littérature.
    // · lancer : Reid, Whiteside, Elliott et coll. (2008–2013, services de joueurs professionnels) : balle frappée
    //   quelques dizaines de centimètres sous l'apogée du lancer et nettement devant le pied avant.
    // · transfert du centre de masse / équilibre : ordres de grandeur issus des études de « transfert du poids »
    //   (Elliott 2006, Br. J. Sports Med. ; Bahamonde 2000) ; valeurs indicatives, très dépendantes de la technique
    //   (pieds joints / pieds décalés, appuis ouverts / fermés).
    shoulderElev: { lo: 85, hi: 120, unit: '°', label: "Élévation du bras à l'armé" },
    shoulderAbdH: { lo: -30, hi: 20, unit: '°', label: "Coude derrière le plan du buste à l'armé" },
    shoulderRotExt: { lo: 130, hi: 190, unit: '°', label: "Rotation externe de l'épaule (armé)" },
    shoulderIRVel: { lo: 1200, hi: 3000, unit: '°/s', label: 'Vitesse de rotation interne (pic)' },
    comShift: { lo: 0.15, hi: 0.7, unit: 'm', label: 'Transfert du centre de masse vers l’avant' },
    balance: { lo: 0.6, hi: 1, unit: '0–1', label: "Équilibre à l'impact" },
    tossDrop: { lo: 0.1, hi: 1.0, unit: 'm', label: 'Hauteur du lancer au-dessus du contact' },
    tossForward: { lo: 0.05, hi: 0.8, unit: 'm', label: 'Lancer devant le pied avant' },
  },
  forehand: {
    kneeFlex: { lo: 25, hi: 55, unit: '°', label: 'Flexion des genoux (max)' },
    separation: { lo: 20, hi: 50, unit: '°', label: 'Séparation hanches / épaules (max)' },
    elbowImpact: { lo: 100, hi: 180, unit: '°', label: "Angle du coude à l'impact" },
    shoulderTurn: { lo: 70, hi: 150, unit: '°', label: 'Amplitude de rotation des épaules' },
    headDrift: { lo: 0, hi: 0.08, unit: 'm', label: "Déplacement de la tête autour de l'impact" },
    // Coup droit : transfert plus faible en appuis ouverts (ordre de grandeur, cf. commentaire du service).
    comShift: { lo: 0.05, hi: 0.5, unit: 'm', label: 'Transfert du centre de masse vers l’avant' },
    balance: { lo: 0.6, hi: 1, unit: '0–1', label: "Équilibre à l'impact" },
  },
  backhand: {
    kneeFlex: { lo: 25, hi: 55, unit: '°', label: 'Flexion des genoux (max)' },
    separation: { lo: 15, hi: 45, unit: '°', label: 'Séparation hanches / épaules (max)' },
    elbowImpact: { lo: 120, hi: 180, unit: '°', label: "Angle du coude à l'impact" },
    shoulderTurn: { lo: 70, hi: 150, unit: '°', label: 'Amplitude de rotation des épaules' },
    headDrift: { lo: 0, hi: 0.08, unit: 'm', label: "Déplacement de la tête autour de l'impact" },
    comShift: { lo: 0.05, hi: 0.5, unit: 'm', label: 'Transfert du centre de masse vers l’avant' },
    balance: { lo: 0.6, hi: 1, unit: '0–1', label: "Équilibre à l'impact" },
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
  // Ajouts V1
  rotExt: { name: 'Rotation externe à 90/90 à l’élastique + « drop » de raquette lent', dose: '3 × 12, tempo 3 s retour', goal: 'Gagner de l’amplitude et du contrôle quand la raquette descend dans le dos.', check: "Rotation externe ≥ 130° à l'armé" },
  scapula: { name: 'Armé face au mur dans le plan de l’omoplate + Y-T-W', dose: '3 × 10 de chaque', goal: 'Garder le coude dans le prolongement des épaules, pas derrière.', check: 'Coude ≤ 20° derrière le plan du buste' },
  elbowHeight: { name: 'Position du trophée tenue 2 s devant un miroir', dose: '3 × 8', goal: 'Coude à hauteur d’épaule, ni plus bas ni très au-dessus.', check: "Élévation du bras entre 85 et 120° à l'armé" },
  internalRot: { name: 'Lancers de médecine-ball 1 kg au-dessus de la tête + rotation interne explosive à l’élastique', dose: '3 × 8 chacun', goal: 'Relâcher l’épaule et laisser l’avant-bras « fouetter » vers la balle.', check: 'Vitesse de rotation interne en hausse à la prochaine séance' },
  transfer: { name: 'Frappe avec pas en avant marqué (step-in) puis service pied arrière ramené', dose: '3 × 10', goal: 'Faire passer le poids de la jambe arrière à la jambe avant pendant la frappe.', check: 'Transfert du centre de masse ≥ 15 cm (service) / 5 cm (fond de court)' },
  balance: { name: 'Frappes avec position finale tenue 2 s, puis sur demi-sphère', dose: '20 frappes', goal: "Rester gainé et aligné au-dessus des appuis pendant l'impact.", check: "Équilibre ≥ 0,6 à l'impact" },
  toss: { name: 'Lancers seuls, raquette posée au sol devant le pied avant comme cible', dose: '30 lancers', goal: 'Lancer un peu au-dessus du point de contact et devant le pied avant, toujours au même endroit.', check: 'Apogée 10 cm à 1 m au-dessus du contact, devant le pied avant' },
};

function scoreRange(v, r) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= r.lo && v <= r.hi) return 100;
  const span = (r.hi - r.lo) || 1;
  const d = v < r.lo ? (r.lo - v) / span : (v - r.hi) / span;
  return Math.round(clamp(100 - d * 120, 0, 100));
}

// Détecte les frappes : pics de vitesse du poignet de frappe, séparés d'au moins 0,8 s.
// Seuil V1 : un pic doit (1) dépasser 3 m/s et 40 % d'un maximum robuste de la séance (99,5e centile, insensible
// à un saut de pose isolé), (2) dominer son voisinage (≥ 60 % du max à ± 1 s : élimine l'armé ou
// l'accompagnement d'une frappe voisine), (3) rester physiquement possible (< 45 m/s au poignet).
// Sur une prise d'une seule frappe, le résultat est le même qu'en V0 ; sur une séance mêlant services et coups
// de fond de court (vitesses très différentes), les coups les plus lents ne sont plus perdus.
export function detectStrokes(frames, hand = 'right') {
  if (!frames || frames.length < 5) return [];
  const t = frames.map((f) => f.t);
  const wi = hand === 'right' ? LM.rWr : LM.lWr;
  const w = smoothPoints(frames, wi, 2);
  const dx = deriv(w.map((p) => p.x), t), dy = deriv(w.map((p) => p.y), t), dz = deriv(w.map((p) => p.z), t);
  const sp = smooth(dx.map((v, i) => Math.hypot(v, dy[i], dz[i])), 1).map((v) => (v < 45 ? v : 0));
  const sorted = sp.slice().sort((a, b) => a - b);
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))] || 0;
  const thr = Math.max(3, 0.4 * ref);
  const peaks = [];
  let j0 = 0, j1 = 0; // fenêtre glissante ± 1 s
  for (let i = 1; i < sp.length - 1; i++) {
    if (!(sp[i] >= sp[i - 1] && sp[i] >= sp[i + 1] && sp[i] > thr)) continue;
    while (t[j0] < t[i] - 1) j0++;
    while (j1 < sp.length - 1 && t[j1 + 1] <= t[i] + 1) j1++;
    let loc = 0;
    for (let k = j0; k <= j1; k++) if (sp[k] > loc) loc = sp[k];
    if (sp[i] < 0.6 * loc) continue;
    const last = peaks[peaks.length - 1];
    if (last != null && t[i] - t[last] < 0.8) { if (sp[i] > sp[last]) peaks[peaks.length - 1] = i; } else peaks.push(i);
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

  // ---------- Ajouts V1 : épaule 3 axes, centre de masse, équilibre, lancer, confiance ----------
  const ext = extendedAnalysis({ frames, opts, t, fps, n, R, stroke, impact, from, to, prep, loadIdx, accel, P, lHip, rHip, lSh, rSh, lAn, rAn, sh, el, wr, nose, groundY, height });
  Object.assign(metrics, ext.metrics);

  // Score et constats
  const refs = REFS[stroke];
  // La vitesse de rotation interne n'est notée qu'à ≥ 100 i/s : en dessous, le lissage l'écrase (pic sous-estimé).
  const scorable = (k) => !(k === 'shoulderIRVel' && fps < 100);
  const items = Object.entries(refs).filter(([k]) => scorable(k)).map(([k, r]) => ({ key: k, ...r, value: metrics[k], score: scoreRange(metrics[k], r) })).filter((x) => x.score != null);
  const seqScore = inOrder ? Math.round(gaps.reduce((s, g) => s + scoreRange(g, SEQ_IDEAL), 0) / gaps.length) : 35;
  items.push({ key: 'sequence', label: 'Chaîne cinétique', value: gaps.join(' / '), unit: 'ms', lo: SEQ_IDEAL.lo, hi: SEQ_IDEAL.hi, score: seqScore });
  const weights = {
    sequence: 3, kneeFlex: 2, separation: 2, elbowImpact: 1.5, contactRatio: 1.5, shoulderTurn: 1.5, headDrift: 1,
    shoulderElev: 1, shoulderAbdH: 1, shoulderRotExt: 1, shoulderIRVel: 0.5, comShift: 1, balance: 1, tossDrop: 0.75, tossForward: 0.75,
  };
  const wsum = items.reduce((s, x) => s + (weights[x.key] || 1), 0);
  const score = Math.round(items.reduce((s, x) => s + x.score * (weights[x.key] || 1), 0) / wsum);

  const findings = buildFindings(stroke, metrics, refs, sequence, gaps, inOrder, { fps, source: opts.source });

  const visArm = frames.slice(from, to).reduce((s, f) => s + ((f.img?.[R ? LM.rEl : LM.lEl]?.v ?? 1) + (f.img?.[R ? LM.rWr : LM.lWr]?.v ?? 1)) / 2, 0) / Math.max(1, to - from);
  const visLegs = frames.slice(from, to).reduce((s, f) => s + ((f.img?.[LM.lKn]?.v ?? 1) + (f.img?.[LM.rKn]?.v ?? 1)) / 2, 0) / Math.max(1, to - from);

  return {
    stroke, hand, fps, n, impact, phases, sequence, gaps, inOrder, metrics, items, score, findings,
    exercises: findings.slice(0, 3).map((f) => ({ ...EXERCISES[f.exercise], forKey: f.key })),
    camera: cameraRequest(stroke, fps, visArm, visLegs, opts.source),
    series: { t, wristSpeed, racketSpeed, pelvisOmega, thoraxOmega, elbowAngle, elbowVel, kneeL, kneeR, separation, pelvisYaw, thoraxYaw, ...ext.series },
    simInput: {
      stroke, kneeFlex: metrics.kneeFlex, separation: metrics.separation, elbowImpact: metrics.elbowImpact,
      contactRatio: metrics.contactRatio ?? 1, d1: gaps[0], d2: gaps[1], d3: gaps[2], speed: metrics.racketSpeed,
    },
    // Ajouts V1 (optionnels)
    confidence: ext.confidence,
    confidenceParts: ext.confidenceParts,
    toss: ext.toss,
    imgRef: ext.imgRef,
  };
}

const G = 9.81;

// Sens du repère monde (+1 direct, −1 miroir) : on retient le signe de U × R qui met le nez et les orteils
// devant le corps. Exporté pour session.js (classification du côté de frappe).
function chiralityOf(frames, F0, midSh, nose, lHe, rHe, lTo, rTo) {
  let s = 0;
  for (let i = 0; i < frames.length; i++) {
    s += dot(sub(nose[i], midSh[i]), F0[i]) + 0.5 * (dot(sub(lTo[i], lHe[i]), F0[i]) + dot(sub(rTo[i], rHe[i]), F0[i]));
  }
  return s >= 0 ? 1 : -1;
}

export function chirality(frames) {
  const W = (k) => frames.map((f) => f.world[k]);
  const lSh = W(11), rSh = W(12), lHip = W(23), rHip = W(24);
  const midSh = lSh.map((p, i) => mid(p, rSh[i])), midHip = lHip.map((p, i) => mid(p, rHip[i]));
  const F0 = midSh.map((p, i) => { const r = unit(sub(rSh[i], lSh[i])); return cross(unit(reject(sub(p, midHip[i]), r)), r); });
  return chiralityOf(frames, F0, midSh, W(0), W(29), W(30), W(31), W(32));
}

// Calculs V1, isolés d'analyze() pour la lisibilité. Toutes les grandeurs sont en coordonnées monde
// (origine au centre des hanches, y vers le haut) : le sol n'est connu qu'à travers les chevilles.
function extendedAnalysis(c) {
  const { frames, opts, t, fps, n, R, stroke, impact, from, to, prep, loadIdx, accel, P, lSh, rSh, lHip, rHip, lAn, rAn, sh, el, wr, nose, groundY } = c;
  const cache = new Map();
  const Q = (i) => { if (!cache.has(i)) cache.set(i, P(i)); return cache.get(i); };
  const midSh = lSh.map((p, i) => mid(p, rSh[i]));
  const midHip = lHip.map((p, i) => mid(p, rHip[i]));
  const fr = (i) => Math.round(fps * i); // secondes → images

  // --- Repère local du thorax : U = vertical du tronc (hanches → épaules), Rt = gauche → droite (épaules),
  // Fw = avant de la poitrine. Le signe de Fw ne se déduit pas d'un produit vectoriel seul : selon la source
  // (MediaPipe, démo, autre caméra) le repère monde peut être direct ou miroir. On le fixe par les données :
  // le nez et les orteils sont devant le corps.
  // L'axe principal est la ligne des épaules (elle porte l'inclinaison « épaule sur épaule » du service),
  // la verticale du tronc est orthogonalisée par rapport à elle.
  const Rt = rSh.map((p, i) => unit(sub(p, lSh[i])));
  const U = midSh.map((p, i) => unit(reject(sub(p, midHip[i]), Rt[i])));
  const F0 = U.map((u, i) => cross(u, Rt[i]));
  const lHe = Q(29), rHe = Q(30), lTo = Q(31), rTo = Q(32);
  const chir = chiralityOf(frames, F0, midSh, nose, lHe, rHe, lTo, rTo);
  const Fw = F0.map((f) => mul(f, chir));
  const Dl = Rt.map((r) => (R ? r : mul(r, -1))); // axe latéral côté bras dominant

  // --- Épaule dominante, 3 axes (degrés) :
  // élévation = angle bras / vertical du tronc vers le bas (0 = bras le long du corps, 90 = horizontal) ;
  // abduction horizontale = position du bras dans le plan transverse du thorax (0 = dans le plan des épaules,
  //   > 0 = coude derrière ce plan, < 0 = devant) ;
  // rotation = orientation de l'avant-bras autour de l'humérus (0 = avant-bras vers l'avant du buste,
  //   90 = vers le haut quand le bras est à l'horizontale, ≈ 170 = raquette dans le dos à l'armé du service).
  //   Indéfinie quand le coude est presque tendu : ces images sont interpolées.
  const elevA = new Array(n), abdA = new Array(n), rotRaw = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = unit(sub(el[i], sh[i])), f = unit(sub(wr[i], el[i]));
    const ux = dot(u, Dl[i]), uy = dot(u, U[i]), uz = dot(u, Fw[i]);
    elevA[i] = Math.acos(clamp(-uy, -1, 1)) * D;
    abdA[i] = Math.hypot(ux, uz) > 0.25 ? Math.atan2(-uz, ux) * D : NaN;
    const r0v = reject(Fw[i], u), fp = reject(f, u);
    if (len(fp) < 0.25 || len(r0v) < 0.2) { rotRaw[i] = NaN; continue; }
    const r0 = unit(r0v);
    const sgn = dot(cross(Dl[i], Fw[i]), U[i]) >= 0 ? 1 : -1;
    const r90 = mul(unit(cross(u, r0)), sgn);
    rotRaw[i] = Math.atan2(dot(fp, r90), dot(fp, r0)) * D;
  }
  // Déroulement de phase sur les seules valeurs valides, puis interpolation des trous.
  let prev = null;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(rotRaw[i])) continue;
    if (prev != null) { while (rotRaw[i] - prev > 180) rotRaw[i] -= 360; while (rotRaw[i] - prev < -180) rotRaw[i] += 360; }
    prev = rotRaw[i];
  }
  const rotS = smooth(fillNaN(rotRaw), 1);
  const shoulderElev = smooth(elevA, 1);
  const shoulderAbdH = smooth(fillNaN(abdA), 1);
  // Armé = rotation externe maximale entre la fin de la charge et l'impact. Le déroulement de phase laisse un
  // multiple de 360° arbitraire (le bras qui pend rend l'origine ambiguë) : on recale toute la série pour que
  // la valeur à l'armé tombe dans ]−90°, 270°], seule plage anatomiquement possible.
  // Au revers (rotation externe pendant la frappe), l'« armé » est le début de l'accélération.
  const m0 = Math.max(from, loadIdx - fr(0.1)), m1 = Math.max(m0 + 1, impact + 1);
  const merIdx = stroke === 'backhand' ? clamp(accel, 0, n - 1) : argmax(rotS, m0, m1);
  const turns = Math.floor((rotS[merIdx] + 90) / 360);
  const shoulderRot = rotS.map((v) => v - 360 * turns);
  const shoulderIRVel = smooth(deriv(shoulderRot, t).map((v) => -v), 1);
  const irIdx = argmax(shoulderIRVel, merIdx, Math.min(n, impact + fr(0.03) + 1));

  // --- Centre de masse (De Leva, 14 segments) et transfert avant / équilibre.
  const sex = opts.sex === 'female' ? 'female' : 'male';
  const idxs = [7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  idxs.forEach(Q);
  const wf = new Array(33);
  const com = new Array(n);
  for (let i = 0; i < n; i++) {
    for (const k of idxs) wf[k] = cache.get(k)[i];
    com[i] = centerOfMass(wf, sex);
  }
  // Direction « avant » horizontale : vitesse du poignet à l'impact (≈ direction de frappe), complétée par
  // l'avant du buste quand le poignet bouge surtout verticalement.
  const ia = Math.max(0, impact - 2), ib = Math.min(n - 1, impact + 2);
  const vW = sub(wr[ib], wr[ia]);
  let H = { x: vW.x, y: 0, z: vW.z };
  const hl = len(H) / Math.max(1e-6, (t[ib] - t[ia]));
  const fH = unit({ x: Fw[impact].x, y: 0, z: Fw[impact].z });
  H = unit(add(mul(unit(H), Math.min(1, hl / 3)), mul(fH, 0.3)));
  if (len(H) < 0.5) H = fH;
  const Lh = { x: -H.z, y: 0, z: H.x };
  const footIdx = [27, 28, 29, 30, 31, 32];
  // Les coordonnées monde sont relatives au bassin : le déplacement absolu du CM n'est pas observable
  // directement. On le mesure par rapport au pied d'appui, c.-à-d. le pied qui bouge le moins dans l'image
  // (caméra fixe) entre la préparation et l'impact. Sans image : pied avant au service, milieu des appuis sinon.
  const footMove = (k) => {
    let s = 0, c0 = frames[Math.max(0, prep)].img?.[k];
    if (!c0) return null;
    for (let i = Math.max(0, prep); i <= impact; i++) { const q = frames[i].img?.[k]; if (!q) return null; s += Math.hypot(q.x - c0.x, q.y - c0.y); }
    return s;
  };
  const mL = footMove(27), mR = footMove(28);
  const anchorIdx = mL != null && mR != null && Math.abs(mL - mR) > 1e-3 * (impact - prep + 1)
    ? (mL < mR ? [27, 29, 31] : [28, 30, 32])
    : stroke === 'serve' ? (R ? [27, 29, 31] : [28, 30, 32]) : footIdx;
  const anchor = (i) => { let s = { x: 0, y: 0, z: 0 }; for (const k of anchorIdx) s = add(s, cache.get(k)[i]); return mul(s, 1 / anchorIdx.length); };
  const comForward = com.map((p, i) => dot(sub(p, anchor(i)), H));
  const back = Math.min(...comForward.slice(Math.max(0, prep), impact + 1));
  const comShift = Math.max(...comForward.slice(Math.max(0, impact - 2), Math.min(n, impact + 3))) - back;
  // Équilibre : distance du CM (projeté au sol) à l'enveloppe des appuis. Devant les appuis, une avance est
  // tolérée (elle fait partie du geste : 45 cm au service, 15 cm en fond de court) ; sur le côté ou en arrière, non.
  const allow = stroke === 'serve' ? 0.45 : 0.15;
  const balAt = (i) => {
    const hp = footIdx.map((k) => { const q = cache.get(k)[i]; return [dot(q, H), dot(q, Lh)]; });
    const [dh, dl] = outsideHull([dot(com[i], H), dot(com[i], Lh)], hull2(hp));
    const dist = Math.hypot(dh > 0 ? Math.max(0, dh - allow) : dh, dl);
    return Math.exp(-((dist / 0.15) ** 2));
  };
  let balance = 0, bn = 0;
  for (let i = ia; i <= ib; i++) { balance += balAt(i); bn++; }
  balance /= bn;

  // --- Repère image (échelle pixels → mètres pour ball.js) : rapport, image par image, de l'étendue verticale
  // nez → chevilles en monde (m) et en image (fraction de hauteur). Médiane = robuste aux postures.
  const im = (i, k) => frames[i].img?.[k];
  const kSc = [], gImg = [];
  for (let i = from; i < to; i++) {
    const a = im(i, 27), b = im(i, 28), no = im(i, 0);
    if (!a || !b || !no) continue;
    const span = Math.max(a.y, b.y) - no.y;
    const ws = nose[i].y - Math.min(lAn[i].y, rAn[i].y);
    if (span > 0.03 && ws > 0.5) kSc.push(ws / span);
    if (i <= Math.max(from + 1, loadIdx)) gImg.push(Math.max(a.y, b.y));
  }
  const mPerImgH = kSc.length ? median(kSc) : null;
  const imgRef = mPerImgH ? {
    mPerImgH, heightWorld: c.height, tImpact: t[impact],
    groundImgY: median(gImg) + 0.08 / mPerImgH,
    wristImg: im(impact, R ? 16 : 15) ? { x: im(impact, R ? 16 : 15).x, y: im(impact, R ? 16 : 15).y } : null,
  } : null;

  // --- Lancer de balle (service). Modèle balistique : la balle quitte la main quand la main décélère plus vite
  // que la gravité (a_y < −g) ; on prolonge alors une parabole à partir de la vitesse de la main. Hauteurs
  // mesurées depuis le sol (chevilles), pieds au sol pendant le lancer. À défaut : apogée du poignet + 0,6 m.
  // Au revers, le bras travaille en rotation externe pendant la frappe : « rotation externe à l'armé » et
  // « pic de rotation interne » n'ont pas de sens, ces deux champs restent null.
  const bh = stroke === 'backhand';
  const out = { shoulderElev: shoulderElev[merIdx], shoulderAbdH: shoulderAbdH[merIdx], shoulderRotExt: bh ? null : shoulderRot[merIdx], shoulderIRVel: bh ? null : shoulderIRVel[irIdx], comShift, balance };
  let toss = null;
  if (stroke === 'serve') {
    const tw = smoothPoints(frames, R ? LM.lWr : LM.rWr, 2), tf = Q(R ? 19 : 20);
    const hand = tw.map((p, i) => lerp3(p, tf[i], 0.6)); // balle entre les doigts
    const front = R ? lTo : rTo; // pied avant = côté non dominant
    const hy = hand.map((p, i) => p.y - groundY(i));
    const hx = hand.map((p, i) => dot(sub(p, front[i]), H));
    const vy = smooth(deriv(hy, t), 2), vx = smooth(deriv(hx, t), 2), ay = smooth(deriv(vy, t), 2);
    const s0 = Math.max(0, from), s1 = Math.max(s0 + 1, impact - fr(0.1));
    const iv = argmax(vy, s0, s1);
    let ir = -1;
    for (let i = iv; i < Math.min(s1, iv + fr(0.35)); i++) if (ay[i] < -G) { ir = i; break; }
    const ihMax = argmax(hy, s0, Math.max(s0 + 1, impact));
    const v0 = ir >= 0 ? vy[ir] : vy[iv];
    let method = 'ballistic', apex, fwd, apexT;
    const r = ir >= 0 ? ir : iv;
    if (v0 > 1.5) {
      const tu = v0 / G;
      apex = hy[r] + (v0 * v0) / (2 * G);
      fwd = hx[r] + vx[r] * tu;
      apexT = t[r] + tu;
      if (ir < 0) method = 'ballistic-approx';
    }
    if (!(apex > hy[ihMax] + 0.05 && apex < 6)) {
      method = 'wrist+0.6';
      apex = hy[ihMax] + 0.6; fwd = hx[ihMax]; apexT = t[ihMax] + Math.sqrt(1.2 / G);
    }
    // Hauteur de contact : poignet + ≈ 0,5 m de raquette dans l'axe de l'avant-bras, + saut mesuré dans l'image
    // (les chevilles quittent le sol ; en coordonnées monde le saut est invisible).
    let jump = 0;
    if (imgRef) {
      const a = im(impact, 27), b = im(impact, 28);
      if (a && b) jump = clamp((imgRef.groundImgY - 0.08 / mPerImgH - Math.max(a.y, b.y)) * mPerImgH, 0, 0.8);
    }
    const fy = unit(sub(wr[impact], el[impact])).y;
    const contactHeight = wr[impact].y - groundY(impact) + 0.5 * Math.max(0, fy) + jump;
    Object.assign(out, { tossApex: apex, tossForward: fwd, tossDrop: apex - contactHeight, contactHeight, jumpHeight: jump });
    toss = { method, releaseIdx: r, releaseT: t[r], apexT, releaseSpeed: v0, timeApexToImpact: t[impact] - apexT };
  }

  // --- Confiance globale (0–1) : visibilité des points clés, cadence, constance des longueurs osseuses
  // (un squelette dont l'avant-bras « change de longueur » est mal estimé), continuité des images.
  const key = [0, R ? 12 : 11, R ? 14 : 13, R ? 16 : 15, 23, 24, 25, 26, 27, 28];
  let vs = 0, vn = 0;
  for (let i = from; i < to; i++) for (const k of key) { const v = frames[i].img?.[k]?.v; vs += v ?? 1; vn++; }
  const visibility = vn ? vs / vn : 1;
  const fpsF = Math.pow(clamp(fps / 120, 0.25, 1), 0.6);
  const bonesDef = [[R ? 12 : 11, R ? 14 : 13], [R ? 14 : 13, R ? 16 : 15], [23, 25], [24, 26], [25, 27], [26, 28]];
  const cvs = bonesDef.map(([a, b]) => {
    const L = [];
    for (let i = from; i < to; i++) L.push(len(sub(frames[i].world[a], frames[i].world[b])));
    const mu = mean(L);
    return mu > 0 ? Math.sqrt(mean(L.map((x) => (x - mu) ** 2))) / mu : 1;
  });
  const bones = clamp(1 - (mean(cvs) - 0.02) / 0.2, 0.2, 1);
  const dts = [];
  for (let i = Math.max(1, from); i < to; i++) dts.push(t[i] - t[i - 1]);
  const dtMed = median(dts);
  const missing = dts.reduce((s, d) => s + Math.max(0, Math.round(d / dtMed) - 1), 0);
  const continuity = clamp(1 - missing / Math.max(1, to - from), 0, 1);
  const confidence = Math.round(clamp(Math.pow(visibility, 0.8) * fpsF * bones * continuity, 0, 1) * 100) / 100;

  return {
    metrics: out,
    series: { shoulderElev, shoulderAbdH, shoulderRot, shoulderIRVel, com, comForward },
    confidence,
    confidenceParts: { visibility: +visibility.toFixed(2), fps: +fpsF.toFixed(2), bones: +bones.toFixed(2), continuity: +continuity.toFixed(2) },
    toss,
    imgRef,
  };
}

function buildFindings(stroke, m, refs, seq, gaps, inOrder, ctx = {}) {
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
  // --- Constats V1 : épaule, centre de masse, équilibre, lancer.
  const ok = (k) => r[k] && Number.isFinite(m[k]);
  const r0 = (v) => Math.round(v);
  const cm = (v) => Math.round(v * 100);
  // Les mesures hors du plan de la caméra sont fragiles avec une seule vue : on le dit.
  const oop = ctx.source === 'video' ? ' Mesure en partie hors du plan de la caméra : à confirmer avec une 2e vue.' : '';
  if (ok('shoulderRotExt') && m.shoulderRotExt < r.shoulderRotExt.lo) push('shoulderRotExt', 2, "Armé d'épaule incomplet", `Rotation externe maximale ${r0(m.shoulderRotExt)}°, repère ≥ ${r.shoulderRotExt.lo}° (les meilleurs serveurs dépassent 160°). La raquette ne descend pas assez dans le dos : la rotation interne, premier moteur de la vitesse de raquette au service, a moins de chemin pour accélérer.${oop}`, 'rotExt', 4);
  if (ok('shoulderAbdH') && m.shoulderAbdH > r.shoulderAbdH.hi) push('shoulderAbdH', 2, "Coude trop en arrière à l'armé", `Le coude passe ${r0(m.shoulderAbdH)}° derrière le plan des épaules (repère ≤ ${r.shoulderAbdH.hi}°). Cette « hyperangulation » étire l'avant de l'épaule à chaque service sans gain de vitesse : c'est d'abord une question de santé de l'épaule.${oop}`, 'scapula', 0);
  if (ok('shoulderAbdH') && m.shoulderAbdH < r.shoulderAbdH.lo) push('shoulderAbdH', 1, "Armé fermé : coude devant le buste", `Coude ${r0(-m.shoulderAbdH)}° devant le plan des épaules à l'armé (repère ≥ ${r.shoulderAbdH.lo}°). Le bras « pousse » la raquette au lieu de la fouetter.${oop}`, 'scapula', 2);
  if (ok('shoulderElev') && m.shoulderElev < r.shoulderElev.lo) push('shoulderElev', 2, "Coude trop bas à l'armé", `Élévation du bras ${r0(m.shoulderElev)}°, repère ${r.shoulderElev.lo}–${r.shoulderElev.hi}° (≈ 100° chez les serveurs de haut niveau). Coude sous la ligne des épaules : moins de levier et plus de contrainte sur l'épaule.`, 'elbowHeight', 2);
  if (ok('shoulderElev') && m.shoulderElev > r.shoulderElev.hi + 5) push('shoulderElev', 1, "Bras trop haut à l'armé", `Élévation ${r0(m.shoulderElev)}°, repère ${r.shoulderElev.lo}–${r.shoulderElev.hi}°. Au-delà, l'épaule travaille en butée et la rotation interne est freinée.`, 'elbowHeight', 1);
  if (ok('shoulderIRVel') && (ctx.fps ?? 120) >= 100 && m.shoulderIRVel < r.shoulderIRVel.lo) push('shoulderIRVel', 1, 'Rotation interne de l’épaule lente', `Pic mesuré ≈ ${Math.round(m.shoulderIRVel / 50) * 50} °/s, repère ≥ ${r.shoulderIRVel.lo} °/s (plus de 2 000 °/s chez les meilleurs). Estimation basse par nature (lissage vidéo), à comparer d'une séance à l'autre plutôt qu'en absolu.`, 'internalRot', 4);
  if (ok('comShift') && m.comShift < r.comShift.lo) push('comShift', stroke === 'serve' ? 2 : 1, 'Le poids reste sur l’arrière', `Le centre de masse n'avance que de ${cm(m.comShift)} cm entre la charge et l'impact (repère ≥ ${cm(r.comShift.lo)} cm). Le corps ne « tombe » pas dans la frappe : la vitesse vient du bras seul.`, 'transfer', 3);
  if (ok('balance') && m.balance < r.balance.lo) push('balance', m.balance < 0.35 ? 2 : 1, "Déséquilibre à l'impact", `Indice d'équilibre ${m.balance.toFixed(2)} (repère ≥ ${r.balance.lo}) : le centre de masse sort sur le côté ou en arrière des appuis au moment de frapper. Contact moins régulier et récupération plus lente.`, 'balance', 2);
  if (ok('tossDrop') && m.tossDrop > r.tossDrop.hi) push('tossDrop', 1, 'Lancer trop haut', `Apogée ≈ ${cm(m.tossDrop)} cm au-dessus du point de contact (repère ${cm(r.tossDrop.lo)}–${cm(r.tossDrop.hi)} cm). La balle redescend vite (${(Math.sqrt(2 * G * m.tossDrop) * 3.6).toFixed(0)} km/h au contact) : le timing devient difficile, surtout au vent.`, 'toss', 1);
  if (ok('tossDrop') && m.tossDrop < r.tossDrop.lo) push('tossDrop', 1, 'Lancer trop bas', `Apogée à ${cm(m.tossDrop)} cm du point de contact seulement : tu dois précipiter l'armé, les jambes n'ont pas le temps de pousser.`, 'toss', 2);
  if (ok('tossForward') && m.tossForward < r.tossForward.lo) push('tossForward', 2, 'Lancer trop en arrière', `Balle lancée ${m.tossForward < 0 ? `${cm(-m.tossForward)} cm derrière` : `${cm(m.tossForward)} cm seulement devant`} le pied avant (repère ${cm(r.tossForward.lo)}–${cm(r.tossForward.hi)} cm devant). Tu dois te cambrer pour la frapper et le poids ne passe pas dans le terrain.${oop}`, 'toss', 3);
  if (ok('tossForward') && m.tossForward > r.tossForward.hi) push('tossForward', 1, 'Lancer trop en avant', `Balle lancée ${cm(m.tossForward)} cm devant le pied avant (repère ≤ ${cm(r.tossForward.hi)} cm) : tu frappes en chute, la balle part vers le bas.${oop}`, 'toss', 1);
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
