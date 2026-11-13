// Génère un service synthétique (droitier) pour la démo : 120 i/s, coordonnées monde en mètres, y vers le haut.
const sig = (t, t0, w) => 1 / (1 + Math.exp(-(t - t0) / w));
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

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

export function makeDemoServe(profile = {}) {
  const p = { kneeMax: 42, pelvisT: 1.06, thoraxT: 1.09, impactT: 1.25, sepAmp: 18, ...profile };
  const fps = 120, T = 1.9, frames = [];
  const L = 0.47; // cuisse = tibia
  const upperK = [
    { t: 0.0, v: [0.25, -1, 0.05] }, { t: 0.45, v: [0.9, -0.3, -0.3] }, { t: 0.92, v: [1, 0.12, -0.25] },
    { t: 1.12, v: [0.7, 0.7, -0.3] }, { t: p.impactT, v: [0.12, 1, 0.22] }, { t: p.impactT + 0.06, v: [0.0, 0.85, 0.55] }, { t: 1.5, v: [-0.4, 0.3, 0.9] }, { t: 1.9, v: [-0.6, -0.7, 0.35] },
  ];
  const foreK = [
    { t: 0.0, v: [0.15, -1, 0.25] }, { t: 0.45, v: [0.4, 0.5, -0.4] }, { t: 0.92, v: [0.15, 1, -0.2] },
    { t: 1.12, v: [0.1, -1, -0.45] }, { t: p.impactT, v: [0.1, 1, 0.3] }, { t: p.impactT + 0.06, v: [0.05, 0.3, 0.95] }, { t: 1.5, v: [-0.6, -0.25, 0.8] }, { t: 1.9, v: [-0.45, -0.85, 0.3] },
  ];
  const tossUpK = [
    { t: 0, v: [-0.2, -1, 0.2] }, { t: 0.6, v: [-0.1, 0.6, 0.6] }, { t: 1.0, v: [-0.05, 1, 0.35] }, { t: 1.2, v: [-0.3, -0.2, 0.6] }, { t: 1.9, v: [-0.5, -1, 0.1] },
  ];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.006; };

  for (let i = 0; i <= T * fps; i++) {
    const t = i / fps;
    // Flexion des genoux : charge jusqu'à 0,95 s, extension rapide, saut léger
    const flex = p.kneeMax * sig(t, 0.62, 0.09) * (1 - sig(t, 1.08, 0.035));
    const jump = 0.14 * Math.exp(-Math.pow((t - 1.32) / 0.12, 2));
    // Rotations (degrés) : 0 = face au filet. Départ de profil.
    const pelvis = -65 + 80 * sig(t, p.pelvisT, 0.045);
    const thorax = -65 - p.sepAmp * sig(t, 0.75, 0.08) + (80 + p.sepAmp + 25) * sig(t, p.thoraxT, 0.04);
    const tilt = -0.13 * sig(t, 0.7, 0.1) + 0.24 * sig(t, 1.17, 0.04); // inclinaison épaules (+ = épaule droite haute)

    const yawVec = (deg) => { const r = deg * Math.PI / 180; return { lat: [Math.cos(r), 0, -Math.sin(r)], fwd: [Math.sin(r), 0, Math.cos(r)] }; };
    const pv = yawVec(pelvis), tv = yawVec(thorax);
    const footL = [-0.12, 0, 0.28], footR = [0.22, 0, -0.12];
    const legLen = 2 * L * Math.cos((flex * Math.PI / 180) / 2);
    const hz = 0.05 + 0.05 * sig(t, 1.0, 0.08);
    const hhL = Math.hypot(0.03 - 0.15 * pv.lat[0] - footL[0], hz - 0.15 * pv.lat[2] - footL[2]);
    const hipC = [0.03, Math.sqrt(Math.max(0.01, legLen * legLen - hhL * hhL)) + 0.08 + jump * 1.8, hz];
    const hip = (s) => [hipC[0] + s * 0.15 * pv.lat[0], hipC[1], hipC[2] + s * 0.15 * pv.lat[2]];
    const hL = hip(-1), hR = hip(1);
    const leg = (h, f) => {
      const a = [f[0], f[1] + 0.08 + jump, f[2]];
      const d = [h[0] - a[0], h[1] - a[1], h[2] - a[2]];
      const dl = Math.hypot(...d);
      const m = [(h[0] + a[0]) / 2, (h[1] + a[1]) / 2, (h[2] + a[2]) / 2];
      const off = Math.sqrt(Math.max(0, L * L - (dl / 2) ** 2));
      const fw = norm([pv.fwd[0], 0, pv.fwd[2]]);
      return { knee: [m[0] + fw[0] * off, m[1], m[2] + fw[2] * off], ankle: a, foot: [a[0] + fw[0] * 0.15, a[1] - 0.06, a[2] + fw[2] * 0.15] };
    };
    const lg = leg(hL, footL), rg = leg(hR, footR);
    const lean = 0.06 + 0.1 * sig(t, 1.12, 0.06);
    const shC = [hipC[0] + 0.02, hipC[1] + 0.5, hipC[2] + lean];
    const sh = (s) => [shC[0] + s * 0.2 * tv.lat[0], shC[1] + s * tilt, shC[2] + s * 0.2 * tv.lat[2]];
    const sL = sh(-1), sR = sh(1);
    const nose = [shC[0] + tv.fwd[0] * 0.09, shC[1] + 0.27, shC[2] + tv.fwd[2] * 0.09];
    const toWorld = (v) => norm([v[0] * tv.lat[0] + v[2] * tv.fwd[0], v[1], v[0] * tv.lat[2] + v[2] * tv.fwd[2]]);
    const u = toWorld(catmull(upperK, t)), f = toWorld(catmull(foreK, t));
    const eR = [sR[0] + u[0] * 0.31, sR[1] + u[1] * 0.31, sR[2] + u[2] * 0.31];
    const wR = [eR[0] + f[0] * 0.27, eR[1] + f[1] * 0.27, eR[2] + f[2] * 0.27];
    const iR = [wR[0] + f[0] * 0.09, wR[1] + f[1] * 0.09, wR[2] + f[2] * 0.09];
    const tu = toWorld(catmull(tossUpK, t));
    const eL = [sL[0] + tu[0] * 0.31, sL[1] + tu[1] * 0.31, sL[2] + tu[2] * 0.31];
    const wL = [eL[0] + tu[0] * 0.27, eL[1] + tu[1] * 0.27, eL[2] + tu[2] * 0.27];
    const iL = [wL[0] + tu[0] * 0.09, wL[1] + tu[1] * 0.09, wL[2] + tu[2] * 0.09];

    const pts = new Array(33).fill(null).map(() => [...nose]);
    const set = (k, v) => { pts[k] = v; };
    for (let k = 1; k <= 10; k++) set(k, [nose[0] + (k % 2 ? -0.03 : 0.03), nose[1] + (k < 9 ? 0.03 : -0.04), nose[2] - 0.02]);
    set(0, nose); set(11, sL); set(12, sR); set(13, eL); set(14, eR); set(15, wL); set(16, wR);
    set(17, iL); set(18, iR); set(19, iL); set(20, iR); set(21, wL); set(22, wR);
    set(23, hL); set(24, hR); set(25, lg.knee); set(26, rg.knee); set(27, lg.ankle); set(28, rg.ankle);
    set(29, lg.ankle); set(30, rg.ankle); set(31, lg.foot); set(32, rg.foot);

    // Racine bassin comme MediaPipe (origine au centre des hanches)
    const world = pts.map((q) => ({ x: q[0] - hipC[0] + rnd(), y: q[1] - hipC[1] + rnd(), z: q[2] - hipC[2] + rnd() }));
    // Projection « caméra de profil » (placée à droite du joueur) pour l'image 2D
    const img = pts.map((q) => ({ x: 0.5 - q[2] * 0.2, y: 0.93 - q[1] * 0.3, v: 0.98 }));
    frames.push({ t, world, img });
  }
  return frames;
}
