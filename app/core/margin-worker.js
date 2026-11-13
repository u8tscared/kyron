import { impact, flight, successRate, bestAngle, customize } from './physics.js';

self.onmessage = (e) => {
  const { cfg, target, disp } = e.data;
  const t0 = performance.now();
  let trials = 0;
  // Taux de réussite au réglage actuel
  const im = impact(cfg.imp);
  const nom = { v: im.speed, launch: im.launch, spinRpm: im.spinRpm, h0: cfg.h0, rho: cfg.rho, wind: cfg.wind, surface: cfg.surface };
  const cur = successRate(nom, target, disp, 4000); trials += 4000;
  self.postMessage({ type: 'current', cur, trials });
  // Frontière : pour chaque vitesse de raquette, meilleur angle de départ et taux de réussite
  const pts = [];
  const scales = [0.7, 0.78, 0.86, 0.93, 1, 1.07, 1.14, 1.22, 1.3];
  for (const k of scales) {
    const im2 = impact({ ...cfg.imp, V: cfg.imp.V * k });
    const b = bestAngle({ v: im2.speed, spinRpm: im2.spinRpm, h0: cfg.h0, rho: cfg.rho, wind: cfg.wind, surface: cfg.surface }, target, disp, 500);
    trials += 65 * 500;
    pts.push({ kmh: im2.speed * 3.6, rate: Math.max(0, b.rate), launch: b.launch ?? null, net: b.net ?? 0, long: b.long ?? 0, isCur: k === 1 });
    self.postMessage({ type: 'progress', p: pts.length / scales.length, trials });
  }
  self.postMessage({ type: 'done', cur, pts, trials, ms: performance.now() - t0 });
};
