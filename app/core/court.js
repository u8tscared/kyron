// KYRON · calibration du court (A04) : lignes blanches → modèle ITF → homographie image ↔ sol → pose caméra.
//
// Repère terrain (mètres) : origine au centre du filet, X en travers (positif vers la droite vu depuis la ligne
// de fond proche de la caméra), Y le long du court (−11,885 = ligne de fond proche, +11,885 = ligne de fond
// éloignée), Z vers le haut. Coordonnées image dans l'API publique : normalisées 0–1 comme les landmarks
// (en interne : pixels).
//
// Détection automatique :
//   1. masque « ligne blanche » : pixel clair, peu saturé, et plus clair que ses voisins à ± 3 px dans au moins
//      une direction (crête fine : élimine ciel, murs blancs, vêtements) ;
//   2. transformée de Hough (θ, ρ) + suppression des non-maxima, puis réajustement de chaque droite par moindres
//      carrés totaux sur ses pixels ;
//   3. hypothèses : 2 droites « horizontales » × 2 droites « verticales » de l'image associées à 2 lignes
//      transversales × 2 lignes longitudinales du modèle → 4 intersections → homographie ; score = part du modèle
//      projeté qui tombe sur des pixels blancs ; la meilleure est raffinée par toutes les droites appariées ;
//   4. pose : focale (pixels carrés, point principal au centre) puis rotation et position de la caméra.
// Calibration manuelle de secours : 4 points cliqués (coins du court en simple par défaut) → homographie.
//
// Module pur, sans DOM.

export const COURT_ITF = {
  halfLength: 11.885, halfWidthSingles: 4.115, halfWidthDoubles: 5.485, serviceLine: 6.40,
};
const C = COURT_ITF;
// Segments du modèle [x1, y1, x2, y2] (m). Lignes transversales (Y constant) puis longitudinales (X constant).
export const COURT_LINES = [
  [-C.halfWidthDoubles, -C.halfLength, C.halfWidthDoubles, -C.halfLength],
  [-C.halfWidthDoubles, C.halfLength, C.halfWidthDoubles, C.halfLength],
  [-C.halfWidthSingles, -C.serviceLine, C.halfWidthSingles, -C.serviceLine],
  [-C.halfWidthSingles, C.serviceLine, C.halfWidthSingles, C.serviceLine],
  [-C.halfWidthDoubles, -C.halfLength, -C.halfWidthDoubles, C.halfLength],
  [C.halfWidthDoubles, -C.halfLength, C.halfWidthDoubles, C.halfLength],
  [-C.halfWidthSingles, -C.halfLength, -C.halfWidthSingles, C.halfLength],
  [C.halfWidthSingles, -C.halfLength, C.halfWidthSingles, C.halfLength],
  [0, -C.serviceLine, 0, C.serviceLine],
];
const MODEL_Y = [C.halfLength, C.serviceLine, -C.serviceLine, -C.halfLength]; // du fond éloigné au fond proche
const MODEL_X = [-C.halfWidthDoubles, -C.halfWidthSingles, 0, C.halfWidthSingles, C.halfWidthDoubles];
// Étendue de chaque ligne du modèle (pour savoir si une intersection existe vraiment sur le court).
const yLineSpan = (Y) => (Math.abs(Y) === C.halfLength ? C.halfWidthDoubles : C.halfWidthSingles);
const xLineSpan = (X) => (X === 0 ? C.serviceLine : C.halfLength);

// ------------------------------------------------------------------------------------- algèbre
// Résout A·x = b (n × n, lignes concaténées) par Gauss avec pivot partiel ; null si singulier.
export function solveLinear(A, b, n) {
  const M = Float64Array.from(A), v = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (Math.abs(M[p * n + c]) < 1e-12) return null;
    if (p !== c) { for (let k = 0; k < n; k++) { const t = M[c * n + k]; M[c * n + k] = M[p * n + k]; M[p * n + k] = t; } const t = v[c]; v[c] = v[p]; v[p] = t; }
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / M[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      v[r] -= f * v[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = v[r]; for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k]; x[r] = s / M[r * n + r]; }
  return x;
}

