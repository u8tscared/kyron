// KYRON · statistiques de balle (E04 / E05) : effet estimé par la courbure de la trajectoire et par le rebond,
// carte des rebonds au sol (mètres), ellipse de dispersion à 95 %, profondeur moyenne.
//
// Le modèle de vol et de rebond est celui de physics.js (traînée, Magnus, décroissance de l'effet, rebond avec
// restitution + frottement, glissement ou roulement) : importé en lecture seule, rien n'est dupliqué.
// Conventions physics.js : x horizontal dans le sens du vol, y = hauteur du centre de la balle, effet > 0 = lift.
//
// Module pur, sans DOM.

import { flight, BALL, SURFACES, COURT } from './physics.js';
import { toGround, COURT_ITF } from './court.js';

const G = 9.81, DEG = Math.PI / 180, RPM = 60 / (2 * Math.PI);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Nelder–Mead minimal (dimension d), pas initiaux steps.
function nelderMead(f, x0, steps, { iters = 300, tol = 1e-10 } = {}) {
  const d = x0.length;
  let S = [x0.slice()];
  for (let i = 0; i < d; i++) { const x = x0.slice(); x[i] += steps[i]; S.push(x); }
  let F = S.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = F.map((_, i) => i).sort((a, b) => F[a] - F[b]);
    S = idx.map((i) => S[i]); F = idx.map((i) => F[i]);
    if (Math.abs(F[d] - F[0]) < tol * (1 + Math.abs(F[0]))) break;
    const c = new Array(d).fill(0);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) c[j] += S[i][j] / d;
    const at = (k) => c.map((v, j) => v + k * (S[d][j] - v));
    const xr = at(-1), fr = f(xr);
    if (fr < F[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { S[d] = xe; F[d] = fe; } else { S[d] = xr; F[d] = fr; } }
    else if (fr < F[d - 1]) { S[d] = xr; F[d] = fr; }
    else {
      const xc = at(fr < F[d] ? -0.5 : 0.5), fc = f(xc);
      if (fc < Math.min(fr, F[d])) { S[d] = xc; F[d] = fc; }
      else for (let i = 1; i <= d; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); }
    }
  }
  const best = F.indexOf(Math.min(...F));
  return { x: S[best], f: F[best] };
}

