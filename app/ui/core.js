// KYRON · accès aux moteurs (app/core/*) avec repli propre quand un module ou un export manque encore.
import { analyzable, linreg, mean } from './util.js';

export const M = { engine: null, session: null, ball: null, sync: null, demo: null, physics: null, optimizer: null };
export const STATUS = [];

const LIST = [
  ['engine', '../core/engine.js', "Moteur d'analyse biomécanique"],
  ['physics', '../core/physics.js', 'Physique raquette, cordage, vol'],
  ['demo', '../core/demo.js', 'Données de démonstration'],
  ['session', '../core/session.js', 'Analyse de séance, classification'],
  ['ball', '../core/ball.js', 'Suivi de balle'],
  ['sync', '../core/sync.js', 'Synchronisation multi-caméras'],
  ['optimizer', '../core/optimizer.js', 'Optimiseur multi-cœurs'],
];

export async function loadCore(onEach) {
  await Promise.all(LIST.map(async ([k, p, label]) => {
    let ok = false;
    try { M[k] = await import(p); ok = true; } catch (e) { M[k] = null; console.warn(`[kyron] module ${p} indisponible :`, e?.message || e); }
    STATUS.push({ k, label, ok });
    onEach?.({ k, label, ok });
  }));
  return M;
}

export const has = (mod, fn) => !!(M[mod] && typeof M[mod][fn] === 'function');

// ---------- Centre de masse (repli si engine ne fournit pas series.com) ----------
const SEG = [
  // [masse relative, point A, point B (null = A seul), position du CdM de A vers B]
  [0.081, 0, null, 0], [0.497, 'sh', 'hip', 0.5],
  [0.028, 11, 13, 0.436], [0.028, 12, 14, 0.436], [0.016, 13, 15, 0.43], [0.016, 14, 16, 0.43], [0.006, 15, null, 0], [0.006, 16, null, 0],
  [0.1, 23, 25, 0.433], [0.1, 24, 26, 0.433], [0.0465, 25, 27, 0.433], [0.0465, 26, 28, 0.433], [0.0145, 27, 31, 0.5], [0.0145, 28, 32, 0.5],
];
export function comOf(world) {
  const P = (k) => k === 'sh' ? mid(world[11], world[12]) : k === 'hip' ? mid(world[23], world[24]) : world[k];
  let x = 0, y = 0, z = 0, m = 0;
  for (const [w, a, b, r] of SEG) {
    const A = P(a); if (!A) continue;
    const B = b == null ? A : P(b); if (!B) continue;
    x += w * (A.x + (B.x - A.x) * r); y += w * (A.y + (B.y - A.y) * r); z += w * (A.z + (B.z - A.z) * r); m += w;
  }
  return { x: x / m, y: y / m, z: z / m };
}
const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : null);
export const comSeries = (res, frames) => res?.series?.com?.length === frames.length ? res.series.com : frames.map((fr) => comOf(fr.world));

// ---------- Classification de repli (heuristique simple) ----------
function classifyFallback(frames, hand, idx) {
  const R = hand === 'right', wi = R ? 16 : 15;
  const f = frames[Math.max(0, Math.min(frames.length - 1, idx))];
  if (!f) return { type: 'serve', conf: 0.3 };
  const w = f.world[wi], nose = f.world[0];
  if (w.y > nose.y + 0.05) return { type: 'serve', conf: 0.55 };
  // Côté du poignet par rapport à l'axe des épaules (projeté dans le plan horizontal)
  const sh = f.world[R ? 12 : 11], so = f.world[R ? 11 : 12];
  const ax = { x: sh.x - so.x, z: sh.z - so.z }, wv = { x: w.x - so.x, z: w.z - so.z };
  const side = (ax.x * wv.x + ax.z * wv.z) / ((ax.x ** 2 + ax.z ** 2) || 1);
  return { type: side > 0.5 ? 'forehand' : 'backhand', conf: 0.4 };
}

export function classify(frames, hand, idx) {
  if (has('session', 'classifyStroke')) { try { const c = M.session.classifyStroke(frames, hand); if (c?.type) return c; } catch (e) { console.warn('[kyron] classifyStroke', e); } }
  return classifyFallback(frames, hand, idx ?? Math.floor(frames.length / 2));
}

// ---------- Fatigue (repli) ----------
export function fatigueOf(strokes) {
  const sp = strokes.map((s) => s.res?.metrics?.racketSpeed).filter(Number.isFinite);
  if (sp.length < 3) return { slopePct: 0, metric: 'racketSpeed', alert: false, detail: 'Il faut au moins 3 frappes pour mesurer la dérive de vitesse.' };
  const { slope } = linreg(sp), m = mean(sp);
  const slopePct = (slope / m) * 100 * (sp.length - 1); // dérive totale sur la séance
  const alert = slopePct < -6;
  return { slopePct, metric: 'racketSpeed', alert, detail: alert ? `Ta vitesse de raquette baisse de ${Math.abs(slopePct).toFixed(1).replace('.', ',')} % entre le début et la fin : signe de fatigue. Fais une pause ou réduis le volume.` : `Vitesse stable sur la séance (${slopePct >= 0 ? '+' : '−'}${Math.abs(slopePct).toFixed(1).replace('.', ',')} %).` };
}

