// KYRON · dynamique inverse à partir d'une seule caméra (vague 2).
//
// Entrée : frames { t, world:[33 {x,y,z}] (m, y vers le haut, origine au centre des hanches), img:[33 {x,y,v}] },
// le résultat d'analyze (res : impact, main, taille…) et un profil { heightM, massKg, sex?, racket? }.
//
// Chaîne de calcul :
//  1. mise à l'échelle des points « world » sur la taille déclarée ;
//  2. reconstruction de la translation du bassin : les points world sont centrés sur les hanches, la translation
//     absolue est perdue. On la retrouve dans l'image (caméra fixe) : projection affine faible perspective
//     img ≈ A·world ajustée par moindres carrés, puis déplacement des hanches dans l'image → déplacement monde
//     (pseudo-inverse : la composante dans l'axe de la caméra est inobservable et mise à zéro). Sans image, repli
//     sur un ancrage au pied le plus bas (vertical seulement) ;
//  3. nettoyage des points aberrants (visibilité faible, sauts de pose d'une image à l'autre, filtre de Hampel,
//     longueurs d'os incohérentes) remplacés par interpolation, puis dérivées lissées par Savitzky-Golay
//     (degré 5, coupure effective adaptée à la cadence : 15 Hz ≥ 100 i/s, 12 Hz ≥ 50 i/s, 8 Hz en dessous) ;
//  4. modèle à 14 segments de De Leva (1996) + raquette rigidement liée au poignet (axe entre main et avant-bras) ;
//  5. Newton-Euler sous forme « somme des segments distaux » : le moment net à une articulation est
//     M = Σ_distaux [ (c_i − J) × m_i (a_i − g) + dH_i/dt ] (− le moment de la réaction du sol pour le genou),
//     ce qui équivaut à la récursion périphérie → tronc sans propager les erreurs de signe ;
//  6. réaction du sol totale F = Σ m_i (a_i − g), répartie entre les pieds au sol (règle du levier).
//
//  7. pics robustes (percentile 90 autour du maximum d'une série débarrassée des pointes isolées) et garde-fou de
//     plausibilité : une valeur hors de toute plage physiologique publiée est marquée « douteuse », masquée
//     (pic = null) et fait baisser la confiance, au lieu d'afficher un chiffre absurde.
//
// INCERTITUDE (à afficher) : une seule caméra, pas de plateforme de force, des segments rigides, un axe de raquette
// supposé, des dérivées secondes de positions bruitées. Les pics sont des ESTIMATIONS d'ordre de
// grandeur (± 30 à 50 % typiquement) ; les tendances d'une séance à l'autre sont plus fiables que les valeurs absolues.

import { customize, RACKETS } from './physics.js';

const G = 9.81;
const L = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lPk: 17, rPk: 18, lIx: 19, rIx: 20,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHe: 29, rHe: 30, lFt: 31, rFt: 32 };

// De Leva (1996, J. Biomech. 29:1223–1230), modèle à 14 segments. [masse relative, CM depuis l'extrémité proximale
// (fraction de la longueur), rayon de giration transversal (fraction de la longueur)]. Repères approximés par les
// points MediaPipe (le tronc va du milieu des épaules au milieu des hanches, la main du poignet au milieu des doigts).
export const SEGMENTS = {
  male: { head: [0.0694, 0.5, 0.362], trunk: [0.4346, 0.5138, 0.328], upperArm: [0.0271, 0.5772, 0.285], forearm: [0.0162, 0.4574, 0.276], hand: [0.0061, 0.79, 0.628], thigh: [0.1416, 0.4095, 0.329], shank: [0.0433, 0.4459, 0.255], foot: [0.0137, 0.4415, 0.257] },
  female: { head: [0.0668, 0.5, 0.33], trunk: [0.4257, 0.4964, 0.307], upperArm: [0.0255, 0.5754, 0.278], forearm: [0.0138, 0.4559, 0.261], hand: [0.0056, 0.7474, 0.531], thigh: [0.1478, 0.3612, 0.369], shank: [0.0481, 0.4416, 0.271], foot: [0.0129, 0.4014, 0.299] },
};
// Part du tronc au-dessus de L5/S1 (De Leva : tronc supérieur + moyen ≈ 32,3 % de la masse, sur 43,5 % de tronc)
const UPPER_TRUNK_SHARE = 0.323 / 0.4346;

// Seuils d'alerte (N·m/kg ou poids de corps). Ordres de grandeur publiés, à prendre comme repères et non comme
// limites cliniques :
//  - rotation interne d'épaule au service : ~40–70 N·m chez des joueurs de haut niveau (Elliott et al. 2003,
//    J. Appl. Biomech. ; Martin et al. 2014, Am. J. Sports Med.), soit ~0,6–0,9 N·m/kg ;
//  - valgus du coude : le ligament collatéral ulnaire seul rompt vers 32–35 N·m sur cadavre (Ahmad et al. 2003) ;
//    les muscles fléchisseurs-pronateurs en reprennent une partie, mais des moments > 0,6 N·m/kg répétés sont un
//    facteur reconnu de surcharge (Elliott 2003 ; Fleisig, baseball) ;
//  - réaction du sol : poussée du service ≈ 1,5–2,5 PC (Girard et al. 2005), réception jusqu'à 3–4 PC ;
//    freinage latéral en coup droit ouvert ≈ 1–1,5 PC horizontal ;
//  - lombaires : moments de flexion latérale / extension au service élevés et asymétriques (Campbell et al. 2013,
//    Br. J. Sports Med.) ; repère prudent ~2,5–3,5 N·m/kg ;
//  - genou : moment d'extension au service ≈ 1,5–2,5 N·m/kg (Elliott 2003) ; > 3 N·m/kg = charge rotulienne élevée.
export const THRESHOLDS = {
  shoulderIR: { warn: 0.65, high: 0.85, unit: 'N·m/kg' },
  elbowValgus: { warn: 0.6, high: 0.85, unit: 'N·m/kg' },
  grfVertical: { warn: 3.0, high: 4.0, unit: 'PC' },
  grfHorizontal: { warn: 1.2, high: 1.6, unit: 'PC' },
  lumbar: { warn: 2.5, high: 3.5, unit: 'N·m/kg' },
  knee: { warn: 2.5, high: 3.2, unit: 'N·m/kg' },
};

