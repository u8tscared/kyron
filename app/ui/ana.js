// KYRON · analyses de la vague 2 côté interface : dynamique inverse, raquette, jeu de jambes, statistiques de balle.
// Chaque fonction appelle le module du moteur s'il est là, sinon calcule un repli simple à partir de la pose,
// et dit toujours d'où vient le chiffre (source : 'mesure' | 'estimation' | 'demo').
import { S, cur } from './state.js';
import { M, has, pick, comSeries } from './core.js';
import { mean, clamp, analyzable, DISP } from './util.js';
import { spinEstimate } from './physics-ui.js';

const cache = new WeakMap();
function memo(obj, key, fn) {
  if (!obj || typeof obj !== 'object') return fn();
  let c = cache.get(obj); if (!c) cache.set(obj, (c = {}));
  if (!(key in c)) { try { c[key] = fn(); } catch (e) { console.warn(`[kyron] ${key}`, e); c[key] = null; } }
  return c[key];
}
export const handOf = () => (S.session?.source === 'demo' ? 'right' : S.profile.hand);
const heightM = () => S.profile.height / 100;

// ---------- Dynamique inverse ----------
export function dynOf(s = cur()) {
  if (!s || !has('dynamics', 'inverseDynamics')) return null;
  return memo(s.res, `dyn:${S.profile.height}:${S.profile.weight}`, () => M.dynamics.inverseDynamics(s.frames, s.res, { heightM: heightM(), massKg: S.profile.weight }));
}

// ---------- Raquette ----------
// Pointe de raquette estimée (prolongement de l'avant-bras), coordonnées image normalisées
export function tipOf(fr, hand = handOf()) {
  const R = hand === 'right', e = fr.img[R ? 14 : 13], w = fr.img[R ? 16 : 15];
  return { x: w.x + (w.x - e.x) * 2.1, y: w.y + (w.y - e.y) * 2.1 };
}
export function racketOf(s = cur()) {
  if (!s) return null;
  return memo(s, `rk:${S.opt.forIdx === S.strokeIdx ? S.opt.status : ''}`, () => {
    const r = s.res, fr = s.frames, tI = fr[r.impact]?.t;
    // Trajectoire de la tête de raquette (fenêtre −400 ms → +150 ms autour de l'impact)
    let path = [], source = 'estimation';
    const rkTrack = S.session?.racketTrack;
    if (rkTrack?.frames?.length) {
      path = rkTrack.frames.filter((q) => q.t >= tI - 0.4 && q.t <= tI + 0.15).map((q) => ({ t: q.t - tI, x: q.x, y: q.y, img: q.source === 'image' }));
    }
    if (path.filter((p) => p.img).length < 4) path = fr.filter((q) => q.t >= tI - 0.4 && q.t <= tI + 0.15).map((q) => ({ t: q.t - tI, ...tipOf(q) }));
    let out = null;
    if (rkTrack && has('racket', 'analyzeRacket')) {
      try { out = M.racket.analyzeRacket(rkTrack, r, { ballTrack: s.ballTrack }); } catch (e) { out = null; }
      if (out) source = out.source === 'image' ? 'mesure' : 'estimation';
    }
    // Repli : vitesse de la tête par l'analyse, trajectoire par la pointe estimée, face par l'optimiseur
    const pre = path.filter((p) => p.t >= -0.03 && p.t <= 0.0001);
    const pathFb = pre.length >= 2 ? Math.atan2(-(pre[pre.length - 1].y - pre[0].y), Math.abs(pre[pre.length - 1].x - pre[0].x) * 1.6) * 180 / Math.PI : null;
    const optP = S.opt.result && S.opt.forIdx === S.strokeIdx ? S.opt.result.current?.params : null;
    const faceFb = Number.isFinite(optP?.phiDeg) ? optP.phiDeg : r.simInput?.phiDeg ?? null;
    const res = {
      headSpeedKmh: out?.headSpeedKmh ?? (r.metrics?.racketSpeed ? r.metrics.racketSpeed * 3.6 : null),
      faceAngleDeg: out?.faceAngleDeg ?? faceFb,
      faceFrom: out?.faceAngleDeg != null ? 'mesure' : faceFb != null ? 'optimiseur' : null,
      pathAngleDeg: out?.pathAngleDeg ?? (Number.isFinite(pathFb) ? pathFb : null),
      impactPoint: out?.impactPoint || null,
      conf: out?.conf ?? 0.3,
      source: S.session?.source === 'demo' ? 'demo' : source,
      detected: rkTrack ? `${rkTrack.detected}/${rkTrack.total}` : null,
      path,
    };
    return res;
  });
}

