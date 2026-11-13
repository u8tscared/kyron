// KYRON · tests du moteur de simulation et d'optimisation.  Exécution : node tests/sim.test.mjs
// Sans dépendance. Vérifie : ordres de grandeur physiques publiés, précision de la trajectoire rapide et du
// surrogate, contrat et réalisme de runOptimization, annulation, débit (thread courant puis workers).

import * as P from '../app/core/physics.js';
import { runOptimization } from '../app/core/optimizer.js';

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const inRange = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const section = (t) => console.log(`\n${t}`);

// ---------------------------------------------------------------------------------------------
section('1. Physique — ordres de grandeur publiés');
{
  const rk = P.customize(P.RACKETS[0], {});
  const Me = P.effectiveMass(rk, 54);
  ok(inRange(Me, 0.15, 0.25), 'masse effective au centre 0,15–0,25 kg', `${f(Me * 1000, 0)} g`);
  const base = { rk, string: 'poly', tension: 24, gauge: 1.25, impactCm: 54 };
  const c = P.impact({ ...base, V: 20, alpha: 0, phi: 0, u: 0 });
  ok(inRange(c.eA, 0.36, 0.45), 'COR apparent au centre ≈ 0,4 (Cross & Lindsey, Brody)', `e_A = ${f(c.eA, 3)}`);
  for (const r of P.RACKETS) {
    const e = P.impact({ ...base, rk: P.customize(r, {}), V: 20, alpha: 0, phi: 0 }).eA;
    if (!inRange(e, 0.33, 0.47)) ok(false, `e_A plausible pour ${r.name}`, f(e, 3));
  }
  const tip = P.impact({ ...base, V: 20, alpha: 0, phi: 0, impactCm: 63 });
  ok(tip.eA < c.eA - 0.05, 'e_A chute vers la pointe', `${f(tip.eA, 3)} à 63 cm`);
  const mid = P.impact({ ...base, V: 25, alpha: 0, phi: 0, u: 0 });
  ok(inRange(mid.tContact * 1000, 4, 5), 'temps de contact 4–5 ms', `${f(mid.tContact * 1000, 2)} ms`);
  const serve = P.impact({ ...base, V: 45, alpha: 3, phi: -4, u: 0 });
  ok(inRange(serve.speed * 3.6, 190, 220), 'service plat, 45 m/s de tête → 190–220 km/h', `${f(serve.speed * 3.6, 0)} km/h, ${f(serve.spinRpm, 0)} tr/min`);
  const fh = P.impact({ ...base, V: 30, alpha: 33, phi: 3, u: 18 });
  ok(inRange(fh.spinRpm, 2500, 3500), 'coup droit lifté pro → 2 500–3 500 tr/min', `${f(fh.spinRpm, 0)} tr/min, ${f(fh.speed * 3.6, 0)} km/h, départ ${f(fh.launch)}°`);
  ok(inRange(fh.speed * 3.6, 120, 165), 'coup droit lifté pro → 120–165 km/h', `${f(fh.speed * 3.6, 0)} km/h`);
  const slip = P.impact({ ...base, V: 30, alpha: 70, phi: 0, u: 0 });
  ok(slip.slip === true, 'swing très vertical → la balle glisse (limite de frottement)', `effet ${f(slip.spinRpm, 0)} tr/min`);
  const lead = P.customize(P.RACKETS[0], { h12: 6 });
  ok(lead.sw > rk.sw + 15 && P.effectiveMass(lead, 54) > Me, '6 g à 12 h : SW et masse effective augmentent', `SW ${f(rk.sw, 0)} → ${f(lead.sw, 0)}`);
  ok(P.swingSpeedFactor(lead, rk) < 1, 'raquette plus lourde → swing plus lent (Cross & Bower)', f(P.swingSpeedFactor(lead, rk), 3));
  ok(P.tensionAfter('poly', 24, 14, 10) < 24 * 0.9, 'perte de tension du polyester', `${f(P.tensionAfter('poly', 24, 14, 10), 1)} kg`);
  ok(inRange(P.airDensity(0, 20), 1.18, 1.22), 'densité de l’air au niveau de la mer', f(P.airDensity(0, 20), 3));
  const k = P.bedStiffness(rk, 'poly', 24);
  ok(inRange(k, 2e4, 4.5e4), 'raideur du lit 20–45 kN/m', `${f(k / 1000, 1)} kN/m`);
}

