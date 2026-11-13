// KYRON · jeu de jambes (B10 / B12) : split-step, premier pas, temps de réaction, déplacement du centre de masse
// au sol, appuis, et asymétries gauche/droite sur une séance.
//
// Entrée : images de pose { t, img: [33 {x, y, v}] } (coordonnées normalisées 0–1, y vers le bas).
// Position au sol :
//   - court calibré (court.js) : homographie image → sol, mètres dans le repère du court (X en travers, Y le long) ;
//   - sinon, échelle du joueur (taille déclarée ou 1,78 m ↔ hauteur nez–chevilles dans l'image) : seul le
//     déplacement latéral (dans le plan image) est mesuré, la profondeur est inconnue (planar = true).
// Le « sol » d'un pied est le point le plus bas parmi cheville, talon et pointe. Un pied est en appui quand il est
// à moins de ≈ 3–4 cm (image) du niveau du sol local (max glissant des deux pieds sur ± 0,4 s : suit les
// déplacements en profondeur qui font monter ou descendre les pieds dans l'image).
//
// Heuristiques honnêtes : chaque détection porte une confiance ; sur une vue de profil ou de très loin, les
// envols de 3–5 cm d'un split-step sont à la limite de la résolution des landmarks.
//
// Module pur, sans DOM.

import { toGround } from './court.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

// Lissage par moyenne glissante centrée (demi-fenêtre h).
function smooth(arr, h) {
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) if (Number.isFinite(arr[j])) { s += arr[j]; c++; }
    out[i] = c ? s / c : NaN;
  }
  return out;
}
function deriv(arr, t) {
  const n = arr.length, out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    out[i] = b > a ? (arr[b] - arr[a]) / (t[b] - t[a]) : 0;
  }
  return out;
}
// Max glissant (± h images).
function runMax(arr, h) {
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) { let m = -Infinity; for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) if (arr[j] > m) m = arr[j]; out[i] = m; }
  return out;
}
// Intervalles où pred(i) est vrai : [{i0, i1}] (inclus).
function runs(n, pred) {
  const out = []; let s = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && pred(i);
    if (on && s < 0) s = i;
    if (!on && s >= 0) { out.push({ i0: s, i1: i - 1 }); s = -1; }
  }
  return out;
}

const FOOT = { L: [27, 29, 31], R: [28, 30, 32] };

