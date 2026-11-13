// KYRON · analyse d'une séance entière : découpe des frappes, classification du coup, qualité de la prise,
// analyse biomécanique de chaque frappe et détection de fatigue.
// Entrée : images {t, world:[33 {x,y,z}], img:[33 {x,y,v}]} (conventions de docs/CONTRACTS.md).
// Module pur (aucun accès au DOM) : utilisable dans le navigateur, un worker ou sous node.

import { analyze, detectStrokes, chirality, LM } from './engine.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (arr) => {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Série lissée (moyenne glissante ± w) d'une coordonnée d'un point.
function track(frames, k, w = 2) {
  const n = frames.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { const p = frames[j].world[k]; x += p.x; y += p.y; z += p.z; c++; }
    out[i] = { x: x / c, y: y / c, z: z / c };
  }
  return out;
}

const STROKE_TYPES = ['serve', 'forehand', 'backhand', 'volley', 'smash'];

// ---------------------------------------------------------------------------------------------------------
// Classification par règles sur la trajectoire 3D du poignet dominant, relative au bassin et à la tête.
//  1. Au-dessus de la tête au pic de vitesse → service ou smash. Service si le bras non dominant monte d'en bas
//     (sous la ceinture) jusqu'au-dessus de la tête (lancer) et si la raquette ne reste pas longtemps en l'air
//     avant la frappe (au smash, la raquette est armée tôt et longtemps derrière la tête).
//  2. Swing court (le poignet part de moins de 55 cm de son point d'impact) → volée.
//  3. Sinon, côté du corps : sens de rotation du poignet autour de l'axe vertical du bassin (moment cinétique)
//     et position latérale de la préparation dans le repère du thorax. Coup droit = préparation côté dominant
//     et balayage vers le côté opposé ; revers = l'inverse.
// Renvoie { type, conf } (+ side et cues pour le débogage). conf ∈ [0, 1].
export function classifyStroke(frames, hand = 'right') {
  const n = frames?.length || 0;
  if (n < 8) return { type: 'forehand', conf: 0, side: 'forehand', cues: {} };
  const R = hand === 'right';
  const t = frames.map((f) => f.t);
  const wr = track(frames, R ? LM.rWr : LM.lWr), wo = track(frames, R ? LM.lWr : LM.rWr);
  const nose = track(frames, LM.nose), lSh = track(frames, LM.lSh), rSh = track(frames, LM.rSh);
  const lHip = track(frames, LM.lHip), rHip = track(frames, LM.rHip);
  const fps = (n - 1) / Math.max(1e-6, t[n - 1] - t[0]);
  const fr = (s) => Math.max(1, Math.round(s * fps));

  // Vitesse du poignet (différences centrées) et pic de la frappe.
  const sp = new Array(n).fill(0), vel = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dt = t[b] - t[a] || 1;
    vel[i] = { x: (wr[b].x - wr[a].x) / dt, y: (wr[b].y - wr[a].y) / dt, z: (wr[b].z - wr[a].z) / dt };
    sp[i] = Math.hypot(vel[i].x, vel[i].y, vel[i].z);
  }
  let p = 1;
  for (let i = 1; i < n - 1; i++) if (sp[i] > sp[p]) p = i;
  const hip = (i) => ({ x: (lHip[i].x + rHip[i].x) / 2, y: (lHip[i].y + rHip[i].y) / 2, z: (lHip[i].z + rHip[i].z) / 2 });
  const shY = (i) => (lSh[i].y + rSh[i].y) / 2;

  // 1. Hauteur au pic (poignet par rapport au nez), sur ± 70 ms.
  let over = -Infinity;
  for (let i = Math.max(0, p - fr(0.07)); i <= Math.min(n - 1, p + fr(0.07)); i++) over = Math.max(over, wr[i].y - nose[i].y);
  const cues = { overhead: over, peakSpeed: sp[p] };
  if (over > 0.1) {
    const i0 = Math.max(0, p - fr(1.6)), i1 = Math.max(i0 + 1, p - fr(0.1));
    let low = Infinity, high = -Infinity, lowI = i0;
    for (let i = i0; i < i1; i++) {
      const h = wo[i].y - hip(i).y;
      if (h < low) { low = h; lowI = i; }
    }
    for (let i = lowI; i < i1; i++) high = Math.max(high, wo[i].y - nose[i].y);
    const tossRise = low < 0.15 && high > 0; // bras non dominant : sous la ceinture → au-dessus de la tête
    let above = 0;
    for (let i = i0; i < p; i++) if (wr[i].y > shY(i) + 0.05) above += t[Math.min(n - 1, i + 1)] - t[i];
    cues.tossRise = tossRise; cues.racketUpTime = above;
    const s = (tossRise ? 0.6 : 0) + (above < 0.5 ? 0.4 : 0);
    const type = s >= 0.5 ? 'serve' : 'smash';
    return { type, conf: +(clamp(0.5 + Math.abs(s - 0.5), 0, 1) * clamp(over / 0.2, 0.5, 1)).toFixed(2), side: 'overhead', cues };
  }

  // 2. Amplitude du swing : distance max du poignet à sa position d'impact sur les 0,6 s précédentes.
  let back = 0, backI = p;
  for (let i = Math.max(0, p - fr(0.6)); i < p; i++) {
    const d = Math.hypot(wr[i].x - wr[p].x, wr[i].y - wr[p].y, wr[i].z - wr[p].z);
    if (d > back) { back = d; backI = i; }
  }
  cues.backswing = back;

  // 3. Côté. Moment cinétique vertical du poignet autour du bassin, du début de l'accélération à l'impact.
  const chir = chirality(frames);
  const hs = R ? 1 : -1;
  let L = 0, norm = 0;
  for (let i = Math.max(0, p - fr(0.25)); i <= Math.min(n - 1, p + fr(0.03)); i++) {
    const h = hip(i), rx = wr[i].x - h.x, rz = wr[i].z - h.z;
    L += rz * vel[i].x - rx * vel[i].z; // (r × v)·y
    norm += Math.hypot(rx, rz) * Math.hypot(vel[i].x, vel[i].z);
  }
  const spin = norm > 0 ? (L / norm) * chir * hs : 0; // > 0 : balayage du côté dominant vers l'autre côté
  // Position latérale de la préparation dans le repère des épaules (> 0 = côté dominant).
  const sx = rSh[backI].x - lSh[backI].x, sz = rSh[backI].z - lSh[backI].z, sl = Math.hypot(sx, sz) || 1;
  const cx = (lSh[backI].x + rSh[backI].x) / 2, cz = (lSh[backI].z + rSh[backI].z) / 2;
  const lat = (((wr[backI].x - cx) * sx + (wr[backI].z - cz) * sz) / sl) * hs;
  const score = 0.6 * Math.tanh(spin * 3) + 0.4 * Math.tanh(lat / 0.15);
  cues.spin = spin; cues.lateral = lat; cues.sideScore = score;
  const side = score >= 0 ? 'forehand' : 'backhand';
  const sideConf = clamp(Math.abs(score), 0, 1);
  if (back < 0.55 && sp[p] < 10) return { type: 'volley', conf: +clamp(0.4 + (0.55 - back), 0, 1).toFixed(2), side, cues };
  return { type: side, conf: +(0.35 + 0.65 * sideConf).toFixed(2), side, cues };
}