section('2. Trajectoire — aérodynamique, rebond, version rapide vs RK4');
{
  const nom = { v: 25, launch: 8, spinRpm: 0, h0: 1, x0: -1, rho: 1.2 };
  const flat = P.flight(nom), top = P.flight({ ...nom, spinRpm: 3000 }), vac = P.flight({ ...nom, rho: 0 });
  ok(top.bounce.x < flat.bounce.x - 2, 'Magnus : le lift raccourcit la trajectoire', `${f(flat.bounce.x, 2)} → ${f(top.bounce.x, 2)} m`);
  ok(flat.bounce.x < vac.bounce.x - 2, 'traînée : plus court que dans le vide', `${f(vac.bounce.x, 2)} → ${f(flat.bounce.x, 2)} m`);
  const sl = Math.hypot(flat.bounce.vx, flat.bounce.vy) / 25;
  ok(inRange(sl, 0.55, 0.85), 'perte de vitesse dans l’air avant rebond (25–45 %)', `${f((1 - sl) * 100, 0)} %`);
  ok(top.after.peak > flat.after.peak, 'rebond : la balle liftée (arrivée plus raide) rebondit plus haut', `${f(flat.after.peak, 2)} → ${f(top.after.peak, 2)} m`);
  ok(Math.abs(flat.after.vy + flat.bounce.vy * P.SURFACES.hard.ey) < 1e-9, 'rebond : restitution verticale e_y du court', `e_y = ${P.SURFACES.hard.ey}`);
  // Rapide vs référence RK4 fine (dt = 0,2 ms)
  let worst = 0, worstNet = 0, compared = 0;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 80; i++) {
    const serve = i % 2 === 0;
    const s = serve
      ? { v: 35 + rnd() * 30, launch: -8 + rnd() * 6, spinRpm: rnd() * 3500, h0: 2.4 + rnd() * 0.6, x0: 0, rho: 1.1 + rnd() * 0.15, wind: (rnd() - 0.5) * 6 }
      : { v: 18 + rnd() * 22, launch: 2 + rnd() * 14, spinRpm: -1500 + rnd() * 5500, h0: 0.7 + rnd() * 0.6, x0: -1, rho: 1.1 + rnd() * 0.15, wind: (rnd() - 0.5) * 6 };
    const ref = P.flight({ ...s, dt: 0.0002, keepPts: false });
    if (!ref.bounce) continue; // sortie du terrain de simulation (> 31 m) : pas de rebond de référence
    const fast = P.flightFast({ ...s, xStop: 40 });
    compared++;
    if (!fast.bounce) { worst = Infinity; continue; }
    worst = Math.max(worst, Math.abs(fast.bounce.x - ref.bounce.x) / (ref.bounce.x - s.x0));
    if (ref.bounce.x > P.COURT.net && ref.netY !== null) worstNet = Math.max(worstNet, Math.abs(fast.netY - ref.netY));
  }
  ok(compared >= 50 && worst < 0.02, `flightFast colle à la RK4 : écart < 2 % sur le point de rebond (${compared} tirs)`, `pire écart ${f(worst * 100, 3)} %, hauteur au filet ±${f(worstNet * 100, 2)} cm`);
  const N = 20000, s = { v: 50, launch: -5, spinRpm: 1800, h0: 2.75, x0: 0, rho: 1.2 };
  let t = performance.now(); for (let i = 0; i < N; i++) { s.launch = -5 + (i % 100) * 0.01; P.flightFast(s); }
  const fastUs = (performance.now() - t) / N * 1000;
  t = performance.now(); for (let i = 0; i < 300; i++) P.flight({ ...s, keepPts: false });
  const refUs = (performance.now() - t) / 300 * 1000;
  ok(fastUs < refUs / 5, 'flightFast nettement plus rapide que flight()', `${f(fastUs, 2)} µs contre ${f(refUs, 1)} µs par trajectoire`);
  // Surrogate de fenêtre d'angle : table interpolée vs dichotomie directe
  t = performance.now();
  const T = P.buildWindowTable({ hMin: 2.0, hMax: 3.3, nh: 5, x0: 0, target: 'service' });
  const tMs = performance.now() - t;
  const out = new Float64Array(6); let wErr = 0;
  for (let i = 0; i < 150; i++) {
    const v = 30 + rnd() * 35, sp = rnd() * 4000, h = 2.3 + rnd() * 0.8;
    const d = P.launchWindow({ v, spinRpm: sp, h0: h, x0: 0, target: 'service', iters: 16 });
    P.windowLookup(T, v, sp, h, out);
    wErr = Math.max(wErr, Math.abs(d.lo - out[0]), Math.abs(d.hi - out[1]));
  }
  ok(wErr < 0.35, 'table de fenêtres (surrogate) : erreur < 0,35° sur θmin/θmax', `pire ${f(wErr, 3)}°, construite en ${f(tMs, 0)} ms`);
}