// ---------------------------------------------------------------------------------------------- analyse
// opts : cal (calibration court.js), heightM, aspect (largeur/hauteur de l'image, sans calibration ; 16/9),
// side ('near' | 'far' : moitié du joueur, pour orienter gauche/droite), cues ([t] frappes adverses, pour le
// temps de réaction), strokes ([{t, type}] frappes du joueur, pour les fenêtres par coup), mirror (caméra face au
// joueur sans calibration : sa droite est à gauche de l'image).
export function analyzeFootwork(frames, opts = {}) {
  const n = frames?.length || 0;
  if (n < 10) throw new Error('Séquence trop courte pour le jeu de jambes (≥ 10 images).');
  const { cal = null, aspect = 16 / 9, side = 'near', cues = [], strokes = [], mirror = false } = opts;
  const t = frames.map((f) => f.t);
  const fps = (n - 1) / ((t[n - 1] - t[0]) || 1);
  const fr = (s) => Math.max(1, Math.round(s * fps));
  const heightM = Number.isFinite(opts.heightM) ? opts.heightM : 1.78;

  const P = (i, j) => frames[i].img?.[j];
  const footY = (i, k) => Math.max(...FOOT[k].map((j) => P(i, j)?.y ?? -Infinity));
  const footX = (i, k) => mean(FOOT[k].map((j) => P(i, j)?.x).filter(Number.isFinite));
  const yL = frames.map((_, i) => footY(i, 'L')), yR = frames.map((_, i) => footY(i, 'R'));
  const hipX = frames.map((_, i) => (P(i, 23) && P(i, 24) ? (P(i, 23).x + P(i, 24).x) / 2 : NaN));
  const hipY = frames.map((_, i) => (P(i, 23) && P(i, 24) ? (P(i, 23).y + P(i, 24).y) / 2 : NaN));
  // Hauteur du corps dans l'image (nez → sol), médiane : échelle locale (m par unité image verticale)
  const hImg = median(frames.map((_, i) => Math.max(yL[i], yR[i]) - (P(i, 0)?.y ?? NaN)));
  const mPerImg = (heightM * 0.9) / (hImg || 0.5);

  // --- Appuis
  const lowest = frames.map((_, i) => Math.max(yL[i], yR[i]));
  const groundLvl = smooth(runMax(lowest, fr(0.4)), fr(0.05));
  const thr = 0.02 * hImg; // ≈ 3–4 cm
  const air = { L: yL.map((y, i) => groundLvl[i] - y > thr), R: yR.map((y, i) => groundLvl[i] - y > thr) };
  // Position au sol d'un point image (x, y du sol)
  const sgn = side === 'far' ? -1 : 1;
  const ground = (x, y) => {
    if (cal) { const g = toGround(cal, { x, y }); return { lat: sgn * g.x, fwd: sgn * g.y, x: g.x, y: g.y }; }
    const lat = (mirror ? -1 : 1) * x * aspect * mPerImg;
    return { lat, fwd: 0, x: lat, y: 0 };
  };
  const minRun = fr(0.04);
  const contacts = [];
  for (const k of ['L', 'R']) {
    for (const r of runs(n, (i) => !air[k][i] && Number.isFinite(yL[i]))) {
      if (r.i1 - r.i0 + 1 < minRun) continue;
      const im = Math.round((r.i0 + r.i1) / 2);
      const g = ground(footX(im, k), k === 'L' ? yL[im] : yR[im]);
      contacts.push({ foot: k, t0: t[r.i0], t1: t[r.i1], ms: Math.round((t[r.i1] - t[r.i0]) * 1000), ground: { x: g.x, y: g.y } });
    }
  }
  contacts.sort((a, b) => a.t0 - b.t0);

  // --- Centre de masse au sol : aplomb du bassin au niveau du pied d'appui (le plus bas)
  const raw = frames.map((_, i) => ground(hipX[i], lowest[i]));
  const h = fr(0.05);
  const lat = smooth(raw.map((g) => g.lat), h), fwd = smooth(raw.map((g) => g.fwd), h);
  const vLat = smooth(deriv(lat, t), h), vFwd = smooth(deriv(fwd, t), h);
  const speed = vLat.map((v, i) => Math.hypot(v, vFwd[i]));
  const accel = smooth(deriv(speed, t), h);
  let distance = 0;
  for (let i = fr(0.1); i < n; i += fr(0.1)) distance += Math.hypot(lat[i] - lat[i - fr(0.1)], fwd[i] - fwd[i - fr(0.1)]);
  const moving = speed.filter((v) => v > 0.3);

  // --- Split-steps : deux pieds en l'air 50–450 ms, bassin qui monte puis redescend
  const splitSteps = [];
  const up = (i) => groundLvl[i] - Math.max(yL[i], yR[i]) > 0.3 * thr; // les deux pieds décollés (≥ 1 cm)
  for (const r of runs(n, (i) => air.L[i] && air.R[i])) {
    // Décollage et réception affinés au seuil bas (le seuil de détection retarde l'un et avance l'autre)
    while (r.i0 > 0 && up(r.i0 - 1)) r.i0--;
    while (r.i1 < n - 1 && up(r.i1 + 1)) r.i1++;
    const dur = t[r.i1] - t[r.i0] + 1 / fps;
    if (dur < 0.05 || dur > 0.45) continue;
    let rise = 0, footUp = 0;
    const base = hipY[Math.max(0, r.i0 - fr(0.15))];
    for (let i = r.i0; i <= r.i1; i++) { rise = Math.max(rise, base - hipY[i]); footUp = Math.max(footUp, groundLvl[i] - Math.min(yL[i], yR[i])); }
    if (!(rise > 0.012 * hImg)) continue;
    const iLand = Math.min(n - 1, r.i1 + 1);
    // Écart des pieds à la réception (largeur d'appui, en m)
    const gl = ground(footX(iLand, 'L'), yL[iLand]), gr = ground(footX(iLand, 'R'), yR[iLand]);
    splitSteps.push({
      t: t[r.i0], tLand: t[iLand], airMs: Math.round(dur * 1000), heightM: +(footUp * mPerImg).toFixed(3),
      stanceM: +Math.hypot(gl.lat - gr.lat, gl.fwd - gr.fwd).toFixed(2),
      conf: +clamp(0.4 + 6 * (rise / hImg) + (cal ? 0.2 : 0), 0, 0.95).toFixed(2),
    });
  }

  // --- Premier pas après chaque split-step : premier pied qui se déplace de plus de 15 cm au sol
  const step = 0.15;
  for (const s of splitSteps) {
    // Référence : pieds posés (≈ 60 ms après la réception ; un pied encore à 2–3 cm du sol se projette
    // plusieurs centimètres trop loin par l'homographie)
    const iL = t.findIndex((x) => x >= s.tLand);
    if (iL < 0) continue;
    const i0 = Math.min(n - 1, iL + fr(0.06));
    const g0 = { L: ground(footX(i0, 'L'), yL[i0]), R: ground(footX(i0, 'R'), yR[i0]) };
    let first = null;
    for (let i = i0 + 1; i < Math.min(n, i0 + fr(1.2)) && !first; i++) {
      for (const k of ['L', 'R']) {
        const g = ground(footX(i, k), k === 'L' ? yL[i] : yR[i]);
        const d = Math.hypot(g.lat - g0[k].lat, g.fwd - g0[k].fwd);
        if (d > step) { first = { i, k, g }; break; }
      }
    }
    if (!first) { s.firstStep = null; continue; }
    // Début réel du pas : quand le pied a quitté sa position (≥ 1,5 cm), en remontant depuis le seuil
    let ib = first.i;
    while (ib > i0) {
      const g = ground(footX(ib - 1, first.k), first.k === 'L' ? yL[ib - 1] : yR[ib - 1]);
      if (Math.hypot(g.lat - g0[first.k].lat, g.fwd - g0[first.k].fwd) < 0.015) break;
      ib--;
    }
    const dl = first.g.lat - g0[first.k].lat, df = first.g.fwd - g0[first.k].fwd;
    // Direction du déplacement du CM sur les 0,5 s suivantes : un premier pas dans l'autre sens = faux pas
    const j = Math.min(n - 1, ib + fr(0.5));
    const comDir = Math.sign(lat[j] - lat[ib]) || 0;
    const cue = [...cues].filter((c) => c <= s.tLand + 0.05 && c >= s.t - 1).pop();
    s.firstStep = {
      t: t[ib], foot: first.k === 'L' ? 'gauche' : 'droit',
      direction: Math.abs(dl) >= Math.abs(df) ? (dl > 0 ? 'droite' : 'gauche') : (df > 0 ? 'avant' : 'arrière'),
      delayMs: Math.round((t[ib] - s.tLand) * 1000),
      reactionMs: cue != null ? Math.round((t[ib] - cue) * 1000) : null,
      falseStep: comDir !== 0 && Math.abs(dl) > Math.abs(df) && Math.sign(dl) !== comDir,
    };
  }

  // --- Fenêtres par frappe : déplacement avant le coup, vitesse de pointe, pied d'appui à l'impact
  const sorted = [...strokes].sort((a, b) => a.t - b.t);
  const perStroke = sorted.map((s, k) => {
    const tFrom = Math.max(s.t - 1.5, k ? sorted[k - 1].t + 0.3 : -Infinity);
    const ia = t.findIndex((x) => x >= tFrom), ib = t.findIndex((x) => x >= s.t);
    if (ia < 0 || ib < 0 || ib <= ia) return { t: s.t, type: s.type, ok: false };
    let vmax = 0; for (let i = ia; i <= ib; i++) vmax = Math.max(vmax, speed[i]);
    const dLat = lat[ib] - lat[ia];
    const onL = !air.L[ib], onR = !air.R[ib];
    let support = null;
    if (onL && !onR) support = 'L'; else if (onR && !onL) support = 'R';
    else if (onL && onR) {
      const gl = ground(footX(ib, 'L'), yL[ib]), gr = ground(footX(ib, 'R'), yR[ib]);
      support = Math.abs(gl.lat - lat[ib]) <= Math.abs(gr.lat - lat[ib]) ? 'L' : 'R';
    }
    return { t: s.t, type: s.type, ok: true, side: dLat >= 0 ? 'droite' : 'gauche', amplitudeM: +Math.abs(dLat).toFixed(2), peakSpeed: +vmax.toFixed(2), support };
  });

  const vis = mean(frames.map((f) => mean([27, 28, 29, 30, 31, 32].map((j) => f.img?.[j]?.v ?? 0.7))));
  const conf = +clamp((cal ? 0.85 : 0.55) * clamp(vis, 0.2, 1) * clamp(fps / 60, 0.4, 1), 0, 1).toFixed(2);
  return {
    fps, planar: !cal, scale: { mPerImg, hImg, heightM },
    series: { t, lat, fwd, speed, accel, airL: air.L, airR: air.R },
    contacts, splitSteps,
    com: {
      distanceM: +distance.toFixed(2), maxSpeed: +Math.max(...speed.filter(Number.isFinite)).toFixed(2),
      meanSpeed: moving.length ? +mean(moving).toFixed(2) : 0,
      maxAccel: +Math.max(...accel.filter(Number.isFinite).map(Math.abs)).toFixed(1),
    },
    perStroke,
    asymmetry: footworkAsymmetry(perStroke, contacts),
    conf,
  };
}