// ---------------------------------------------------------------------------------------------------------
// Qualité de la prise : cadence réelle, confiance moyenne des points, joueur entier dans le cadre, taille du
// joueur dans l'image, images manquantes. meta = { width, height, duration } (pixels, secondes), optionnels.
// Renvoie { score: 0–100, fps, issues: [{ key, label, detail }] } ; parts détaille chaque facteur (0–1).
export function qualityScore(frames, meta = {}) {
  const n = frames?.length || 0;
  if (n < 2) return { score: 0, fps: 0, issues: [{ key: 'empty', label: 'Aucun joueur détecté', detail: "Le joueur n'a été détecté sur presque aucune image. Cadre-le en entier, bien éclairé, sans contre-jour." }], parts: {} };
  const issues = [];
  const dts = [];
  for (let i = 1; i < n; i++) dts.push(frames[i].t - frames[i - 1].t);
  const dt = median(dts.filter((d) => d > 0)) || 1 / 30;
  const fps = 1 / dt;
  // Images manquantes : trous dans la suite temporelle (pose non détectée), plus la fin non couverte.
  let missing = 0;
  for (const d of dts) missing += Math.max(0, Math.round(d / dt) - 1);
  if (meta.duration > 0) missing += Math.max(0, Math.round((meta.duration - (frames[n - 1].t - frames[0].t)) / dt) - 1);
  const missRatio = missing / (n + missing);

  const KEY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  let vs = 0, vn = 0, inside = 0;
  const spans = [];
  for (const f of frames) {
    if (!f.img) continue;
    let ok = true;
    for (const k of KEY) {
      const q = f.img[k];
      if (!q) { ok = false; continue; }
      vs += q.v ?? 1; vn++;
      if (q.x < 0.005 || q.x > 0.995 || q.y < 0.005 || q.y > 0.995) ok = false;
    }
    if (ok) inside++;
    const no = f.img[0], a = f.img[27], b = f.img[28];
    if (no && a && b) spans.push(Math.max(a.y, b.y) - no.y);
  }
  const conf = vn ? vs / vn : 1;
  const inFrame = inside / n;
  const span = spans.length ? median(spans) : NaN; // nez → chevilles, en fraction de hauteur d'image
  const spanPx = meta.height > 0 && Number.isFinite(span) ? span * meta.height : null;

  const fpsF = Math.sqrt(clamp(fps / 120, 0.25, 1));
  const confF = Math.sqrt(clamp((conf - 0.3) / 0.6, 0, 1));
  const frameF = 0.3 + 0.7 * inFrame;
  let sizeF = 1;
  if (Number.isFinite(span)) {
    if (span < 0.3) sizeF = clamp(span / 0.3, 0.2, 1);
    else if (span > 0.9) sizeF = 0.8;
  }
  if (spanPx != null && spanPx < 120) sizeF = Math.min(sizeF, clamp(spanPx / 120, 0.2, 1));
  const missF = 1 - Math.min(0.8, missRatio * 1.5);
  const score = Math.round(100 * fpsF * confF * frameF * sizeF * missF);

  if (fps < 100) issues.push({ key: 'fps', label: fps < 50 ? 'Cadence trop faible' : 'Cadence limite', detail: `${Math.round(fps)} images/s analysées : le bras et la raquette sont flous à l'impact et les pics de vitesse sont sous-estimés. Filme en ralenti 120 ou 240 i/s.` });
  if (conf < 0.75) issues.push({ key: 'visibility', label: 'Points du corps mal vus', detail: `Confiance moyenne ${Math.round(conf * 100)} % : lumière faible, contre-jour ou joueur partiellement caché. Filme avec la lumière dans le dos de la caméra.` });
  if (inFrame < 0.9) issues.push({ key: 'framing', label: 'Joueur coupé par le cadre', detail: `Le joueur sort du cadre sur ${Math.round((1 - inFrame) * 100)} % des images (pieds, tête ou raquette). Recule ou dézoome : il faut le voir en entier, bras levé compris.` });
  if (Number.isFinite(span) && span < 0.3) issues.push({ key: 'size', label: 'Joueur trop petit dans l’image', detail: `Le joueur occupe ${Math.round(span * 100)} % de la hauteur de l'image${spanPx != null ? ` (${Math.round(spanPx)} px)` : ''}. Rapproche-toi pour qu'il en occupe 40 à 80 %.` });
  else if (Number.isFinite(span) && span > 0.9) issues.push({ key: 'size', label: 'Joueur trop près', detail: 'Le joueur remplit toute la hauteur : au service, la raquette et la balle sortent du cadre. Recule d’un ou deux mètres.' });
  if (missRatio > 0.05) issues.push({ key: 'missing', label: 'Images sans détection', detail: `${missing} images sans joueur détecté (${Math.round(missRatio * 100)} %). Évite que quelqu'un passe devant la caméra et garde le joueur bien éclairé.` });

  return {
    score, fps: Math.round(fps * 10) / 10, issues,
    parts: { fps: +fpsF.toFixed(2), visibility: +conf.toFixed(2), framing: +inFrame.toFixed(2), size: Number.isFinite(span) ? +span.toFixed(2) : null, missing: +missRatio.toFixed(3) },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Fatigue : régression linéaire de la vitesse de raquette estimée sur le rang de la frappe. Chaque vitesse est
// d'abord rapportée à la moyenne de son type de coup (un service est plus rapide qu'un revers : sans cette
// normalisation, l'ordre des coups biaiserait la pente). Pente exprimée en % sur l'ensemble de la séance.
function fatigueTrend(strokes) {
  const valid = strokes.filter((s) => s.res && Number.isFinite(s.res.metrics?.racketSpeed));
  const groups = {};
  valid.forEach((s) => { (groups[s.type] ||= []).push(s.res.metrics.racketSpeed); });
  const meanOf = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
  const pts = valid.map((s, i) => ({ x: i, y: s.res.metrics.racketSpeed / meanOf[s.type], ok: groups[s.type].length >= 2 })).filter((q) => q.ok);
  const N = pts.length;
  const metric = 'racketSpeed';
  if (N < 4) return { slopePct: 0, metric, alert: false, r2: 0, n: N, detail: `Pas assez de frappes comparables (${N}) pour mesurer une dérive : il en faut au moins 4, dont 2 du même type.` };
  const mx = pts.reduce((a, q) => a + q.x, 0) / N, my = pts.reduce((a, q) => a + q.y, 0) / N;
  let sxy = 0, sxx = 0, syy = 0;
  for (const q of pts) { sxy += (q.x - mx) * (q.y - my); sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0;
  const span = pts[N - 1].x - pts[0].x;
  const slopePct = Math.round(b * span * 1000) / 10; // b est déjà relatif (vitesses normalisées autour de 1)
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const alert = slopePct < -5;
  const fmt = (v) => `${v > 0 ? '+' : ''}${String(v).replace('.', ',')} %`;
  const detail = alert
    ? `Vitesse de raquette en baisse de ${String(Math.abs(slopePct)).replace('.', ',')} % entre la 1re et la ${valid.length}e frappe (tendance linéaire, R² ${r2.toFixed(2).replace('.', ',')}). Signe de fatigue : fais une pause, hydrate-toi, et garde les exercices explosifs pour le début de séance.`
    : `Vitesse de raquette stable sur la séance (${fmt(slopePct)}, R² ${r2.toFixed(2).replace('.', ',')}).`;
  return { slopePct, metric, alert, r2: +r2.toFixed(2), n: N, detail };
}

// ---------------------------------------------------------------------------------------------------------
// Analyse d'une séance : découpe (detectStrokes), classification, analyse de chaque frappe, fatigue, résumé.
// opts = { hand, forceStroke?, source?, sex?, meta? (pour qualityScore) }.
export function analyzeSession(allFrames, opts = {}) {
  const hand = opts.hand || 'right';
  const source = opts.source || 'video';
  const frames = allFrames || [];
  const peaks = detectStrokes(frames, hand);
  const t = frames.map((f) => f.t);
  const sliceT = (a, b) => {
    let i0 = 0; while (i0 < t.length && t[i0] < a) i0++;
    let i1 = i0; while (i1 < t.length && t[i1] <= b) i1++;
    return { i0, frames: frames.slice(i0, i1) };
  };
  const strokes = [];
  peaks.forEach((pk, k) => {
    const prevT = k > 0 ? peaks[k - 1].t : -Infinity;
    const nextT = k < peaks.length - 1 ? peaks[k + 1].t : Infinity;
    // Fenêtres : jamais avant la fin de l'accompagnement de la frappe précédente (+ 0,3 s), jamais au-delà
    // du début de la préparation de la suivante (− 0,9 s).
    const lo = (before) => Math.max(pk.t - before, prevT + 0.3);
    const hi = Math.min(pk.t + 0.7, Math.max(pk.t + 0.25, nextT - 0.9));
    let type, conf, side;
    if (opts.forceStroke) { type = opts.forceStroke; conf = 1; side = opts.forceStroke; }
    else ({ type, conf, side } = classifyStroke(sliceT(lo(1.6), hi).frames, hand));
    const engineStroke = type === 'smash' ? 'serve' : type === 'volley' ? side : type;
    const seg = sliceT(lo(engineStroke === 'serve' ? 1.8 : 1.3), hi);
    let res = null, error = null;
    try {
      res = analyze(seg.frames, { stroke: engineStroke, hand, source, sex: opts.sex });
    } catch (e) { error = e.message; }
    strokes.push({ i: k, t: pk.t, type, conf, frames: seg.frames, res, ...(error ? { error } : {}), i0: seg.i0 });
  });

  const byType = Object.fromEntries(STROKE_TYPES.map((k) => [k, 0]));
  strokes.forEach((s) => { byType[s.type] = (byType[s.type] || 0) + 1; });
  const scored = strokes.filter((s) => s.res);
  let bestIdx = -1;
  scored.forEach((s) => { if (bestIdx < 0 || s.res.score > strokes[bestIdx].res.score) bestIdx = s.i; });
  const meanScore = scored.length ? Math.round(scored.reduce((a, s) => a + s.res.score, 0) / scored.length) : 0;

  return {
    strokes,
    fatigue: fatigueTrend(strokes),
    summary: { count: strokes.length, byType, bestIdx, meanScore },
    quality: qualityScore(frames, opts.meta || {}),
  };
}
