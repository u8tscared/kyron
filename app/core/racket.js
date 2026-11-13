// KYRON · détection et suivi de la raquette sans réseau (C01–C05), sur les mêmes ImageData réduites que la balle.
//
// Par image, guidé par la pose (poignet, coude du bras de frappe) :
//   1. région d'intérêt : disque autour du poignet, de rayon ≈ longueur de raquette (échelle = taille du joueur
//      dans l'image) ;
//   2. contours : gradient de Sobel + suppression des non-maxima (bords fins) ;
//   3. ellipse du cadre par RANSAC : échantillons de 5 points voisins → conique, inliers par distance de Sampson
//      ET orientation du gradient (perpendiculaire au cadre), contraintes de taille (tamis ≈ 34 × 26 cm),
//      présence du manche (le poignet doit se trouver dans le prolongement du grand axe), proximité de la
//      prédiction temporelle ; raffinement par moindres carrés sur les inliers ;
//   4. normale 3D de la face : les deux demi-axes observés comparés aux dimensions réelles du tamis donnent le
//      raccourcissement le long du manche et en travers ; l'inclinaison du manche hors du plan image vient de la
//      profondeur de l'avant-bras (landmarks world), l'ambiguïté restante (2 solutions) est levée par la
//      continuité temporelle puis par le sens de la vitesse (la face de frappe regarde vers où va la raquette).
// Si rien n'est trouvé : repli sur le modèle avant-bras (tamis dans le prolongement de l'avant-bras), avec une
// confiance basse. Toutes les grandeurs « vitesse » sont mesurées dans le plan de l'image (borne basse).
//
// Repère caméra utilisé pour la normale : x vers la droite de l'image, y vers le haut, z vers la caméra
// (cohérent avec les landmarks world après inversion de y et z). Module pur, sans DOM.

const HEAD = { a: 0.17, b: 0.13, wristToCenter: 0.43 }; // demi-axes du tamis (m), poignet → centre du tamis (m)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------------------------- coniques
// Conique A x² + B xy + C y² + D x + E y = 1 (F = −1) ; coordonnées recentrées pour le conditionnement.
function solve(M, v, n) {
  const A = Float64Array.from(M), b = Float64Array.from(v);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-14) return null;
    if (p !== c) { for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
    for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / A[c * n + c]; for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]; b[r] -= f * b[c]; }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]; x[r] = s / A[r * n + r]; }
  return x;
}
function conicFit(px, py, idx, ox, oy) {
  const M = new Float64Array(25), v = new Float64Array(5);
  for (const i of idx) {
    const x = px[i] - ox, y = py[i] - oy, r = [x * x, x * y, y * y, x, y];
    for (let a = 0; a < 5; a++) { v[a] += r[a]; for (let b = 0; b < 5; b++) M[a * 5 + b] += r[a] * r[b]; }
  }
  return solve(M, v, 5);
}
// Paramètres géométriques d'une conique (origine ox, oy) ; null si ce n'est pas une ellipse.
export function conicToEllipse(q, ox = 0, oy = 0) {
  if (!q) return null;
  const [A, B, Cc, D, E] = q, F = -1;
  const det = 4 * A * Cc - B * B;
  if (!(det > 0)) return null;
  const x0 = (B * E - 2 * Cc * D) / det, y0 = (B * D - 2 * A * E) / det;
  const F0 = A * x0 * x0 + B * x0 * y0 + Cc * y0 * y0 + D * x0 + E * y0 + F;
  const tr = A + Cc, dd = Math.sqrt(Math.max(0, (A - Cc) ** 2 + B * B));
  const l1 = (tr - dd) / 2, l2 = (tr + dd) / 2; // l1 ≤ l2 → grand axe le long du vecteur propre de l1
  if (!(-F0 / l1 > 0 && -F0 / l2 > 0)) return null;
  const a = Math.sqrt(-F0 / l1), b = Math.sqrt(-F0 / l2);
  const angle = Math.abs(B) < 1e-12 ? (A <= Cc ? 0 : Math.PI / 2) : Math.atan2(l1 - A, B / 2);
  return { cx: x0 + ox, cy: y0 + oy, a, b, angle };
}