// ---------------------------------------------------------------------------------------------
section('3. runOptimization — budget quick, thread courant');
const RES_SERVE = { // forme d'un résultat d'analyze (engine.js) : profil de démonstration
  stroke: 'serve',
  metrics: { height: 1.86, racketSpeed: 36.1 },
  simInput: { stroke: 'serve', kneeFlex: 44, separation: 23.6, elbowImpact: 151.4, contactRatio: 1.06, d1: 58, d2: 75, d3: 8, speed: 36.1 },
};
const EQ = { racket: 'ctrl98', leads: {}, string: 'poly', tension: 23, gauge: 1.25, days: 20, hours: 12 };
const COND = { alt: 0, temp: 20, wind: 0, surface: 'hard' };

function checkResult(r, label, stroke) {
  ok(r.trials >= 1e6, `${label} : trials ≥ 1 M`, `${(r.trials / 1e6).toFixed(2)} M en ${f(r.ms / 1000, 2)} s → ${f(r.trialsPerSec / 1e6, 2)} M éval./s`);
  const keys = ['kneeFlex', 'separation', 'elbowImpact', 'contactRatio', 'd1', 'd2', 'd3', 'alphaDeg', 'phiDeg', 'launchDeg'];
  ok(keys.every((k) => Number.isFinite(r.best.params[k])), `${label} : best.params complet`);
  ok(['racketKmh', 'ballKmh', 'spinRpm', 'successRate'].every((k) => Number.isFinite(r.current[k])), `${label} : current complet`,
    `${f(r.current.ballKmh, 0)} km/h, ${f(r.current.spinRpm, 0)} tr/min, ${f(r.current.successRate * 100, 0)} % bonnes`);
  const g = r.best.gains;
  ok(r.best.gainPct > 0, `${label} : gain positif`, `gainPct ${f(r.best.gainPct, 1)} (vitesse ${f(g.speedPct, 1)} %, effet ${f(g.spinPct, 1)} %, réussite ${f(g.successPts, 1)} pts)`);
  ok(g.speedPct <= 15 && g.speedPct > -10, `${label} : gain de vitesse borné (≤ 15 %)`, `${f(g.speedPct, 1)} %`);
  ok(r.best.params.separation <= 55, `${label} : séparation ≤ 55°`, f(r.best.params.separation));
  ok(['d1', 'd2', 'd3'].every((k) => r.best.params[k] >= 5 - 1e-9), `${label} : chaîne proximo-distale respectée (écarts ≥ 5 ms)`, ['d1', 'd2', 'd3'].map((k) => f(r.best.params[k], 0)).join(' / ') + ' ms');
  ok(r.best.params.kneeFlex <= (stroke === 'serve' ? 95 : 75), `${label} : flexion des genoux sous le seuil`, f(r.best.params.kneeFlex));
  ok(r.best.shoulderIR <= Math.max(r.current.shoulderIR * 1.1001, 0), `${label} : rotation interne d'épaule ≤ +10 %`, `${f(r.current.shoulderIR, 0)} → ${f(r.best.shoulderIR, 0)} °/s`);
  ok(Math.abs(r.best.successSurrogate - r.best.successRate) < 0.05, `${label} : surrogate validé par la vraie intégration (|ΔP| < 5 pts)`,
    `surrogate ${f(r.best.successSurrogate * 100, 1)} %, Monte-Carlo ${f(r.best.successRate * 100, 1)} %`);
  const sorted = r.sensitivity.every((s, i, a) => i === 0 || a[i - 1].gainPct >= s.gainPct);
  ok(r.sensitivity.length > 0 && sorted, `${label} : sensibilité triée`, r.sensitivity.slice(0, 3).map((s) => `${s.key} ${f(s.gainPct, 2)} %`).join(', '));
  const fr = r.frontier;
  const pareto = fr.every((p, i) => i === 0 || (p.ballKmh > fr[i - 1].ballKmh && p.successRate <= fr[i - 1].successRate + 1e-6));
  ok(fr.length >= 5 && pareto, `${label} : frontière vitesse ↔ réussite de Pareto`, `${fr.length} points, ${f(fr[0].ballKmh, 0)}–${f(fr[fr.length - 1].ballKmh, 0)} km/h`);
  ok(r.cloud instanceof Float32Array && r.cloud.length <= 4000 * 4 && r.cloud.length > 0, `${label} : nuage ≤ 4 000 points`, `${r.cloud.length / 4} points`);
  const e = r.equipment;
  ok(e && e.best && Number.isFinite(e.gainPct) && e.gainPct >= 0 && e.gainPct < 20, `${label} : matériel exploré`, `${e.best.racketName}, ${e.best.stringName} ${e.best.tension} kg / ${e.best.gauge} mm → ${f(e.gainPct, 1)} %`);
  ok(r.rejected.total > 0, `${label} : des combinaisons à risque ont été rejetées`, JSON.stringify(r.rejected));
}

