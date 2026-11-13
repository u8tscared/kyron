// Tests vague 2 — analyse : court, raquette, jeu de jambes, effet et rebonds, match, hauteur de contact, démos.
// `node tests/wave2-analysis.test.mjs` (aucune dépendance ; images et scènes synthétiques).
import { calibrateCourt, calibrateManual, applyHomography, toGround, toImage, COURT_LINES, inCourt } from '../app/core/court.js';
import { createRacketTracker, analyzeRacket } from '../app/core/racket.js';
import { analyzeFootwork, footworkAsymmetry } from '../app/core/footwork.js';
import { spinFromTrajectory, spinFromBounce, bounceMap } from '../app/core/ballstats.js';
import { analyzeMatch, bouncesFromTrack, segmentPoints } from '../app/core/match.js';
import { flight } from '../app/core/physics.js';
import { analyze } from '../app/core/engine.js';
import { makeDemoServe, makeDemoForehand, makeDemoBackhand } from '../app/core/demo.js';

let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  const t0 = performance.now();
  try { const info = await fn(); pass++; results.push(`  ok   ${name}${info ? ` — ${info}` : ''} (${Math.round(performance.now() - t0)} ms)`); }
  catch (e) { fail++; results.push(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 2).join(' | ') || e.message}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const near = (v, ref, tol, what) => assert(Math.abs(v - ref) <= tol, `${what} = ${v} (attendu ${ref} ± ${tol})`);
const rng = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; };

// ---------------------------------------------------------------------------------- outils de scène
const sub = (a, b) => a.map((v, i) => v - b[i]), nz = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Caméra sténopé (repère court : X en travers, Y le long, Z haut) → projection en pixels et homographie sol → image.
function camera({ W = 640, H = 360, f = 520, cam = [0.5, -18.5, 5.5], look = [0, 1, 0] } = {}) {
  const fw = nz(sub(look, cam)), rt = nz(cross(fw, [0, 0, 1])), dn = cross(fw, rt);
  const px = (p) => { const d = sub(p, cam), z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2]; return { x: W / 2 + f * (d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2]) / z, y: H / 2 + f * (d[0] * dn[0] + d[1] * dn[1] + d[2] * dn[2]) / z }; };
  const R = [rt, dn, fw], t = R.map((r) => -(r[0] * cam[0] + r[1] * cam[1] + r[2] * cam[2]));
  const K = [[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]];
  const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => K[i][0] * [R[0][0], R[0][1], t[0]][j] + K[i][1] * [R[1][0], R[1][1], t[1]][j] + K[i][2] * [R[2][0], R[2][1], t[2]][j])).flat();
  return { W, H, f, px, norm: (p) => { const q = px(p); return { x: q.x / W, y: q.y / H }; }, Hg2i: M.map((v) => v / M[8]) };
}
function renderCourt(Hm, W, H, seed = 3) {
  const r = rng(seed), data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const n = r() * 16, sky = Math.floor(i / W) < H * 0.18; data[i * 4] = sky ? 190 + n : 50 + n; data[i * 4 + 1] = sky ? 200 + n : 110 + n; data[i * 4 + 2] = sky ? 215 + n : 90 + n; data[i * 4 + 3] = 255; }
  for (const [x1, y1, x2, y2] of COURT_LINES) {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 0.01);
    for (let k = 0; k <= n; k++) {
      const p = applyHomography(Hm, { x: x1 + (x2 - x1) * k / n, y: y1 + (y2 - y1) * k / n });
      for (let yy = Math.floor(p.y - 2); yy <= Math.ceil(p.y + 2); yy++) for (let xx = Math.floor(p.x - 2); xx <= Math.ceil(p.x + 2); xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const a = Math.max(0, Math.min(1, 1.3 - Math.hypot(xx - p.x, yy - p.y))), i = (yy * W + xx) * 4;
        for (let c = 0; c < 3; c++) data[i + c] = Math.max(data[i + c], data[i + c] * (1 - a) + 240 * a);
      }
    }
  }
  return { width: W, height: H, data };
}
function drawRacket(W, H, { cx, cy, theta, tilt, s, wrist }, r) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const n = r() * 14; data[i * 4] = 170 + n; data[i * 4 + 1] = 175 + n; data[i * 4 + 2] = 165 + n; data[i * 4 + 3] = 255; }
  const a = 0.17 * s, b = 0.13 * s * Math.cos(tilt), ca = Math.cos(theta), sa = Math.sin(theta), R = Math.ceil(a + 4);
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const dx = x - cx, dy = y - cy, u = (dx * ca + dy * sa) / a, v = (-dx * sa + dy * ca) / b, rr = Math.hypot(u, v), i = (y * W + x) * 4;
    if (Math.abs(rr - 1) * Math.min(a, b) < 1.4) { data[i] = 35; data[i + 1] = 35; data[i + 2] = 45; }
    else if (rr < 1 && (x + y) % 5 === 0) { data[i] = 200; data[i + 1] = 200; data[i + 2] = 200; }
  }
  const bx = cx - ca * a, by = cy - sa * a, L = Math.hypot(wrist.x - bx, wrist.y - by);
  for (let k = 0; k <= L; k += 0.5) { const x = Math.round(bx + (wrist.x - bx) * k / L), y = Math.round(by + (wrist.y - by) * k / L); for (let o = -1; o <= 1; o++) { const i = ((y + o) * W + x) * 4; if (i >= 0 && i < data.length) { data[i] = 30; data[i + 1] = 30; data[i + 2] = 30; } } }
  return { width: W, height: H, data };
}