function summaryOf(strokes) {
  const byType = {};
  strokes.forEach((s) => { byType[s.type] = (byType[s.type] || 0) + 1; });
  let bestIdx = 0;
  strokes.forEach((s, i) => { if ((s.res?.score ?? -1) > (strokes[bestIdx].res?.score ?? -1)) bestIdx = i; });
  return { count: strokes.length, byType, bestIdx, meanScore: Math.round(mean(strokes.map((s) => s.res?.score ?? 0)) || 0) };
}

const safeAnalyze = (frames, opts) => { try { return M.engine.analyze(frames, opts); } catch (e) { console.warn('[kyron] analyze', e?.message); return null; } };

// ---------- Séance ----------
export function analyzeSessionSafe(all, { hand, forceStroke, height } = {}) {
  if (has('session', 'analyzeSession')) {
    try {
      const out = M.session.analyzeSession(all, { hand, forceStroke, heightM: height });
      if (out?.strokes?.length) {
        out.strokes = out.strokes.map((s, i) => {
          const frames = s.frames?.length ? s.frames : all;
          const res = s.res || safeAnalyze(frames, { stroke: analyzable(s.type), hand, source: 'video' });
          return { ...s, i: s.i ?? i, frames, res };
        }).filter((s) => s.res);
        if (out.strokes.length) {
          out.fatigue ||= fatigueOf(out.strokes);
          out.summary ||= summaryOf(out.strokes);
          out.engine = 'session';
          return out;
        }
      }
    } catch (e) { console.warn('[kyron] analyzeSession indisponible, repli', e); }
  }
  // Repli : pics de vitesse du poignet + analyse frappe par frappe
  let peaks = [];
  try { peaks = M.engine.detectStrokes(all, hand); } catch (e) { peaks = []; }
  if (!peaks.length) { const k = Math.floor(all.length / 2); peaks = [{ idx: k, t: all[k].t }]; }
  const strokes = [];
  peaks.forEach((p) => {
    const c = forceStroke ? { type: forceStroke, conf: 1 } : classifyFallback(all, hand, p.idx);
    const st = analyzable(c.type);
    const before = st === 'serve' ? 1.8 : 1.3;
    const frames = all.filter((fr) => fr.t >= p.t - before && fr.t <= p.t + 0.7);
    const res = frames.length >= 12 ? safeAnalyze(frames, { stroke: st, hand, source: 'video' }) : null;
    if (res) strokes.push({ i: strokes.length, t: p.t, type: c.type, conf: c.conf, frames, res });
  });
  return { strokes, fatigue: fatigueOf(strokes), summary: summaryOf(strokes), engine: 'repli' };
}

// ---------- Qualité de prise ----------
export function qualitySafe(frames, meta) {
  if (has('session', 'qualityScore')) { try { const q = M.session.qualityScore(frames, meta); if (q && Number.isFinite(q.score)) return q; } catch (e) { console.warn('[kyron] qualityScore', e); } }
  const n = frames.length; if (!n) return { score: 0, fps: 0, issues: [] };
  const fps = n > 1 ? (n - 1) / (frames[n - 1].t - frames[0].t) : 0;
  const vis = mean(frames.map((fr) => mean(fr.img.map((p) => p.v ?? 1))));
  const inFrame = mean(frames.map((fr) => fr.img.filter((p) => p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99).length / 33));
  const issues = [];
  let score = 100;
  if (fps < 100) { score -= fps < 50 ? 30 : 15; issues.push({ key: 'fps', label: 'Cadence trop faible', detail: `${Math.round(fps)} i/s analysées : le bras est flou à l'impact. Filme en ralenti 120 ou 240 i/s.` }); }
  if (vis < 0.8) { score -= Math.round((0.8 - vis) * 100); issues.push({ key: 'vis', label: 'Articulations mal vues', detail: `Confiance moyenne ${Math.round(vis * 100)} %. Améliore l'éclairage et évite le contre-jour.` }); }
  if (inFrame < 0.97) { score -= 15; issues.push({ key: 'crop', label: 'Joueur coupé', detail: "Une partie du corps sort du cadre. Recule pour voir le joueur entier, raquette comprise." }); }
  if (meta?.width && meta?.height && Math.min(meta.width, meta.height) < 540) { score -= 10; issues.push({ key: 'res', label: 'Résolution faible', detail: `${meta.width}×${meta.height} : passe en 1080p.` }); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), fps, issues };
}