// Homographie H (3 × 3, tableau de 9) telle que dst ≈ H·src, par DLT normalisée (Hartley) ; ≥ 4 paires.
export function homographyFromPoints(src, dst) {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const norm = (P) => {
    let mx = 0, my = 0; for (const p of P) { mx += p.x; my += p.y; } mx /= P.length; my /= P.length;
    let d = 0; for (const p of P) d += Math.hypot(p.x - mx, p.y - my); d = (d / P.length) || 1;
    const s = Math.SQRT2 / d;
    return { T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1], P: P.map((p) => ({ x: s * (p.x - mx), y: s * (p.y - my) })) };
  };
  const a = norm(src.slice(0, n)), b = norm(dst.slice(0, n));
  // Équations normales (h33 = 1), 8 inconnues.
  const AtA = new Float64Array(64), Atb = new Float64Array(8);
  const addRow = (r, rhs) => { for (let i = 0; i < 8; i++) { Atb[i] += r[i] * rhs; for (let j = 0; j < 8; j++) AtA[i * 8 + j] += r[i] * r[j]; } };
  for (let i = 0; i < n; i++) {
    const { x, y } = a.P[i], u = b.P[i].x, v = b.P[i].y;
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(AtA, Atb, 8);
  if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // H = Tb⁻¹ · Hn · Ta
  const H = mul3(inv3(b.T), mul3(Hn, a.T));
  if (!H) return null;
  const s = H[8] || 1;
  return H.map((v) => v / s);
}
export function mul3(A, B) {
  const R = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return R;
}
export function inv3(M) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export function applyHomography(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w, w };
}

// ------------------------------------------------------------------------------------- détection
// Masque des lignes blanches (Uint8Array W·H, 1 = ligne).
export function whiteLineMask(img, opts = {}) {
  const { width: W, height: H, data } = img;
  const minL = opts.minLum ?? 130, maxSat = opts.maxSat ?? 60, dRidge = opts.ridge ?? 14, o = opts.offset ?? 3;
  const lum = new Uint8Array(W * H), sat = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2];
    lum[i] = (r * 77 + g * 150 + b * 29) >> 8;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    sat[i] = mx - mn;
  }
  const mask = new Uint8Array(W * H);
  for (let y = o; y < H - o; y++) {
    for (let x = o; x < W - o; x++) {
      const i = y * W + x, L = lum[i];
      if (L < minL || sat[i] > maxSat) continue;
      const hz = L - lum[i - o] > dRidge && L - lum[i + o] > dRidge;
      const vt = L - lum[i - o * W] > dRidge && L - lum[i + o * W] > dRidge;
      const d1 = L - lum[i - o * W - o] > dRidge && L - lum[i + o * W + o] > dRidge;
      const d2 = L - lum[i - o * W + o] > dRidge && L - lum[i + o * W - o] > dRidge;
      if (hz || vt || d1 || d2) mask[i] = 1;
    }
  }
  return mask;
}