// ---------------------------------------------------------------------------------- court
await test('calibrateCourt : lignes projetées par une homographie connue → homographie et caméra retrouvées', () => {
  const cam = camera(), img = renderCourt(cam.Hg2i, cam.W, cam.H);
  const cal = calibrateCourt(img);
  assert(cal, 'aucune calibration');
  let e = 0;
  for (const [x, y] of [[-4.115, -11.885], [4.115, -11.885], [4.115, 11.885], [-4.115, 11.885], [0, 6.4], [-5.485, 11.885], [5.485, -11.885]]) {
    const a = applyHomography(cam.Hg2i, { x, y }), b = applyHomography(cal.Hinv, { x, y });
    e = Math.max(e, Math.hypot(a.x - b.x, a.y - b.y));
  }
  assert(e < 6, `reprojection max ${e.toFixed(2)} px`);
  const g = toGround(cal, cam.norm([1.2, -8, 0]));
  near(Math.hypot(g.x - 1.2, g.y + 8), 0, 0.1, 'pied projeté au sol (écart, m)');
  near(cal.camera.heightM, 5.5, 1.2, 'hauteur caméra (m)');
  return `reproj max ${e.toFixed(2)} px, pied ±${Math.hypot(g.x - 1.2, g.y + 8).toFixed(3)} m, f ${cal.camera.f.toFixed(0)} (vrai 520), h ${cal.camera.heightM.toFixed(2)} m, conf ${cal.conf}`;
});

await test('calibrateManual : 4 coins cliqués → aller-retour image ↔ sol exact ; image sans court → null', () => {
  const cam = camera({ cam: [-1, -19, 4.5] });
  const pts = [[-4.115, -11.885], [4.115, -11.885], [4.115, 11.885], [-4.115, 11.885]].map(([x, y]) => cam.norm([x, y, 0]));
  const cal = calibrateManual(pts, { width: cam.W, height: cam.H });
  const g = toGround(cal, cam.norm([2, 3, 0])), back = toImage(cal, { x: 2, y: 3 }), ref = cam.norm([2, 3, 0]);
  near(Math.hypot(g.x - 2, g.y - 3), 0, 1e-6, 'sol');
  near(Math.hypot((back.x - ref.x) * cam.W, (back.y - ref.y) * cam.H), 0, 1e-6, 'image (px)');
  assert(inCourt(g) && !inCourt({ x: 5, y: 0 }) && inCourt({ x: 5, y: 0 }, { doubles: true }), 'inCourt');
  const r = rng(9), blank = { width: 320, height: 180, data: new Uint8ClampedArray(320 * 180 * 4).map((_, i) => (i % 4 === 3 ? 255 : 90 + r() * 20)) };
  assert(calibrateCourt(blank) === null, 'image vide calibrée');
  return 'erreur < 1e-6';
});

