// KYRON · deux caméras : synchronisation par le geste et fusion 3D simple.
//
// syncByWrist : les deux téléphones ne démarrent pas en même temps. On aligne les vidéos sur la vitesse du
// poignet de frappe, qui présente un pic net et unique à chaque frappe, visible dans les deux vues.
//   · signal par vue = vitesse 2D du poignet dans l'image (normalisée par la taille du joueur dans l'image, pour
//     que zoom et distance n'importent pas), combinée à la vitesse 3D du poignet relative au bassin (invariante
//     au point de vue, car les coordonnées « world » sont centrées sur le bassin) ;
//   · rééchantillonnage sur une grille régulière commune (les cadences peuvent différer : 60 et 240 i/s) ;
//   · corrélation croisée normalisée (Pearson sur le recouvrement) pour chaque décalage entier ;
//   · affinage sous l'échantillon par interpolation parabolique autour du maximum.
// fuseViews : alignement des repères des deux vues (rotation de Kabsch par la méthode des quaternions de Horn,
// les deux repères étant centrés sur le bassin), puis fusion point par point pondérée par la visibilité et par
// l'incertitude propre à chaque vue : la profondeur d'une caméra est ≈ 2,5× moins précise que le plan image,
// alors que la profondeur de la vue A est dans le plan de la vue B si les vues sont à ≈ 90°. C'est ce qui
// « améliore la profondeur ».
//
// Module pur, sans DOM.

const WR = { right: 16, left: 15 };

function medianDt(frames) {
  const d = [];
  for (let i = 1; i < frames.length; i++) { const x = frames[i].t - frames[i - 1].t; if (x > 0) d.push(x); }
  d.sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : 1 / 30;
}

// Interpolation linéaire d'une série {t, v} (t croissants) sur la grille t0 + k·dt.
function resample(ts, vs, t0, dt, n) {
  const out = new Float64Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + k * dt;
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const a = ts[j], b = ts[j + 1] ?? a;
    const w = b > a ? Math.max(0, Math.min(1, (t - a) / (b - a))) : 0;
    out[k] = vs[j] + ((vs[j + 1] ?? vs[j]) - vs[j]) * w;
  }
  return out;
}

const movingAvg = (x, w) => {
  const n = x.length, out = new Float64Array(n);
  let s = 0, c = 0;
  for (let i = 0; i < n + w; i++) {
    if (i < n) { s += x[i]; c++; }
    if (i - 2 * w - 1 >= 0) { s -= x[i - 2 * w - 1]; c--; }
    const k = i - w;
    if (k >= 0 && k < n) out[k] = s / c;
  }
  return out;
};

const zscore = (x) => {
  let m = 0; for (const v of x) m += v; m /= x.length || 1;
  let s = 0; for (const v of x) s += (v - m) ** 2; s = Math.sqrt(s / (x.length || 1)) || 1;
  return x.map((v) => (v - m) / s);
};

// Signal de synchronisation d'une vue, sur sa propre grille régulière.
function wristSignal(frames, hand, dt, mode) {
  const n = Math.max(2, Math.floor((frames[frames.length - 1].t - frames[0].t) / dt) + 1);
  const t0 = frames[0].t, ts = frames.map((f) => f.t), wi = WR[hand] ?? 16;
  const comp = (get) => resample(ts, frames.map(get), t0, dt, n);
  const speed = (xs) => {
    const k = xs.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let s = 0; for (let c = 0; c < k; c++) s += (xs[c][b] - xs[c][a]) ** 2;
      out[i] = Math.sqrt(s) / ((b - a) * dt || 1);
    }
    return movingAvg(out, Math.max(1, Math.round(0.012 / dt)));
  };
  let sig = null;
  const hasImg = frames[0].img && frames[0].img[wi];
  if (mode !== 'world' && hasImg) {
    // Taille du joueur dans l'image (nez → chevilles) pour une vitesse en « tailles par seconde ».
    const spans = frames.map((f) => Math.max(f.img[27].y, f.img[28].y) - f.img[0].y).filter((v) => v > 0.02).sort((a, b) => a - b);
    const sc = spans.length ? spans[spans.length >> 1] : 1;
    sig = zscore(speed([comp((f) => f.img[wi].x / sc), comp((f) => f.img[wi].y / sc)]));
  }
  if (mode !== 'img' && frames[0].world) {
    const w = zscore(speed([comp((f) => f.world[wi].x), comp((f) => f.world[wi].y), comp((f) => f.world[wi].z)]));
    sig = sig ? sig.map((v, i) => 0.5 * (v + w[i])) : w;
  }
  return { sig, t0, n };
}