// Droites par transformée de Hough. Renvoie [{ theta, rho, votes, nx, ny }] : nx·x + ny·y = rho (pixels).
export function houghLines(mask, W, H, opts = {}) {
  const nT = opts.thetaBins ?? 180, maxLines = opts.maxLines ?? 20;
  const D = Math.ceil(Math.hypot(W, H)), nR = 2 * D + 1;
  const acc = new Uint32Array(nT * nR);
  const cs = new Float64Array(nT), sn = new Float64Array(nT);
  for (let k = 0; k < nT; k++) { cs[k] = Math.cos(Math.PI * k / nT); sn[k] = Math.sin(Math.PI * k / nT); }
  const pts = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) pts.push(x, y);
  for (let p = 0; p < pts.length; p += 2) {
    const x = pts[p], y = pts[p + 1];
    for (let k = 0; k < nT; k++) acc[k * nR + Math.round(x * cs[k] + y * sn[k]) + D]++;
  }
  const minVotes = opts.minVotes ?? Math.max(20, Math.round(0.05 * Math.min(W, H)));
  // Pics : maxima locaux (± 2 bins en θ, ± 6 px en ρ), triés par votes.
  const peaks = [];
  for (let k = 0; k < nT; k++) {
    for (let r = 0; r < nR; r++) {
      const v = acc[k * nR + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dk = -2; dk <= 2 && isMax; dk++) {
        let kk = k + dk, rr0 = r;
        if (kk < 0) { kk += nT; rr0 = 2 * D - r; } else if (kk >= nT) { kk -= nT; rr0 = 2 * D - r; }
        for (let dr = -6; dr <= 6; dr++) {
          const rr = rr0 + dr;
          if (rr < 0 || rr >= nR || (dk === 0 && dr === 0)) continue;
          const w = acc[kk * nR + rr];
          if (w > v || (w === v && (kk * nR + rr) < k * nR + r)) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ k, r, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const lines = [];
  for (const pk of peaks) {
    // Réajustement par moindres carrés totaux sur les pixels à moins de 2 px de la droite.
    const nx = cs[pk.k], ny = sn[pk.k], rho = pk.r - D;
    let n = 0, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
    for (let p = 0; p < pts.length; p += 2) {
      const x = pts[p], y = pts[p + 1];
      if (Math.abs(x * nx + y * ny - rho) > 2) continue;
      n++; mx += x; my += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (n < minVotes * 0.6) continue;
    mx /= n; my /= n;
    const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    // Direction = vecteur propre de la plus grande valeur propre ; normale = l'autre.
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    let ux = -Math.sin(ang), uy = Math.cos(ang);
    if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
    const line = { nx: ux, ny: uy, rho: ux * mx + uy * my, votes: n };
    line.theta = Math.atan2(uy, ux);
    if (lines.some((l) => Math.abs(l.nx * line.nx + l.ny * line.ny) > Math.cos(3 * Math.PI / 180) && Math.abs(l.rho - line.rho * Math.sign(l.nx * line.nx + l.ny * line.ny)) < 5)) continue;
    lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

const intersect = (a, b) => {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (a.rho * b.ny - a.ny * b.rho) / det, y: (a.nx * b.rho - a.rho * b.nx) / det };
};

// ------------------------------------------------------------------------------------- pose caméra
// Pose à partir de H (sol → image, pixels) : focale estimée (pixels carrés, point principal au centre), puis
// rotation et centre optique. Renvoie { f, R (3×3 lignes), t, center: {x,y,z} (m, repère terrain), heightM }.
export function cameraFromHomography(H, W, Hh) {
  const cx = W / 2, cy = Hh / 2;
  const g = (c) => [H[c] - cx * H[6 + c], H[3 + c] - cy * H[6 + c], H[6 + c]];
  const g1 = g(0), g2 = g(1), g3 = g(2);
  const fs = [];
  const a = -(g1[0] * g2[0] + g1[1] * g2[1]) / (g1[2] * g2[2]);
  if (a > 0 && Number.isFinite(a)) fs.push(Math.sqrt(a));
  const b = (g2[0] ** 2 + g2[1] ** 2 - g1[0] ** 2 - g1[1] ** 2) / (g1[2] ** 2 - g2[2] ** 2);
  if (b > 0 && Number.isFinite(b)) fs.push(Math.sqrt(b));
  let f = fs.length ? fs.reduce((s, v) => s + v, 0) / fs.length : 0.9 * W;
  if (!(f > 0.2 * W && f < 20 * W)) f = 0.9 * W;
  const k = (v) => [v[0] / f, v[1] / f, v[2]];
  let r1 = k(g1), r2 = k(g2), t = k(g3);
  const l1 = Math.hypot(...r1), l2 = Math.hypot(...r2);
  let lam = 2 / (l1 + l2);
  r1 = r1.map((v) => v / l1); r2 = r2.map((v) => v / l2);
  // Orthonormalisation (r1, r2 presque orthogonaux) puis r3 = r1 × r2.
  const d = r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2];
  r2 = r2.map((v, i) => v - d * r1[i]); const n2 = Math.hypot(...r2); r2 = r2.map((v) => v / n2);
  let r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  t = t.map((v) => v * lam);
  // Le court doit être devant la caméra (profondeur > 0) : sinon signe opposé.
  if (t[2] < 0) { r1 = r1.map((v) => -v); r2 = r2.map((v) => -v); t = t.map((v) => -v); lam = -lam; }
  r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const R = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]]; // colonnes r1 r2 r3
  // Centre C = −Rᵀ t
  const center = { x: -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]), y: -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]), z: -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]) };
  // Z terrain vers le haut : la caméra doit être au-dessus du sol (sinon repère image miroir, on inverse r3).
  if (center.z < 0) { center.z = -center.z; for (let i = 0; i < 3; i++) R[i][2] = -R[i][2]; }
  return { f, R, t, center, heightM: center.z };
}

// ------------------------------------------------------------------------------------- calibration
function makeCalibration(Hg2i, W, Hh, extra = {}) {
  const Hi2g = inv3(Hg2i);
  if (!Hi2g) return null;
  return { H: Hi2g, Hinv: Hg2i, width: W, height: Hh, camera: cameraFromHomography(Hg2i, W, Hh), ...extra };
}

// Hypothèse géométriquement plausible : court devant la caméra, quadrilatère convexe, fond éloigné plus haut
// dans l'image que le fond proche, gauche/droite conservés, surface projetée non négligeable.
function plausible(Hg2i, W, Hh) {
  const D = C.halfWidthDoubles, L = C.halfLength;
  const q = [[-D, -L], [D, -L], [D, L], [-D, L]].map(([x, y]) => applyHomography(Hg2i, { x, y }));
  if (q.some((p) => !(p.w > 0) || !Number.isFinite(p.x))) return false;
  if (!(q[3].y < q[0].y && q[2].y < q[1].y && q[1].x > q[0].x && q[2].x > q[3].x)) return false;
  let area = 0, sgn = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (sgn && Math.sign(cr) !== sgn) return false;
    sgn = Math.sign(cr);
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2 > 0.02 * W * Hh;
}