// Garde-fou de plausibilité : au-delà, la valeur est physiologiquement invraisemblable pour un joueur (≈ 2 fois les
// plus hautes valeurs publiées, lancer de baseball compris : RI ≈ 1,1 N·m/kg, valgus ≈ 1,1 N·m/kg chez les
// lanceurs professionnels, Fleisig et al. 1995) : c'est presque toujours un artefact de suivi.
export const PLAUSIBLE = {
  shoulderIR: 2.0, shoulderTotal: 4.5, elbowValgus: 2.0,
  lumbar: 7, lumbarLateral: 6, lumbarExtension: 6,
  kneeLeft: 6, kneeRight: 6, // N·m/kg (le pic « knee » = côté plausible le plus chargé)
  grfVertical: 6, grfHorizontal: 3, // poids de corps
};

// ---------- petite algèbre 3D (tableaux [x,y,z]) ----------
const v3 = (p) => [p.x, p.y, p.z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mid = (a, b) => lerp(a, b, 0.5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Savitzky-Golay généralisé (pas de temps quelconque) ----------
// Pour chaque image i : polynôme de degré `deg` ajusté sur 2h+1 images (fenêtre décalée aux bords), évalué en t_i.
// Renvoie des poids W0, W1, W2 (valeur, dérivée 1re, 2de) à appliquer à n'importe quelle série.
export function sgWeights(t, h, deg = 3) {
  const n = t.length, win = Math.min(n, 2 * h + 1), d = Math.min(deg, win - 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = clamp(i - h, 0, n - win), idx = [];
    for (let k = 0; k < win; k++) idx.push(a + k);
    // Normales (VᵀV) c = Vᵀ y, V_kj = (t_k − t_i)^j
    const m = d + 1, A = Array.from({ length: m }, () => new Float64Array(m));
    for (const k of idx) { const x = t[k] - t[i]; for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) A[r][c] += Math.pow(x, r + c); }
    const inv = invert(A);
    // poids de la dérivée p : p! · ligne p de (VᵀV)⁻¹ Vᵀ
    const W = [new Float64Array(win), new Float64Array(win), new Float64Array(win)];
    idx.forEach((k, q) => {
      const x = t[k] - t[i];
      for (let p = 0; p < 3; p++) {
        if (p > d) continue;
        let s = 0; for (let c = 0; c < m; c++) s += inv[p][c] * Math.pow(x, c);
        W[p][q] = s * (p === 2 ? 2 : 1);
      }
    });
    out.push({ a, W });
  }
  return out;
}
function invert(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}
// Applique les poids à une série de vecteurs 3D → { p, v, a } (tableaux de [x,y,z])
function sgApply(S, series) {
  const p = [], v = [], a = [];
  for (const { a: s0, W } of S) {
    const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let q = 0; q < W[0].length; q++) {
      const x = series[s0 + q];
      for (let k = 0; k < 3; k++) { o[k][0] += W[k][q] * x[0]; o[k][1] += W[k][q] * x[1]; o[k][2] += W[k][q] * x[2]; }
    }
    p.push(o[0]); v.push(o[1]); a.push(o[2]);
  }
  return { p, v, a };
}

// ---------- Nettoyage des points aberrants ----------
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Interpolation linéaire des échantillons marqués (bad[i] = true) ; aux bords, le plus proche point valide.
function fillBad(x, bad) {
  const n = x.length, out = x.map((p) => [...p]);
  let prev = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && bad[i]) continue;
    if (i - prev > 1) { // trou ]prev, i[
      for (let k = prev + 1; k < i; k++) {
        if (prev < 0 && i >= n) break;
        out[k] = prev < 0 ? [...x[i]] : i >= n ? [...x[prev]] : lerp(x[prev], x[i], (k - prev) / (i - prev));
      }
    }
    prev = i;
  }
  return out;
}
// Points aberrants d'une série 3D :
//  - pointe : grand déplacement à l'aller ET au retour, en sens opposés, au-delà d'une vitesse plafond ;
//  - Hampel : écart à la médiane glissante (± ~25 ms) supérieur à max(3 cm + déplacement typique local par image,
//    4 σ robustes de la série) — le terme « déplacement local » évite de rejeter un mouvement rapide mais régulier.
function outliers(x, dt, vmax, bad) {
  const n = x.length, k = Math.max(2, Math.round(0.025 / dt));
  const step = []; for (let i = 1; i < n; i++) step.push(dist(x[i], x[i - 1]));
  for (let i = 1; i < n - 1; i++) {
    const a = sub(x[i], x[i - 1]), b = sub(x[i + 1], x[i]);
    if (step[i - 1] > vmax * dt && step[i] > vmax * dt && dot(a, b) < 0) bad[i] = true;
  }
  const dev = [], med = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k), m = [0, 1, 2].map((c) => median(x.slice(a, b + 1).map((p) => p[c])));
    med.push(m); dev.push(dist(x[i], m));
  }
  const sig = 1.4826 * median(dev);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k), b = Math.min(n - 2, i + k - 1);
    const typ = median(step.slice(a, b + 1));
    if (dev[i] > Math.max(0.03 + typ, 4 * sig)) bad[i] = true;
  }
  return bad;
}
// Os contrôlés (proximal, distal) : une longueur à plus de 30 % (+ 2 cm) de sa médiane marque le point distal.
const BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [15, 19], [15, 17], [16, 20], [16, 18], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [27, 31], [28, 30], [28, 32], [11, 12], [23, 24]];
function cleanJoints(raw, vis, dt) {
  const n = raw[0]?.length || 0, joints = Object.keys(raw).map(Number), bad = {};
  let nBad = 0, nTot = 0;
  for (const j of joints) {
    bad[j] = vis[j].map((v) => v < 0.3);
    const vmax = [15, 16, 17, 18, 19, 20].includes(j) ? 45 : [13, 14].includes(j) ? 30 : 20; // m/s relatifs aux hanches
    outliers(raw[j], dt, vmax, bad[j]);
  }
  for (const [a, b] of BONES) {
    if (!raw[a] || !raw[b]) continue;
    const len = raw[a].map((p, i) => dist(p, raw[b][i])), good = len.filter((_, i) => !bad[a][i] && !bad[b][i]);
    const lm = median(good.length > n / 3 ? good : len);
    for (let i = 0; i < n; i++) if (!bad[a][i] && Math.abs(len[i] - lm) > 0.3 * lm + 0.02) bad[b][i] = true;
  }
  const out = {};
  for (const j of joints) {
    const c = bad[j].filter(Boolean).length; nBad += c; nTot += n;
    out[j] = c ? fillBad(raw[j], bad[j]) : raw[j];
  }
  return { J: out, fraction: nTot ? nBad / nTot : 0 };
}