// ---------------------------------------------------------------------------------- raquette
await test('createRacketTracker : ellipse dessinée suivie (centre, inclinaison, vitesse) et analyse d\'impact', () => {
  const W = 480, H = 320, fps = 120, s = 160 / 1.62, r = rng(4);
  const tr = createRacketTracker({ width: W, height: H, heightM: 1.8 });
  const truth = [];
  let ms = 0;
  for (let k = 0; k < 12; k++) {
    const t = k / fps, theta = -0.3 + 0.05 * k, wrist = { x: 150 + 300 * t, y: 220 - 100 * t };
    const dist = 0.43 * s, cx = wrist.x + Math.cos(theta) * dist, cy = wrist.y + Math.sin(theta) * dist;
    truth.push({ t, cx, cy });
    const img = drawRacket(W, H, { cx, cy, theta, tilt: 0.6, s, wrist }, r);
    const elbow = { x: wrist.x - Math.cos(theta) * 0.27 * s, y: wrist.y - Math.sin(theta) * 0.27 * s };
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 1 }));
    lm[0] = { x: 0.3, y: 0.3, v: 1 }; lm[27] = { x: 0.3, y: 0.3 + 160 / H, v: 1 }; lm[28] = lm[27];
    lm[16] = { x: wrist.x / W, y: wrist.y / H, v: 1 }; lm[14] = { x: elbow.x / W, y: elbow.y / H, v: 1 };
    const t0 = performance.now();
    tr.push(t, img, { img: lm, world: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 })) });
    ms += performance.now() - t0;
  }
  const res = tr.result();
  let e = 0;
  for (const f of res.frames) { const g = truth.find((q) => q.t === f.t); assert(f.source === 'image', `image ${f.t} : ${f.source}`); e = Math.max(e, Math.hypot(f.px - g.cx, f.py - g.cy)); }
  assert(e < 2, `centre : erreur max ${e.toFixed(2)} px`);
  const mid = res.frames[6];
  const tilt = Math.acos(Math.min(1, mid.b / (mid.a * 0.13 / 0.17))) * 180 / Math.PI;
  near(tilt, 34.4, 8, 'inclinaison du tamis (°)');
  const a = analyzeRacket(res, null, { tImpact: 6 / fps });
  assert(a && Number.isFinite(a.headSpeedKmh) && Number.isFinite(a.faceAngleDeg) && Number.isFinite(a.pathAngleDeg), 'analyse incomplète');
  return `centre ≤ ${e.toFixed(2)} px, inclinaison ${tilt.toFixed(0)}° (vrai 34°), tête ${a.headSpeedKmh} km/h, face ${a.faceAngleDeg}°, trajectoire ${a.pathAngleDeg}°, ${(ms / 12).toFixed(1)} ms/image`;
});

