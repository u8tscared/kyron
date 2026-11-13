// KYRON · données de démonstration synthétiques (droitier, 120 i/s).
// Convention identique au flux vidéo : world = 33 points en mètres, y vers le haut, origine au centre des
// hanches ; img = projection normalisée 0–1 d'une caméra de profil fixe (1 m ≈ 0,3 hauteur d'image).
// Le repère « terrain » utilisé pour construire le corps est direct : filet vers +z, et un joueur face au filet
// a sa droite vers −x (comme MediaPipe après inversion de y et z à l'ingestion).
//
// Le corps est un modèle articulé simple : bassin et thorax orientés (lacet, inclinaison latérale, flexion
// avant), segments de longueur fixe (bras 0,32 m, avant-bras 0,27 m, cuisse et tibia 0,47 m), jambes par
// cinématique inverse à deux segments. Les bras suivent des directions-clés exprimées dans le repère du thorax
// [droite, haut, avant], interpolées par Catmull-Rom. Les ordres de grandeur visés (épaule à l'armé, vitesse de
// rotation interne, lancer, transfert du poids) sont ceux de la littérature citée dans engine.js.

const sig = (t, t0, w) => 1 / (1 + Math.exp(-(t - t0) / w));
const bump = (t, t0, w) => Math.exp(-(((t - t0) / w) ** 2));
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const addv = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerpv = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const D2R = Math.PI / 180;
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Rotation de v d'un angle a (rad) autour de l'axe unitaire k (Rodrigues).
const rotv = (v, k, a) => {
  const c = Math.cos(a), s = Math.sin(a), kv = cross3(k, v), kd = dot3(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
};

function catmull(keys, t) {
  // keys: [{t, v:[x,y,z]}]
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k1 = keys[i], k2 = keys[i + 1];
  const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = Math.max(0, Math.min(1, (t - k1.t) / (k2.t - k1.t)));
  const u2 = u * u, u3 = u2 * u;
  return [0, 1, 2].map((j) => 0.5 * ((2 * k1.v[j]) + (-k0.v[j] + k2.v[j]) * u + (2 * k0.v[j] - 5 * k1.v[j] + 4 * k2.v[j] - k3.v[j]) * u2 + (-k0.v[j] + 3 * k1.v[j] - 3 * k2.v[j] + k3.v[j]) * u3));
}
const K = (arr) => arr.map(([t, v]) => ({ t, v }));

// Enchaînement de poses par sigmoïdes : keys = [v0, [v1, c1, w1], [v2, c2, w2], …] ; la transition vers vk est
// centrée en ck (s) avec une largeur wk (s). Chaque transition a un pic de vitesse unique, en ck : on place
// ainsi précisément les pics de la chaîne cinétique.
const B = (keys) => ({ blend: keys });
function evalDir(spec, t) {
  if (!spec.blend) return catmull(spec, t);
  const k = spec.blend;
  let v = k[0].slice();
  for (let i = 1; i < k.length; i++) {
    const [to, c, w] = k[i], from = i === 1 ? k[0] : k[i - 1][0], a = sig(t, c, w);
    v = [v[0] + (to[0] - from[0]) * a, v[1] + (to[1] - from[1]) * a, v[2] + (to[2] - from[2]) * a];
  }
  return v;
}

// Bruit déterministe (générateur de Park-Miller), amplitude ± a mètres.
function noiseGen(seed, a) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 2 * a; };
}

const SEG = { upper: 0.32, fore: 0.27, thigh: 0.47, shank: 0.47, trunk: 0.5, halfSh: 0.19, halfHip: 0.14 };