// ---------- Translation du bassin ----------
// Ajuste img − img_hanches ≈ A·world (2×3) sur tous les points visibles, puis inverse le déplacement des hanches.
function rootFromImage(frames, scale) {
  const n = frames.length;
  if (!frames.every((f) => Array.isArray(f.img) && f.img.length >= 33)) return null;
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Atx = [0, 0, 0], Aty = [0, 0, 0];
  const pts = [0, 11, 12, 13, 14, 15, 16, 25, 26, 27, 28, 31, 32];
  const hipImg = frames.map((f) => [(f.img[23].x + f.img[24].x) / 2, (f.img[23].y + f.img[24].y) / 2]);
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    for (const j of pts) {
      if ((f.img[j].v ?? 1) < 0.5) continue;
      const w = mul(v3(f.world[j]), scale);
      const dx = f.img[j].x - hipImg[i][0], dy = f.img[j].y - hipImg[i][1];
      for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) AtA[r][c] += w[r] * w[c]; Atx[r] += w[r] * dx; Aty[r] += w[r] * dy; }
      cnt++;
    }
  }
  if (cnt < 30) return null;
  const inv = invert(AtA);
  const rx = inv.map((row) => dot(row, Atx)), ry = inv.map((row) => dot(row, Aty));
  // résidu relatif (qualité de l'hypothèse caméra fixe / faible perspective)
  let res = 0, tot = 0;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 60))) {
    const f = frames[i];
    for (const j of pts) {
      const w = mul(v3(f.world[j]), scale);
      const ex = f.img[j].x - hipImg[i][0] - dot(rx, w), ey = f.img[j].y - hipImg[i][1] - dot(ry, w);
      res += ex * ex + ey * ey; tot += (f.img[j].x - hipImg[i][0]) ** 2 + (f.img[j].y - hipImg[i][1]) ** 2;
    }
  }
  const fitErr = Math.sqrt(res / Math.max(1e-12, tot));
  // pseudo-inverse : d_world = Aᵀ (A Aᵀ)⁻¹ d_img
  const a11 = dot(rx, rx), a12 = dot(rx, ry), a22 = dot(ry, ry), det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null;
  const root = hipImg.map((h) => {
    const dx = h[0] - hipImg[0][0], dy = h[1] - hipImg[0][1];
    const l1 = (a22 * dx - a12 * dy) / det, l2 = (-a12 * dx + a11 * dy) / det;
    return add(mul(rx, l1), mul(ry, l2));
  });
  return { root, fitErr, method: 'image' };
}
// Repli : le pied le plus bas reste au sol (vertical seulement ; faux pendant un saut)
function rootFromFeet(frames, scale) {
  const low = frames.map((f) => Math.min(...[27, 28, 29, 30, 31, 32].map((j) => f.world[j].y * scale)));
  const g0 = Math.min(...low);
  return { root: low.map((y) => [0, g0 - y, 0]), fitErr: null, method: 'pieds' };
}