// Décalage à ajouter aux temps de B pour les ramener sur l'horloge de A (tA ≈ tB + offset).
// opts : { maxOffset (s, défaut : 8 s ou la durée la plus courte), mode: 'both'|'img'|'world', dt }.
export function syncByWrist(framesA, framesB, hand = 'right', opts = {}) {
  if (!framesA?.length || !framesB?.length || framesA.length < 10 || framesB.length < 10) return { offset: 0, corr: 0 };
  const dt = opts.dt || Math.max(1 / 480, Math.min(medianDt(framesA), medianDt(framesB), 1 / 60));
  const mode = opts.mode || 'both';
  const A = wristSignal(framesA, hand, dt, mode), B = wristSignal(framesB, hand, dt, mode);
  const durA = A.n * dt, durB = B.n * dt;
  const maxOff = opts.maxOffset ?? Math.max(1, Math.min(8, Math.max(durA, durB)));
  const minOverlap = Math.max(10, Math.round(Math.min(A.n, B.n) * 0.3));
  // Pour un décalage d'indices m : A[k] ↔ B[k + m]. offset = A.t0 − B.t0 − m·dt.
  const base = (A.t0 - B.t0) / dt;
  const mLo = Math.ceil(base - maxOff / dt), mHi = Math.floor(base + maxOff / dt);
  const a = A.sig, b = B.sig;
  const corrAt = (m) => {
    const k0 = Math.max(0, -m), k1 = Math.min(A.n, B.n - m);
    const L = k1 - k0;
    if (L < minOverlap) return -2;
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let k = k0; k < k1; k++) { const x = a[k], y = b[k + m]; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
    const cov = sab - sa * sb / L, va = saa - sa * sa / L, vb = sbb - sb * sb / L;
    return va > 1e-12 && vb > 1e-12 ? cov / Math.sqrt(va * vb) : -2;
  };
  let best = -2, bm = 0;
  const cache = new Map();
  for (let m = mLo; m <= mHi; m++) { const c = corrAt(m); cache.set(m, c); if (c > best) { best = c; bm = m; } }
  if (best <= -1) return { offset: 0, corr: 0 };
  // Affinage parabolique (sous l'échantillon) autour du maximum.
  const c0 = best, cm = cache.get(bm - 1) ?? corrAt(bm - 1), cp = cache.get(bm + 1) ?? corrAt(bm + 1);
  let frac = 0;
  if (cm > -1 && cp > -1) { const den = cm - 2 * c0 + cp; if (den < 0) frac = Math.max(-0.5, Math.min(0.5, 0.5 * (cm - cp) / den)); }
  const offset = A.t0 - B.t0 - (bm + frac) * dt;
  return { offset: Math.round(offset * 1e5) / 1e5, corr: Math.round(best * 1000) / 1000, dt };
}

// ---------------------------------------------------------------------------------------------------------
// Fusion des deux vues.

// Valeurs/vecteurs propres d'une matrice symétrique n×n (Jacobi). Renvoie { values, vectors (colonnes) }.
function jacobiEigen(Min, n) {
  const A = Min.slice(), V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(tt * tt + 1), s = tt * c;
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
  }
  return { values: Array.from({ length: n }, (_, i) => A[i * n + i]), vectors: V };
}

// Rotation R (3×3, ligne par ligne) minimisant Σ w‖a − R·b‖² (Horn 1987, quaternions unitaires).
export function kabschRotation(pairs) {
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (const [a, b, w] of pairs) {
    Sxx += w * b.x * a.x; Sxy += w * b.x * a.y; Sxz += w * b.x * a.z;
    Syx += w * b.y * a.x; Syy += w * b.y * a.y; Syz += w * b.y * a.z;
    Szx += w * b.z * a.x; Szy += w * b.z * a.y; Szz += w * b.z * a.z;
  }
  const N = new Float64Array([
    Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
  ]);
  const { values, vectors } = jacobiEigen(N, 4);
  let bi = 0; for (let i = 1; i < 4; i++) if (values[i] > values[bi]) bi = i;
  const q0 = vectors[0 * 4 + bi], qx = vectors[1 * 4 + bi], qy = vectors[2 * 4 + bi], qz = vectors[3 * 4 + bi];
  return [
    [q0 * q0 + qx * qx - qy * qy - qz * qz, 2 * (qx * qy - q0 * qz), 2 * (qx * qz + q0 * qy)],
    [2 * (qy * qx + q0 * qz), q0 * q0 - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - q0 * qx)],
    [2 * (qz * qx - q0 * qy), 2 * (qz * qy + q0 * qx), q0 * q0 - qx * qx - qy * qy + qz * qz],
  ];
}

const rot = (R, p) => ({ x: R[0][0] * p.x + R[0][1] * p.y + R[0][2] * p.z, y: R[1][0] * p.x + R[1][1] * p.y + R[1][2] * p.z, z: R[2][0] * p.x + R[2][1] * p.y + R[2][2] * p.z });