// ---------- Jeu de jambes ----------
function fwFallback(s) {
  const fr = s.frames, r = s.res, n = fr.length;
  const i0 = Math.max(0, r.phases[0].i0 - Math.round(r.fps * 0.4)), i1 = Math.min(n - 1, r.phases[4].i1);
  const L = (k) => fr.map((q) => q.world[k]);
  const ankL = L(27), ankR = L(28);
  // Base d'appui à l'impact (distance horizontale entre chevilles)
  const a = fr[r.impact].world[27], b = fr[r.impact].world[28];
  const base = Math.hypot(a.x - b.x, a.z - b.z);
  // Pas : déplacements horizontaux d'une cheville > 12 cm entre deux appuis
  let steps = 0; const stepT = [];
  for (const [ank, side] of [[ankL, 'G'], [ankR, 'D']]) {
    let anchor = ank[i0];
    for (let i = i0 + 1; i <= i1; i++) {
      const d = Math.hypot(ank[i].x - anchor.x, ank[i].z - anchor.z);
      const sp = i > 0 ? Math.hypot(ank[i].x - ank[i - 1].x, ank[i].z - ank[i - 1].z) * r.fps : 0;
      if (d > 0.12 && sp < 0.4) { steps++; stepT.push({ t: fr[i].t - fr[r.impact].t, side }); anchor = ank[i]; }
    }
  }
  // Split-step : les deux chevilles décollent ensemble avant l'armé
  const gy = Math.min(...fr.slice(i0, i1 + 1).map((q) => Math.min(q.world[27].y, q.world[28].y)));
  let split = null;
  for (let i = i0; i < r.phases[1]?.i0; i++) if (fr[i].world[27].y > gy + 0.035 && fr[i].world[28].y > gy + 0.035) { split = fr[i].t - fr[r.impact].t; break; }
  // Transfert du poids : déplacement du centre de masse de la fin de l'armé à l'impact
  const com = comSeries(r, fr);
  const iLoad = r.phases[1]?.i1 ?? r.impact, cA = com[iLoad], cB = com[r.impact];
  const transfer = cA && cB ? Math.hypot(cB.x - cA.x, cB.z - cA.z) : null;
  const sr = r.series;
  const kL = sr?.kneeL ? Math.max(...sr.kneeL.slice(i0, i1 + 1)) : null, kR = sr?.kneeR ? Math.max(...sr.kneeR.slice(i0, i1 + 1)) : null;
  return { base, baseRatio: base / heightM(), steps, stepT, split, transfer, kneeL: kL, kneeR: kR, source: 'estimation' };
}
// Module jeu de jambes (footwork.js) sur toute la vidéo (ou sur la frappe pour la démo), mémorisé par séance
function fwModule(s) {
  if (!has('footwork', 'analyzeFootwork')) return null;
  const sess = S.session; if (!sess) return null;
  const whole = sess.all?.length > 20;
  const host = whole ? sess : s.res;
  return memo(host, `fwm:${sess.court ? 'cal' : 'nocal'}:${S.profile.height}`, () => {
    const frames = whole ? sess.all : s.frames;
    const strokes = (whole ? sess.strokes : [s]).map((x) => ({ t: x.frames[x.res.impact].t, type: analyzable(x.type) }));
    const aspect = sess.quality?.width && sess.quality?.height ? sess.quality.width / sess.quality.height : sess.still ? sess.still.width / sess.still.height : 16 / 9;
    return M.footwork.analyzeFootwork(frames, { cal: sess.court || null, heightM: heightM(), aspect, strokes });
  });
}
export function footworkOf(s = cur()) {
  if (!s) return null;
  return memo(s.res, `fw:${S.session?.court ? 1 : 0}`, () => {
    const fb = fwFallback(s);
    const m = fwModule(s);
    const tI = s.frames[s.res.impact].t;
    const ps = m?.perStroke?.find((x) => Math.abs(x.t - tI) < 0.05 && x.ok) || null;
    const sp = m?.splitSteps?.filter((x) => x.t <= tI && x.t >= tI - 1.6).pop() || null;
    const d = dynOf(s);
    // Répartition gauche / droite de l'appui pendant la charge (dynamique inverse)
    let grfLR = null;
    if (d?.series?.grf?.left && d.series.grf.right) {
      const i0 = s.res.phases[1]?.i0 ?? 0, i1 = s.res.impact;
      const l = mean(d.series.grf.left.slice(i0, i1 + 1)), rr = mean(d.series.grf.right.slice(i0, i1 + 1));
      if (l + rr > 0) grfLR = { left: l / (l + rr), right: rr / (l + rr) };
    }
    return {
      ...fb,
      split: sp ? sp.t - tI : m ? null : fb.split, splitInfo: sp, perStroke: ps,
      comDistance: m?.com?.distanceM ?? null, comMaxSpeed: m?.com?.maxSpeed ?? null,
      planar: m?.planar ?? true, asym: m?.asymmetry || null, conf: m?.conf ?? null,
      grfLR, module: m ? 'footwork.js' : null,
      source: S.session?.source === 'demo' ? 'demo' : m ? (m.planar ? 'estimation' : 'mesure') : 'estimation',
    };
  });
}
// Asymétries sur la séance : coup droit contre revers, appuis gauche / droite
export function asymmetries() {
  const st = S.session?.strokes || [];
  const by = (t) => st.filter((s) => analyzable(s.type) === t);
  const fh = by('forehand'), bh = by('backhand');
  const out = [];
  const m = (list, fn) => { const v = list.map(fn).filter(Number.isFinite); return v.length ? mean(v) : null; };
  if (fh.length && bh.length) {
    out.push({ label: 'Vitesse de raquette', a: 'Coup droit', b: 'Revers', va: m(fh, (s) => s.res.metrics.racketSpeed * 3.6), vb: m(bh, (s) => s.res.metrics.racketSpeed * 3.6), unit: 'km/h' });
    out.push({ label: 'Score du geste', a: 'Coup droit', b: 'Revers', va: m(fh, (s) => s.res.score), vb: m(bh, (s) => s.res.score), unit: '/100' });
    out.push({ label: 'Flexion des genoux', a: 'Coup droit', b: 'Revers', va: m(fh, (s) => s.res.metrics.kneeFlex), vb: m(bh, (s) => s.res.metrics.kneeFlex), unit: '°' });
  }
  const fw = st.map((s) => footworkOf(s)).filter(Boolean);
  const kl = m(fw, (x) => x.kneeL), kr = m(fw, (x) => x.kneeR);
  if (kl != null && kr != null) out.push({ label: 'Flexion max. des genoux', a: 'Gauche', b: 'Droite', va: kl, vb: kr, unit: '°' });
  const gl = m(fw, (x) => x.grfLR?.left), gr = m(fw, (x) => x.grfLR?.right);
  if (gl != null && gr != null) out.push({ label: 'Appui pendant la charge', a: 'Gauche', b: 'Droite', va: gl * 100, vb: gr * 100, unit: '%' });
  return out.map((x) => ({ ...x, gapPct: x.va != null && x.vb != null ? (Math.abs(x.va - x.vb) / Math.max(1e-6, (Math.abs(x.va) + Math.abs(x.vb)) / 2)) * 100 : null }));
}