// ---------------------------------------------------------------------------------------------- asymétries
// Indice d'asymétrie (droite − gauche) / moyenne, en %. Alerte si |indice| > 15 % avec ≥ 3 cas de chaque côté.
const asym = (r, l) => (Number.isFinite(r) && Number.isFinite(l) && r + l > 0 ? Math.round(((r - l) / ((r + l) / 2)) * 100) : null);
export function footworkAsymmetry(perStroke = [], contacts = []) {
  const ok = perStroke.filter((s) => s.ok);
  const by = (pred) => ok.filter(pred);
  const R = by((s) => s.side === 'droite' && s.amplitudeM > 0.2), L = by((s) => s.side === 'gauche' && s.amplitudeM > 0.2);
  const FH = by((s) => s.type === 'forehand'), BH = by((s) => s.type === 'backhand');
  const sup = { L: ok.filter((s) => s.support === 'L').length, R: ok.filter((s) => s.support === 'R').length };
  const cMs = { L: contacts.filter((c) => c.foot === 'L').reduce((a, c) => a + c.ms, 0), R: contacts.filter((c) => c.foot === 'R').reduce((a, c) => a + c.ms, 0) };
  const m = (arr, k) => (arr.length ? mean(arr.map((s) => s[k])) : NaN);
  const out = {
    moves: { right: R.length, left: L.length, amplitude: asym(m(R, 'amplitudeM'), m(L, 'amplitudeM')), speed: asym(m(R, 'peakSpeed'), m(L, 'peakSpeed')),
      rightAmp: +(m(R, 'amplitudeM') || 0).toFixed(2), leftAmp: +(m(L, 'amplitudeM') || 0).toFixed(2), rightSpeed: +(m(R, 'peakSpeed') || 0).toFixed(2), leftSpeed: +(m(L, 'peakSpeed') || 0).toFixed(2) },
    supports: { left: sup.L, right: sup.R, index: asym(sup.R, sup.L), contactMsLeft: cMs.L, contactMsRight: cMs.R, contactIndex: asym(cMs.R, cMs.L) },
    strokes: { forehand: FH.length, backhand: BH.length, speed: asym(m(FH, 'peakSpeed'), m(BH, 'peakSpeed')), amplitude: asym(m(FH, 'amplitudeM'), m(BH, 'amplitudeM')) },
    alerts: [],
  };
  const A = out.alerts;
  if (R.length >= 3 && L.length >= 3 && Math.abs(out.moves.speed ?? 0) > 15)
    A.push({ key: 'moves', text: `Déplacements ${out.moves.speed > 0 ? 'vers la droite' : 'vers la gauche'} plus rapides de ${Math.abs(out.moves.speed)} % : travaille le départ ${out.moves.speed > 0 ? 'côté gauche' : 'côté droit'}.` });
  if (FH.length >= 3 && BH.length >= 3 && Math.abs(out.strokes.speed ?? 0) > 15)
    A.push({ key: 'strokes', text: `Vitesse de replacement ${out.strokes.speed > 0 ? 'plus élevée en coup droit' : 'plus élevée en revers'} (${Math.abs(out.strokes.speed)} %).` });
  if (sup.L + sup.R >= 6 && Math.abs(out.supports.index ?? 0) > 40)
    A.push({ key: 'supports', text: `Appui à l'impact surtout sur le pied ${sup.R > sup.L ? 'droit' : 'gauche'} (${Math.max(sup.L, sup.R)}/${sup.L + sup.R}).` });
  return out;
}