// Une image du corps. s = état à l'instant t (angles en degrés, positions terrain en mètres).
function pose(s) {
  const yawF = (deg) => { const r = deg * D2R; return { F: [Math.sin(r), 0, Math.cos(r)], R: [-Math.cos(r), 0, Math.sin(r)] }; };
  const pv = yawF(s.pelvisYaw), tv = yawF(s.thoraxYaw);
  const up = [0, 1, 0];
  // Axe du tronc incliné (tiltX vers +x, tiltZ vers le filet, en degrés) ; le thorax tourne autour de cet axe,
  // comme une colonne vertébrale, ce qui garde la tête stable pendant la rotation.
  const Ut = norm([Math.tan(s.tiltX * D2R), 1, Math.tan(s.tiltZ * D2R)]);
  const Rt = norm(addv(tv.R, Ut, -dot3(tv.R, Ut)));
  const Ft = cross3(Ut, Rt); // repère direct : avant = haut × droite
  const toT = (v) => norm([v[0] * Rt[0] + v[1] * Ut[0] + v[2] * Ft[0], v[0] * Rt[1] + v[1] * Ut[1] + v[2] * Ft[1], v[0] * Rt[2] + v[1] * Ut[2] + v[2] * Ft[2]]);
  const hv = yawF(s.headYaw ?? s.thoraxYaw).F;
  const Fh = norm(addv(hv, Ut, -dot3(hv, Ut)));
  const Rh = cross3(Fh, Ut);

  // Hauteur du bassin : la jambe d'appui (pied « plant ») a une longueur fixée par la flexion du genou.
  const L = SEG.thigh;
  const legLen = 2 * L * Math.cos((s.flex * D2R) / 2);
  const hipXZ = s.hip;
  const plant = s.plant === 'L' ? s.footL : s.footR;
  const side = s.plant === 'L' ? -1 : 1;
  const hp = [hipXZ[0] + side * SEG.halfHip * pv.R[0], 0, hipXZ[1] + side * SEG.halfHip * pv.R[2]];
  const dh = Math.hypot(hp[0] - plant[0], hp[2] - plant[1]);
  const hipY = Math.sqrt(Math.max(0.04, legLen * legLen - dh * dh)) + 0.08 + s.jump;
  const hipC = [hipXZ[0], hipY, hipXZ[1]];
  const hipAt = (k) => addv(hipC, pv.R, k * SEG.halfHip);
  const hL = hipAt(-1), hR = hipAt(1);
  // Jambe par cinématique inverse ; si le pied est hors d'atteinte il décolle (longueurs conservées).
  const leg = (h, f, yawFoot) => {
    let a = [f[0], 0.08 + s.jump, f[1]];
    let d = [a[0] - h[0], a[1] - h[1], a[2] - h[2]];
    let dl = Math.hypot(...d);
    if (dl > 2 * L * 0.995) { a = addv(h, norm(d), 2 * L * 0.995); d = [a[0] - h[0], a[1] - h[1], a[2] - h[2]]; dl = 2 * L * 0.995; }
    const m = lerpv(h, a, 0.5);
    const off = Math.sqrt(Math.max(0, L * L - (dl / 2) ** 2));
    const dn = norm(d);
    const fw = norm(addv(pv.F, dn, -(pv.F[0] * dn[0] + pv.F[1] * dn[1] + pv.F[2] * dn[2])));
    const fy = yawF(yawFoot).F;
    return { knee: addv(m, fw, off), ankle: a, heel: addv(addv(a, fy, -0.05), up, -0.05), toe: addv(addv(a, fy, 0.16), up, -0.07) };
  };
  const lg = leg(hL, s.footL, s.footYawL), rg = leg(hR, s.footR, s.footYawR);

  const shC = addv(hipC, Ut, SEG.trunk);
  const sL = addv(shC, Rt, -SEG.halfSh), sR = addv(shC, Rt, SEG.halfSh);
  const nose = addv(addv(shC, Ut, 0.2), Fh, 0.1);
  const ear = (k) => addv(addv(shC, Ut, 0.21), Rh, 0.07 * k);
  const arm = (sh, upK, foK, lat) => {
    const u = toT(dirAt(upK, s.t)), f = toT(dirAt(foK, s.t));
    const e = addv(sh, u, SEG.upper), w = addv(e, f, SEG.fore);
    const side3 = norm([u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]]);
    return { e, w, idx: addv(addv(w, f, 0.09), side3, 0.02 * lat), pinky: addv(addv(w, f, 0.08), side3, -0.03 * lat), thumb: addv(w, f, 0.05) };
  };
  const aR = arm(sR, s.armR.upper, s.armR.fore, 1), aL = arm(sL, s.armL.upper, s.armL.fore, -1);

  const P = new Array(33);
  P[0] = nose;
  for (let k = 1; k <= 6; k++) P[k] = addv(addv(nose, Rh, (k <= 3 ? -1 : 1) * 0.02 * (1 + (k - 1) % 3) * 0.6), Ut, 0.03);
  P[7] = ear(-1); P[8] = ear(1);
  P[9] = addv(addv(nose, Ut, -0.04), Rh, -0.02); P[10] = addv(addv(nose, Ut, -0.04), Rh, 0.02);
  P[11] = sL; P[12] = sR; P[13] = aL.e; P[14] = aR.e; P[15] = aL.w; P[16] = aR.w;
  P[17] = aL.pinky; P[18] = aR.pinky; P[19] = aL.idx; P[20] = aR.idx; P[21] = aL.thumb; P[22] = aR.thumb;
  P[23] = hL; P[24] = hR; P[25] = lg.knee; P[26] = rg.knee; P[27] = lg.ankle; P[28] = rg.ankle;
  P[29] = lg.heel; P[30] = rg.heel; P[31] = lg.toe; P[32] = rg.toe;
  return { P, hipC };
}