// ---------------------------------------------------------------------------------- jeu de jambes
const sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
function footworkScene({ fps = 60, T = 3, Y = -12.5 } = {}) {
  const cam = camera({ W: 1280, H: 720, f: 1000, cam: [0, -20, 4], look: [0, -8, 0] });
  const frames = [];
  for (let i = 0; i <= T * fps; i++) {
    const t = i / fps;
    const z = t > 1.0 && t < 1.25 ? Math.sin(Math.PI * (t - 1.0) / 0.25) * 0.06 : 0; // split-step : 6 cm, 250 ms
    const rx = 0.25 + 0.7 * sm((t - 1.4) / 0.25), lx = -0.25 + 0.8 * sm((t - 1.75) / 0.25); // pas chassé à droite
    const rL = t > 1.4 && t < 1.65 ? 0.06 * Math.sin(Math.PI * (t - 1.4) / 0.25) : 0, lL = t > 1.75 && t < 2.0 ? 0.06 * Math.sin(Math.PI * (t - 1.75) / 0.25) : 0;
    const cx = (rx + lx) / 2;
    const P = new Array(33).fill(null).map(() => [cx, Y, 1.3 + z]);
    P[0] = [cx, Y + 0.08, 1.68 + z]; P[11] = [cx - 0.19, Y, 1.45 + z]; P[12] = [cx + 0.19, Y, 1.45 + z];
    P[23] = [cx - 0.14, Y, 0.95 + z]; P[24] = [cx + 0.14, Y, 0.95 + z];
    const foot = (x, lift) => [[x, Y, 0.08 + lift + z], [x, Y - 0.05, 0.03 + lift + z], [x, Y + 0.15, 0.02 + lift + z]];
    [P[27], P[29], P[31]] = foot(lx, lL); [P[28], P[30], P[32]] = foot(rx, rL);
    frames.push({ t, img: P.map((p) => ({ ...cam.norm(p), v: 0.95 })) });
  }
  const cal = calibrateManual([[-4.115, -11.885], [4.115, -11.885], [4.115, 11.885], [-4.115, 11.885]].map(([x, y]) => cam.norm([x, y, 0])), { width: cam.W, height: cam.H });
  return { frames, cal };
}
await test('analyzeFootwork : split-step, premier pas, réaction, déplacement du CM (court calibré et sans)', () => {
  const { frames, cal } = footworkScene();
  const r = analyzeFootwork(frames, { cal, cues: [1.15], heightM: 1.8, strokes: [{ t: 2.4, type: 'forehand' }] });
  assert(r.splitSteps.length === 1, `${r.splitSteps.length} split-steps`);
  const s = r.splitSteps[0];
  near(s.t, 1.0, 0.05, 'décollage (s)'); near(s.tLand, 1.25, 0.04, 'réception (s)'); near(s.heightM, 0.06, 0.025, 'hauteur (m)');
  assert(s.firstStep && s.firstStep.foot === 'droit' && s.firstStep.direction === 'droite' && !s.firstStep.falseStep, `premier pas ${JSON.stringify(s.firstStep)}`);
  near(s.firstStep.t, 1.4, 0.06, 'premier pas (s)'); near(s.firstStep.reactionMs, 250, 60, 'réaction (ms)');
  near(r.perStroke[0].amplitudeM, 0.75, 0.1, 'déplacement latéral avant la frappe (m)');
  assert(r.perStroke[0].side === 'droite' && r.contacts.length >= 4, 'côté / appuis');
  const r2 = analyzeFootwork(frames, { cues: [1.15], heightM: 1.8 });
  assert(r2.planar && r2.splitSteps.length === 1 && r2.splitSteps[0].firstStep?.direction === 'droite', 'sans calibration');
  return `split ${s.t.toFixed(2)}→${s.tLand.toFixed(2)} s (vrai 1,00→1,25), ${Math.round(s.heightM * 100)} cm, 1er pas ${s.firstStep.foot} vers la ${s.firstStep.direction} à ${s.firstStep.t.toFixed(2)} s (vrai 1,40), réaction ${s.firstStep.reactionMs} ms (vrai 250), CM ${r.com.distanceM} m, vmax ${r.com.maxSpeed} m/s ; sans calibration : réaction ${r2.splitSteps[0].firstStep.reactionMs} ms`;
});

await test('footworkAsymmetry : déplacements plus lents vers la gauche et appuis déséquilibrés → alertes', () => {
  const per = [];
  for (let i = 0; i < 4; i++) per.push({ ok: true, type: 'forehand', side: 'droite', amplitudeM: 1.5, peakSpeed: 3.6, support: 'R' });
  for (let i = 0; i < 4; i++) per.push({ ok: true, type: 'backhand', side: 'gauche', amplitudeM: 1.4, peakSpeed: 2.6, support: 'R' });
  const a = footworkAsymmetry(per);
  assert(a.moves.speed > 15 && a.alerts.some((x) => x.key === 'moves') && a.alerts.some((x) => x.key === 'strokes') && a.alerts.some((x) => x.key === 'supports'), JSON.stringify(a));
  const b = footworkAsymmetry(per.map((p) => ({ ...p, peakSpeed: 3, support: p.side === 'droite' ? 'R' : 'L' })));
  assert(b.alerts.length === 0, 'faux positif');
  return `vitesse droite/gauche ${a.moves.speed > 0 ? '+' : ''}${a.moves.speed} % ; ${a.alerts.map((x) => x.text).join(' | ')}`;
});