// Score d'une homographie sol → image : part des points du modèle projetés (dans l'image) qui tombent sur un
// pixel du masque dilaté. Renvoie { score, inside, hits }.
function scoreModel(Hg2i, dil, W, Hh, step = 0.25) {
  let inside = 0, hits = 0;
  for (const [x1, y1, x2, y2] of COURT_LINES) {
    const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(L / step));
    for (let s = 0; s <= n; s++) {
      const p = applyHomography(Hg2i, { x: x1 + (x2 - x1) * s / n, y: y1 + (y2 - y1) * s / n });
      if (!(p.w > 0)) continue;
      const xi = Math.round(p.x), yi = Math.round(p.y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= Hh) continue;
      inside++;
      if (dil[yi * W + xi]) hits++;
    }
  }
  return { score: hits - 0.35 * (inside - hits), inside, hits };
}

// Calibration automatique sur une image (ImageData). Renvoie la calibration ou null si aucun court plausible.
// { H (image px → sol m), Hinv, width, height, camera, conf, lines, reprojPx }
export function calibrateCourt(img, opts = {}) {
  const { width: W, height: Hh } = img;
  const mask = whiteLineMask(img, opts);
  const lines = houghLines(mask, W, Hh, opts);
  if (lines.length < 4) return null;
  const dil = new Uint8Array(W * Hh);
  for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W]) dil[i] = 1;
  }
  // Droites « horizontales » de l'image (lignes transversales du court vues de derrière) et « verticales ».
  const horiz = [], vert = [];
  for (const l of lines) (Math.abs(l.ny) > Math.cos(30 * Math.PI / 180) ? horiz : vert).push(l);
  const yAt = (l) => (l.rho - l.nx * W / 2) / l.ny;              // ordonnée au centre de l'image
  const xAt = (l, y) => (l.rho - l.ny * y) / l.nx;                // abscisse à une ordonnée donnée
  horiz.sort((a, b) => yAt(a) - yAt(b)); // du haut (fond éloigné) vers le bas
  const hs = horiz.slice(0, 8), vs = vert.slice(0, 10);
  vs.sort((a, b) => xAt(a, Hh * 0.75) - xAt(b, Hh * 0.75));
  let best = null;
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    for (let a = 0; a < MODEL_Y.length; a++) for (let b = a + 1; b < MODEL_Y.length; b++) {
      for (let p = 0; p < vs.length; p++) for (let q = p + 1; q < vs.length; q++) {
        for (let u = 0; u < MODEL_X.length; u++) for (let v = u + 1; v < MODEL_X.length; v++) {
          const Y1 = MODEL_Y[a], Y2 = MODEL_Y[b], X1 = MODEL_X[u], X2 = MODEL_X[v];
          // Intersections réelles sur le court seulement (la ligne médiane ne coupe pas les lignes de fond).
          if (Math.abs(X1) > yLineSpan(Y1) || Math.abs(X2) > yLineSpan(Y1) || Math.abs(X1) > yLineSpan(Y2) || Math.abs(X2) > yLineSpan(Y2)) continue;
          if (Math.abs(Y1) > xLineSpan(X1) || Math.abs(Y2) > xLineSpan(X1) || Math.abs(Y1) > xLineSpan(X2) || Math.abs(Y2) > xLineSpan(X2)) continue;
          const P = [intersect(hs[i], vs[p]), intersect(hs[i], vs[q]), intersect(hs[j], vs[p]), intersect(hs[j], vs[q])];
          if (P.some((x) => !x || Math.abs(x.x) > 4 * W || Math.abs(x.y) > 4 * Hh)) continue;
          const G = [{ x: X1, y: Y1 }, { x: X2, y: Y1 }, { x: X1, y: Y2 }, { x: X2, y: Y2 }];
          const Hm = homographyFromPoints(G, P);
          if (!Hm || !plausible(Hm, W, Hh)) continue;
          const sc = scoreModel(Hm, dil, W, Hh, 0.5);
          if (!best || sc.score > best.sc.score) best = { Hm, sc };
        }
      }
    }
  }
  if (!best || best.sc.hits < 20) return null;
  // Raffinement : chaque ligne du modèle est appariée à la droite détectée la plus proche de sa projection,
  // puis homographie sur toutes les intersections appariées.
  let Hm = best.Hm;
  for (let it = 0; it < 2; it++) {
    const matched = COURT_LINES.map((seg) => {
      const A = applyHomography(Hm, { x: seg[0], y: seg[1] }), B = applyHomography(Hm, { x: seg[2], y: seg[3] });
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      let bl = null, bd = Infinity;
      for (const l of lines) {
        if (Math.abs(l.nx * nx + l.ny * ny) < Math.cos(4 * Math.PI / 180)) continue;
        const d = (Math.abs(l.nx * A.x + l.ny * A.y - l.rho) + Math.abs(l.nx * B.x + l.ny * B.y - l.rho)) / 2;
        if (d < bd) { bd = d; bl = l; }
      }
      return bd < 6 ? bl : null;
    });
    const src = [], dst = [];
    for (let i = 0; i < COURT_LINES.length; i++) for (let j = i + 1; j < COURT_LINES.length; j++) {
      const si = COURT_LINES[i], sj = COURT_LINES[j];
      const ti = si[1] === si[3], tj = sj[1] === sj[3];
      if (ti === tj || !matched[i] || !matched[j] || matched[i] === matched[j]) continue;
      const Y = ti ? si[1] : sj[1], X = ti ? sj[0] : si[0];
      if (Math.abs(X) > yLineSpan(Y) + 1e-9 || Math.abs(Y) > xLineSpan(X) + 1e-9) continue;
      const P = intersect(matched[i], matched[j]);
      if (P) { src.push({ x: X, y: Y }); dst.push(P); }
    }
    if (src.length >= 4) { const Hr = homographyFromPoints(src, dst); if (Hr && plausible(Hr, W, Hh) && scoreModel(Hr, dil, W, Hh).score >= scoreModel(Hm, dil, W, Hh).score - 1) Hm = Hr; }
  }
  const sc = scoreModel(Hm, dil, W, Hh);
  const conf = Math.max(0, Math.min(1, (sc.hits / Math.max(1, sc.inside) - 0.3) / 0.6)) * Math.min(1, sc.inside / 150);
  const cal = makeCalibration(Hm, W, Hh, { conf: Math.round(conf * 100) / 100, source: 'auto', lines: lines.length });
  return cal;
}