// Direction-clé : spécification (évaluée à t) ou vecteur déjà évalué.
const dirAt = (k, t) => (typeof k[0] === 'number' ? k : evalDir(k, t));

// État numérique à l'instant t : directions des bras évaluées, champs scalaires/vecteurs à plat.
const NUM_KEYS = ['pelvisYaw', 'thoraxYaw', 'tiltX', 'tiltZ', 'headYaw', 'flex', 'jump'];
function evalState(state, t) {
  const s = state(t);
  return { ...s, hip: s.hip.slice(),
    armR: { upper: dirAt(s.armR.upper, t), fore: dirAt(s.armR.fore, t) },
    armL: { upper: dirAt(s.armL.upper, t), fore: dirAt(s.armL.fore, t) } };
}
// Accompagnement physiologique après l'impact (t0) : chaque paramètre p garde sa vitesse d'impact v0 puis
// décélère exponentiellement (constante T) tout en rejoignant, par un raccord C¹ en smoothstep, la pose
// prévue à t0 + R ; au-delà, le geste d'origine reprend. Avant t0 rien ne change (métriques à l'impact
// inchangées). Sans cela, le poignet passait de ~16 à ~2 m/s en ~30 ms, d'où des moments articulaires
// irréalistes en dynamique inverse.
function followThrough(state, { t0, T = 0.2, Ta = 0.1, R = 0.5 }) {
  const h = 1e-4, a = evalState(state, t0), am = evalState(state, t0 - h), b = evalState(state, t0 + R);
  const eR = T * (1 - Math.exp(-R / T)), eRa = Ta * (1 - Math.exp(-R / Ta));
  // Scalaires (angles du tronc, flexion, saut, bassin) : extrapolation amortie + raccord.
  const scal = (s) => [...NUM_KEYS.map((k) => s[k] ?? 0), ...s.hip];
  const p0 = scal(a), v0 = scal(am).map((x, i) => (p0[i] - x) / h), pR = scal(b);
  // Directions des bras : même loi, mais en rotation (axe et vitesse angulaire à l'impact), sinon
  // l'extrapolation linéaire d'un vecteur unitaire ralentit d'elle-même.
  const DIRS = [['armR', 'upper'], ['armR', 'fore'], ['armL', 'upper'], ['armL', 'fore']];
  const dirs = DIRS.map(([s1, s2]) => {
    const d0 = norm(a[s1][s2]), dm = norm(am[s1][s2]);
    const w = cross3(dm, d0), sw = Math.hypot(...w), om = Math.asin(Math.min(1, sw)) / h; // rad/s
    const ax = sw > 1e-12 ? norm(w) : [1, 0, 0];
    const dA = rotv(d0, ax, om * eRa), dR = norm(b[s1][s2]);
    const c = cross3(dA, dR), sc = Math.hypot(...c);
    return { d0, ax, om, cax: sc > 1e-12 ? norm(c) : [1, 0, 0], cang: Math.atan2(sc, dot3(dA, dR)) };
  });
  return (t) => {
    if (t <= t0 || t >= t0 + R) return evalState(state, t);
    const u = t - t0, x = u / R, S = x * x * (3 - 2 * x), e = T * (1 - Math.exp(-u / T)), ea = Ta * (1 - Math.exp(-u / Ta));
    const q = p0.map((p, i) => p + v0[i] * e + (pR[i] - p - v0[i] * eR) * S);
    const s = { ...state(t), armR: {}, armL: {} };
    NUM_KEYS.forEach((k, i) => { if (k in s) s[k] = q[i]; });
    s.hip = q.slice(NUM_KEYS.length, NUM_KEYS.length + 2);
    DIRS.forEach(([s1, s2], i) => {
      const D = dirs[i];
      s[s1][s2] = rotv(rotv(D.d0, D.ax, D.om * ea), D.cax, D.cang * S);
    });
    return s;
  };
}