// ---------------------------------------------------------------------------------- effet et rebonds
await test('spinFromTrajectory : effet retrouvé par la courbure (modèle physics.js, bruit 2 cm)', () => {
  const r = rng(5), out = [];
  for (const [v, la, sp] of [[30, 8, 2500], [28, 4, -1500], [35, 3, 0]]) {
    const f = flight({ v, launch: la, spinRpm: sp, h0: 1.0, dt: 0.001 });
    const pts = [];
    for (let k = 0; k / 120 < Math.min(0.6, f.bounce.t - 0.02); k++) { const i = Math.round(k * 1000 / 120); pts.push({ t: i / 1000, x: f.pts[i][0] + r() * 0.04, y: f.pts[i][1] + r() * 0.04 }); }
    const e = spinFromTrajectory(pts);
    near(e.spinRpm, sp, 450, `effet (${sp} tr/min)`); near(e.speedKmh, v * 3.6, 5, 'vitesse (km/h)');
    assert(e.type === (sp > 400 ? 'lift' : sp < -400 ? 'slice' : 'à plat'), `type ${e.type}`);
    out.push(`${sp} → ${e.spinRpm} tr/min`);
  }
  return out.join(', ');
});

await test('spinFromBounce : effet à l\'arrivée par l\'angle de rebond (roulement), borne en glissement', () => {
  const f = flight({ v: 25, launch: 12, spinRpm: 3500, h0: 1, dt: 0.001 });
  const b = f.bounce, a = f.after;
  const e = spinFromBounce({ inSpeed: Math.hypot(b.vx, b.vy), inAngleDeg: Math.atan2(-b.vy, b.vx) * 180 / Math.PI, outSpeed: Math.hypot(a.vx, a.vy), outAngleDeg: a.angle });
  assert(e.regime === 'roulement', e.regime);
  near(e.spinRpm, 3350, 250, 'effet au rebond (tr/min)');
  const e2 = spinFromBounce({ inSpeed: Math.hypot(b.vx, b.vy), inAngleDeg: Math.atan2(-b.vy, b.vx) * 180 / Math.PI, outVx: a.vx, bounceHeight: a.peak });
  near(e2.spinRpm, e.spinRpm, 30, 'variante apogée du rebond');
  const g = flight({ v: 35, launch: 3, spinRpm: 0, h0: 1, dt: 0.001 });
  const e3 = spinFromBounce({ inSpeed: Math.hypot(g.bounce.vx, g.bounce.vy), inAngleDeg: Math.atan2(-g.bounce.vy, g.bounce.vx) * 180 / Math.PI, outSpeed: g.after.kmh / 3.6, outAngleDeg: g.after.angle });
  assert(e3.regime === 'glissement' && e3.spinRpm === null && e3.maxRpm > 0, JSON.stringify(e3));
  return `${e.spinRpm} tr/min (lancé à 3500, décroissance en vol), balle plate : glissement, effet < ${e3.maxRpm} tr/min`;
});

await test('bounceMap : ellipse 95 % d\'un nuage gaussien connu, profondeur moyenne, zones', () => {
  const r = rng(21), g = () => { let s = 0; for (let i = 0; i < 12; i++) s += r(); return s; }; // ≈ N(0, 1)
  const B = [];
  for (let i = 0; i < 2000; i++) { const u = g() * 1.2, v = g() * 0.5; const c = Math.cos(0.5), s = Math.sin(0.5); B.push({ x: 1 + u * c - v * s, y: 8 + u * s + v * c }); }
  const m = bounceMap(B, { side: 'far' });
  near(m.ellipse95.a, 1.2 * Math.sqrt(5.991), 0.15, 'demi-grand axe (m)'); near(m.ellipse95.b, 0.5 * Math.sqrt(5.991), 0.08, 'demi-petit axe (m)');
  near(m.ellipse95.angleDeg, 0.5 * 180 / Math.PI, 3, 'orientation (°)');
  near(m.meanDepthM, 11.885 - 8, 0.1, 'profondeur moyenne depuis la ligne de fond (m)');
  const inside = B.filter((p) => { const e = m.ellipse95, c = Math.cos(e.angleDeg * Math.PI / 180), s = Math.sin(e.angleDeg * Math.PI / 180), dx = p.x - e.cx, dy = p.y - e.cy; return ((dx * c + dy * s) / e.a) ** 2 + ((-dx * s + dy * c) / e.b) ** 2 <= 1; }).length / B.length;
  near(inside, 0.95, 0.02, 'part dans l\'ellipse');
  return `a ${m.ellipse95.a} m, b ${m.ellipse95.b} m, ${m.ellipse95.angleDeg}°, ${(inside * 100).toFixed(1)} % dedans, profondeur ${m.meanDepthM} m, zones ${JSON.stringify(m.zones)}`;
});

