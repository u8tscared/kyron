// KYRON · optimisation massive du geste et du matériel (contrat : docs/CONTRACTS.md, « optimizer.js »).
//
// Navigateur : le travail est réparti sur navigator.hardwareConcurrency workers module (opt-worker.js) ;
// chaque worker reconstruit le même problème (calibration + table de substitution), explore une part du budget
// avec sa propre graine, puis le premier worker valide les meilleurs candidats par la vraie intégration.
// Node (tests) ou absence de Worker : la même fonction de calcul tourne dans le thread courant, par tranches,
// en rendant la main entre deux tranches (progression et annulation restent actives).

import { buildProblem, searchGen, searchEquipment, finalize, equipmentCount, EQUIP_EVALS_PER_COMBO } from './opt-worker.js';

export const BUDGETS = { quick: 1e6, full: 1e7, max: 5e7 };
const CLOUD_MAX = 4000;
const KMH0 = 40, KMH_STEP = 0.5;

// Résultat d'analyze (ou null) → configuration sérialisable pour le cœur de calcul
function makeCfg({ res, stroke, equipment, conditions, goal, dispersion }) {
  const st = stroke || res?.stroke || res?.simInput?.stroke || 'serve';
  const si = res?.simInput || {};
  const me = res?.metrics || {};
  const sim = res ? {
    kneeFlex: si.kneeFlex ?? me.kneeFlex, separation: si.separation ?? me.separation, elbowImpact: si.elbowImpact ?? me.elbowImpact,
    contactRatio: si.contactRatio ?? me.contactRatio, d1: si.d1, d2: si.d2, d3: si.d3, speed: si.speed ?? me.racketSpeed,
    height: me.height, ir: me.shoulderIRVel, alphaDeg: si.alphaDeg, phiDeg: si.phiDeg,
  } : {};
  // JSON : supprime undefined / NaN (le cœur applique les valeurs par défaut du coup)
  const clean = (o) => JSON.parse(JSON.stringify(o ?? {}, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? undefined : v)));
  return clean({ stroke: st, sim, equipment: equipment || {}, conditions: conditions || {}, goal: goal || 'balanced', disp: dispersion });
}

function abortError() {
  try { return new DOMException('Optimisation annulée', 'AbortError'); } catch { const e = new Error('Optimisation annulée'); e.name = 'AbortError'; return e; }
}

// Fusion des résultats partiels (frontière, nuage, élites, matériel)
function merge(parts) {
  const NB = parts[0].frP.length;
  const frP = new Float32Array(NB).fill(-1), frL = new Float32Array(NB), frS = new Float32Array(NB);
  let trials = 0, feasible = 0; const rejected = [0, 0, 0, 0, 0];
  let elites = [], equipBest = null, seen = 0;
  for (const p of parts) {
    trials += p.trials; feasible += p.feasible; seen += p.cloudSeen;
    p.rejected.forEach((v, i) => { rejected[i] += v; });
    for (let b = 0; b < NB; b++) if (p.frP[b] > frP[b]) { frP[b] = p.frP[b]; frL[b] = p.frL[b]; frS[b] = p.frS[b]; }
    elites = elites.concat(p.elites);
    if (p.equipBest && (!equipBest || p.equipBest.J > equipBest.J)) equipBest = p.equipBest;
  }
  elites.sort((a, b) => b.J - a.J);
  // Frontière de Pareto vitesse ↔ réussite : une case est retenue si aucune case plus rapide n'est plus sûre
  const front = [];
  let bestP = -1;
  for (let b = NB - 1; b >= 0; b--) {
    if (frP[b] < 0) continue;
    if (frP[b] > bestP + 1e-4) { bestP = frP[b]; front.push({ ballKmh: KMH0 + (b + 0.5) * KMH_STEP, successRate: frP[b], launchDeg: frL[b], spinRpm: frS[b] }); }
  }
  front.reverse();
  // ≤ 60 points, extrémités conservées
  const frontier = front.length <= 60 ? front : Array.from({ length: 60 }, (_, i) => front[Math.round(i * (front.length - 1) / 59)]);
  // Nuage : échantillon ≤ 4000 points, proportionnel à la part de chaque worker
  const cloud = new Float32Array(Math.min(CLOUD_MAX, parts.reduce((s, p) => s + p.cloud.length / 4, 0)) * 4);
  let k = 0;
  for (const p of parts) {
    const n = p.cloud.length / 4, take = Math.min(n, Math.round(CLOUD_MAX * (p.cloudSeen / Math.max(1, seen))));
    for (let i = 0; i < take && k < cloud.length / 4; i++, k++) cloud.set(p.cloud.subarray(i * 4, i * 4 + 4), k * 4);
  }
  return { trials, feasible, rejected, elites, equipBest, frontier, cloud: cloud.slice(0, k * 4) };
}

// Exécution dans le thread courant (node, ou navigateur sans Worker)
async function runInline(cfg, evals, onProgress, signal, t0) {
  const Pb = buildProblem(cfg);
  if (signal?.aborted) throw abortError();
  const eqRes = searchEquipment(Pb, { part: 0, nParts: 1 });
  const it = searchGen(Pb, { evals: Math.max(0, evals - eqRes.trials), seed: 1, cloudMax: CLOUD_MAX });
  let r, last = 0;
  const yieldNow = () => new Promise((ok) => (typeof setImmediate === 'function' ? setImmediate(ok) : setTimeout(ok, 0)));
  while (!(r = it.next()).done) {
    const t = nowMs();
    if (t - last > 100) {
      last = t;
      const trials = eqRes.trials + r.value.trials;
      onProgress?.({ p: trials / evals, trials, trialsPerSec: trials / Math.max(1e-3, (t - t0) / 1000), best: r.value.best });
      await yieldNow();
      if (signal?.aborted) throw abortError();
    }
  }
  const part = r.value; part.trials += eqRes.trials; part.equipBest = eqRes.best;
  const M = merge([part]);
  const fin = finalize(Pb, { elites: M.elites, equipBest: M.equipBest });
  return { M, fin, workers: 1 };
}

