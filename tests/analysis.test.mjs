// Tests du moteur d'analyse KYRON — `node tests/analysis.test.mjs` (aucune dépendance).
import { analyze, detectStrokes, REFS, EXERCISES } from '../app/core/engine.js';
import { makeDemoServe, makeDemoForehand, makeDemoBackhand, makeDemoSession } from '../app/core/demo.js';
import { classifyStroke, qualityScore, analyzeSession } from '../app/core/session.js';
import { createBallTracker, estimateBallFlight } from '../app/core/ball.js';
import { syncByWrist, fuseViews } from '../app/core/sync.js';

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  const t0 = performance.now();
  try { const info = fn(); pass++; results.push(`  ok   ${name}${info ? ` — ${info}` : ''} (${Math.round(performance.now() - t0)} ms)`); }
  catch (e) { fail++; results.push(`  FAIL ${name}\n       ${e.message}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const near = (v, ref, tol, what) => assert(Math.abs(v - ref) <= tol, `${what} = ${v} (attendu ${ref} ± ${tol})`);
const inRange = (v, lo, hi, what) => assert(Number.isFinite(v) && v >= lo && v <= hi, `${what} = ${v} hors de [${lo}, ${hi}]`);

const demos = { serve: makeDemoServe(), forehand: makeDemoForehand(), backhand: makeDemoBackhand() };

// ---------------------------------------------------------------------------------------------- engine
test('demos : 120 i/s, 33 points, origine au bassin', () => {
  for (const [k, f] of Object.entries(demos)) {
    near((f.length - 1) / (f[f.length - 1].t - f[0].t), 120, 0.5, `${k} fps`);
    assert(f.every((x) => x.world.length === 33 && x.img.length === 33), `${k} : 33 points par image`);
    const h = f[10].world; near((h[23].x + h[24].x) / 2, 0, 0.01, `${k} centre des hanches x`);
  }
});

for (const stroke of ['serve', 'forehand', 'backhand']) {
  test(`analyze(${stroke}) : champs existants intacts et valeurs plausibles`, () => {
    const r = analyze(demos[stroke], { stroke, hand: 'right', source: 'demo' });
    for (const k of ['stroke', 'hand', 'fps', 'n', 'impact', 'phases', 'sequence', 'gaps', 'inOrder', 'metrics', 'items', 'score', 'findings', 'exercises', 'camera', 'series', 'simInput']) assert(k in r, `champ ${k} manquant`);
    assert(r.phases.length === 5 && r.sequence.length === 4 && r.gaps.length === 3, 'phases / séquence');
    inRange(r.score, 0, 100, 'score');
    const m = r.metrics;
    inRange(m.racketSpeed, 15, 55, 'vitesse de raquette (m/s)');
    inRange(m.height, 1.5, 2.1, 'taille');
    inRange(m.elbowImpact, 100, 180, 'coude impact');
    inRange(m.shoulderElev, 20, 140, 'élévation épaule');
    inRange(m.shoulderAbdH, -180, 60, 'abduction horizontale');
    inRange(m.comShift, 0, 0.8, 'transfert CM');
    inRange(m.balance, 0, 1, 'équilibre');
    inRange(r.confidence, 0.5, 1, 'confiance');
    assert(r.series.com.length === r.n && Number.isFinite(r.series.com[r.impact].y), 'series.com');
    assert(r.exercises.every((e) => e.name && e.check), 'exercices complets');
    assert(r.findings.every((f) => EXERCISES[f.exercise]), 'chaque constat pointe vers un exercice existant');
    if (stroke === 'serve') {
      inRange(m.shoulderRotExt, 130, 190, 'rotation externe à l’armé');
      inRange(m.shoulderIRVel, 800, 4000, 'pic de rotation interne (°/s)');
      inRange(m.shoulderElev, 85, 125, 'élévation à l’armé');
      inRange(m.tossApex, 2.3, 3.6, 'apogée du lancer (m)');
      inRange(m.tossForward, -0.2, 1, 'lancer devant le pied avant (m)');
      inRange(m.comShift, 0.15, 0.7, 'transfert CM au service');
      assert(r.toss && r.toss.method.startsWith('ballistic'), `méthode du lancer : ${r.toss?.method}`);
    }
    if (stroke === 'backhand') assert(m.shoulderRotExt === null && m.shoulderIRVel === null, 'rotation externe non définie au revers');
    return `score ${r.score}, raquette ${(m.racketSpeed * 3.6).toFixed(0)} km/h, confiance ${r.confidence}`
      + (stroke === 'serve' ? `, RE ${m.shoulderRotExt.toFixed(0)}°, RI ${Math.round(m.shoulderIRVel)} °/s, lancer ${m.tossApex.toFixed(2)} m / +${m.tossForward.toFixed(2)} m` : '')
      + `, CM +${(m.comShift * 100).toFixed(0)} cm, équilibre ${m.balance.toFixed(2)}`;
  });
}

test('analyze : gaucher (démo miroir) sans erreur et angles d’épaule identiques', () => {
  // Miroir x → −x et échange gauche/droite : un gaucher « parfait » de la démo de service.
  const swap = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31];
  const mir = demos.serve.map((f) => ({ t: f.t, world: swap.map((k) => ({ x: -f.world[k].x, y: f.world[k].y, z: f.world[k].z })), img: swap.map((k) => ({ x: 1 - f.img[k].x, y: f.img[k].y, v: f.img[k].v })) }));
  const a = analyze(demos.serve, { stroke: 'serve', hand: 'right' }), b = analyze(mir, { stroke: 'serve', hand: 'left' });
  near(b.metrics.shoulderRotExt, a.metrics.shoulderRotExt, 1, 'RE gaucher');
  near(b.metrics.shoulderElev, a.metrics.shoulderElev, 1, 'élévation gaucher');
  near(b.metrics.comShift, a.metrics.comShift, 0.02, 'transfert CM gaucher');
  assert(classifyStroke(mir, 'left').type === 'serve', 'classé service');
  return `RE ${b.metrics.shoulderRotExt.toFixed(1)}° vs ${a.metrics.shoulderRotExt.toFixed(1)}°`;
});

test('analyze : rejette une séquence trop courte', () => {
  let threw = false;
  try { analyze(demos.serve.slice(0, 8), { stroke: 'serve' }); } catch { threw = true; }
  assert(threw, 'devait lever une erreur');
});

test('REFS : chaque plage a lo < hi et une unité', () => {
  for (const s of Object.values(REFS)) for (const [k, r] of Object.entries(s)) assert(r.lo < r.hi && r.unit && r.label, k);
});

// --------------------------------------------------------------------------------------------- session
test('classifyStroke : service / coup droit / revers de la démo', () => {
  const out = [];
  for (const [k, f] of Object.entries(demos)) {
    const c = classifyStroke(f, 'right');
    assert(c.type === k, `${k} classé ${c.type}`);
    inRange(c.conf, 0.5, 1, `${k} conf`);
    out.push(`${k} ${c.conf}`);
  }
  return out.join(', ');
});

test('classifyStroke : volée (swing court) et smash (raquette armée tôt)', () => {
  // Volée : on garde le coup droit mais on écrase l'amplitude du poignet autour de l'impact.
  const fh = demos.forehand, iImp = fh.findIndex((f) => f.t >= 0.98);
  const volley = fh.map((f, i) => {
    const k = Math.min(1, Math.abs(i - iImp) / 60) * 0 + 0.3; // amplitude réduite à 30 %
    const ref = fh[iImp].world[16];
    const world = f.world.map((p, j) => (j === 16 || j === 18 || j === 20 || j === 22 || j === 14) ? { x: ref.x + (p.x - ref.x) * k, y: ref.y + (p.y - ref.y) * k, z: ref.z + (p.z - ref.z) * k } : p);
    return { ...f, world };
  });
  const v = classifyStroke(volley, 'right');
  assert(v.type === 'volley', `volée classée ${v.type}`);
  // Smash : poignet maintenu au-dessus de l'épaule pendant toute la préparation, pas de lancer.
  const sv = demos.serve;
  const smash = sv.map((f) => {
    const world = f.world.slice();
    if (f.t < 1.1) { world[16] = { ...world[16], y: Math.max(world[16].y, world[12].y + 0.3) }; world[15] = { ...world[15], y: world[11].y }; }
    return { ...f, world };
  });
  const s = classifyStroke(smash, 'right');
  assert(s.type === 'smash', `smash classé ${s.type}`);
  return `volée (${v.side}) ${v.conf}, smash ${s.conf}`;
});

test('qualityScore : prise propre vs prise dégradée', () => {
  const q = qualityScore(demos.serve, { width: 1920, height: 1080, duration: 1.9 });
  inRange(q.score, 85, 100, 'score démo');
  near(q.fps, 120, 1, 'cadence');
  // Dégradée : 30 i/s, une image sur cinq perdue, joueur petit et coupé, visibilité faible.
  const bad = demos.serve.filter((_, i) => i % 4 === 0).filter((_, i) => i % 5 !== 2)
    .map((f) => ({ ...f, img: f.img.map((p) => ({ x: 1.0 + (p.x - 0.5) * 0.5, y: 0.2 + p.y * 0.4, v: p.v * 0.6 })) }));
  const qb = qualityScore(bad, { width: 640, height: 360 });
  assert(qb.score < 40, `score dégradé ${qb.score}`);
  for (const k of ['fps', 'visibility', 'size', 'missing', 'framing']) assert(qb.issues.some((x) => x.key === k), `problème « ${k} » non signalé`);
  return `propre ${q.score}, dégradée ${qb.score} (${qb.issues.map((x) => x.key).join(', ')})`;
});

test('analyzeSession : nombre de frappes, types, fatigue', () => {
  const s = makeDemoSession();
  const r = analyzeSession(s, { hand: 'right', source: 'demo' });
  assert(r.summary.count === s.truth.length, `${r.summary.count} frappes trouvées, ${s.truth.length} attendues`);
  r.strokes.forEach((x, i) => {
    near(x.t, s.truth[i].t, 0.12, `instant frappe ${i + 1}`);
    assert(x.type === s.truth[i].type, `frappe ${i + 1} : ${x.type} au lieu de ${s.truth[i].type}`);
    assert(x.res && Number.isFinite(x.res.score), `frappe ${i + 1} non analysée (${x.error})`);
  });
  assert(r.fatigue.alert === true && r.fatigue.slopePct < -5, `fatigue ${r.fatigue.slopePct} %`);
  assert(r.summary.byType.serve === 4 && r.summary.byType.forehand === 4 && r.summary.byType.backhand === 2, 'byType');
  inRange(r.summary.meanScore, 1, 100, 'meanScore');
  // Sans fatigue : pas d'alerte.
  const r2 = analyzeSession(makeDemoSession({ fatiguePerStroke: 0 }), { hand: 'right', source: 'demo' });
  assert(!r2.fatigue.alert && Math.abs(r2.fatigue.slopePct) < 2, `séance sans fatigue : ${r2.fatigue.slopePct} %`);
  return `${r.summary.count} frappes, fatigue ${r.fatigue.slopePct} % (R² ${r.fatigue.r2}), sans fatigue ${r2.fatigue.slopePct} %`;
});

test('detectStrokes : séance vide ou immobile → aucune frappe', () => {
  assert(detectStrokes([], 'right').length === 0, 'vide');
  const still = demos.serve.slice(0, 40).map((f) => ({ ...f, world: demos.serve[0].world }));
  assert(detectStrokes(still, 'right').length === 0, 'immobile');
});

// ------------------------------------------------------------------------------------------------ sync
// Vue B synthétique : autre caméra (repère tourné de 70° autour de la verticale), autre cadence (100 i/s),
// horloge décalée, projection différente et bruit.
function otherView(frames, { shift, fps = 100, yawDeg = 70, noise = 0.004 }) {
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2 * noise; };
  const out = [];
  const T = frames[frames.length - 1].t;
  let j = 0;
  for (let tB = 0; tB + shift <= T; tB += 1 / fps) {
    const tA = tB + shift;
    if (tA < frames[0].t) continue;
    while (j < frames.length - 2 && frames[j + 1].t < tA) j++;
    const a = frames[j], b = frames[j + 1], w = (tA - a.t) / (b.t - a.t);
    const world = a.world.map((p, k) => {
      const q = { x: p.x + (b.world[k].x - p.x) * w, y: p.y + (b.world[k].y - p.y) * w, z: p.z + (b.world[k].z - p.z) * w };
      return { x: c * q.x + s * q.z + rnd(), y: q.y + rnd(), z: -s * q.x + c * q.z + rnd() };
    });
    const img = world.map((p) => ({ x: 0.5 + p.x * 0.25, y: 0.5 - p.y * 0.25, v: 0.9 }));
    out.push({ t: tB, world, img });
  }
  return out;
}

test('syncByWrist : retrouve un décalage connu à la sous-image près', () => {
  const A = makeDemoSession({ order: ['serve', 'forehand', 'backhand', 'serve'] });
  const shift = 1.2345; // tA = tB + 1,2345 s
  const B = otherView(A, { shift });
  const r = syncByWrist(A, B, 'right');
  near(r.offset, shift, 1 / 240, 'décalage (s)');
  assert(r.corr > 0.8, `corrélation ${r.corr}`);
  const r2 = syncByWrist(A, B, 'right', { mode: 'img' });
  near(r2.offset, shift, 1 / 120, 'décalage, image seule (s)');
  return `décalage ${r.offset.toFixed(4)} s (vrai ${shift}), erreur ${((r.offset - shift) * 1000).toFixed(2)} ms, corr ${r.corr}`;
});

test('fuseViews : rotation retrouvée, fusion proche de la vérité, profondeur meilleure qu’une vue', () => {
  const truth = makeDemoForehand();
  let seed = 9; const rnd = (a) => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2 * a; };
  // Vue A : bruit faible dans le plan (x, y), fort en profondeur (z). Vue B : idem dans son propre repère.
  const A = truth.map((f) => ({ t: f.t, img: f.img, world: f.world.map((p) => ({ x: p.x + rnd(0.005), y: p.y + rnd(0.005), z: p.z + rnd(0.06) })) }));
  const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
  const B = truth.map((f) => ({ t: f.t + 0.5, img: f.img, world: f.world.map((p) => { const x = c * p.x + s * p.z, z = -s * p.x + c * p.z; return { x: x + rnd(0.005), y: p.y + rnd(0.005), z: z + rnd(0.06) }; }) }));
  const fused = fuseViews(A, B, -0.5);
  assert(fused.length > truth.length * 0.95, `${fused.length} images fusionnées`);
  const err = (frames) => {
    let e = 0, k = 0;
    frames.forEach((f, i) => { const g = truth[Math.min(truth.length - 1, Math.round((f.t - truth[0].t) * 120))].world; f.world.forEach((p, j) => { if (j >= 11) { e += (p.z - g[j].z) ** 2; k++; } }); });
    return Math.sqrt(e / k);
  };
  const eA = err(A), eF = err(fused);
  assert(eF < eA * 0.5, `erreur de profondeur fusionnée ${eF.toFixed(3)} m vs vue A ${eA.toFixed(3)} m`);
  return `RMS profondeur : vue seule ${(eA * 100).toFixed(1)} cm → fusion ${(eF * 100).toFixed(1)} cm`;
});

// ------------------------------------------------------------------------------------------------ ball
// Images fabriquées à la main (RGBA) : fond texturé, objets jaunes parasites, balle anti-crénelée.
function makeImage(W, H, t, ball, rng) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, n = rng();
      // Court bleu-vert texturé, ligne blanche horizontale, ciel plus clair en haut.
      let r = 40 + n * 12, g = 95 + n * 12, b = 120 + n * 12;
      if (y < H * 0.25) { r = 150 + n * 8; g = 180 + n * 8; b = 210 + n * 8; }
      if (Math.abs(y - H * 0.8) < 1.5) { r = g = b = 235; }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const paint = (cx, cy, rad, col, soft = true) => {
    for (let y = Math.max(0, Math.floor(cy - rad - 2)); y <= Math.min(H - 1, Math.ceil(cy + rad + 2)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rad - 2)); x <= Math.min(W - 1, Math.ceil(cx + rad + 2)); x++) {
        const d = Math.hypot(x - cx, y - cy), a = soft ? Math.max(0, Math.min(1, rad + 0.5 - d)) : d <= rad ? 1 : 0;
        if (a <= 0) continue;
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - a) + col[c] * a;
      }
    }
  };
  const rect = (x0, y0, w, h, col) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; } };
  rect(30, 200, 14, 14, [220, 230, 60]);                         // panier de balles immobile (jaune)
  paint(400, 230, 3.5, [215, 235, 70]);                          // balle posée au sol, immobile
  rect(Math.round(200 + 40 * Math.sin(t * 3)), 120, 34, 56, [200, 220, 50]); // maillot jaune qui bouge (trop gros)
  if (ball) paint(ball.x, ball.y, ball.r, [214, 240, 66]);
  return { width: W, height: H, data };
}

test('createBallTracker : retrouve une balle synthétique, ignore les objets jaunes parasites', () => {
  const W = 480, H = 320, fps = 120;
  let seed = 5; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const tr = createBallTracker({ width: W, height: H });
  const truth = [];
  let ms = 0;
  for (let k = 0; k < 40; k++) {
    const t = k / fps;
    // Parabole en pixels : 1 m ≈ 96 px, balle à ≈ 120 km/h vers la gauche, légère montée puis chute.
    const u = Math.max(0, t - 0.05);
    const ball = t >= 0.05 && k < 36 ? { x: 420 - 33.3 * 96 * u, y: 150 - 4 * 96 * u + 0.5 * 9.81 * 96 * u * u, r: 3.2 } : null;
    if (ball && ball.x > 5) truth.push({ t, ...ball });
    const img = makeImage(W, H, t, ball && ball.x > 5 ? ball : null, rng);
    const t0 = performance.now(); tr.push(t, img); ms += performance.now() - t0;
  }
  const { track, fps: f } = tr.result();
  near(f, 120, 0.5, 'cadence');
  assert(track.length >= truth.length - 3, `${track.length} points suivis sur ${truth.length}`);
  let maxErr = 0;
  for (const p of track) {
    const g = truth.find((q) => Math.abs(q.t - p.t) < 1e-6);
    assert(g, `point parasite à t = ${p.t.toFixed(3)} (${p.px.toFixed(0)}, ${p.py.toFixed(0)})`);
    maxErr = Math.max(maxErr, Math.hypot(p.px - g.x, p.py - g.y));
  }
  assert(maxErr < 1.5, `erreur max ${maxErr.toFixed(2)} px`);
  return `${track.length}/${truth.length} points, erreur max ${maxErr.toFixed(2)} px, ${(ms / 40).toFixed(2)} ms/image`;
});

test('estimateBallFlight : vitesse et angle retrouvés sur une frappe de démo', () => {
  // Service de démo (image 480 × 320, rapport 1,5 cohérent avec la projection de la démo).
  const res = analyze(demos.serve, { stroke: 'serve', hand: 'right', source: 'demo' });
  const W = 480, H = 320, fps = 120, tImp = res.series.t[res.impact];
  const v = 150 / 3.6, ang = -6 * Math.PI / 180;
  const mH = res.imgRef.mPerImgH, aspect = W / H;
  const start = { X: res.imgRef.wristImg.x * aspect * mH - 0.3, Y: -res.imgRef.wristImg.y * mH + 0.4 };
  // Balle simulée avec traînée quadratique (10 sous-pas par image), projetée dans l'image, puis suivie.
  const sim = [];
  let X = start.X, Y = start.Y, vx = v * Math.cos(ang), vy = v * Math.sin(ang); // vers la droite de l'image
  const sub = 10, h = 1 / (fps * sub), kD = 0.0203;
  for (let k = 0; k <= 40 * sub; k++) {
    if (k % sub === 0) sim.push({ t: tImp + k * h, X, Y });
    const sp = Math.hypot(vx, vy);
    vx += -kD * sp * vx * h; vy += (-9.81 - kD * sp * vy) * h; X += vx * h; Y += vy * h;
  }
  let seed = 8; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const tr = createBallTracker({ width: W, height: H });
  for (let k = -3; k < 30; k++) {
    const t = tImp + k / fps;
    const s = k >= 0 ? sim[k] : null;
    const ball = s ? { x: (s.X / (aspect * mH)) * W, y: (-s.Y / mH) * H, r: 3 } : null;
    tr.push(t, makeImage(W, H, t, ball && ball.x > 4 && ball.x < W - 4 && ball.y > 4 && ball.y < H - 4 ? ball : null, rng));
  }
  const { track } = tr.result();
  const est = estimateBallFlight(track, res, { heightM: res.metrics.height });
  assert(est, 'aucune estimation');
  near(est.speedKmh, 150, 15, 'vitesse (km/h)');
  near(est.launchDeg, -6, 3, 'angle de départ (°)');
  inRange(est.conf, 0.3, 1, 'confiance');
  // Pas assez de points → null, sans exception.
  assert(estimateBallFlight(track.slice(0, 2), res, { heightM: 1.8 }) === null, 'null attendu (2 points)');
  assert(estimateBallFlight([], res, {}) === null && estimateBallFlight(track, null, {}) === null, 'null attendu (entrées vides)');
  return `${est.speedKmh} km/h (vrai 150), ${est.launchDeg}° (vrai −6), conf ${est.conf}, ${est.n} points`;
});

console.log(results.join('\n'));
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