// RANSAC d'ellipse sur des points de contour (pixels) avec gradients unitaires (gx, gy).
// prior = { cx, cy, rMin, rMax, aMin, aMax, wrist:{x,y}, pred:{x,y}|null, scale }.
export function fitEllipseRansac(pts, prior, opts = {}) {
  const n = pts.x.length;
  if (n < 12) return null;
  const iters = opts.iters ?? 500, tol = opts.tol ?? 1.6;
  const { x: px, y: py, gx, gy } = pts;
  let seed = opts.seed ?? 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const evalE = (e) => {
    const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    // Le cadre a deux bords (intérieur et extérieur) de polarités opposées : on garde la polarité majoritaire
    // pour ne pas mélanger deux ellipses concentriques.
    const pos = [], neg = [];
    for (let i = 0; i < n; i++) {
      const dx = px[i] - e.cx, dy = py[i] - e.cy;
      const u = (dx * ca + dy * sa) / e.a, v = (-dx * sa + dy * ca) / e.b;
      const r = Math.hypot(u, v);
      if (r < 0.6 || r > 1.4) continue;
      // Distance approchée au bord (Sampson) : |r² − 1| / |∇(r²)|
      const gu = 2 * u / e.a, gv = 2 * v / e.b;
      const nxl = gu * ca - gv * sa, nyl = gu * sa + gv * ca, gl = Math.hypot(nxl, nyl) || 1;
      if (Math.abs(r * r - 1) / gl > tol) continue;
      const c = (nxl * gx[i] + nyl * gy[i]) / gl;
      if (Math.abs(c) < 0.75) continue; // gradient ⟂ au cadre
      (c > 0 ? pos : neg).push(i);
    }
    return pos.length >= neg.length ? pos : neg;
  };
  const geomOK = (e) => {
    if (!e || !(e.a <= prior.aMax && e.a >= prior.aMin && e.b >= 0.18 * e.a)) return false;
    const dw = Math.hypot(e.cx - prior.wrist.x, e.cy - prior.wrist.y);
    return dw >= prior.rMin && dw <= prior.rMax;
  };
  const score = (e, inl) => {
    const perim = Math.PI * (3 * (e.a + e.b) - Math.sqrt((3 * e.a + e.b) * (e.a + 3 * e.b)));
    const cover = Math.min(1, inl.length / perim);
    // Manche : poignet dans le prolongement du grand axe.
    const wx = prior.wrist.x - e.cx, wy = prior.wrist.y - e.cy, wl = Math.hypot(wx, wy) || 1;
    const al = Math.abs((wx * Math.cos(e.angle) + wy * Math.sin(e.angle)) / wl);
    const handle = clamp((al - 0.6) / 0.35, 0, 1);
    const pred = prior.pred ? Math.exp(-((Math.hypot(e.cx - prior.pred.x, e.cy - prior.pred.y) / (0.25 * prior.scale)) ** 2)) : 0.5;
    return { s: cover * (0.55 + 0.3 * handle + 0.15 * pred), cover, handle };
  };
  let best = null;
  const near = Math.max(8, 2.2 * prior.aMax);
  const pool = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const i0 = (rnd() * n) | 0;
    let m = 0;
    for (let i = 0; i < n; i++) if (Math.abs(px[i] - px[i0]) < near && Math.abs(py[i] - py[i0]) < near) pool[m++] = i;
    if (m < 5) continue;
    const s = [i0];
    for (let k = 0; k < 12 && s.length < 5; k++) { const c = pool[(rnd() * m) | 0]; if (!s.includes(c)) s.push(c); }
    if (s.length < 5) continue;
    const e = conicToEllipse(conicFit(px, py, s, px[i0], py[i0]), px[i0], py[i0]);
    if (!geomOK(e)) continue;
    const inl = evalE(e);
    if (inl.length < 10) continue;
    const sc = score(e, inl);
    if (!best || sc.s > best.sc.s) best = { e, inl, sc };
  }
  if (!best) return null;
  // Raffinement : deux passes moindres carrés sur les inliers.
  let { e, inl } = best;
  for (let k = 0; k < 2; k++) {
    const e2 = conicToEllipse(conicFit(px, py, inl, e.cx, e.cy), e.cx, e.cy);
    if (!geomOK(e2)) break;
    const inl2 = evalE(e2);
    if (inl2.length < inl.length * 0.9) break;
    e = e2; inl = inl2;
  }
  const sc = score(e, inl);
  return { ...e, inliers: inl.length, cover: sc.cover, handle: sc.handle, score: sc.s };
}