// ---------- Démo ----------
export function buildDemoSession() {
  const D = M.demo || {};
  // Séance de démo continue (comme une vraie vidéo) passée dans le vrai pipeline de séance quand il existe
  if (typeof D.makeDemoSession === 'function' && has('session', 'analyzeSession')) {
    try {
      const all = D.makeDemoSession();
      const out = analyzeSessionSafe(all, { hand: 'right', height: 1.8 });
      if (out.strokes.length >= 3) return { ...out, all, engine: 'démo · séance' };
    } catch (e) { console.warn('[kyron] démo séance', e); }
  }
  const out = [];
  const add = (frames, type) => {
    if (!Array.isArray(frames) || frames.length < 12) return;
    const st = analyzable(type);
    const res = safeAnalyze(frames, { stroke: st, hand: 'right', source: 'demo' });
    if (res) out.push({ type, conf: 1, frames, res });
  };
  // Séance de démo : services de plus en plus fatigués, puis coup droit et revers si le module les fournit
  if (typeof D.makeDemoServe === 'function') {
    const variants = [{ kneeMax: 46 }, { kneeMax: 44, sepAmp: 20 }, { kneeMax: 42 }, { kneeMax: 39, thoraxT: 1.085 }, { kneeMax: 36, sepAmp: 14, thoraxT: 1.075 }];
    for (const v of variants) { try { add(D.makeDemoServe(v), 'serve'); } catch (e) { console.warn('[kyron] démo service', e); } }
  }
  for (const [k, type] of [['makeDemoForehand', 'forehand'], ['makeDemoBackhand', 'backhand']]) {
    if (typeof D[k] === 'function') { try { add(D[k](), type); } catch (e) { console.warn(`[kyron] ${k}`, e); } }
  }
  // Étale les frappes sur une même horloge de séance (affichage uniquement)
  let t0 = 0;
  const strokes = out.map((s, i) => {
    const off = t0; t0 += (s.frames[s.frames.length - 1].t - s.frames[0].t) + 6;
    return { ...s, i, t: off + s.frames[s.res.impact].t };
  });
  return { strokes, fatigue: fatigueOf(strokes.filter((s) => s.type === 'serve')), summary: summaryOf(strokes), engine: 'démo' };
}

// ---------- Optimiseur ----------
const SIM_FACT = { serve: 1.32, forehand: 1.18, backhand: 1.18 };
const PARAM_LABEL = { kneeFlex: 'Flexion des genoux', separation: 'Torsion hanches / épaules', elbowImpact: "Extension du coude à l'impact", contactRatio: 'Hauteur de contact', timing: 'Timing de la chaîne' };

export async function optimize(opts) {
  if (has('optimizer', 'runOptimization')) {
    try {
      const r = await M.optimizer.runOptimization(opts);
      return { ...r, engine: 'optimizer' };
    } catch (e) {
      if (e?.name === 'AbortError' || opts.signal?.aborted) throw e;
      console.warn("[kyron] runOptimization a échoué, repli sur le moteur simple :", e?.message || e);
    }
  }
  return simFallback(opts);
}

function simFallback({ res, stroke, budget, onProgress, signal }) {
  const SRC = M.engine?.SIM_SOURCE;
  if (!SRC || !res?.simInput) return Promise.reject(new Error("Moteur d'optimisation indisponible."));
  const N = budget === 'max' ? 50e6 : budget === 'quick' ? 1e6 : 10e6;
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }))); } catch (e) { reject(e); return; }
    const t0 = performance.now();
    signal?.addEventListener('abort', () => { w.terminate(); reject(Object.assign(new Error('annulé'), { name: 'AbortError' })); });
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'erreur du moteur')); };
    w.onmessage = (e) => {
      const d = e.data;
      if (!d.done) { const trials = d.progress * N, s = (performance.now() - t0) / 1000; onProgress?.({ p: d.progress, trials, trialsPerSec: trials / Math.max(0.001, s) }); return; }
      w.terminate();
      const k = SIM_FACT[stroke] || 1.2, x = res.simInput, b = d.best;
      resolve({
        engine: 'repli', trials: d.trials, ms: d.ms, workers: 1,
        current: { racketKmh: d.base * 3.6, ballKmh: d.base * k * 3.6, spinRpm: null, successRate: null },
        best: { params: { kneeFlex: b.k, separation: b.s, elbowImpact: b.e1, contactRatio: stroke === 'serve' ? b.c : null, d1: b.d1, d2: b.d2, d3: b.d3 }, ballKmh: b.v * k * 3.6, spinRpm: null, successRate: null, gainPct: d.gainPct },
        sensitivity: d.sens.map((s) => ({ key: s.key, label: PARAM_LABEL[s.key] || s.key, gainPct: s.gainPct, unit: '', from: null, to: null })).sort((a, z) => z.gainPct - a.gainPct),
        equipment: null, frontier: [], cloud: null, input: x,
      });
    };
    w.postMessage({ input: res.simInput, trials: N });
  });
}