// ---------------------------------------------------------------------------------- match
await test('bouncesFromTrack : rebond d\'une balle projetée par la caméra retrouvé au sol', () => {
  const cam = camera({ W: 1280, H: 720, f: 1000, cam: [0, -20, 4], look: [0, -2, 0] });
  const cal = calibrateManual([[-4.115, -11.885], [4.115, -11.885], [4.115, 11.885], [-4.115, 11.885]].map(([x, y]) => cam.norm([x, y, 0])), { width: cam.W, height: cam.H });
  const f = flight({ v: 30, launch: 6, spinRpm: 2000, h0: 1, dt: 1 / 600 });
  const track = [];
  for (let i = 0; i < f.pts.length; i += 10) { const [x, y] = f.pts[i]; track.push({ t: i / 600, ...cam.norm([0.5 + 0.05 * x, -11.885 + x, Math.max(0.0335, y) - 0.0335]) }); }
  const b = bouncesFromTrack(track, { cal });
  assert(b.length >= 1, 'aucun rebond');
  near(b[0].y, -11.885 + f.bounce.x, 0.35, 'rebond Y (m)'); near(b[0].t, f.bounce.t, 0.03, 'instant (s)');
  return `rebond à Y ${b[0].y.toFixed(2)} m (vrai ${(-11.885 + f.bounce.x).toFixed(2)}), t ${b[0].t.toFixed(3)} s (vrai ${f.bounce.t.toFixed(3)})`;
});

await test('analyzeMatch : points, première balle, frappes par type, séquences, profil adverse, carte de chaleur', () => {
  const S = [], B = [], pos = [];
  let t = 0;
  const pt = (spec) => { // spec : liste d'évènements relatifs
    for (const e of spec) { if (e.s) S.push({ t: t + e.dt, type: e.s, conf: 0.8 }); if (e.b) B.push({ t: t + e.dt, x: e.b[0], y: e.b[1] }); }
    t += 25;
  };
  // 1 : service (faute longue), 2e service dedans, échange CD gagnant
  pt([{ dt: 0, s: 'serve' }, { dt: 0.6, b: [-2, 8] }, { dt: 9, s: 'serve' }, { dt: 9.6, b: [-2, 5] }, { dt: 10.5, b: [3, -9] }, { dt: 11.2, s: 'forehand' }, { dt: 12, b: [2, 9] }]);
  // 2 : première dedans, revers, coup droit dehors (perdu)
  pt([{ dt: 0, s: 'serve' }, { dt: 0.6, b: [2, 4] }, { dt: 1.5, b: [-3, -10] }, { dt: 2.2, s: 'backhand' }, { dt: 3, b: [0, 8] }, { dt: 4, b: [2.8, -9] }, { dt: 4.7, s: 'forehand' }, { dt: 5.5, b: [1, 13] }]);
  // 3 : première dedans, coup droit gagnant
  pt([{ dt: 0, s: 'serve' }, { dt: 0.6, b: [-2, 5] }, { dt: 1.5, b: [3.2, -8] }, { dt: 2.2, s: 'forehand' }, { dt: 3, b: [-3, 10] }]);
  // 4 : double faute
  pt([{ dt: 0, s: 'serve' }, { dt: 0.6, b: [2, 7.5] }, { dt: 8, s: 'serve' }, { dt: 8.6, b: [2.5, 7] }]);
  for (let k = 0; k < 400; k++) pos.push({ t: k * 0.25, x: Math.sin(k / 9) * 2, y: -12.3 + 0.4 * Math.cos(k / 7) });
  const m = analyzeMatch({ strokes: S, bounces: B, positions: pos, serverX: 1 });
  const sm2 = m.summary;
  assert(sm2.points === 4, `${sm2.points} points`);
  assert(sm2.servePoints === 4 && sm2.firstServePct === 50 && sm2.doubleFaults === 1, `services ${JSON.stringify(sm2)}`);
  assert(sm2.byType.serve === 6 && sm2.byType.forehand === 3 && sm2.byType.backhand === 1, `types ${JSON.stringify(sm2.byType)}`);
  assert(m.points.map((p) => p.outcome).join(',') === 'gagné,perdu,gagné,perdu', `issues ${m.points.map((p) => p.outcome)}`);
  const sf = m.sequences.find((s) => s.key === 'serve>forehand');
  assert(sf && sf.count === 2 && sf.successPct === 100, `séquence ${JSON.stringify(sf)}`);
  assert(m.opponent.favourite === 'droite' && m.opponent.shots === 4, `adversaire ${JSON.stringify(m.opponent)}`);
  assert(m.heatmap && Math.abs(m.heatmap.share.reduce((a, v) => a + v, 0) - 1) < 1e-3 && m.heatmap.behindBaselinePct > 50, 'carte de chaleur');
  const seg = segmentPoints({ strokes: [{ t: 0, type: 'serve' }, { t: 3, type: 'serve' }, { t: 4, type: 'forehand' }] });
  assert(seg.length === 1 && seg[0].fault1 && seg[0].strokes.length === 2, 'faute + 2e balle sans pause');
  return `${sm2.points} points, 1re balle ${sm2.firstServePct} %, ${sm2.doubleFaults} double faute, issues ${m.points.map((p) => p.outcome).join('/')}, « ${sf.label} » ${sf.count}× (${sf.successPct} %), adversaire → ${m.opponent.favourite} (${JSON.stringify(m.opponent.direction)})`;
});