// ---------- Dynamique inverse ----------
// opts.clean = false désactive le nettoyage des points aberrants (comparaison, tests).
export function inverseDynamics(frames, res = null, profile = {}, opts = {}) {
  const n = frames?.length || 0;
  if (n < 15) throw new Error('Séquence trop courte pour la dynamique inverse (≥ 15 images).');
  const t = frames.map((f) => f.t);
  const fps = (n - 1) / (t[n - 1] - t[0]);
  const hand = res?.hand || profile.hand || 'right';
  const R = hand === 'right';
  const sex = profile.sex === 'female' ? 'female' : 'male';
  const DL = SEGMENTS[sex];
  // Taille : déclarée, sinon mesurée par analyze, sinon 1,78 m ; masse : déclarée, sinon IMC 23
  const heightM = Number.isFinite(profile.heightM) ? profile.heightM : Number.isFinite(res?.metrics?.height) ? res.metrics.height : 1.78;
  const massKg = Number.isFinite(profile.massKg) ? profile.massKg : 23 * heightM * heightM;
  const rk = profile.racket ? (profile.racket.Icm ? profile.racket : customize(profile.racket, profile.leads || {})) : customize(RACKETS[0], {});

  // 1. Échelle : hauteur nez → chevilles médiane (+ 0,18 m) comparée à la taille déclarée
  const est = frames.map((f) => f.world[0].y - Math.min(f.world[27].y, f.world[28].y) + 0.18).sort((a, b) => a - b)[Math.floor(n / 2)];
  const scale = clamp(heightM / (est || heightM), 0.75, 1.3);
  // 2. Translation du bassin
  const doClean = opts.clean !== false;
  const rootInfo = rootFromImage(frames, scale) || rootFromFeet(frames, scale);
  const dt = 1 / fps;
  let root = rootInfo.root;
  if (doClean) root = fillBad(root, outliers(root, dt, 12, root.map(() => false)));
  // 3. Nettoyage puis positions globales lissées + dérivées
  const need = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const raw = {}, visJ = {};
  for (const j of need) {
    raw[j] = frames.map((f) => mul(v3(f.world[j]), scale));
    visJ[j] = frames.map((f) => f.img?.[j]?.v ?? f.world[j].visibility ?? f.world[j].v ?? 1);
  }
  const cleaned = doClean ? cleanJoints(raw, visJ, dt) : { J: raw, fraction: 0 };
  // Lissage : coupure effective adaptée à la cadence ET au bruit mesuré, avec deux noyaux :
  //  - bras (coudes, poignets, mains) : 15 Hz à ≥ 100 i/s (pratique courante en cinétique du service), 12 Hz à
  //    ≥ 50 i/s, 8 Hz en dessous (un mouvement rapide n'y est de toute façon pas résolu) ;
  //  - reste du corps (tronc, tête, jambes, bassin) : au plus 10 Hz, ses mouvements utiles étant plus lents.
  // Le bruit de chaque groupe est estimé par la MAD des différences secondes (σ ≈ 1,4826·MAD/√6, dominée par le
  // bruit pendant les phases lentes) ; au-delà de 4 mm, la coupure baisse en σ^−0,4 pour garder un bruit
  // d'accélération à peu près constant (∝ σ·f_c^2,5). Contrepartie assumée : sur une vidéo très bruitée, les pics
  // réels sont sous-estimés — la confiance le reflète.
  // f_c ≈ (deg+1)/(3,2·h − 4,6) · f_s/2 pour un Savitzky-Golay de degré deg (Schafer 2011)
  // Degré 5 : bande passante plus plate que le degré 3 à coupure égale (moins de biais sur les rotations rapides)
  const deg = 5, fcMax = fps >= 100 ? 15 : fps >= 50 ? 12 : 8;
  const ARM = new Set([13, 14, 15, 16, 17, 18, 19, 20]);
  const noiseOf = (js) => median(js.flatMap((j) => [0, 1, 2].map((c) => {
    const x = cleaned.J[j], d2 = []; for (let i = 1; i < n - 1; i++) d2.push(Math.abs(x[i + 1][c] - 2 * x[i][c] + x[i - 1][c]));
    return 1.4826 * median(d2) / Math.sqrt(6);
  })));
  const noiseArm = noiseOf([...ARM]), noiseBody = noiseOf(need.filter((j) => !ARM.has(j)));
  const adapt = (f0, sg) => clamp(f0 * Math.pow(0.004 / Math.max(0.004, sg), 0.4), 4, f0);
  const fc = adapt(fcMax, noiseArm), fcBody = adapt(Math.min(10, fcMax), noiseBody);
  const hOf = (f) => clamp(Math.round(((deg + 1) * fps / (2 * f) + 4.6) / 3.2), 3, 40);
  const h = hOf(fc), hB = hOf(fcBody);
  const S = sgWeights(t, h, deg), SB = hB === h ? S : sgWeights(t, hB, deg);
  const J = {};
  for (const j of need) J[j] = sgApply(ARM.has(j) ? S : SB, cleaned.J[j].map((p, i) => add(p, root[i])));
  const P = (j, i) => J[j].p[i], A = (j, i) => J[j].a[i];

  // Segments « tige » : proximal p, distal d (fonctions des images) → CM, accélération du CM, axe unitaire et ü
  const midJ = (a, b) => ({ p: J[a].p.map((x, i) => mid(x, J[b].p[i])), a: J[a].a.map((x, i) => mid(x, J[b].a[i])) });
  const pt = (j) => ({ p: J[j].p, a: J[j].a });
  const side = (r) => (r ? { sh: 12, el: 14, wr: 16, ix: 20, pk: 18, hip: 24, kn: 26, an: 28, he: 30, ft: 32 } : { sh: 11, el: 13, wr: 15, ix: 19, pk: 17, hip: 23, kn: 25, an: 27, he: 29, ft: 31 });
  // Segment « tige » en chaîne cinématique : la vitesse angulaire ω = u × u̇ (u = axe unitaire, u̇ par
  // Savitzky-Golay) et ω̇ (dérivée lissée de ω) sont estimées sur les ROTATIONS, puis les accélérations suivent
  // la formule du solide rigide a(x) = a_prox + ω̇ × r + ω × (ω × r) depuis l'articulation proximale.
  // Dériver deux fois des positions cartésiennes d'un segment qui tourne vite biaise fortement les pics (le
  // polynôme local ne suit pas un arc de plus d'un radian) ; ω, lui, varie lentement. La rotation propre autour
  // de l'axe de la tige est inobservable et négligée (inertie axiale faible, sauf le tronc traité à part).
  const rod = (key, prox, distP, mass, k, rg, cPos = null, S = SB) => {
    const c = [], ac = [], ad = [], u = [], len = [], H = [];
    for (let i = 0; i < n; i++) {
      const d = sub(distP[i], prox.p[i]); len.push(norm(d)); u.push(unit(d));
    }
    const lm = [...len].sort((x, y) => x - y)[Math.floor(n / 2)];
    const uv = sgApply(S, u).v;
    const w = u.map((x, i) => cross(x, uv[i]));
    const wd = sgApply(S, w).v;
    const I = mass * (rg * lm) ** 2;
    for (let i = 0; i < n; i++) {
      const cp = cPos ? cPos[i] : lerp(prox.p[i], distP[i], k);
      const rc = sub(cp, prox.p[i]), rd = sub(distP[i], prox.p[i]);
      const acc = (r) => add(add(prox.a[i], cross(wd[i], r)), cross(w[i], cross(w[i], r)));
      c.push(cp); ac.push(acc(rc)); ad.push(acc(rd));
      const wp = sub(wd[i], mul(u[i], dot(wd[i], u[i]))); // ω̇ transversal
      H.push(mul(wp, I));
    }
    return { key, m: mass, c, ac, ad, u, w, wd, I, Hv: H, len: lm, lenCV: cv(len) };
  };
  const segs = {};
  for (const r of [true, false]) {
    const s = side(r), tag = r ? 'R' : 'L';
    const handTip = midJ(s.ix, s.pk).p;
    const ua = rod('upperArm' + tag, pt(s.sh), J[s.el].p, DL.upperArm[0] * massKg, DL.upperArm[1], DL.upperArm[2], null, S);
    const fa = rod('forearm' + tag, { p: J[s.el].p, a: ua.ad }, J[s.wr].p, DL.forearm[0] * massKg, DL.forearm[1], DL.forearm[2], null, S);
    const hd = rod('hand' + tag, { p: J[s.wr].p, a: fa.ad }, handTip, DL.hand[0] * massKg, DL.hand[1], DL.hand[2], null, S);
    const th = rod('thigh' + tag, pt(s.hip), J[s.kn].p, DL.thigh[0] * massKg, DL.thigh[1], DL.thigh[2]);
    const sk = rod('shank' + tag, { p: J[s.kn].p, a: th.ad }, J[s.an].p, DL.shank[0] * massKg, DL.shank[1], DL.shank[2]);
    const footC = J[s.he].p.map((x, i) => lerp(x, J[s.ft].p[i], DL.foot[1]));
    const ft = rod('foot' + tag, { p: J[s.an].p, a: sk.ad }, J[s.ft].p, DL.foot[0] * massKg, 0, DL.foot[2], footC);
    Object.assign(segs, { ['upperArm' + tag]: ua, ['forearm' + tag]: fa, ['hand' + tag]: hd, ['thigh' + tag]: th, ['shank' + tag]: sk, ['foot' + tag]: ft });
  }
  // Raquette : tige rigide issue du poignet, CM à (équilibre − 7 cm de prise + 8 cm poignet → prise). Axe : 75 %
  // avant-bras + 25 % main. Le segment main (poignet → articulations des doigts, ~8 cm) est très court : son
  // orientation est bruitée, et le bras de levier de 0,33 m de la raquette amplifiait ce bruit (dérivée seconde de
  // l'angle) jusque dans l'épaule et les lombaires. En réalité la raquette forme un angle avec l'avant-bras (déviation
  // ulnaire, extension du poignet) qu'une seule caméra ne mesure pas : c'est une approximation assumée.
  // Inertie : I_cm transversal (masse, équilibre, poids de swing) ; le moment polaire (~0,0015 kg·m²) est négligé.
  {
    const hs = segs[R ? 'handR' : 'handL'], s = side(R), fa = segs[R ? 'forearmR' : 'forearmL'];
    const mr = rk.mass / 1000, off = (rk.balance - 7) / 100 + 0.08;
    const ur = fa.u.map((x, i) => unit(add(mul(x, 0.75), mul(hs.u[i], 0.25))));
    const urv = sgApply(S, ur).v, wr = ur.map((x, i) => cross(x, urv[i])), wrd = sgApply(S, wr).v;
    const c = [], ac = [], H = [];
    for (let i = 0; i < n; i++) {
      const r = mul(ur[i], off);
      c.push(add(P(s.wr, i), r));
      ac.push(add(add(fa.ad[i], cross(wrd[i], r)), cross(wr[i], cross(wr[i], r))));
      H.push(mul(sub(wrd[i], mul(ur[i], dot(wrd[i], ur[i]))), rk.Icm));
    }
    segs.racket = { key: 'racket', m: mr, c, ac, u: ur, w: wr, wd: wrd, Hv: H, I: rk.Icm, len: 0.686, lenCV: 0 };
  }
  // Tête : masse ponctuelle au milieu des oreilles
  const headC = midJ(7, 8);
  segs.head = { key: 'head', m: DL.head[0] * massKg, c: headC.p, ac: headC.a, u: null, I: 0 };
  // Tronc : corps rigide 3D (axe long, médio-latéral, antéro-postérieur) pour l'inertie de rotation axiale
  const hipM = midJ(23, 24), shM = midJ(11, 12);
  const trunkLen = [...Array(n).keys()].map((i) => norm(sub(shM.p[i], hipM.p[i]))).sort((a, b) => a - b)[Math.floor(n / 2)];
  const frame = [];
  for (let i = 0; i < n; i++) {
    const u = unit(sub(shM.p[i], hipM.p[i]));
    let l = sub(P(11, i), P(12, i)); l = unit(sub(l, mul(u, dot(l, u)))); // gauche, orthogonalisé
    frame.push([l, u, cross(l, u)]); // [médio-latéral, long, antéro-postérieur]
  }
  const omega = trunkOmega(frame, t, SB);
  const mT = DL.trunk[0] * massKg;
  const Itr = [mT * (0.33 * trunkLen) ** 2, mT * (0.19 * trunkLen) ** 2, mT * (0.3 * trunkLen) ** 2]; // ML, long, AP
  const Hdot = (i, Ifac) => { // dH/dt = I·ω̇ + ω × (I·ω), exprimé dans le repère monde via le repère du tronc
    const [e1, e2, e3] = frame[i], w = omega.w[i], wd = omega.wd[i];
    const Iw = (x) => { const a = [dot(x, e1) * Itr[0], dot(x, e2) * Itr[1], dot(x, e3) * Itr[2]].map((v) => v * Ifac); return add(add(mul(e1, a[0]), mul(e2, a[1])), mul(e3, a[2])); };
    return add(Iw(wd), cross(w, Iw(w)));
  };
  const Lj = [], upT = [];
  for (let i = 0; i < n; i++) {
    const Lp = lerp(hipM.p[i], shM.p[i], 0.15); Lj.push(Lp); // ≈ L5/S1
    upT.push(lerp(Lp, shM.p[i], 0.55));
  }
  const trunkCa = DL.trunk[1];
  segs.trunk = { key: 'trunk', m: mT, c: shM.p.map((x, i) => lerp(x, hipM.p[i], trunkCa)), ac: shM.a.map((x, i) => lerp(x, hipM.a[i], trunkCa)), u: null, I: 0, H: (i) => Hdot(i, 1) };
  const upTa = shM.a.map((x, i) => lerp(lerp(hipM.a[i], x, 0.15), x, 0.55));
  const upperTrunk = { key: 'upperTrunk', m: mT * UPPER_TRUNK_SHARE, c: upT, ac: upTa, u: null, H: (i) => Hdot(i, UPPER_TRUNK_SHARE * 0.8) };

  // dH/dt : tige → I·ω̇ transversal (calculé dans rod) ; tronc → corps rigide 3D ; tête → masse ponctuelle
  const Hd = (s, i) => (s.H ? s.H(i) : s.Hv ? s.Hv[i] : [0, 0, 0]);
  const gvec = [0, -G, 0];
  // Moment net à l'articulation J (exercé par le segment proximal sur la chaîne distale)
  const jointMoment = (list, Jp, i) => {
    let M = [0, 0, 0];
    for (const s of list) M = add(M, add(cross(sub(s.c[i], Jp), mul(sub(s.ac[i], gvec), s.m)), Hd(s, i)));
    return M;
  };
  const tag = R ? 'R' : 'L';
  const arm = [segs['upperArm' + tag], segs['forearm' + tag], segs['hand' + tag], segs.racket];
  const all = Object.values(segs);
  const totalM = all.reduce((s, x) => s + x.m, 0);
  // Sol : niveau = plus bas point des pieds sur la séquence
  const footLow = (i, r) => { const s = side(r); return Math.min(P(s.he, i)[1], P(s.ft, i)[1], P(s.an, i)[1] - 0.06); };
  let ground = Infinity; for (let i = 0; i < n; i++) ground = Math.min(ground, footLow(i, true), footLow(i, false));

  const ser = { t, grf: { vertical: [], horizontal: [], left: [], right: [] }, shoulderTorque: { ir: [], total: [] }, elbowValgus: [], lumbarTorque: { total: [], extension: [], lateral: [], axial: [] }, kneeTorque: { left: [], right: [] }, com: [] };
  let nPrevFlex = null;
  for (let i = 0; i < n; i++) {
    // Réaction du sol totale
    let F = [0, 0, 0], com = [0, 0, 0];
    for (const s of all) { F = add(F, mul(sub(s.ac[i], gvec), s.m)); com = add(com, mul(s.c[i], s.m)); }
    com = mul(com, 1 / totalM);
    ser.com.push(com);
    const BW = totalM * G;
    ser.grf.vertical.push(F[1] / BW);
    ser.grf.horizontal.push(Math.hypot(F[0], F[2]) / BW);
    // Répartition entre les pieds au sol (à moins de 6 cm du sol) par la règle du levier sur la projection du CM
    const cop = (r) => { const s = side(r); const c = mid(P(s.he, i), P(s.ft, i)); return [c[0], ground, c[2]]; };
    const onL = footLow(i, false) - ground < 0.06, onR = footLow(i, true) - ground < 0.06;
    let wR = 0, wL = 0;
    if (onL && onR) {
      const pl = cop(false), pr = cop(true);
      const dl = Math.hypot(com[0] - pl[0], com[2] - pl[2]), dr = Math.hypot(com[0] - pr[0], com[2] - pr[2]);
      wR = dl / Math.max(1e-6, dl + dr); wL = 1 - wR;
    } else if (onR) wR = 1; else if (onL) wL = 1;
    const Fz = F[1] > 0 ? F : [F[0], 0, F[2]]; // le sol ne tire pas
    ser.grf.left.push(wL * Fz[1] / BW); ser.grf.right.push(wR * Fz[1] / BW);
    // Épaule (côté frappe) : moment sur le bras ; rotation interne = composante le long de l'humérus.
    // Repère direct : pour un bras droit, la rotation interne est NÉGATIVE autour de l'axe épaule → coude.
    const s = side(R);
    const Msh = jointMoment(arm, P(s.sh, i), i);
    const uUA = segs['upperArm' + tag].u[i];
    ser.shoulderTorque.ir.push(dot(Msh, uUA) * (R ? -1 : 1));
    ser.shoulderTorque.total.push(norm(Msh));
    // Coude : moment sur l'avant-bras ; axe varus/valgus = perpendiculaire à l'avant-bras dans le plan du bras
    const Mel = jointMoment(arm.slice(1), P(s.el, i), i);
    const uFA = segs['forearm' + tag].u[i];
    let nf = cross(uUA, uFA);
    if (norm(nf) < 0.15 && nPrevFlex) nf = nPrevFlex; else { nf = unit(nf); nPrevFlex = nf; }
    const vAxis = unit(cross(nf, uFA));
    ser.elbowValgus.push(Math.abs(dot(Mel, vAxis)));
    // Lombaires (L5/S1) : tronc supérieur + tête + deux bras + raquette
    const upper = [upperTrunk, segs.head, segs.upperArmR, segs.forearmR, segs.handR, segs.upperArmL, segs.forearmL, segs.handL, segs.racket];
    const Ml = jointMoment(upper, Lj[i], i);
    const [e1, e2, e3] = frame[i];
    ser.lumbarTorque.total.push(norm(Ml));
    ser.lumbarTorque.extension.push(dot(Ml, e1));
    ser.lumbarTorque.lateral.push(dot(Ml, e3));
    ser.lumbarTorque.axial.push(dot(Ml, e2));
    // Genoux : moment sur la jambe (jambe + pied) moins le moment de la réaction du sol de ce pied
    for (const r of [false, true]) {
      const sd = side(r), tg = r ? 'R' : 'L';
      const Kp = P(sd.kn, i);
      let Mk = jointMoment([segs['shank' + tg], segs['foot' + tg]], Kp, i);
      const w = r ? wR : wL;
      if (w > 0) Mk = sub(Mk, cross(sub(cop(r), Kp), mul(Fz, w)));
      (r ? ser.kneeTorque.right : ser.kneeTorque.left).push(norm(Mk));
    }
  }

  // Pics dans la fenêtre de frappe (service : réception incluse)
  const imp = Number.isInteger(res?.impact) ? res.impact : null;
  const stroke = res?.stroke || 'serve';
  // (les h premières et dernières images sont exclues : fenêtres de lissage décentrées, dérivées peu fiables)
  const e0 = Math.min(Math.max(h, hB), Math.floor(n / 4)), e1 = n - 1 - e0;
  const i0 = imp == null ? e0 : clamp(imp - Math.round(fps * 0.8), e0, e1);
  const i1 = imp == null ? e1 : clamp(imp + Math.round(fps * (stroke === 'serve' ? 0.6 : 0.3)), i0, e1);
  // Pic robuste : la série est d'abord débarrassée des pointes d'une image (médiane sur 3), puis on prend le
  // percentile 90 des valeurs à ± 25 ms (≥ ± 2 images) autour de son maximum. Le maximum brut reste dans rawMax.
  const pw = Math.max(2, Math.round(0.025 * fps));
  const pct = (a, q) => { const s2 = [...a].sort((x, y) => x - y), r = q * (s2.length - 1), lo = Math.floor(r); return s2[lo] + (s2[Math.min(s2.length - 1, lo + 1)] - s2[lo]) * (r - lo); };
  const peak = (arr, absV = false) => {
    const y = arr.map((v) => (absV ? Math.abs(v) : v));
    const ym = y.map((v, i) => (i > 0 && i < n - 1 ? median([y[i - 1], v, y[i + 1]]) : v));
    let bi = i0, raw = i0;
    for (let i = i0; i <= i1; i++) { if (ym[i] > ym[bi]) bi = i; if (y[i] > y[raw]) raw = i; }
    const value = pct(ym.slice(Math.max(i0, bi - pw), Math.min(i1, bi + pw) + 1), 0.9);
    return { value, rawMax: y[raw], idx: bi, t: t[bi], msFromImpact: imp == null ? null : Math.round((t[bi] - t[imp]) * 1000) };
  };
  const perKg = (p) => ({ ...p, perKg: p.value / massKg });
  const kneeL = peak(ser.kneeTorque.left), kneeR = peak(ser.kneeTorque.right);
  const peaks = {
    grfVertical: peak(ser.grf.vertical), grfHorizontal: peak(ser.grf.horizontal),
    shoulderIR: perKg(peak(ser.shoulderTorque.ir)), shoulderTotal: perKg(peak(ser.shoulderTorque.total)),
    elbowValgus: perKg(peak(ser.elbowValgus)),
    lumbar: perKg(peak(ser.lumbarTorque.total)), lumbarLateral: perKg(peak(ser.lumbarTorque.lateral, true)), lumbarExtension: perKg(peak(ser.lumbarTorque.extension, true)),
    kneeLeft: perKg(kneeL), kneeRight: perKg(kneeR),
  };
  // Garde-fou de plausibilité : valeur invraisemblable → marquée douteuse et masquée (null), confiance réduite
  const doubtful = [];
  for (const key of Object.keys(PLAUSIBLE)) {
    const p = peaks[key]; if (!p) continue;
    const v = p.perKg ?? p.value, unitK = p.perKg != null ? 'N·m/kg' : 'PC';
    if (!(Number.isFinite(v) && v <= PLAUSIBLE[key])) {
      doubtful.push({ key, value: p.value, perKg: p.perKg ?? null, limit: PLAUSIBLE[key], unit: unitK, reason: Number.isFinite(v) ? 'hors plage physiologique' : 'valeur non finie' });
      peaks[key] = null;
    }
  }
  // genou le plus chargé parmi les côtés jugés plausibles
  const kL = peaks.kneeLeft, kR = peaks.kneeRight;
  peaks.knee = kL && (!kR || kL.value >= kR.value) ? { ...kL, side: 'left' } : kR ? { ...kR, side: 'right' } : null;

  // Confiance : cadence, visibilité, stabilité des longueurs de segments, translation du bassin, plafond 1 caméra
  const fpsF = clamp((fps - 20) / 100, 0.25, 1);
  const vis = frames.reduce((s, f) => s + need.reduce((a, j) => a + (f.img?.[j]?.v ?? 0.7), 0) / need.length, 0) / n;
  const bones = clamp(1 - 4 * Math.max(segs['upperArm' + tag].lenCV, segs['forearm' + tag].lenCV, segs.shankL.lenCV, segs.shankR.lenCV), 0.2, 1);
  const rootF = rootInfo.method === 'image' ? clamp(1 - 2 * (rootInfo.fitErr ?? 0.2), 0.4, 1) : 0.5;
  const scaleF = Math.abs(scale - 1) < 0.15 ? 1 : 0.8;
  const cleanF = clamp(1 - 1.5 * cleaned.fraction, 0.3, 1); // part de points remplacés par interpolation
  // bruit : une coupure abaissée sous-estime les pics réels
  const noiseF = clamp(Math.sqrt((fc / fcMax) * (fcBody / Math.min(10, fcMax))), 0.4, 1);
  let confidence = 0.85 * fpsF * clamp(vis, 0.2, 1) * bones * rootF * scaleF * cleanF * noiseF;
  if (Number.isFinite(res?.confidence)) confidence *= Math.sqrt(clamp(res.confidence, 0.1, 1));
  // chaque valeur douteuse réduit la confiance
  const nDoubt = doubtful.length;
  confidence *= Math.pow(0.7, nDoubt);
  confidence = +clamp(confidence, 0, 1).toFixed(2);

  const alerts = buildAlerts(peaks, confidence, stroke, doubtful);
  return {
    series: ser, peaks,
    units: { grf: 'PC (poids de corps)', torque: 'N·m', perKg: 'N·m/kg', t: 's' },
    confidence,
    alerts,
    doubtful,
    model: { massKg, heightM, sex, scale, root: rootInfo.method, rootFitErr: rootInfo.fitErr, smoothingMs: Math.round(h / fps * 1000), cutoffHz: { arm: +fc.toFixed(1), body: +fcBody.toFixed(1) }, noiseMm: { arm: +(noiseArm * 1000).toFixed(1), body: +(noiseBody * 1000).toFixed(1) }, fps, window: [i0, i1], cleanedFraction: +cleaned.fraction.toFixed(4) },
  };
}

