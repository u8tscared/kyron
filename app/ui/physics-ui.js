// KYRON · passerelle UI ↔ physics.js : geste par défaut, matériel courant, estimation de l'effet
import { M } from './core.js';
import { S, curRes, cur } from './state.js';
import { analyzable } from './util.js';

// Geste par défaut d'un bon joueur de compétition (km/h, °, m, cm)
export const SWING_DEF = {
  serve: { V: 150, A: 6, P: -6.5, U: 0, H: 2.75, I: 56, O: 0, target: 'service' },
  forehand: { V: 95, A: 24, P: 2, U: 80, H: 0.95, I: 54, O: 0, target: 'base' },
  backhand: { V: 88, A: 20, P: 3, U: 80, H: 0.9, I: 54, O: 0, target: 'base' },
};

export function racketOf(eq = S.equipment) {
  const P = M.physics; if (!P) return null;
  const base = eq.spec || P.RACKETS.find((r) => r.id === eq.racket) || P.RACKETS[0];
  return P.customize(base, eq.leads);
}

export function tensionNow(eq = S.equipment) {
  const P = M.physics; if (!P) return eq.tension;
  return P.tensionAfter(eq.string, eq.tension, eq.days, eq.hours);
}

// Geste issu de la dernière analyse (vitesse de raquette, hauteur de contact), sinon défaut
export function swingFromAnalysis(stroke) {
  const st = analyzable(stroke);
  const d = { ...SWING_DEF[st] };
  const s = cur(), r = s?.res;
  if (r && analyzable(s.type) === st) {
    d.V = Math.round(Math.max(60, Math.min(200, r.metrics.racketSpeed * 3.6)));
    if (st === 'serve' && Number.isFinite(r.metrics.contactRatio)) d.H = +Math.max(2.2, Math.min(3.2, r.metrics.contactRatio * (S.profile.height / 100) + 0.35)).toFixed(2);
    d.fromAnalysis = true;
    // Angles de raquette et de face estimés par l'optimiseur pour ce geste
    const o = S.opt;
    const cp = o.status === 'done' && o.forIdx === S.strokeIdx ? o.result?.current?.params : null;
    if (cp && Number.isFinite(cp.alphaDeg) && Number.isFinite(cp.phiDeg)) { d.A = +cp.alphaDeg.toFixed(1); d.P = +cp.phiDeg.toFixed(1); d.anglesFromOpt = true; }
  }
  return d;
}

// Effet estimé à partir de la vitesse de raquette mesurée et du geste type
export function spinEstimate(type, racketSpeed) {
  const P = M.physics; if (!P || !Number.isFinite(racketSpeed)) return null;
  try {
    const st = analyzable(type), d = SWING_DEF[st], rk = racketOf();
    const im = P.impact({ rk, string: S.equipment.string, tension: tensionNow(), gauge: S.equipment.gauge, V: racketSpeed, alpha: d.A, phi: d.P, u: d.U / 3.6, impactCm: d.I, offCenter: 0 });
    const rpm = im.spinRpm;
    return { rpm: Math.abs(rpm), label: rpm >= 0 ? (st === 'serve' ? 'lift / kick' : 'lift') : 'slice', im };
  } catch (e) { return null; }
}