// Points de trajectoire normalisés : accepte {t, x, y} ou les points de ball.estimateBallFlight ({t, X, Y}).
function normPts(pts) {
  const P = pts.map((p) => ({ t: p.t, x: p.X ?? p.x, y: p.Y ?? p.y })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (P.length && P[P.length - 1].x < P[0].x) P.forEach((p) => { p.x = -p.x; }); // vol vers +x
  return P;
}

// ---------------------------------------------------------------------------------------------- E04 : courbure
// Effet par ajustement du modèle de vol (traînée + Magnus) sur les points AVANT rebond.
// pts : [{t, x, y}] en mètres, x horizontal (dans le sens du vol ou opposé), y hauteur ; t en s (recommandé :
// sans les temps, seule la forme y(x) est ajustée et vitesse et effet se compensent partiellement).
// opts.yIsHeight : y est la hauteur au-dessus du sol (sinon un décalage vertical est ajusté).
// Renvoie { spinRpm, speedKmh, launchDeg, h0, rms, sigmaRpm, conf, n } ou null.
export function spinFromTrajectory(pts, { yIsHeight = true, rho = 1.2 } = {}) {
  const P = normPts(pts || []);
  if (P.length < 5) return null;
  const hasT = P.every((p) => Number.isFinite(p.t));
  const t0 = hasT ? P[0].t : 0, x0 = P[0].x;
  const Q = P.map((p) => ({ u: hasT ? p.t - t0 : null, x: p.x - x0, y: p.y }));
  // Départ : parabole à gravité connue (vitesse et angle moyens)
  let v0 = 25, la0 = 5;
  if (hasT) {
    const n = Q.length, su = Q.reduce((s, q) => s + q.u, 0), suu = Q.reduce((s, q) => s + q.u * q.u, 0);
    const lin = (k) => { const sy = Q.reduce((s, q) => s + k(q), 0), suy = Q.reduce((s, q) => s + q.u * k(q), 0); const det = n * suu - su * su; return (n * suy - su * sy) / det; };
    const vx = lin((q) => q.x), vy = lin((q) => q.y + 0.5 * G * q.u * q.u);
    v0 = Math.hypot(vx, vy) * 1.05; la0 = Math.atan2(vy, vx) / DEG;
  }
  const dt = 0.002;
  const yOff0 = 0;
  const cost = ([v, la, sk, h, yo]) => {
    if (!(v > 3 && v < 90) || Math.abs(la) > 70 || Math.abs(sk) > 9) return 1e9;
    const f = flight({ v, launch: la, spinRpm: sk * 1000, h0: Math.max(BALL.r, h), x0: 0, rho, dt, maxT: hasT ? Q[Q.length - 1].u + 0.05 : 3 });
    const pts2 = f.pts, bt = f.bounce ? f.bounce.t : Infinity;
    let e = 0;
    for (const q of Q) {
      let px, py;
      if (hasT) {
        if (q.u > bt + 1e-3) return 1e9;
        const k = q.u / dt, i = Math.min(pts2.length - 2, Math.floor(k)), w = k - i;
        if (i < 0) return 1e9;
        px = pts2[i][0] + (pts2[i + 1][0] - pts2[i][0]) * w; py = pts2[i][1] + (pts2[i + 1][1] - pts2[i][1]) * w;
        e += (px - q.x) ** 2 + (py + (yIsHeight ? 0 : yo) - q.y) ** 2;
      } else {
        let i = 1; while (i < pts2.length - 1 && pts2[i][0] < q.x) i++;
        const a = pts2[i - 1], b = pts2[i], w = (q.x - a[0]) / ((b[0] - a[0]) || 1e-9);
        py = a[1] + (b[1] - a[1]) * w;
        e += (py + (yIsHeight ? 0 : yo) - q.y) ** 2;
      }
    }
    return e / Q.length;
  };
  const h0 = yIsHeight ? Q[0].y : 1;
  // Plusieurs départs en effet (la surface d'erreur a des vallées : effet ↔ vitesse ↔ angle)
  let best = null;
  for (const s0 of [-1.5, 0, 1.5, 3]) {
    const r = nelderMead(cost, [v0, la0, s0, h0, yOff0], [3, 2, 1, 0.05, 0.05], { iters: 400 });
    if (!best || r.f < best.f) best = r;
  }
  const r2 = nelderMead(cost, best.x, [0.5, 0.3, 0.3, 0.01, 0.01], { iters: 300 });
  if (r2.f < best.f) best = r2;
  const [v, la, sk, h] = best.x;
  // Incertitude sur l'effet : courbure de l'erreur (profil à 1 paramètre, autres fixés : borne basse)
  const ds = 0.2, fp = cost([v, la, sk + ds, h, best.x[4]]), fm = cost([v, la, sk - ds, h, best.x[4]]);
  const curv = (fp + fm - 2 * best.f) / (ds * ds); // dérivée seconde de l'erreur moyenne (par krpm²)
  const dof = Math.max(1, Q.length * (hasT ? 2 : 1) - 4);
  const s2 = (best.f * Q.length) / dof;
  const sigmaK = curv > 0 ? Math.sqrt((2 * s2) / (curv * Q.length)) : Infinity;
  const rms = Math.sqrt(best.f);
  const span = Q[Q.length - 1].x - Q[0].x;
  const conf = clamp(Math.min(1, Q.length / 12) * clamp(span / 8, 0.2, 1) * clamp(1 - rms / 0.08, 0.1, 1) * (hasT ? 1 : 0.7) * clamp(1 - sigmaK / 2, 0.1, 1), 0, 1);
  return {
    spinRpm: Math.round(sk * 1000), speedKmh: +(v * 3.6).toFixed(1), launchDeg: +la.toFixed(1), h0: +Math.max(BALL.r, h).toFixed(2),
    rms: +rms.toFixed(3), sigmaRpm: Number.isFinite(sigmaK) ? Math.round(sigmaK * 1000) : null, conf: +conf.toFixed(2), n: Q.length,
    type: sk > 0.4 ? 'lift' : sk < -0.4 ? 'slice' : 'à plat',
  };
}

// ---------------------------------------------------------------------------------------------- E04 : rebond
// Effet à l'arrivée déduit du rebond (modèle physics.js : restitution verticale ey, frottement μ ; en roulement
// la variation de vitesse horizontale vaut k/(1+k)·(vx − ω·r), k = 0,55). Mesures, au choix :
//   inSpeed (m/s) + inAngleDeg (descente, > 0) ; outSpeed (m/s) + outAngleDeg, ou outVx + bounceHeight (apogée
//   du rebond, m, centre de la balle).
// Renvoie { spinRpm, regime: 'roulement' | 'glissement', maxRpm | minRpm (borne en glissement), ey, conf }.
export function spinFromBounce({ inSpeed, inAngleDeg, outSpeed, outAngleDeg, outVx, bounceHeight, surface = 'hard' } = {}) {
  if (!(inSpeed > 0) || !Number.isFinite(inAngleDeg)) return null;
  const S = SURFACES[surface] || SURFACES.hard, I = BALL.I, r = BALL.r;
  const vx = inSpeed * Math.cos(inAngleDeg * DEG), vy = -Math.abs(inSpeed * Math.sin(inAngleDeg * DEG));
  let vxo, vyo = null;
  if (outSpeed > 0 && Number.isFinite(outAngleDeg)) { vxo = outSpeed * Math.cos(outAngleDeg * DEG); vyo = outSpeed * Math.sin(outAngleDeg * DEG); }
  else if (Number.isFinite(outVx)) { vxo = outVx; if (bounceHeight > r) vyo = Math.sqrt(2 * G * (bounceHeight - r)); }
  else return null;
  const ey = vyo != null ? vyo / Math.abs(vy) : S.ey;
  const dv = vx - vxo;
  const dvMax = S.mu * (1 + S.ey) * Math.abs(vy);
  const out = { surface, ey: +ey.toFixed(2), dvMs: +dv.toFixed(2), dvMax: +dvMax.toFixed(2) };
  if (Math.abs(dv) < 0.95 * dvMax) {
    // Roulement : vSurf = dv·(1+k)/k → ω = (vx − vSurf)/r
    const vSurf = (dv * (1 + I)) / I;
    out.regime = 'roulement';
    out.spinRpm = Math.round(((vx - vSurf) / r) * RPM);
    out.conf = +clamp(0.8 * (1 - Math.abs(ey - S.ey) / 0.3), 0.2, 0.8).toFixed(2);
  } else {
    // Glissement pendant tout le contact : l'effet n'est pas observable, seulement borné
    const lim = Math.round(((vx - (dvMax * (1 + I)) / I) / r) * RPM);
    out.regime = 'glissement';
    out.spinRpm = null;
    if (dv > 0) out.maxRpm = lim; else out.minRpm = Math.round(((vx + (dvMax * (1 + I)) / I) / r) * RPM);
    out.conf = 0.3;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- E05 : carte
// bounces : [{x, y}] au sol (m, repère court.js) ou [{img: {x, y}}] avec opts.cal. side : moitié visée
// ('far' par défaut : le joueur proche de la caméra frappe vers le fond). Renvoie points, centre, ellipse 95 %
// (χ²₂ = 5,991), profondeur moyenne depuis la ligne de fond visée, répartition par zones.
export function bounceMap(bounces, { cal = null, side = 'far', doubles = false } = {}) {
  const pts = (bounces || []).map((b) => (b.img && cal ? { ...toGround(cal, b.img), t: b.t } : { x: b.x, y: b.y, t: b.t }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (!n) return { n: 0, points: [], ellipse95: null, meanDepthM: null };
  const s = side === 'near' ? -1 : 1;
  const hw = doubles ? COURT_ITF.halfWidthDoubles : COURT_ITF.halfWidthSingles, L = COURT_ITF.halfLength, SL = COURT_ITF.serviceLine;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  let ellipse95 = null;
  if (n >= 3) {
    sxx /= n - 1; syy /= n - 1; sxy /= n - 1;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc), k = Math.sqrt(5.991);
    const ang = Math.atan2(l1 - sxx, sxy || 1e-12); // vecteur propre de l1 : (sxy, l1 − sxx)
    ellipse95 = { cx: +mx.toFixed(2), cy: +my.toFixed(2), a: +(k * Math.sqrt(l1)).toFixed(2), b: +(k * Math.sqrt(l2)).toFixed(2), angleDeg: +(sxy === 0 && l1 === sxx ? 0 : ang / DEG).toFixed(1), areaM2: +(Math.PI * 5.991 * Math.sqrt(Math.max(0, det))).toFixed(2) };
  }
  const depth = (p) => L - s * p.y; // distance à la ligne de fond visée (m)
  const inside = (p) => Math.abs(p.x) <= hw && s * p.y >= 0 && s * p.y <= L;
  const zones = { court: 0, milieu: 0, profond: 0, gauche: 0, centre: 0, droite: 0, out: 0 };
  for (const p of pts) {
    if (!inside(p)) { zones.out++; continue; }
    const dd = s * p.y;
    zones[dd < SL ? 'court' : dd < SL + (L - SL) / 2 ? 'milieu' : 'profond']++;
    const lx = s * p.x; // gauche/droite vues par le frappeur (face au fond visé)
    zones[lx < -hw / 3 ? 'gauche' : lx > hw / 3 ? 'droite' : 'centre']++;
  }
  const inPts = pts.filter(inside);
  const d = inPts.map(depth);
  const meanDepthM = d.length ? +(d.reduce((a, v) => a + v, 0) / d.length).toFixed(2) : null;
  const sdDepth = d.length > 1 ? +Math.sqrt(d.reduce((a, v) => a + (v - meanDepthM) ** 2, 0) / (d.length - 1)).toFixed(2) : null;
  return {
    n, points: pts.map((p) => ({ ...p, in: inside(p), depthM: +depth(p).toFixed(2) })), center: { x: +mx.toFixed(2), y: +my.toFixed(2) },
    ellipse95, meanDepthM, sdDepthM: sdDepth, inPct: Math.round((inPts.length / n) * 100), zones, side,
  };
}

// Point de l'ellipse (pour le dessin) : k ∈ [0, 1) → {x, y}.
export function ellipsePoint(e, k) {
  const a = 2 * Math.PI * k, c = Math.cos(e.angleDeg * DEG), s = Math.sin(e.angleDeg * DEG);
  const u = e.a * Math.cos(a), v = e.b * Math.sin(a);
  return { x: e.cx + u * c - v * s, y: e.cy + u * s + v * c };
}

export { COURT };