// Image interpolée d'une vue à l'instant t (world et img, avec visibilité).
function frameAt(frames, t, hint) {
  let j = Math.max(0, Math.min(frames.length - 2, hint.j));
  while (j < frames.length - 2 && frames[j + 1].t < t) j++;
  while (j > 0 && frames[j].t > t) j--;
  hint.j = j;
  const a = frames[j], b = frames[j + 1] || a;
  const w = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const L = (p, q) => ({ x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w, z: (p.z ?? 0) + ((q.z ?? 0) - (p.z ?? 0)) * w });
  return {
    world: a.world.map((p, k) => L(p, b.world[k])),
    img: a.img ? a.img.map((p, k) => ({ x: p.x + (b.img[k].x - p.x) * w, y: p.y + (b.img[k].y - p.y) * w, v: Math.min(p.v ?? 1, b.img[k].v ?? 1) })) : null,
  };
}

// framesA, framesB : les deux vues ; offset : sortie de syncByWrist (tA = tB + offset).
// Renvoie des images au format habituel, sur l'horloge de A (grille commune au pas le plus fin), avec en plus
// imgB (vue B) et views: 2. Le tableau porte en propriété non énumérée `rotation` (repère B → repère A).
// opts.depthRatio : rapport écart-type profondeur / plan image d'une vue (2,5 par défaut).
export function fuseViews(framesA, framesB, offset = 0, opts = {}) {
  if (!framesA?.length || !framesB?.length) return [];
  const dt = opts.dt || Math.min(medianDt(framesA), medianDt(framesB));
  const t0 = Math.max(framesA[0].t, framesB[0].t + offset);
  const t1 = Math.min(framesA[framesA.length - 1].t, framesB[framesB.length - 1].t + offset);
  if (!(t1 > t0)) return [];
  const n = Math.floor((t1 - t0) / dt + 1e-6) + 1;
  const hA = { j: 0 }, hB = { j: 0 };
  const grid = [];
  for (let k = 0; k < n; k++) {
    const t = t0 + k * dt;
    grid.push({ t, A: frameAt(framesA, t, hA), B: frameAt(framesB, t - offset, hB) });
  }
  // Rotation B → A estimée sur tous les points du torse et des membres, pondérés par les deux visibilités.
  const pairs = [];
  const step = Math.max(1, Math.floor(n / 300));
  for (let k = 0; k < n; k += step) {
    const { A, B } = grid[k];
    for (let i = 11; i < 33; i++) {
      const w = (A.img?.[i]?.v ?? 1) * (B.img?.[i]?.v ?? 1);
      if (w > 0.2) pairs.push([A.world[i], B.world[i], w]);
    }
  }
  const R = kabschRotation(pairs);
  // Covariances (inverse = information) dans le repère A : vue A = diag(1, 1, k²) ; vue B = R·diag(1, 1, k²)·Rᵀ.
  const k2 = (opts.depthRatio ?? 2.5) ** 2;
  const infoA = [[1, 0, 0], [0, 1, 0], [0, 0, 1 / k2]];
  const infoB = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const dB = [1, 1, 1 / k2];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let m = 0; m < 3; m++) infoB[r][c] += R[r][m] * dB[m] * R[c][m];
  const mv = (M, p) => [M[0][0] * p.x + M[0][1] * p.y + M[0][2] * p.z, M[1][0] * p.x + M[1][1] * p.y + M[1][2] * p.z, M[2][0] * p.x + M[2][1] * p.y + M[2][2] * p.z];
  const solve3 = (M, v) => {
    const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null;
    return [
      (v[0] * (e * i - f * h) - b * (v[1] * i - f * v[2]) + c * (v[1] * h - e * v[2])) / det,
      (a * (v[1] * i - f * v[2]) - v[0] * (d * i - f * g) + c * (d * v[2] - v[1] * g)) / det,
      (a * (e * v[2] - v[1] * h) - b * (d * v[2] - v[1] * g) + v[0] * (d * h - e * g)) / det,
    ];
  };
  const out = grid.map(({ t, A, B }) => {
    const world = A.world.map((pa, i) => {
      const wa = Math.max(1e-3, A.img?.[i]?.v ?? 1), wb = Math.max(1e-3, B.img?.[i]?.v ?? 1);
      const pb = rot(R, B.world[i]);
      const M = infoA.map((row, r) => row.map((x, c) => wa * x + wb * infoB[r][c]));
      const ia = mv(infoA, pa), ib = mv(infoB, pb);
      const s = solve3(M, [wa * ia[0] + wb * ib[0], wa * ia[1] + wb * ib[1], wa * ia[2] + wb * ib[2]]);
      return s ? { x: s[0], y: s[1], z: s[2] } : { x: (pa.x * wa + pb.x * wb) / (wa + wb), y: (pa.y * wa + pb.y * wb) / (wa + wb), z: (pa.z * wa + pb.z * wb) / (wa + wb) };
    });
    const img = A.img ? A.img.map((p, i) => ({ x: p.x, y: p.y, v: Math.max(p.v, B.img?.[i]?.v ?? 0) })) : null;
    return { t, world, img, imgB: B.img, views: 2 };
  });
  Object.defineProperty(out, 'rotation', { value: R, enumerable: false });
  return out;
}