function cv(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  return m ? sd / m : 1;
}

// Vitesse et accélération angulaires du tronc à partir de la suite de repères (Ṙ Rᵀ antisymétrisé)
function trunkOmega(frame, t, S) {
  const n = frame.length;
  const cols = [0, 1, 2].map((k) => sgApply(S, frame.map((F) => F[k])));
  const w = [];
  for (let i = 0; i < n; i++) {
    // ω = ½ Σ_k e_k × ė_k
    let o = [0, 0, 0];
    for (let k = 0; k < 3; k++) o = add(o, cross(frame[i][k], cols[k].v[i]));
    w.push(mul(o, 0.5));
  }
  const wd = sgApply(S, w).v;
  return { w, wd };
}

const DOUBT_LABEL = { shoulderIR: "rotation interne d'épaule", shoulderTotal: "moment total à l'épaule", elbowValgus: 'valgus du coude', lumbar: 'lombaires (L5/S1)', lumbarLateral: 'flexion latérale lombaire', lumbarExtension: 'extension lombaire', kneeLeft: 'genou gauche', kneeRight: 'genou droit', knee: 'genou', grfVertical: 'réaction verticale du sol', grfHorizontal: 'réaction horizontale du sol' };
function buildAlerts(pk, conf, stroke, doubtful = []) {
  const out = [];
  const low = conf < 0.4;
  const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
  const dl = doubtful;
  if (dl.length) {
    out.push({ key: 'doubtful', label: 'Valeurs douteuses masquées', severity: 1, value: dl.length, unit: '',
      detail: `${dl.map((d) => `${DOUBT_LABEL[d.key] || d.key} (${fmt(d.perKg ?? d.value, 1)} ${d.unit}, plafond plausible ${fmt(d.limit, 1)})`).join(' ; ')} : hors de toute plage physiologique publiée, probablement un artefact de suivi (saut de pose, occlusion, flou). Valeur non affichée ; refilmez de profil, mieux éclairé, à 120 i/s ou plus.` });
  }
  const push = (key, label, value, th, detail) => {
    if (!pk[key]) return;
    let sev = value >= th.high ? 3 : value >= th.warn ? 2 : 0;
    if (!sev) return;
    if (low) sev = 1;
    out.push({ key, label, severity: sev, value, unit: th.unit, detail: detail + (low ? ' Mesure peu fiable (confiance faible) : à confirmer avec une meilleure prise de vue.' : '') });
  };
  const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
  push('shoulderIR', "Rotation interne d'épaule élevée", pk.shoulderIR?.perKg, THRESHOLDS.shoulderIR,
    `Pic estimé ${f(pk.shoulderIR?.value, 0)} N·m (${f(pk.shoulderIR?.perKg)} N·m/kg). Repère haut niveau ≈ 0,6–0,9 N·m/kg : au-delà, la coiffe des rotateurs encaisse beaucoup à chaque frappe.`);
  push('elbowValgus', 'Contrainte en valgus du coude', pk.elbowValgus?.perKg, THRESHOLDS.elbowValgus,
    `Pic estimé ${f(pk.elbowValgus?.value, 0)} N·m (${f(pk.elbowValgus?.perKg)} N·m/kg). Le ligament collatéral ulnaire seul cède vers 32–35 N·m : ce sont les muscles de l'avant-bras qui le protègent.`);
  push('grfVertical', 'Impact vertical au sol élevé', pk.grfVertical?.value, THRESHOLDS.grfVertical,
    `Réaction verticale estimée ${f(pk.grfVertical?.value, 1)} fois le poids du corps${stroke === 'serve' ? ' (réception du service)' : ''}.`);
  push('grfHorizontal', 'Freinage horizontal élevé', pk.grfHorizontal?.value, THRESHOLDS.grfHorizontal,
    `Réaction horizontale estimée ${f(pk.grfHorizontal?.value, 1)} fois le poids du corps : appuis et chevilles très sollicités.`);
  push('lumbar', 'Charge lombaire élevée', pk.lumbar?.perKg, THRESHOLDS.lumbar,
    `Moment estimé à L5/S1 ${f(pk.lumbar?.value, 0)} N·m (${f(pk.lumbar?.perKg)} N·m/kg), dont flexion latérale ${f(pk.lumbarLateral?.value, 0)} N·m. L'hyperextension combinée à l'inclinaison est le mécanisme décrit chez les serveurs lombalgiques.`);
  push('knee', 'Charge du genou élevée', pk.knee?.perKg, THRESHOLDS.knee,
    `Moment estimé au genou ${pk.knee?.side === 'left' ? 'gauche' : 'droit'} ${f(pk.knee?.value, 0)} N·m (${f(pk.knee?.perKg)} N·m/kg) : tendon rotulien fortement sollicité.`);
  out.sort((a, b) => b.severity - a.severity);
  return out;
}