// Instant du pic de vitesse du poignet droit (frappe) dans [from, to], au 1/2000 s : c'est l'impact que
// détecte engine.js, donc le point de départ naturel de l'accompagnement.
function wristPeak(state, { from, to }) {
  const dt = 1 / 2000, at = (t) => pose({ t, ...evalState(state, t) }).P[16];
  let best = from, vmax = -1, prev = at(from);
  for (let t = from + dt; t <= to; t += dt) {
    const q = at(t), v = Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
    if (v > vmax) { vmax = v; best = t - dt / 2; }
    prev = q;
  }
  return best;
}

// Échantillonne un geste à 120 i/s. state(t) → état du corps ; camera : projection de profil.
// post = { t0, T, R } : accompagnement adouci après l'impact (voir followThrough).
function sample(T, state, { fps = 120, seed = 7, noise = 0.003, camX = 0.5, post = null } = {}) {
  const rnd = noiseGen(seed, noise);
  const st = post ? followThrough(state, { ...post, t0: post.t0 === 'peak' ? wristPeak(state, post) : post.t0 }) : state;
  const frames = [];
  for (let i = 0; i <= Math.round(T * fps); i++) {
    const t = i / fps;
    const { P, hipC } = pose({ t, ...st(t) });
    const world = P.map((q) => ({ x: q[0] - hipC[0] + rnd(), y: q[1] - hipC[1] + rnd(), z: q[2] - hipC[2] + rnd() }));
    // Caméra fixe sur le côté droit du terrain : le filet (+z) part vers la gauche de l'image.
    const img = P.map((q) => ({ x: camX - q[2] * 0.2, y: 0.93 - q[1] * 0.3, v: 0.97 + rnd() * 3 }));
    frames.push({ t, world, img });
  }
  return frames;
}

