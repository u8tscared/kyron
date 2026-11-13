// KYRON · suivi de balle sans réseau de neurones + estimation de la vitesse et de l'angle de départ.
//
// Pipeline par image (ImageData réduite, ≈ 480 px de large, fournie par l'app qui avance la vidéo image par
// image) :
//   1. masque couleur « balle » (jaune-vert optique en TSV, seuils tolérants : flou de bougé, compression) ;
//   2. différence avec l'image précédente (en niveaux de gris) : on ne garde que les taches qui bougent, ce qui
//      élimine les balles posées, le panier, les bâches, les vêtements jaunes immobiles ;
//   3. composantes connexes (8-connexité, pile explicite, aucun objet alloué par pixel) avec moments d'ordre 2 ;
//   4. filtre de forme : taille, allongement (≤ 4 : le flou étire la balle), remplissage de l'ellipse équivalente ;
//   5. association temporelle : pistes multiples, filtre de Kalman à vitesse constante par axe, porte de
//      Mahalanobis ; une piste n'est confirmée qu'après 3 détections cohérentes ;
//   6. rejet final : ajustement robuste d'une parabole par piste (la balle est un projectile), points aberrants
//      et pistes non balistiques écartés.
// Tout est alloué une fois par taille d'image (tableaux typés réutilisés). Coût ≈ 1–3 ms par image 480 × 270.
//
// Module pur : aucun accès au DOM, importable sous node (les tests fabriquent des ImageData à la main).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createBallTracker({ width = 480, height = 270, ...opt } = {}) {
  const cfg = {
    hueMin: 35, hueMax: 105,      // ° : jaune (60) à vert-jaune ; la balle « optic yellow » est vers 65–75°
    satMin: 0.25, valMin: 80,     // saturation 0–1, valeur 0–255
    motionThr: 16,                // écart de gris (0–255) pour qu'un pixel soit « en mouvement »
    minMoved: 0.2,                // part minimale de pixels en mouvement dans une tache
    minR: 0.8, maxRFrac: 0.035,   // rayon min (px) et max (fraction de la largeur)
    maxElong: 4, fillLo: 0.45, fillHi: 1.6,
    maxSpeedFrac: 8,              // vitesse max d'initialisation : 8 largeurs d'image par seconde
    accelFrac: 4,                 // écart-type d'accélération du modèle (largeurs / s²) : gravité, traînée, effet
    gate: 13.8,                   // seuil de Mahalanobis (χ² 2 ddl, 99,9 %)
    maxMiss: 4, minHits: 4, maxTracks: 40, maxBlobs: 400,
    ...opt,
  };
  let W = 0, H = 0, N = 0;
  let gray, prevGray, mask, stack, hasPrev = false;
  const alloc = (w, h) => {
    W = w; H = h; N = w * h;
    gray = new Uint8Array(N); prevGray = new Uint8Array(N); mask = new Uint8Array(N); stack = new Int32Array(N);
    hasPrev = false;
  };
  alloc(width, height);

  const tracks = [], archive = [];
  let nextId = 1, lastT = null;
  const dts = [];

  // --- Détection dans une image : renvoie [{x, y, r, conf, area}] (pixels).
  function detect(data) {
    const hMin = cfg.hueMin, hMax = cfg.hueMax, sMin = cfg.satMin, vMin = cfg.valMin, thr = cfg.motionThr;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const r = data[j], g = data[j + 1], b = data[j + 2];
      const gr = (r * 77 + g * 150 + b * 29) >> 8;
      gray[i] = gr;
      let m = 0;
      // Rejet rapide : la balle a peu de bleu et beaucoup de vert.
      if (g >= vMin && b < g) {
        const mx = g > r ? g : r, mn = b < r ? b : r, c = mx - mn;
        if (c > 0 && c >= sMin * mx) {
          const h = mx === r ? 60 * (g - b) / c : 60 * (2 + (b - r) / c);
          if (h >= hMin && h <= hMax) m = 1;
        }
      }
      if (m && hasPrev) { const d = gr - prevGray[i]; if (d > thr || d < -thr) m = 2; }
      mask[i] = m;
    }
    if (!hasPrev) return [];
    const maxR = cfg.maxRFrac * W, minArea = Math.max(2, Math.PI * cfg.minR * cfg.minR * 0.8), maxArea = Math.PI * maxR * maxR * 1.6;
    const out = [];
    let blobs = 0;
    for (let s = 0; s < N; s++) {
      if (!mask[s]) continue;
      if (++blobs > cfg.maxBlobs) break; // scène saturée de jaune : on abandonne l'image plutôt que de ramer
      // Remplissage par pile ; mask remis à 0 au passage (sert de marqueur « visité »).
      let sp = 0; stack[sp++] = s;
      let moved = mask[s] === 2 ? 1 : 0; mask[s] = 0;
      let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      while (sp) {
        const q = stack[--sp];
        const y = (q / W) | 0, x = q - y * W;
        area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        const y0 = y > 0 ? -1 : 0, y1 = y < H - 1 ? 1 : 0, x0 = x > 0 ? -1 : 0, x1 = x < W - 1 ? 1 : 0;
        for (let dy = y0; dy <= y1; dy++) {
          for (let dx = x0; dx <= x1; dx++) {
            const k = q + dy * W + dx;
            const mk = mask[k];
            if (mk) { if (mk === 2) moved++; mask[k] = 0; stack[sp++] = k; }
          }
        }
      }
      if (area < minArea || area > maxArea) continue;
      const mx = sx / area, my = sy / area;
      const cxx = sxx / area - mx * mx + 1 / 12, cyy = syy / area - my * my + 1 / 12, cxy = sxy / area - mx * my;
      const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
      const elong = Math.sqrt(l1 / l2);
      // Ellipse uniforme de demi-axes a, b : variances a²/4, b²/4 → aire π·a·b = 4π√(l1·l2).
      const fill = area / (4 * Math.PI * Math.sqrt(l1 * l2));
      const movedFrac = moved / area;
      if (elong > cfg.maxElong || fill < cfg.fillLo || fill > cfg.fillHi || movedFrac < cfg.minMoved) continue;
      const r = 2 * Math.sqrt(l2);
      if (r < cfg.minR || r > maxR) continue;
      const conf = clamp(0.35 + 0.65 * Math.min(1, movedFrac / 0.6), 0, 1)
        * clamp(1.15 - Math.abs(1 - fill), 0.3, 1) * clamp(1.25 - elong / 5, 0.4, 1);
      out.push({ x: mx, y: my, r, conf, area });
    }
    return out;
  }

  // --- Filtre de Kalman 1D à vitesse constante (un par axe) : état [p, v], covariance [a, b; b, c].
  const kfPredict = (k, dt, q) => {
    k.p += k.v * dt;
    const dt2 = dt * dt;
    const a = k.a + 2 * dt * k.b + dt2 * k.c + q * dt2 * dt2 / 4;
    const b = k.b + dt * k.c + q * dt2 * dt / 2;
    const c = k.c + q * dt2;
    k.a = a; k.b = b; k.c = c;
  };
  const kfUpdate = (k, z, R) => {
    const S = k.a + R, Ka = k.a / S, Kb = k.b / S, nu = z - k.p;
    k.p += Ka * nu; k.v += Kb * nu;
    const a = (1 - Ka) * k.a, b = (1 - Ka) * k.b, c = k.c - Kb * k.b;
    k.a = a; k.b = b; k.c = c;
  };
  const newTrack = (d, t) => ({
    id: nextId++, t, hits: 1, misses: 0, init: false,
    kx: { p: d.x, v: 0, a: 4, b: 0, c: 1e8 }, ky: { p: d.y, v: 0, a: 4, b: 0, c: 1e8 },
    pts: [{ t, px: d.x, py: d.y, r: d.r, conf: d.conf }],
  });

  function step(t, dets) {
    const dt = lastT == null ? 0 : t - lastT;
    if (lastT != null && dt > 0) dts.push(dt);
    lastT = t;
    const q = (cfg.accelFrac * W) ** 2, maxV = cfg.maxSpeedFrac * W;
    // Prédiction et appariements candidats (piste, détection, distance).
    const pairs = [];
    for (let ti = 0; ti < tracks.length; ti++) {
      const tr = tracks[ti], h = t - tr.t;
      for (let di = 0; di < dets.length; di++) {
        const d = dets[di];
        let d2;
        if (!tr.init) {
          // Piste à un seul point : vitesse inconnue, porte euclidienne liée à la vitesse max plausible.
          const dist = Math.hypot(d.x - tr.kx.p, d.y - tr.ky.p);
          if (h <= 0 || dist > maxV * h + 3 * d.r || dist < 0.3) continue;
          d2 = (dist / (maxV * h)) * cfg.gate;
        } else {
          const R = 1 + 0.25 * d.r * d.r;
          const px = tr.kx.p + tr.kx.v * h, py = tr.ky.p + tr.ky.v * h;
          const h2 = h * h;
          const Sx = tr.kx.a + 2 * h * tr.kx.b + h2 * tr.kx.c + q * h2 * h2 / 4 + R;
          const Sy = tr.ky.a + 2 * h * tr.ky.b + h2 * tr.ky.c + q * h2 * h2 / 4 + R;
          d2 = (d.x - px) ** 2 / Sx + (d.y - py) ** 2 / Sy;
          if (d2 > cfg.gate) continue;
        }
        pairs.push(d2, ti, di);
      }
    }
    // Affectation gloutonne par distance croissante (suffisant : peu de candidats par image).
    const order = [];
    for (let k = 0; k < pairs.length; k += 3) order.push(k);
    order.sort((a, b) => pairs[a] - pairs[b]);
    const usedT = new Uint8Array(tracks.length), usedD = new Uint8Array(dets.length);
    for (const k of order) {
      const ti = pairs[k + 1], di = pairs[k + 2];
      if (usedT[ti] || usedD[di]) continue;
      usedT[ti] = 1; usedD[di] = 1;
      const tr = tracks[ti], d = dets[di], h = t - tr.t;
      const R = 1 + 0.25 * d.r * d.r;
      if (!tr.init) {
        // Initialisation à deux points : vitesse = différence finie.
        tr.kx = { p: d.x, v: (d.x - tr.kx.p) / h, a: R, b: R / h, c: 2 * R / (h * h) + q * h * h };
        tr.ky = { p: d.y, v: (d.y - tr.ky.p) / h, a: R, b: R / h, c: 2 * R / (h * h) + q * h * h };
        tr.init = true;
      } else {
        kfPredict(tr.kx, h, q); kfPredict(tr.ky, h, q);
        kfUpdate(tr.kx, d.x, R); kfUpdate(tr.ky, d.y, R);
      }
      tr.t = t; tr.hits++; tr.misses = 0;
      tr.pts.push({ t, px: d.x, py: d.y, r: d.r, conf: d.conf });
    }
    // Pistes sans détection : on les garde quelques images (balle masquée, flou), puis on les archive.
    for (let ti = tracks.length - 1; ti >= 0; ti--) {
      if (usedT[ti]) continue;
      const tr = tracks[ti];
      tr.misses++;
      if (tr.misses > (tr.hits >= 3 ? cfg.maxMiss : 1)) {
        if (tr.hits >= cfg.minHits) archive.push(tr);
        tracks.splice(ti, 1);
      }
    }
    for (let di = 0; di < dets.length; di++) {
      if (!usedD[di] && tracks.length < cfg.maxTracks) tracks.push(newTrack(dets[di], t));
    }
  }

  // Ajustement robuste d'une parabole en t sur chaque axe ; renvoie les points gardés et l'erreur RMS (px).
  function ballistic(pts) {
    if (pts.length < 5) return { pts, rms: 0 };
    let keep = pts.slice();
    let rms = 0;
    for (let it = 0; it < 3; it++) {
      const t0 = keep[0].t;
      const fx = polyfit2(keep.map((p) => p.t - t0), keep.map((p) => p.px));
      const fy = polyfit2(keep.map((p) => p.t - t0), keep.map((p) => p.py));
      if (!fx || !fy) break;
      const res = pts.map((p) => {
        const u = p.t - t0;
        return Math.hypot(p.px - (fx[0] + fx[1] * u + fx[2] * u * u), p.py - (fy[0] + fy[1] * u + fy[2] * u * u));
      });
      const kept = res.filter((_, i) => keep.includes(pts[i]));
      rms = Math.sqrt(kept.reduce((s, e) => s + e * e, 0) / kept.length);
      const lim = Math.max(2.5, 3 * 1.4826 * median(kept));
      const next = pts.filter((_, i) => res[i] <= lim);
      if (next.length === keep.length || next.length < 5) break;
      keep = next;
    }
    return { pts: keep, rms };
  }

  return {
    // t en secondes (horloge de la vidéo), imageData = { width, height, data: Uint8ClampedArray RGBA }.
    push(t, imageData) {
      if (!imageData || !imageData.data) return;
      if (imageData.width !== W || imageData.height !== H) alloc(imageData.width, imageData.height);
      const dets = detect(imageData.data);
      const tmp = prevGray; prevGray = gray; gray = tmp; hasPrev = true;
      step(t, dets);
    },
    // Pistes confirmées, sans recouvrement temporel (la meilleure gagne), concaténées dans l'ordre du temps.
    // Points : x, y normalisés 0–1 (comme les landmarks), px, py, r en pixels, id = numéro de piste.
    result() {
      const all = archive.concat(tracks.filter((tr) => tr.hits >= cfg.minHits)).map((tr) => {
        const b = ballistic(tr.pts);
        const meanConf = b.pts.reduce((s, p) => s + p.conf, 0) / Math.max(1, b.pts.length);
        // Une piste immobile (ou presque) n'est pas une balle en vol.
        const p0 = b.pts[0], p1 = b.pts[b.pts.length - 1];
        const travel = p0 && p1 ? Math.hypot(p1.px - p0.px, p1.py - p0.py) : 0;
        const q = clamp(1 - b.rms / 6, 0.2, 1);
        return { id: tr.id, pts: b.pts, rms: b.rms, score: b.pts.length * meanConf * q, travel, q };
      }).filter((tr) => tr.pts.length >= cfg.minHits && tr.travel > 3 * Math.max(1, tr.pts[0].r));
      all.sort((a, b) => b.score - a.score);
      const chosen = [];
      for (const tr of all) {
        const a = tr.pts[0].t, b = tr.pts[tr.pts.length - 1].t;
        if (chosen.some((c) => !(b < c.a || a > c.b))) continue;
        chosen.push({ ...tr, a, b });
      }
      chosen.sort((x, y) => x.a - y.a);
      const track = [];
      for (const tr of chosen) for (const p of tr.pts) track.push({ t: p.t, x: p.px / W, y: p.py / H, r: p.r, conf: +(p.conf * tr.q).toFixed(3), px: p.px, py: p.py, id: tr.id });
      const fps = dts.length ? 1 / median(dts) : 0;
      return { track, fps, width: W, height: H, tracks: chosen.length };
    },
    reset() { tracks.length = 0; archive.length = 0; hasPrev = false; lastT = null; dts.length = 0; },
  };
}