// ---------- Statistiques de balle ----------
// Points de rebond au sol (m, repère court : x en travers, y le long, y > 0 côté adverse) et effets
function seeded(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(rnd) { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }
export function ballStats(stroke) {
  const sess = S.session; if (!sess) return null;
  const list = sess.strokes.filter((s) => analyzable(s.type) === stroke);
  return memo(sess, `bs:${stroke}:${S.profile.level}:${S.profile.height}:${S.opt.status}:${sess.court ? 1 : 0}`, () => {
    const Pm = M.physics; if (!list.length) return null;
    // Effet mesuré : ajustement du modèle de vol sur les points de balle suivis après l'impact
    const measured = [];
    if (has('ballstats', 'spinFromTrajectory')) for (const s of list) {
      const pts = s.ball?.points; if (!pts || pts.length < 5) continue;
      try { const r = M.ballstats.spinFromTrajectory(pts.map((p) => ({ t: p.t, X: p.X, Y: p.Y })), { yIsHeight: false }); if (r && Number.isFinite(r.spinRpm) && r.conf > 0.2) measured.push(r.spinRpm); } catch (e) { /* rien */ }
    }
    // Rebonds : observés si le suivi de balle les donne avec un court calibré, sinon frappes rejouées (simulées)
    const obs = [];
    if (sess.court) for (const s of list) for (const b of s.ball?.bounces || []) if (b && Number.isFinite(b.x)) obs.push({ img: { x: b.x, y: b.y }, t: b.t });
    let bounces = [], source = sess.source === 'demo' ? 'demo' : 'simulation';
    const spins = [];
    if (obs.length >= 3) { bounces = obs; source = 'mesure'; }
    else if (Pm) {
      const disp = DISP[S.profile.level] || DISP.competition;
      const rnd = seeded(list.length * 7919 + stroke.length);
      for (const s of list) {
        const kmh = s.ball?.speedKmh ?? s.res.metrics.ballSpeedKmh ?? 120;
        const se = spinEstimate(s.type, s.res.metrics.racketSpeed);
        const spin = Number.isFinite(se?.im?.spinRpm) ? se.im.spinRpm : stroke === 'serve' ? 1800 : 2200;
        const h0 = stroke === 'serve' ? Math.max(2.2, (s.res.metrics.contactRatio || 1.4) * heightM()) : 0.95;
        const lw = typeof Pm.launchWindow === 'function' ? Pm.launchWindow({ v: kmh / 3.6, spinRpm: spin, h0, target: stroke === 'serve' ? 'service' : 'base' }) : null;
        const la = lw && Number.isFinite(lw.lo) && Number.isFinite(lw.hi) ? (lw.lo + lw.hi) / 2 : stroke === 'serve' ? -4 : 6;
        for (let k = 0; k < 6; k++) {
          const v = kmh / 3.6 * (1 + gauss(rnd) * disp.speed), a = la + gauss(rnd) * disp.angle, sp = spin * (1 + gauss(rnd) * disp.spin);
          const tr = Pm.flightFast ? Pm.flightFast({ v, launch: a, spinRpm: sp, h0 }) : null;
          const bx = tr?.bounce?.x;
          if (!Number.isFinite(bx)) continue;
          const side = (stroke === 'serve' ? 1.8 : 0) + gauss(rnd) * (0.9 + disp.angle * 0.6);
          bounces.push({ x: side, y: bx - Pm.COURT.net, sim: true });
          spins.push(sp);
        }
      }
    }
    let map = null;
    if (has('ballstats', 'bounceMap')) { try { map = M.ballstats.bounceMap(bounces, { cal: sess.court || null, side: 'far' }); } catch (e) { map = null; } }
    const pts = map?.points || bounces;
    const el = map?.ellipse95 ? { cx: map.ellipse95.cx, cy: map.ellipse95.cy, rx: map.ellipse95.a, ry: map.ellipse95.b, angle: map.ellipse95.angleDeg * Math.PI / 180 } : ellipseOf(pts);
    return {
      bounces: pts.map((p) => ({ ...p, sim: source !== 'mesure' })), ellipse: el, map,
      spinRpm: measured.length ? mean(measured) : spins.length ? mean(spins) : null, spinFrom: measured.length ? 'mesure' : 'estimation', spinN: measured.length,
      source, module: map ? 'ballstats.js' : null, n: list.length,
    };
  });
}
// Ellipse de dispersion à 95 % (χ² à 2 ddl = 5,991) des points {x, y}
export function ellipseOf(pts) {
  if (!pts || pts.length < 3) return null;
  const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const n = pts.length - 1; sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + d, l2 = Math.max(0, tr / 2 - d), k = Math.sqrt(5.991);
  return { cx: mx, cy: my, rx: k * Math.sqrt(l1), ry: k * Math.sqrt(l2), angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) };
}
export { clamp };