// ------------------------------------------------------------------------------------- normale 3D
// Normale unitaire de la face à partir de l'ellipse observée. hImg : direction image poignet → centre (unitaire,
// pixels, y vers le bas) ; along/across : demi-axes observés le long du manche / en travers ; s : px par mètre ;
// hz : signe de l'inclinaison du manche vers la caméra (+1, −1 ou 0 si inconnu). Renvoie 2 candidats.
export function faceNormals(hImg, along, across, s, hz = 0) {
  // Si l'axe le long du manche paraît plus long que le vrai tamis (échelle du joueur imprécise, épaisseur du
  // cadre), on corrige l'échelle par ce rapport : seul le rapport des deux axes reste alors informatif.
  let kL = along / (HEAD.a * s), kW = across / (HEAD.b * s);
  if (kL > 1) { kW /= kL; kL = 1; }
  kL = clamp(kL, 0, 1); kW = clamp(kW, 0, 1);
  const zL = Math.sqrt(1 - kL * kL), zW = Math.sqrt(1 - kW * kW);
  const hs = hz ? [Math.sign(hz)] : [1, -1];
  const out = [];
  for (const sh of hs) {
    const h = [hImg.x * kL, -hImg.y * kL, sh * zL];
    for (const sw of [1, -1]) {
      let w = [-hImg.y * kW, -hImg.x * kW, sw * zW]; // perpendiculaire image (x, y vers le haut)
      const d = w[0] * h[0] + w[1] * h[1] + w[2] * h[2];
      w = w.map((v, i) => v - d * h[i]);
      const n = [h[1] * w[2] - h[2] * w[1], h[2] * w[0] - h[0] * w[2], h[0] * w[1] - h[1] * w[0]];
      const l = Math.hypot(...n) || 1;
      out.push({ x: n[0] / l, y: n[1] / l, z: n[2] / l });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------- suivi
export function createRacketTracker({ width = 480, height = 270, hand = 'right', heightM = 1.8, ...opt } = {}) {
  const WR = hand === 'right' ? 16 : 15, EL = hand === 'right' ? 14 : 13;
  let W = width, H = height, gray = null, mag = null, gxA = null, gyA = null;
  const alloc = (w, h) => { W = w; H = h; gray = new Float32Array(w * h); mag = new Float32Array(w * h); gxA = new Float32Array(w * h); gyA = new Float32Array(w * h); };
  alloc(W, H);
  const out = [];
  let spanEMA = null;

  function edges(data, x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const j = (y * W + x) * 4; gray[y * W + x] = data[j] * 0.3 + data[j + 1] * 0.59 + data[j + 2] * 0.11; }
    let mx = 0;
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
      const i = y * W + x;
      const gx = gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1] - gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1];
      const gy = gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1] - gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1];
      gxA[i] = gx; gyA[i] = gy; const m = Math.hypot(gx, gy); mag[i] = m; if (m > mx) mx = m;
    }
    const thr = Math.max(opt.minGrad ?? 60, 0.2 * mx);
    const X = [], Y = [], GX = [], GY = [];
    for (let y = y0 + 2; y < y1 - 1; y++) for (let x = x0 + 2; x < x1 - 1; x++) {
      const i = y * W + x, m = mag[i];
      if (m < thr) continue;
      // Non-maxima le long du gradient (quantifié sur 4 directions)
      const ax = Math.abs(gxA[i]), ay = Math.abs(gyA[i]);
      let o;
      if (ax > 2.4 * ay) o = 1; else if (ay > 2.4 * ax) o = W; else o = (gxA[i] * gyA[i] > 0) ? W + 1 : W - 1;
      if (m < mag[i - o] || m < mag[i + o]) continue;
      X.push(x); Y.push(y); GX.push(gxA[i] / m); GY.push(gyA[i] / m);
    }
    return { x: X, y: Y, gx: GX, gy: GY };
  }

  return {
    // frame : image de pose du même instant ({img, world}) ; sans pose, seul le suivi temporel est possible.
    push(t, imageData, frame) {
      if (imageData.width !== W || imageData.height !== H) alloc(imageData.width, imageData.height);
      const im = frame?.img;
      if (!im?.[WR] || !im?.[EL]) { out.push({ t, found: false, source: 'none', conf: 0 }); return; }
      const wrist = { x: im[WR].x * W, y: im[WR].y * H }, elbow = { x: im[EL].x * W, y: im[EL].y * H };
      // Échelle px/m à partir du joueur (nez → chevilles ≈ taille − 18 cm), lissée dans le temps.
      const span = im[27] && im[28] && im[0] ? (Math.max(im[27].y, im[28].y) - im[0].y) * H : null;
      if (span > 10) spanEMA = spanEMA == null ? span : 0.8 * spanEMA + 0.2 * span;
      const s = (spanEMA || 0.4 * H) / Math.max(1, heightM - 0.18);
      const fx = wrist.x - elbow.x, fy = wrist.y - elbow.y, fl = Math.hypot(fx, fy) || 1;
      const fore = { x: fx / fl, y: fy / fl };
      const R = (HEAD.wristToCenter + HEAD.a + 0.05) * s;
      const x0 = Math.max(0, Math.floor(wrist.x - R)), y0 = Math.max(0, Math.floor(wrist.y - R));
      const x1 = Math.min(W - 1, Math.ceil(wrist.x + R)), y1 = Math.min(H - 1, Math.ceil(wrist.y + R));
      const prev = out[out.length - 1], prev2 = out[out.length - 2];
      let pred = null;
      if (prev?.found && prev.source === 'image') {
        pred = { x: prev.px, y: prev.py };
        if (prev2?.found && prev2.source === 'image' && prev.t > prev2.t) { const k = (t - prev.t) / (prev.t - prev2.t); pred = { x: prev.px + (prev.px - prev2.px) * k, y: prev.py + (prev.py - prev2.py) * k }; }
      }
      let e = null;
      if (x1 - x0 > 10 && y1 - y0 > 10) {
        const pts = edges(imageData.data, x0, y0, x1, y1);
        e = fitEllipseRansac(pts, { wrist, pred, scale: s, rMin: 0.18 * s, rMax: 0.62 * s, aMin: 0.45 * HEAD.a * s, aMax: 1.45 * HEAD.a * s }, { seed: (out.length + 1) * 7919 });
        if (e && e.cover < (opt.minCover ?? 0.35)) e = null;
      }
      // Profondeur de l'avant-bras (world, z vers la caméra) : le manche le prolonge.
      const wd = frame.world ? frame.world[WR].z - frame.world[EL].z : 0;
      if (e) {
        const hx = e.cx - wrist.x, hy = e.cy - wrist.y, hl = Math.hypot(hx, hy) || 1;
        const hImg = { x: hx / hl, y: hy / hl };
        const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
        const alongMajor = Math.abs(hImg.x * ca + hImg.y * sa) >= Math.SQRT1_2;
        const along = alongMajor ? e.a : e.b, across = alongMajor ? e.b : e.a;
        const cands = faceNormals(hImg, along, across, s, Math.abs(wd) > 0.03 ? wd : 0);
        out.push({ t, found: true, source: 'image', px: e.cx, py: e.cy, x: e.cx / W, y: e.cy / H, a: e.a, b: e.b, angle: e.angle, along, across, hImg, cands, scale: s, conf: +clamp(e.score * 1.3, 0, 1).toFixed(2) });
      } else {
        // Repli : modèle avant-bras.
        const cx = wrist.x + fore.x * HEAD.wristToCenter * s, cy = wrist.y + fore.y * HEAD.wristToCenter * s;
        out.push({ t, found: true, source: 'model', px: cx, py: cy, x: cx / W, y: cy / H, hImg: fore, scale: s, conf: 0.25 });
      }
    },
    // Résolution des normales (continuité + sens de la vitesse) et vitesses. Renvoie { frames, fps }.
    result() {
      const fr = out.filter((f) => f.found);
      const n = fr.length;
      // Vitesse : pente des moindres carrés sur ± 2 images (réduit le bruit de position du centre).
      for (let i = 0; i < n; i++) {
        let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0, m = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
          const u = fr[j].t - fr[i].t; st += u; sx += fr[j].px; sy += fr[j].py; stt += u * u; stx += u * fr[j].px; sty += u * fr[j].py; m++;
        }
        const den = m * stt - st * st;
        fr[i].vx = den > 0 ? (m * stx - st * sx) / den : 0; fr[i].vy = den > 0 ? (m * sty - st * sy) / den : 0;
        fr[i].speed = Math.hypot(fr[i].vx, fr[i].vy) / fr[i].scale; // m/s dans le plan image
      }
      let prevN = null;
      for (const f of fr) {
        if (!f.cands) { f.normal = null; continue; }
        const v = { x: f.vx, y: -f.vy, z: 0 }, vl = Math.hypot(v.x, v.y) || 1;
        let best = null, bs = -Infinity;
        for (const c0 of f.cands) {
          // Face de frappe : orientée dans le sens du déplacement.
          const sg = (c0.x * v.x + c0.y * v.y) >= 0 ? 1 : -1;
          const c = { x: c0.x * sg, y: c0.y * sg, z: c0.z * sg };
          const sc = prevN ? c.x * prevN.x + c.y * prevN.y + c.z * prevN.z : Math.abs(c.x * v.x + c.y * v.y) / vl;
          if (sc > bs) { bs = sc; best = c; }
        }
        f.normal = best; prevN = best;
        delete f.cands;
      }
      const dts = [];
      for (let i = 1; i < out.length; i++) dts.push(out[i].t - out[i - 1].t);
      dts.sort((x, y) => x - y);
      return { frames: fr, fps: dts.length ? 1 / dts[dts.length >> 1] : 0, detected: fr.filter((f) => f.source === 'image').length, total: out.length };
    },
  };
}