// ---------------------------------------------------------------------------------- moteur et démos
await test('contactRatio du service rapporté au sol quand le saut est mesuré (ancienne valeur conservée)', () => {
  const res = analyze(makeDemoServe(), { stroke: 'serve', hand: 'right', source: 'demo' });
  const m = res.metrics;
  assert(res.contactRef === 'ground' && Number.isFinite(m.contactRatioFeet) && m.jumpHeight > 0.03, `réf ${res.contactRef}, saut ${m.jumpHeight}`);
  near(m.contactRatio - m.contactRatioFeet, m.jumpHeight / m.height, 1e-9, 'écart = saut / taille');
  const fh = analyze(makeDemoForehand(), { stroke: 'forehand', hand: 'right', source: 'demo' });
  assert(fh.metrics.contactRatio === null && fh.contactRef === null, 'coup droit : pas de ratio');
  return `${m.contactRatioFeet.toFixed(3)} (chevilles) → ${m.contactRatio.toFixed(3)} (sol), saut ${(m.jumpHeight * 100).toFixed(1)} cm`;
});

await test('démos : accompagnement progressif (le poignet garde > 40 % de sa vitesse 50 ms après l\'impact)', async () => {
  const out = [];
  let dyn = null;
  try { dyn = await import('../app/core/dynamics.js'); } catch { /* module de l'agent simulation absent */ }
  for (const [k, mk] of [['serve', makeDemoServe], ['forehand', makeDemoForehand], ['backhand', makeDemoBackhand]]) {
    const f = mk(), res = analyze(f, { stroke: k, hand: 'right', source: 'demo' });
    const v = (i) => { const a = f[i].world[16], b = f[i + 1].world[16]; return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 120; };
    const vi = Math.max(v(res.impact - 1), v(res.impact)), v50 = v(res.impact + 6), v150 = v(res.impact + 18);
    assert(v50 > 0.4 * vi && v150 < 0.6 * vi, `${k} : ${vi.toFixed(1)} → ${v50.toFixed(1)} (50 ms) → ${v150.toFixed(1)} m/s (150 ms)`);
    let extra = '';
    if (dyn?.inverseDynamics) {
      const d = dyn.inverseDynamics(f, res, { heightM: 1.85, massKg: 78 });
      extra = `, RI ${d.peaks.shoulderIR.value.toFixed(0)} N·m, L5/S1 ${d.peaks.lumbar.value.toFixed(0)} N·m, genou ${d.peaks.knee.value.toFixed(0)} N·m`;
    }
    out.push(`${k} ${vi.toFixed(1)} → ${v50.toFixed(1)} → ${v150.toFixed(1)} m/s${extra}`);
  }
  return out.join(' ; ');
});

console.log('Tests vague 2 — analyse');
console.log(results.join('\n'));
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