function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

// Exécution sur un pool de workers module
function runWorkers(cfg, evals, W, onProgress, signal, t0) {
  return new Promise((resolve, reject) => {
    const workers = [];
    let finished = false;
    const stop = () => { for (const w of workers) try { w.terminate(); } catch { /* déjà arrêté */ } };
    const fail = (e) => { if (finished) return; finished = true; stop(); signal?.removeEventListener?.('abort', onAbort); reject(e); };
    const onAbort = () => fail(abortError());
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      for (let i = 0; i < W; i++) workers.push(new Worker(new URL('./opt-worker.js', import.meta.url), { type: 'module' }));
    } catch (e) { fail(e); return; }
    const trials = new Array(W).fill(0), bests = new Array(W).fill(null), parts = new Array(W).fill(null);
    let lastEmit = 0, done = 0;
    const per = Math.floor(evals / W);
    const emit = (force) => {
      const t = nowMs();
      if (!force && t - lastEmit < 100) return;
      lastEmit = t;
      const tot = trials.reduce((a, b) => a + b, 0);
      const best = bests.filter(Boolean).sort((a, b) => b.J - a.J)[0] || null;
      onProgress?.({ p: Math.min(1, tot / evals), trials: tot, trialsPerSec: tot / Math.max(1e-3, (t - t0) / 1000), best });
    };
    workers.forEach((w, i) => {
      w.onerror = (e) => fail(new Error(`Worker d'optimisation : ${e.message || 'erreur'}`));
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'error') return fail(new Error(d.message));
        if (d.type === 'progress') { trials[i] = d.trials; if (d.best && (!bests[i] || d.best.J > bests[i].J)) bests[i] = d.best; emit(false); }
        else if (d.type === 'done') {
          parts[i] = d.result; trials[i] = d.result.trials; emit(true);
          if (++done === W) {
            const M = merge(parts);
            workers[0].onmessage = (e2) => {
              if (e2.data.type === 'error') return fail(new Error(e2.data.message));
              if (e2.data.type !== 'final' || finished) return;
              finished = true; stop(); signal?.removeEventListener?.('abort', onAbort);
              resolve({ M, fin: e2.data.result, workers: W });
            };
            workers[0].postMessage({ type: 'finalize', cfg, elites: M.elites.slice(0, 24), equipBest: M.equipBest });
          }
        }
      };
      w.postMessage({ type: 'search', cfg, part: i, nParts: W, evals: i === W - 1 ? evals - per * (W - 1) : per, seed: 1 + i * 7, cloudMax: Math.ceil(CLOUD_MAX / W) * 2 });
    });
  });
}

/**
 * Optimisation massive du geste (et du matériel) — voir docs/CONTRACTS.md.
 * Options supplémentaires (compatibles) : dispersion {angle (°), speed, spin (relatifs)}, workers (forcer N),
 * inline (forcer le thread courant).
 */
export async function runOptimization({ res = null, stroke, equipment, conditions, goal = 'balanced', budget = 'full', onProgress, signal, dispersion, workers: forceW, inline } = {}) {
  const t0 = nowMs();
  if (signal?.aborted) throw abortError();
  const cfg = makeCfg({ res, stroke, equipment, conditions, goal, dispersion });
  const evals = Math.max(equipmentCount() * EQUIP_EVALS_PER_COMBO + 1e5, BUDGETS[budget] ?? (Number.isFinite(budget) ? budget : BUDGETS.full));
  const canWorker = !inline && typeof Worker !== 'undefined' && typeof window !== 'undefined';
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 1;
  const W = Math.max(1, Math.min(16, forceW || hc));
  let out;
  if (canWorker) {
    try { out = await runWorkers(cfg, evals, W, onProgress, signal, t0); }
    catch (e) { if (e?.name === 'AbortError') throw e; out = await runInline(cfg, evals, onProgress, signal, t0); } // repli : thread courant
  } else out = await runInline(cfg, evals, onProgress, signal, t0);
  const { M, fin } = out;
  const ms = nowMs() - t0;
  const trials = M.trials + fin.flights;
  onProgress?.({ p: 1, trials, trialsPerSec: trials / (ms / 1000), best: { ballKmh: fin.best.ballKmh, spinRpm: fin.best.spinRpm, successRate: fin.best.successRate, gainPct: fin.best.gainPct } });
  const R = M.rejected;
  return {
    trials, ms, workers: out.workers, goal: cfg.goal, stroke: cfg.stroke,
    trialsPerSec: trials / (ms / 1000),
    current: fin.current,
    best: fin.best,
    sensitivity: fin.sensitivity,
    equipment: fin.equipment,
    frontier: M.frontier,
    cloud: M.cloud, cloudStride: 4, cloudFields: ['ballKmh', 'successRate', 'spinRpm', 'shoulderLoad'],
    rejected: { separation: R[1], knee: R[2], shoulder: R[3], reach: R[4], total: R[1] + R[2] + R[3] + R[4], feasible: M.feasible },
    validated: true,
  };
}