// ---------------------------------------------------------------------------------------------------------
// Service (droitier). Profil : kneeMax (°), pelvisT / thoraxT (s, déclenchement des rotations), impactT (s),
// sepAmp (°, fermeture supplémentaire des épaules à l'armé). Défauts volontaires de la démo : charge des
// jambes un peu faible et léger temps mort buste → bras, pour que l'app ait des corrections à montrer.
export function makeDemoServe(profile = {}) {
  const p = { kneeMax: 42, pelvisT: 1.06, thoraxT: 1.09, impactT: 1.25, sepAmp: 18, ...profile };
  const Ti = p.impactT;
  const armR = {
    upper: B([[0.2, -0.95, 0.25], [[0.15, -0.98, 0.1], 0.3, 0.06], [[0.6, -0.6, -0.5], 0.62, 0.07], [[0.95, 0.0, -0.3], 0.85, 0.05],
      [[0.95, 0.25, -0.15], Ti - 0.13, 0.03], [[0.72, 0.68, 0.1], Ti - 0.04, 0.018], [[0.6, 0.3, 0.75], Ti + 0.08, 0.02],
      [[-0.2, -0.6, 0.75], Ti + 0.2, 0.07], [[-0.1, -0.95, 0.3], 1.75, 0.06]]),
    fore: B([[0.1, -0.2, 0.98], [[0.05, -0.9, 0.4], 0.3, 0.06], [[0.5, -0.1, -0.85], 0.62, 0.07], [[0.15, 0.98, -0.1], 0.85, 0.05],
      [[0.05, 0.1, -0.99], Ti - 0.13, 0.03], [[0.62, 0.78, 0.1], Ti - 0.05, 0.014], [[0.25, -0.3, 0.92], Ti + 0.08, 0.02],
      [[-0.6, -0.6, 0.5], Ti + 0.2, 0.07], [[-0.3, -0.8, 0.5], 1.75, 0.06]]),
  };
  // Bras de lancer : monte vers le filet (côté gauche du thorax) puis s'arrête bras tendu → lâcher de balle
  // quand la main décélère plus vite que la gravité.
  const armL = {
    upper: B([[-0.2, -0.95, 0.2], [[-0.15, -0.98, 0.15], 0.3, 0.06], [[-0.75, -0.1, 0.6], 0.5, 0.05], [[-0.75, 0.55, 0.35], 0.62, 0.035], [[-0.6, 0.72, 0.25], 0.85, 0.05],
      [[-0.6, 0.2, 0.75], 1.12, 0.04], [[-0.5, -0.4, 0.75], Ti + 0.1, 0.06], [[-0.2, -0.95, 0.2], 1.7, 0.08]]),
    fore: B([[-0.1, -0.3, 0.95], [[-0.1, -0.9, 0.4], 0.3, 0.06], [[-0.7, 0.1, 0.65], 0.5, 0.05], [[-0.6, 0.75, 0.25], 0.62, 0.035], [[-0.45, 0.87, 0.15], 0.85, 0.05],
      [[-0.5, -0.2, 0.85], 1.12, 0.04], [[-0.2, -0.6, 0.75], Ti + 0.1, 0.06], [[-0.1, -0.95, 0.3], 1.7, 0.08]]),
  };
  return sample(1.9, (t) => ({
    pelvisYaw: -80 + 75 * sig(t, p.pelvisT, 0.045) + 25 * sig(t, Ti + 0.15, 0.08),
    thoraxYaw: -80 - p.sepAmp * sig(t, 0.75, 0.08) + (80 + p.sepAmp + 15) * sig(t, p.thoraxT, 0.04) + 30 * sig(t, Ti + 0.12, 0.06),
    // Tronc : recul à l'armé puis inclinaison vers la gauche (« épaule sur épaule ») et vers le terrain.
    tiltZ: -12 * sig(t, 0.75, 0.08) + 20 * sig(t, 1.03, 0.07) + 17 * sig(t, Ti + 0.3, 0.1),
    tiltX: 35 * sig(t, 1.0, 0.08) - 30 * sig(t, Ti + 0.3, 0.1),
    headYaw: -40 + 40 * sig(t, Ti + 0.15, 0.08),
    flex: p.kneeMax * sig(t, 0.62, 0.09) * (1 - sig(t, 1.08, 0.045)) + 4,
    // Le bassin avance vers le terrain pendant la poussée puis atterrit à l'intérieur.
    hip: [0.06, -0.06 + 0.12 * sig(t, 0.75, 0.1) + 0.3 * sig(t, Ti - 0.06, 0.1) + 0.3 * sig(t, Ti + 0.25, 0.08)],
    jump: 0.13 * bump(t, Ti + 0.05, 0.11),
    // Pendant le vol, les pieds suivent le corps : réception sur le pied gauche dans le terrain, la jambe
    // droite passe devant (sinon le bassin finit 45 cm devant l'appui, d'où des moments de genou irréalistes).
    footL: [0.12, 0.2 + 0.42 * sig(t, Ti + 0.1, 0.04)], footR: [0.12 - 0.1 * sig(t, Ti + 0.2, 0.06), -0.24 + 0.9 * sig(t, Ti + 0.2, 0.06)],
    footYawL: -40, footYawR: -90, plant: 'L',
    armR, armL,
  }), { post: { t0: 'peak', from: Ti - 0.12, to: Ti + 0.02 } });
}