function median(arr) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Moindres carrés pondérés y ≈ c0 + c1·u (+ c2·u²). Renvoie null si mal conditionné.
function polyfit(u, y, w, deg) {
  const m = deg + 1, A = new Float64Array(m * m), B = new Float64Array(m);
  for (let i = 0; i < u.length; i++) {
    const wi = w ? w[i] : 1;
    const pw = [1, u[i], u[i] * u[i]];
    for (let r = 0; r < m; r++) { B[r] += wi * pw[r] * y[i]; for (let c = 0; c < m; c++) A[r * m + c] += wi * pw[r] * pw[c]; }
  }
  // Élimination de Gauss avec pivot partiel.
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r * m + c]) > Math.abs(A[p * m + c])) p = r;
    if (Math.abs(A[p * m + c]) < 1e-12) return null;
    if (p !== c) { for (let k = 0; k < m; k++) { const tmp = A[c * m + k]; A[c * m + k] = A[p * m + k]; A[p * m + k] = tmp; } const tb = B[c]; B[c] = B[p]; B[p] = tb; }
    for (let r = c + 1; r < m; r++) {
      const f = A[r * m + c] / A[c * m + c];
      for (let k = c; k < m; k++) A[r * m + k] -= f * A[c * m + k];
      B[r] -= f * B[c];
    }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) { let s = B[r]; for (let k = r + 1; k < m; k++) s -= A[r * m + k] * x[k]; x[r] = s / A[r * m + r]; }
  return x;
}
const polyfit2 = (u, y) => polyfit(u, y, null, 2);