// Calibration manuelle : points cliqués dans l'image (normalisés 0–1, ou pixels si opts.pixels), associés aux
// points du court. Par défaut, 4 clics = coins du court en simple dans l'ordre : fond proche gauche, fond proche
// droite, fond éloigné droite, fond éloigné gauche. opts.court permet d'en donner d'autres ({x,y} m).
export function calibrateManual(points, { width, height, court, pixels = false } = {}) {
  if (!points || points.length < 4 || !(width > 0 && height > 0)) return null;
  const S = C.halfWidthSingles, L = C.halfLength;
  const ground = court || [{ x: -S, y: -L }, { x: S, y: -L }, { x: S, y: L }, { x: -S, y: L }];
  const img = points.map((p) => (pixels ? { x: p.x, y: p.y } : { x: p.x * width, y: p.y * height }));
  const Hg2i = homographyFromPoints(ground.slice(0, img.length), img);
  if (!Hg2i) return null;
  return makeCalibration(Hg2i, width, height, { conf: 1, source: 'manual' });
}

// Image (normalisée 0–1) → sol (m). Valable pour un point AU SOL (pied, rebond).
export function toGround(cal, p) {
  const q = applyHomography(cal.H, { x: p.x * cal.width, y: p.y * cal.height });
  return { x: q.x, y: q.y };
}
// Sol (m) → image (normalisée 0–1).
export function toImage(cal, g) {
  const q = applyHomography(cal.Hinv, g);
  return { x: q.x / cal.width, y: q.y / cal.height };
}
// Position au sol d'un joueur (milieu des chevilles d'une image de pose) ; null si chevilles absentes.
export function feetOnGround(cal, frame) {
  const a = frame?.img?.[27], b = frame?.img?.[28];
  if (!cal || !a || !b) return null;
  return toGround(cal, { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) });
}
// Le point est-il dans le court (simple par défaut) ? side : 'far' | 'near' | undefined.
export function inCourt(g, { doubles = false, side, margin = 0 } = {}) {
  const hw = doubles ? C.halfWidthDoubles : C.halfWidthSingles;
  if (Math.abs(g.x) > hw + margin || Math.abs(g.y) > C.halfLength + margin) return false;
  if (side === 'far') return g.y >= -margin;
  if (side === 'near') return g.y <= margin;
  return true;
}