// ---------------------------------------------------------------------------------------------------------
// Coup droit (droitier, appuis semi-ouverts). Profil : kneeMax, pelvisT, thoraxT, impactT, turn (rotation des
// épaules en préparation, °).
export function makeDemoForehand(profile = {}) {
  const p = { kneeMax: 38, pelvisT: 0.9, thoraxT: 0.94, impactT: 1.0, turn: 95, ...profile };
  const Ti = p.impactT;
  const armR = {
    upper: B([[0.25, -0.9, 0.35], [[0.45, -0.8, 0.1], 0.32, 0.07], [[0.6, -0.7, -0.35], 0.55, 0.06], [[0.55, -0.8, -0.2], Ti - 0.2, 0.04],
      [[0.5, -0.55, 0.66], Ti - 0.02, 0.04], [[0.15, -0.3, 0.94], Ti + 0.05, 0.025], [[-0.35, 0.25, 0.9], Ti + 0.2, 0.06], [[-0.1, -0.7, 0.7], 1.45, 0.06]]),
    fore: B([[-0.05, -0.15, 0.99], [[0.3, 0.2, 0.9], 0.32, 0.07], [[0.35, 0.35, -0.85], 0.55, 0.06], [[0.55, -0.45, -0.7], Ti - 0.2, 0.04],
      [[0.15, 0.05, 0.99], Ti - 0.02, 0.04], [[-0.55, 0.25, 0.8], Ti + 0.05, 0.025], [[-0.85, 0.45, -0.25], Ti + 0.2, 0.06], [[-0.4, -0.5, 0.75], 1.45, 0.06]]),
  };
  const armL = {
    upper: B([[-0.25, -0.9, 0.35], [[-0.1, -0.3, 0.95], 0.32, 0.07], [[-0.6, -0.75, 0.25], Ti - 0.04, 0.04], [[-0.3, -0.4, 0.85], Ti + 0.2, 0.06], [[-0.2, -0.9, 0.3], 1.45, 0.06]]),
    fore: B([[0.05, -0.15, 0.99], [[0.35, 0.1, 0.93], 0.32, 0.07], [[-0.2, -0.3, 0.93], Ti - 0.04, 0.04], [[0.2, 0.6, 0.75], Ti + 0.2, 0.06], [[0.1, -0.6, 0.8], 1.45, 0.06]]),
  };
  return sample(1.6, (t) => ({
    pelvisYaw: -50 * sig(t, 0.3, 0.08) + 70 * sig(t, p.pelvisT, 0.045),
    thoraxYaw: -p.turn * sig(t, 0.32, 0.08) + (p.turn + 35) * sig(t, p.thoraxT, 0.04),
    tiltZ: 12, tiltX: 0,
    headYaw: -30 + 40 * sig(t, Ti + 0.15, 0.08),
    flex: 10 + (p.kneeMax - 10) * bump(t, 0.72, 0.18),
    hip: [-0.02 + 0.06 * sig(t, Ti, 0.08), -0.06 + 0.2 * sig(t, Ti - 0.05, 0.07)],
    jump: 0,
    footL: [0.28, 0.16], footR: [-0.33, -0.08], footYawL: -15, footYawR: -60, plant: 'L',
    armR, armL,
  }), { seed: 11, post: { t0: 'peak', from: Ti - 0.12, to: Ti + 0.02 } });
}

// ---------------------------------------------------------------------------------------------------------
// Revers à une main (droitier, appuis fermés, épaule droite vers le filet). Même profil que le coup droit.
export function makeDemoBackhand(profile = {}) {
  const p = { kneeMax: 36, pelvisT: 0.9, thoraxT: 0.94, impactT: 1.0, turn: 110, ...profile };
  const Ti = p.impactT;
  const armR = {
    upper: B([[0.25, -0.9, 0.35], [[-0.2, -0.85, 0.5], 0.32, 0.07], [[-0.65, -0.6, 0.45], 0.55, 0.06], [[-0.5, -0.8, 0.35], Ti - 0.2, 0.04],
      [[0.45, -0.45, 0.77], Ti - 0.02, 0.028], [[0.8, -0.05, 0.6], Ti + 0.05, 0.025], [[0.85, 0.5, 0.1], Ti + 0.2, 0.06], [[0.6, -0.6, 0.5], 1.45, 0.06]]),
    fore: B([[-0.05, -0.15, 0.99], [[-0.5, 0.0, 0.87], 0.32, 0.07], [[-0.55, 0.45, -0.7], 0.55, 0.06], [[-0.3, -0.7, -0.65], Ti - 0.2, 0.04],
      [[0.5, -0.3, 0.81], Ti - 0.02, 0.028], [[0.8, 0.25, 0.55], Ti + 0.05, 0.025], [[0.6, 0.75, -0.25], Ti + 0.2, 0.06], [[0.3, -0.4, 0.85], 1.45, 0.06]]),
  };
  // Main gauche sur le cœur de la raquette pendant la préparation, puis bras qui part en arrière (équilibre).
  const armL = {
    upper: B([[-0.25, -0.9, 0.35], [[-0.6, -0.6, 0.55], 0.32, 0.07], [[-0.8, -0.5, -0.3], Ti - 0.03, 0.03], [[-0.3, -0.9, 0.2], 1.45, 0.06]]),
    fore: B([[0.05, -0.15, 0.99], [[-0.35, 0.45, 0.82], 0.32, 0.07], [[-0.7, -0.4, -0.6], Ti - 0.03, 0.03], [[-0.1, -0.9, 0.4], 1.45, 0.06]]),
  };
  return sample(1.6, (t) => ({
    pelvisYaw: 75 * sig(t, 0.3, 0.12) - 45 * sig(t, p.pelvisT, 0.04),
    thoraxYaw: p.turn * sig(t, 0.32, 0.12) - (p.turn - 40) * sig(t, p.thoraxT, 0.035),
    tiltZ: 10, tiltX: 0,
    headYaw: 50,
    flex: 10 + (p.kneeMax - 10) * bump(t, 0.72, 0.18),
    hip: [0.0, -0.08 + 0.2 * sig(t, Ti - 0.05, 0.07)],
    jump: 0,
    footL: [0.15, -0.2], footR: [-0.08, 0.28], footYawL: 70, footYawR: 45, plant: 'R',
    armR, armL,
  }), { seed: 13, post: { t0: 'peak', from: Ti - 0.12, to: Ti + 0.02 } });
}