// ---------------------------------------------------------------------------------------------------------
// Vitesse et angle de départ de la balle après l'impact.
// track : points du tracker (x, y normalisés ; px, py en pixels) ; res : résultat d'analyze() (impact, imgRef,
// confidence) ; heightM : taille réelle du joueur (m) pour l'échelle. opts.window : durée analysée après
// l'impact (s, 0,3 par défaut).
// Échelle : res.imgRef.mPerImgH = mètres (monde MediaPipe) par hauteur d'image, mesuré image par image sur
// l'étendue nez → chevilles ; corrigé par heightM / taille estimée. Hypothèse : la balle part dans un plan
// parallèle à l'image, à la même distance de la caméra que le joueur (vue de profil). Toute composante vers la
// caméra est invisible : la vitesse est alors sous-estimée (borne basse), ce que reflète conf.
// Renvoie { speedKmh, launchDeg, conf, points, ... } ou null si pas assez de points exploitables.
export function estimateBallFlight(track, res, { heightM, window: win = 0.3, minPoints = 4 } = {}) {
  if (!Array.isArray(track) || track.length < minPoints || !res) return null;
  const ref = res.imgRef;
  const tImp = res.series?.t?.[res.impact] ?? ref?.tImpact;
  if (!ref || !(ref.mPerImgH > 0) || !Number.isFinite(tImp)) return null;
  const k = heightM > 0 && ref.heightWorld > 0 ? heightM / ref.heightWorld : 1;
  const mH = ref.mPerImgH * k; // mètres par hauteur d'image
  // Rapport largeur / hauteur de l'image analysée, retrouvé à partir des pixels.
  const withPx = track.find((p) => p.px > 0 && p.x > 0 && p.py > 0 && p.y > 0);
  const aspect = withPx ? (withPx.px / withPx.x) / (withPx.py / withPx.y) : 16 / 9;

  // Points après l'impact, d'une seule piste (la première qui démarre après l'impact).
  const after = track.filter((p) => p.t > tImp + 0.002 && p.t <= tImp + win);
  if (after.length < minPoints) return null;
  const id = after[0].id;
  let pts = after.filter((p) => p.id === id || id == null).map((p) => ({ t: p.t, x: p.x, y: p.y, u: p.t - tImp, X: p.x * aspect * mH, Y: -p.y * mH, w: p.conf ?? 1 }));
  if (pts.length < minPoints) return null;

  // Ajustement : X linéaire, Y parabolique à gravité connue (Y + g·u²/2 linéaire). Deux passes de rejet robuste.
  const G = 9.81;
  let fx, fy, rms = 0;
  for (let it = 0; it < 3; it++) {
    fx = polyfit(pts.map((p) => p.u), pts.map((p) => p.X), pts.map((p) => p.w), 1);
    fy = polyfit(pts.map((p) => p.u), pts.map((p) => p.Y + 0.5 * G * p.u * p.u), pts.map((p) => p.w), 1);
    if (!fx || !fy) return null;
    const r = pts.map((p) => Math.hypot(p.X - (fx[0] + fx[1] * p.u), p.Y + 0.5 * G * p.u * p.u - (fy[0] + fy[1] * p.u)));
    rms = Math.sqrt(r.reduce((s, e) => s + e * e, 0) / r.length);
    const lim = Math.max(0.03, 3 * 1.4826 * median(r));
    const next = pts.filter((_, i) => r[i] <= lim);
    if (next.length === pts.length || next.length < minPoints) break;
    pts = next;
  }
  const vx = fx[1], vy = fy[1];
  const vMean = Math.hypot(vx, vy);
  // Traînée : dv/dt = −k·v², k = ρ·Cd·A / (2m) ≈ 0,020 m⁻¹ (balle ITF : 57 g, Ø 6,7 cm, Cd ≈ 0,55).
  // La pente ajustée est la vitesse moyenne vers u moyen ; on remonte à la vitesse au départ.
  const kD = 0.0203, uMean = pts.reduce((s, p) => s + p.u, 0) / pts.length;
  const drag = clamp(1 / Math.max(0.5, 1 - kD * vMean * uMean), 1, 1.3);
  const v0 = vMean * drag;
  const speedKmh = v0 * 3.6;
  if (!(speedKmh >= 15 && speedKmh <= 290)) return null;
  const launchDeg = Math.atan2(vy, Math.abs(vx)) * 180 / Math.PI;

  // Confiance : nombre de points, durée couverte, résidu, qualité des détections, cohérence avec la position du
  // poignet à l'impact (la balle part de la raquette, à moins d'≈ 1,2 m du poignet), confiance de la pose.
  const span = pts[pts.length - 1].u - pts[0].u;
  let near = 1;
  if (ref.wristImg) {
    const d = Math.hypot(fx[0] - ref.wristImg.x * aspect * mH, fy[0] + ref.wristImg.y * mH);
    if (d > 3) return null;
    near = clamp(1 - (d - 1.2) / 1.8, 0.2, 1);
  }
  const meanW = pts.reduce((s, p) => s + p.w, 0) / pts.length;
  const conf = clamp(Math.min(1, pts.length / 8) * clamp(span / 0.08, 0.3, 1) * clamp(1 - rms / 0.1, 0.1, 1)
    * clamp(meanW, 0.2, 1) * near * Math.sqrt(clamp(res.confidence ?? 0.7, 0.1, 1)), 0, 1);

  return {
    speedKmh: Math.round(speedKmh * 10) / 10,
    launchDeg: Math.round(launchDeg * 10) / 10,
    conf: Math.round(conf * 100) / 100,
    points: pts.map((p) => ({ t: p.t, x: p.x, y: p.y, X: +p.X.toFixed(3), Y: +p.Y.toFixed(3) })),
    vx, vy, n: pts.length, rms: +rms.toFixed(3), dragCorrection: +drag.toFixed(3), scaleMPerImgH: +mH.toFixed(3), inPlane: true,
  };
}

// Apogée du lancer mesurée sur la balle suivie (service) : plus fiable que l'estimation par le poignet quand
// la balle est visible. Renvoie { apexM, apexT } (m au-dessus du sol) ou null.
export function estimateTossFromTrack(track, res, { heightM } = {}) {
  const ref = res?.imgRef;
  const tImp = res?.series?.t?.[res.impact] ?? ref?.tImpact;
  if (!Array.isArray(track) || !ref?.mPerImgH || !Number.isFinite(ref.groundImgY) || !Number.isFinite(tImp)) return null;
  const pts = track.filter((p) => p.t < tImp - 0.02 && p.t > tImp - 1.6);
  if (pts.length < 4) return null;
  const k = heightM > 0 && ref.heightWorld > 0 ? heightM / ref.heightWorld : 1;
  let top = pts[0];
  for (const p of pts) if (p.y < top.y) top = p;
  // L'apogée ne doit pas être au bord de la fenêtre (sinon la balle montait encore ou n'a pas été vue en haut).
  if (top === pts[0] || top === pts[pts.length - 1]) return null;
  return { apexM: +((ref.groundImgY - top.y) * ref.mPerImgH * k).toFixed(2), apexT: top.t };
}