{
  let calls = 0, lastP = 0, mono = true;
  const r = await runOptimization({
    res: RES_SERVE, stroke: 'serve', equipment: EQ, conditions: COND, goal: 'speed', budget: 'quick',
    onProgress: (p) => { calls++; if (p.p + 1e-9 < lastP) mono = false; lastP = p.p; },
  });
  ok(calls >= 3 && mono, 'progression régulière et monotone', `${calls} appels`);
  checkResult(r, 'service / vitesse (res mesuré)', 'serve');
}
for (const [stroke, goal] of [['forehand', 'spin'], ['backhand', 'balanced'], ['serve', 'safety']]) {
  const r = await runOptimization({ res: null, stroke, equipment: EQ, conditions: COND, goal, budget: 'quick' });
  checkResult(r, `${stroke} / ${goal} (profil par défaut)`, stroke);
}

section('3 bis. Robustesse');
{
  // Geste actuel HORS contraintes de sécurité (séparation 60°, genoux 99°) : l'actuel doit rester chiffrable
  // (avant correction : finalize lisait null.sigmaAngle quand aucune visée n'était admissible)
  const bad = { ...RES_SERVE, simInput: { ...RES_SERVE.simInput, separation: 60, kneeFlex: 99, d3: -21 } };
  let r = null, err = null;
  try { r = await runOptimization({ res: bad, stroke: 'serve', equipment: EQ, conditions: COND, goal: 'speed', budget: 'quick' }); } catch (e) { err = e; }
  ok(!err && r && Number.isFinite(r.current.ballKmh) && r.current.outsideSafety === 'separation' && r.equipment && Number.isFinite(r.equipment.current.ballKmh),
    'geste actuel hors contraintes : pas d’erreur, actuel chiffré et signalé', err ? err.message : `outsideSafety = ${r.current.outsideSafety}`);
  ok(r && r.best.params.separation <= 55 && ['d1', 'd2', 'd3'].every((k) => r.best.params[k] >= 5),
    'la cible repasse dans les contraintes et remet la chaîne dans l’ordre', r ? `séparation ${f(r.best.params.separation)}°, d3 ${f(r.current.params.d3, 0)} → ${f(r.best.params.d3, 0)} ms` : '');
  const sd3 = r?.sensitivity.find((x) => x.key === 'd3');
  ok(sd3 && sd3.gainPct > 0 && sd3.to >= 5, 'sensibilité (objectif vitesse) : remettre le poignet après le coude est un gain', sd3 ? `d3 ${f(sd3.from, 0)} → ${f(sd3.to, 0)} ms : +${f(sd3.gainPct, 2)} %` : 'absente');
  // Tranche vide / course entre workers : finalize sans élites ni matériel
  const W = await import('../app/core/opt-worker.js');
  const Pb = W.buildProblem({ stroke: 'serve', sim: { ...bad.simInput, height: 1.86 }, equipment: EQ, conditions: COND, goal: 'speed' });
  let fin = null; err = null;
  try { fin = W.finalize(Pb, { elites: [], equipBest: null, mcN: 300 }); } catch (e) { err = e; }
  ok(!err && fin.best.isCurrent && fin.best.gainPct === 0 && fin.equipment.isCurrent, 'finalize sans élite ni matériel (tranche vide) : renvoie l’actuel', err ? err.message : 'ok');
}