// ---------------------------------------------------------------------------------------------------------
// Ralentit un geste d'un facteur k (> 1 = plus lent : toutes les vitesses divisées par k), rééchantillonné à fps.
function retime(frames, k, fps = 120) {
  const T = frames[frames.length - 1].t * k;
  const out = [];
  for (let i = 0; i <= Math.round(T * fps); i++) {
    const t = i / fps, u = t / k;
    let j = Math.min(frames.length - 2, Math.floor(u * fps));
    while (j > 0 && frames[j].t > u) j--;
    const a = frames[j], b = frames[j + 1], w = Math.max(0, Math.min(1, (u - a.t) / (b.t - a.t)));
    out.push({
      t,
      world: a.world.map((p, n) => ({ x: p.x + (b.world[n].x - p.x) * w, y: p.y + (b.world[n].y - p.y) * w, z: p.z + (b.world[n].z - p.z) * w })),
      img: a.img.map((p, n) => ({ x: p.x + (b.img[n].x - p.x) * w, y: p.y + (b.img[n].y - p.y) * w, v: Math.min(p.v, b.img[n].v) })),
    });
  }
  return out;
}

// Séance de démonstration : services, coups droits et revers enchaînés, avec une baisse progressive de la
// vitesse (≈ 1,5 % par frappe, ≈ −12 % sur la séance) pour illustrer la détection de fatigue.
// Renvoie les images (comme une vidéo) ; la vérité terrain est dans frames.truth (non énumérée en JSON).
export function makeDemoSession({ order = ['serve', 'serve', 'forehand', 'backhand', 'forehand', 'serve', 'backhand', 'forehand', 'serve', 'forehand'], fatiguePerStroke = 0.015, rest = 1.2 } = {}) {
  const gen = { serve: makeDemoServe, forehand: makeDemoForehand, backhand: makeDemoBackhand };
  const fps = 120, out = [], truth = [];
  let t0 = 0;
  order.forEach((type, i) => {
    const k = 1 + fatiguePerStroke * i;
    const seg = retime(gen[type](), k, fps);
    if (out.length) {
      // Transition lente (repos, replacement) entre la fin de la frappe précédente et le début de la suivante.
      const a = out[out.length - 1], b = seg[0], nT = Math.round(rest * fps);
      for (let j = 1; j < nT; j++) {
        const w = 0.5 - 0.5 * Math.cos(Math.PI * j / nT);
        out.push({
          t: t0 + j / fps,
          world: a.world.map((p, n) => ({ x: p.x + (b.world[n].x - p.x) * w, y: p.y + (b.world[n].y - p.y) * w, z: p.z + (b.world[n].z - p.z) * w })),
          img: a.img.map((p, n) => ({ x: p.x + (b.img[n].x - p.x) * w, y: p.y + (b.img[n].y - p.y) * w, v: p.v })),
        });
      }
      t0 += nT / fps;
    }
    const impactT = (type === 'serve' ? 1.25 : 1.0) * k;
    truth.push({ type, t: t0 + impactT, speedFactor: 1 / k });
    for (const f of seg) out.push({ t: t0 + f.t, world: f.world, img: f.img });
    t0 = out[out.length - 1].t;
  });
  Object.defineProperty(out, 'truth', { value: truth, enumerable: false });
  return out;
}