// Synthèse autour de l'impact. racket : sortie de result() ; res : analyze() (impact) ; opts.ballTrack : points
// de ball.js (x, y normalisés, t) ; opts.tImpact pour forcer l'instant.
// Renvoie { headSpeedKmh, faceAngleDeg, faceYawDeg, pathAngleDeg, normal, impactPoint, conf, source } ou null.
export function analyzeRacket(racket, res, { ballTrack, tImpact } = {}) {
  const fr = racket?.frames || [];
  const tI = tImpact ?? res?.series?.t?.[res.impact] ?? res?.imgRef?.tImpact;
  if (!fr.length || !Number.isFinite(tI)) return null;
  let ii = 0;
  for (let i = 0; i < fr.length; i++) if (Math.abs(fr[i].t - tI) < Math.abs(fr[ii].t - tI)) ii = i;
  const fps = racket.fps || 120;
  if (Math.abs(fr[ii].t - tI) > 1.5 / fps) return null;
  const win = fr.filter((f) => f.t >= tI - 0.02 - 1e-9 && f.t <= tI + 0.01 + 1e-9);
  const headSpeed = Math.max(...win.map((f) => f.speed || 0));
  // Trajectoire de la tête sur les 30 ms avant l'impact (bas → haut positif).
  const pre = fr.filter((f) => f.t >= tI - 0.03 - 1e-9 && f.t <= tI + 1e-9);
  let pathAngleDeg = null;
  if (pre.length >= 2) {
    const a = pre[0], b = pre[pre.length - 1];
    pathAngleDeg = Math.atan2(-(b.py - a.py), Math.abs(b.px - a.px)) * 180 / Math.PI;
  }
  // Normale au plus près de l'impact parmi les images détectées.
  const withN = fr.filter((f) => f.normal && Math.abs(f.t - tI) <= 2.5 / fps).sort((a, b) => Math.abs(a.t - tI) - Math.abs(b.t - tI));
  const fN = withN[0] || null;
  const n = fN?.normal || null;
  const faceAngleDeg = n ? Math.asin(clamp(n.y, -1, 1)) * 180 / Math.PI : null; // > 0 : face ouverte (vers le haut)
  const faceYawDeg = n ? Math.atan2(n.x, n.z) * 180 / Math.PI : null;           // orientation horizontale / axe caméra
  // Point d'impact sur le tamis si la balle est visible à ± 1 image de l'impact.
  let impactPoint = null;
  if (fN && fN.source === 'image' && Array.isArray(ballTrack)) {
    const bp = ballTrack.filter((p) => Math.abs(p.t - fN.t) <= 1.01 / fps).sort((a, b) => Math.abs(a.t - fN.t) - Math.abs(b.t - fN.t))[0];
    if (bp) {
      const Wp = fN.px / fN.x, Hp = fN.py / fN.y;
      const rx = bp.x * Wp - fN.px, ry = bp.y * Hp - fN.py;
      const tip = { x: fN.hImg.x, y: fN.hImg.y }; // poignet → centre → vers le bout
      const al = (rx * tip.x + ry * tip.y) / fN.along, ac = (-rx * tip.y + ry * tip.x) / fN.across;
      if (Math.hypot(al, ac) <= 1.3) impactPoint = { alongCm: +(al * HEAD.a * 100).toFixed(1), acrossCm: +(ac * HEAD.b * 100).toFixed(1), offCenterCm: +Math.hypot(al * HEAD.a * 100, ac * HEAD.b * 100).toFixed(1) };
    }
  }
  const detFrac = win.filter((f) => f.source === 'image').length / Math.max(1, win.length);
  const conf = clamp((0.25 + 0.75 * detFrac) * (fN ? fN.conf : 0.25) * Math.sqrt(clamp(res?.confidence ?? 0.7, 0.1, 1)), 0, 1);
  return {
    headSpeedKmh: +(headSpeed * 3.6).toFixed(1),
    faceAngleDeg: faceAngleDeg == null ? null : +faceAngleDeg.toFixed(1),
    faceYawDeg: faceYawDeg == null ? null : +faceYawDeg.toFixed(1),
    pathAngleDeg: pathAngleDeg == null ? null : +pathAngleDeg.toFixed(1),
    normal: n, impactPoint,
    conf: +conf.toFixed(2),
    source: detFrac > 0.5 ? 'image' : 'model',
  };
}