section('4. Annulation');
{
  const ac = new AbortController();
  const t0 = performance.now();
  setTimeout(() => ac.abort(), 150);
  let err = null;
  try { await runOptimization({ res: null, stroke: 'forehand', goal: 'speed', budget: 'max', signal: ac.signal }); } catch (e) { err = e; }
  ok(err && err.name === 'AbortError' && performance.now() - t0 < 2500, 'AbortSignal interrompt le calcul', `${f(performance.now() - t0, 0)} ms`);
}

// ---------------------------------------------------------------------------------------------
section('5. Débit en workers (même chemin que le navigateur, simulé avec worker_threads)');
{
  // Simulation minimale de l'API Web Worker module au-dessus de node:worker_threads, sans dépendance.
  let threads = null;
  try { threads = await import('node:worker_threads'); } catch { /* indisponible */ }
  if (!threads) console.log('  (worker_threads indisponible : section ignorée)');
  else {
    const workerUrl = new URL('../app/core/opt-worker.js', import.meta.url).href;
    const boot = `
      const { parentPort } = require('node:worker_threads');
      class WorkerGlobalScope {}
      globalThis.WorkerGlobalScope = WorkerGlobalScope;
      const self = Object.create(WorkerGlobalScope.prototype);
      self.postMessage = (d, tr) => parentPort.postMessage(d, tr);
      globalThis.self = self;
      parentPort.on('message', (d) => self.onmessage && self.onmessage({ data: d }));
      import(${JSON.stringify(workerUrl)});`;
    class ShimWorker {
      constructor() {
        this.w = new threads.Worker(boot, { eval: true });
        this.w.on('message', (d) => this.onmessage && this.onmessage({ data: d }));
        this.w.on('error', (e) => this.onerror && this.onerror(e));
      }
      postMessage(d, tr) { this.w.postMessage(d, tr); }
      terminate() { this.w.terminate(); }
    }
    globalThis.Worker = ShimWorker;
    globalThis.window = globalThis;
    const cores = (globalThis.navigator && navigator.hardwareConcurrency) || 1;
    const r = await runOptimization({ res: RES_SERVE, stroke: 'serve', equipment: EQ, conditions: COND, goal: 'balanced', budget: 'full' });
    delete globalThis.Worker; delete globalThis.window;
    ok(r.workers === cores && r.trials >= 1e7, `budget full sur ${r.workers} workers`, `${(r.trials / 1e6).toFixed(1)} M essais en ${f(r.ms / 1000, 2)} s → ${f(r.trialsPerSec / 1e6, 2)} M éval./s`);
    ok(r.best.gainPct > 0 && r.best.gains.speedPct <= 15, 'résultat cohérent en parallèle', `gain ${f(r.best.gainPct, 1)}, vitesse ${f(r.best.gains.speedPct, 1)} %`);
    console.log(`  (cible : full < 10 s sur un portable récent à 8 cœurs ; ici ${cores} cœur(s))`);
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
