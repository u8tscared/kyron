// KYRON · tests vague 2 (simulation) : dynamique inverse, charge cumulée, vibrations, hybrides, rebond, style.
// Exécution : node tests/wave2-sim.test.mjs   (aucune dépendance)

import * as P from '../app/core/physics.js';
import { inverseDynamics, SEGMENTS, sgWeights } from '../app/core/dynamics.js';
import { computeLoad, strokeLoad } from '../app/core/load.js';
import { classifyStyle, dtw, referenceCurves, compareToReference, targetGesture, mapTime, ARCHETYPES } from '../app/core/style.js';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => { if (c) pass++; else fail++; console.log(`  ${c ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1e-9, Math.abs(b));
const section = (t) => console.log(`\n${t}`);

// Données de démonstration (fichiers de l'agent analyse) : facultatives, les tests analytiques n'en dépendent pas
let D = null, E = null;
try { D = await import('../app/core/demo.js'); E = await import('../app/core/engine.js'); } catch (e) { console.log(`(démo indisponible : ${e.message})`); }

// Pose debout synthétique (33 points, y vers le haut, origine au centre des hanches, joueur face à +z, droite vers −x)
function standingPose() {
  const W = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y, z) => { W[i] = { x, y, z }; };
  set(0, 0, 0.62, 0.08); set(7, 0.07, 0.6, 0); set(8, -0.07, 0.6, 0);
  set(11, 0.19, 0.5, 0); set(12, -0.19, 0.5, 0);
  set(13, 0.21, 0.19, 0); set(14, -0.21, 0.19, 0); set(15, 0.22, -0.08, 0.02); set(16, -0.22, -0.08, 0.02);
  set(17, 0.22, -0.16, 0.02); set(18, -0.22, -0.16, 0.02); set(19, 0.22, -0.16, 0.04); set(20, -0.22, -0.16, 0.04);
  set(23, 0.1, 0, 0); set(24, -0.1, 0, 0); set(25, 0.1, -0.45, 0.02); set(26, -0.1, -0.45, 0.02);
  set(27, 0.1, -0.9, 0); set(28, -0.1, -0.9, 0); set(29, 0.1, -0.95, -0.05); set(30, -0.1, -0.95, -0.05); set(31, 0.1, -0.97, 0.15); set(32, -0.1, -0.97, 0.15);
  return W;
}

// ---------------------------------------------------------------------------------------------
section('1. Dynamique inverse — validations analytiques');
{
  const base = standingPose(), fps = 240;
  // a) Statique : réaction du sol = 1 poids de corps
  const st = Array.from({ length: 60 }, (_, i) => ({ t: i / fps, world: base }));
  const d0 = inverseDynamics(st, null, { heightM: 1.8, massKg: 75 });
  ok(near(d0.series.grf.vertical[30], 1, 0.005), 'statique : réaction verticale = 1 PC', f(d0.series.grf.vertical[30], 4));
  // b) Bras droit tendu tournant dans le plan sagittal, accélération angulaire constante : moment à l'épaule
  //    attendu = I_épaule·α + m·g·r·cos θ (somme des segments de De Leva + raquette)
  const sh = base[12], alpha = 60, M = 75;
  const lens = { el: 0.30, wr: 0.57, tip: 0.65 };
  const frames = Array.from({ length: 120 }, (_, k) => {
    const t = k / fps, th = 0.5 * alpha * t * t;
    const W = base.map((p) => ({ ...p }));
    const at = (d) => ({ x: sh.x, y: sh.y + Math.sin(th) * d, z: sh.z + Math.cos(th) * d });
    W[14] = at(lens.el); W[16] = at(lens.wr); W[18] = at(lens.tip); W[20] = at(lens.tip);
    return { t, world: W };
  });
  const d = inverseDynamics(frames, null, { heightM: 1.8, massKg: M });
  const s = d.model.scale, T = SEGMENTS.male, rk = P.customize(P.RACKETS[0], {});
  let I = 0, mr = 0;
  for (const [p, a, b] of [[T.upperArm, 0, lens.el], [T.forearm, lens.el, lens.wr], [T.hand, lens.wr, lens.tip]]) {
    const m = p[0] * M, Lg = (b - a) * s, r = (a + (b - a) * p[1]) * s; I += m * (p[2] * Lg) ** 2 + m * r * r; mr += m * r;
  }
  const rR = lens.wr * s + (rk.balance - 7) / 100 + 0.08; I += rk.Icm + rk.mass / 1000 * rR * rR; mr += rk.mass / 1000 * rR;
  let worst = 0;
  for (const k of [30, 45, 60, 75]) {
    const th = 0.5 * alpha * (k / fps) ** 2, exp = Math.abs(I * alpha + mr * 9.81 * Math.cos(th));
    worst = Math.max(worst, Math.abs(d.series.shoulderTorque.total[k] - exp) / exp);
  }
  ok(worst < 0.05, "Newton-Euler : moment à l'épaule = solution analytique (< 5 %)", `pire écart ${f(worst * 100, 2)} %, I_épaule = ${f(I, 3)} kg·m²`);
  // c) Rotation interne pure (bras à 90° d'abduction, avant-bras vertical qui bascule vers l'avant) : signe positif
  const irFrames = Array.from({ length: 100 }, (_, k) => {
    const t = k / fps, th = 0.5 * 80 * t * t; // rad, vers l'avant (+z)
    const W = base.map((p) => ({ ...p }));
    const el = { x: sh.x - 0.3, y: sh.y, z: sh.z }; W[14] = el;
    const dir = { x: 0, y: Math.cos(th), z: Math.sin(th) };
    const at = (dd) => ({ x: el.x, y: el.y + dir.y * dd, z: el.z + dir.z * dd });
    W[16] = at(0.27); W[18] = at(0.35); W[20] = at(0.35);
    return { t, world: W };
  });
  const dIR = inverseDynamics(irFrames, null, { heightM: 1.8, massKg: M });
  ok(dIR.series.shoulderTorque.ir[50] > 5, "convention : la rotation interne (avant-bras qui bascule vers l'avant) donne un moment de RI positif", `${f(dIR.series.shoulderTorque.ir[50])} N·m`);
  ok(dIR.series.elbowValgus[50] > 1, 'le même mouvement charge le coude en valgus', `${f(dIR.series.elbowValgus[50])} N·m`);
  // d) Translation verticale sinusoïdale du corps entier (via l'image) : F = m(g + ÿ)
  const A = 0.05, w = 2 * Math.PI * 2;
  const vert = Array.from({ length: 240 }, (_, k) => {
    const t = k / fps, dy = A * Math.sin(w * t);
    const img = base.map((p) => ({ x: 0.5 - p.x * 0.3, y: 0.5 - (p.y + dy) * 0.3, v: 1 }));
    return { t, world: base, img };
  });
  const dv = inverseDynamics(vert, null, { heightM: 1.8, massKg: M });
  // sin = 1 à t = 0,625 s ; le déplacement image est remis à l'échelle de la taille déclarée (facteur model.scale)
  const idx = Math.round(fps * 0.625), expect = 1 - A * dv.model.scale * w * w / 9.81;
  ok(dv.model.root === 'image' && near(dv.series.grf.vertical[idx], expect, 0.03), 'translation du bassin reconstruite par l’image : F = m(g + ÿ)', `${f(dv.series.grf.vertical[idx], 3)} PC, attendu ${f(expect, 3)}`);
  // e) Savitzky-Golay exact sur un polynôme de degré 3
  const tt = Array.from({ length: 30 }, (_, i) => i / 100 + (i % 3) * 0.001);
  const S = sgWeights(tt, 4, 3);
  const y = tt.map((x) => 2 * x ** 3 - x + 1);
  const a = S[15].W[2].reduce((s2, wq, q) => s2 + wq * y[S[15].a + q], 0);
  ok(near(a, 12 * tt[15], 1e-6), 'Savitzky-Golay (pas irrégulier) exact sur un cubique', `ÿ = ${f(a, 4)}`);
}

section('2. Dynamique inverse — séquences de démonstration');
if (D && E) {
  for (const [stroke, mk] of [['serve', D.makeDemoServe], ['forehand', D.makeDemoForehand], ['backhand', D.makeDemoBackhand]]) {
    if (typeof mk !== 'function') continue;
    const frames = mk(), res = E.analyze(frames, { stroke, hand: 'right', source: 'demo' });
    const t0 = performance.now();
    const d = inverseDynamics(frames, res, { heightM: 1.85, massKg: 80 });
    const ms = performance.now() - t0;
    const mean = d.series.grf.vertical.reduce((s, v) => s + v, 0) / frames.length;
    ok(Math.abs(mean - 1) < 0.08, `${stroke} : réaction verticale moyenne ≈ 1 PC sur la séquence`, `${f(mean, 3)} PC, pic ${f(d.peaks.grfVertical.value, 2)} PC`);
    const pk = d.peaks;
    ok(['grfVertical', 'shoulderIR', 'elbowValgus', 'lumbar', 'knee'].every((key) => Number.isFinite(pk[key].value) && pk[key].value >= 0),
      `${stroke} : pics présents`, `RI ${f(pk.shoulderIR.value, 0)} N·m, valgus ${f(pk.elbowValgus.value, 0)} N·m, L5/S1 ${f(pk.lumbar.value, 0)} N·m, genou ${f(pk.knee.value, 0)} N·m · ${f(ms, 0)} ms`);
    ok(d.confidence > 0 && d.confidence <= 0.85 && Array.isArray(d.alerts) && d.units.grf, `${stroke} : confiance plafonnée (1 caméra) et alertes`, `confiance ${d.confidence}, alertes : ${d.alerts.map((x) => `${x.key}(${x.severity})`).join(', ') || 'aucune'}`);
  }
} else console.log('  (ignoré)');

// ---------------------------------------------------------------------------------------------
section('3. Charge cumulée (ACWR, EWMA)');
{
  const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString();
  const sess = (n, nb, kmh = 100, serves = 0.3) => ({ date: day(n), strokes: Array.from({ length: nb }, (_, i) => ({ type: i < nb * serves ? 'serve' : 'forehand', racketKmh: kmh })) });
  const steady = []; for (let n = 0; n < 42; n += 2) steady.push(sess(n, 150));
  const L1 = computeLoad(steady, { today: day(40) });
  ok(L1.acwr > 0.8 && L1.acwr < 1.3 && L1.zone.key === 'optimal', 'charge régulière → zone favorable', `ACWR ${f(L1.acwr, 2)}`);
  const spike = steady.concat([sess(43, 400), sess(44, 400), sess(45, 400), sess(46, 400)]);
  const L2 = computeLoad(spike, { today: day(46) });
  ok(L2.acwr > 1.5 && L2.zone.key === 'danger' && L2.alerts.some((a) => a.key === 'acwr' && a.severity === 3), 'pic de volume → alerte « pic de charge »', `ACWR ${f(L2.acwr, 2)}, semaine ${f(L2.weekChangePct, 0)} %`);
  ok(L2.advice.strokesPerWeek[1] > 0 && /frappes/.test(L2.advice.text), 'conseil de volume chiffré', L2.advice.text);
  const L3 = computeLoad(steady.slice(0, 15), { today: day(56) });
  ok(L3.zone.key === 'under', 'coupure de deux semaines → sous-charge', `ACWR ${f(L3.acwr, 2)}`);
  ok(strokeLoad({ type: 'serve', peakShoulderTorque: 40 }) > strokeLoad({ type: 'forehand', peakShoulderTorque: 40 }) && strokeLoad({ type: 'forehand', racketKmh: 120 }) > strokeLoad({ type: 'forehand', racketKmh: 100 }),
    'charge par frappe : service > coup droit, croissante avec la vitesse');
  ok(computeLoad([]).acwr === null && computeLoad([]).advice.text.length > 0, 'historique vide géré');
}

// ---------------------------------------------------------------------------------------------
section('4. Vibrations et confort (C09)');
{
  const rk = P.customize(P.RACKETS[0], {});
  const v = P.vibration(rk, 54);
  ok(v.freqHz > 120 && v.freqHz < 180, 'fréquence propre libre-libre 120–180 Hz (Cross & Lindsey)', `${f(v.freqHz, 0)} Hz, nœuds ${v.nodesCm.map((x) => f(x, 1)).join(' / ')} cm`);
  const stiff = P.vibration(P.customize(P.RACKETS.find((r) => r.id === 'pow100'), {}), 54);
  ok(stiff.freqHz > v.freqHz, 'cadre plus rigide (RA) → fréquence plus haute', `${f(stiff.freqHz, 0)} Hz`);
  const tip = P.vibration(rk, 63), node = P.vibration(rk, v.nodesCm[1]);
  ok(node.amplitudeRel < 0.05 && tip.amplitudeRel > 0.9, 'amplitude ~0 au nœud, maximale en haut du tamis', `${f(node.amplitudeRel, 3)} → ${f(tip.amplitudeRel, 2)}`);
  ok(P.vibration(rk, v.copCm).armShockN < 1 && tip.armShockN > 50, 'choc au manche nul au centre de percussion', `CoP ${f(v.copCm, 1)} cm, choc pointe ${f(tip.armShockN, 0)} N`);
  ok(P.vibration(rk, 54).comfortIndex > tip.comfortIndex && P.vibration(rk, 54, 2).comfortIndex < P.vibration(rk, 54).comfortIndex, 'confort : centre > pointe, décentré < centré');
  const im = P.impact({ rk, string: 'poly', tension: 23, V: 30, alpha: 25, phi: 3, u: 18, impactCm: 60 });
  ok(Number.isFinite(P.vibration(rk, 60, 0, im).comfortIndex), 'accepte le résultat d’impact (impulsion réelle)');
}

section('5. Hybrides (D06)');
{
  const rk = P.customize(P.RACKETS[0], {});
  const hy = { mains: { material: 'poly', gauge: 1.25, tension: 24 }, crosses: { material: 'gut', gauge: 1.3, tension: 23 } };
  const base = { rk, V: 30, alpha: 30, phi: 3, u: 18, impactCm: 54 };
  const iH = P.impact({ ...base, string: hy }), iP = P.impact({ ...base, string: 'poly', tension: 23.5 }), iG = P.impact({ ...base, string: 'gut', tension: 23.5 });
  ok(iH.spinRpm < iP.spinRpm && iH.spinRpm > iG.spinRpm, 'hybride poly / boyau : effet entre poly et boyau', `${f(iG.spinRpm, 0)} < ${f(iH.spinRpm, 0)} < ${f(iP.spinRpm, 0)} tr/min`);
  const kH = P.bedStiffness(rk, hy), kP = P.bedStiffness(rk, 'poly', 23.55), kG = P.bedStiffness(rk, 'gut', 23.55);
  ok(kH < kP && kH > kG, 'raideur du lit hybride intermédiaire', `${f(kH / 1000, 1)} kN/m`);
  const multiCross = { mains: { material: 'poly', gauge: 1.25, tension: 24 }, crosses: { material: 'multi', gauge: 1.25, tension: 23 } };
  ok(P.stringProps(multiCross).snap < P.stringProps({ ...hy, crosses: { ...hy.crosses, material: 'poly' } }).snap, 'travers accrocheurs (multi) → moins de snapback qu’un poly / poly');
  ok(P.tensionAfter(hy, undefined, 10, 5) < 23.55 && P.stringLabel(hy) === 'Polyester / Boyau naturel', 'tension restante et libellé d’un hybride', `${f(P.tensionAfter(hy, undefined, 10, 5), 1)} kg`);
  const r0 = P.recommendStrings({ ...base }, 'spin'), r1 = P.recommendStrings({ ...base }, 'spin', { hybrids: true });
  ok(r0.every((r) => typeof r.string === 'string') && r1.length === 3 && r1.every((r) => r.label), 'recommendStrings : format historique inchangé, hybrides en option', r1.map((r) => `${r.label} ${f(r.tension, 1)} kg`).join(' · '));
  ok(P.impact({ ...base, string: 'poly', tension: 23 }).speed > 0 && P.bedStiffness(rk, 'poly', 24) > 0, 'formats existants inchangés');
}

section('6. Rebond et kick par surface (E07)');
{
  const out = {};
  for (const s of Object.keys(P.SURFACES)) out[s] = P.bounceProfile(32, 8, 2600, s, { h0: 1, x0: -1 });
  ok(Object.values(out).every((b) => b && b.heightAtReceiver > 0.3 && b.heightAtReceiver < 2.5), 'hauteur à la ligne de fond plausible (0,3–2,5 m)', Object.entries(out).map(([k, b]) => `${k} ${f(b.heightAtReceiver, 2)} m`).join(', '));
  ok(P.courtPace('clay') < P.courtPace('hard') && P.courtPace('hard') < P.courtPace('grass'), 'indice de vitesse ITF : terre < dur < gazon', ['clay', 'hard', 'grass'].map((s) => `${s} ${f(P.courtPace(s), 0)}`).join(', '));
  const flat = P.bounceProfile(45, 2, 300, 'grass', { h0: 1, x0: -1 }), top = P.bounceProfile(28, 12, 3500, 'clay', { h0: 1, x0: -1 });
  ok(flat.slide === true && top.slide === false && flat.out.angleDeg < top.out.angleDeg, 'balle plate rapide sur gazon : glisse et fuse bas ; balle liftée sur terre : roule et remonte', `sortie ${f(flat.out.angleDeg, 1)}° contre ${f(top.out.angleDeg, 1)}°`);
  ok(top.peakH > flat.peakH, 'balle liftée sur terre : rebond plus haut', `${f(top.peakH, 2)} m contre ${f(flat.peakH, 2)} m`);
}

// ---------------------------------------------------------------------------------------------
section('7. Style : archétypes synthétiques, Mahalanobis, DTW, geste cible');
{
  const c = classifyStyle(ARCHETYPES.forehand[0].mean, 'forehand');
  ok(c.ranking[0].key === 'topspin' && c.ranking[0].d < 1e-6 && near(c.ranking.reduce((s, r) => s + r.p, 0), 1, 1e-9), 'un profil égal à un archétype est classé dessus (d = 0, Σp = 1)', c.ranking.map((r) => `${r.key} ${f(r.p, 2)}`).join(', '));
  const c2 = classifyStyle({ kneeFlex: 30, separation: 18, elbowImpact: 150, contactRatio: 1.21, d1: 12, d2: 22, d3: 18, racketSpeed: 31 }, 'serve');
  ok(c2.ranking[0].key === 'arm' && c2.ranking[0].risk && c.notice.includes('synthétique'), 'profil « bras » reconnu, archétype à risque, étiqueté synthétique', `d = ${f(c2.ranking[0].d, 2)}, typicité ${f(c2.ranking[0].typicality, 2)}`);
  const a = Array.from({ length: 60 }, (_, i) => Math.sin(i / 8)), b = Array.from({ length: 70 }, (_, i) => Math.sin(i * 60 / 70 / 8));
  const w = dtw(a, b), wFar = dtw(a, a.map((x) => -x));
  ok(w.normDistance < 0.05 && wFar.normDistance > 0.3 && w.path[0][0] === 0 && w.path[w.path.length - 1][1] === 69, 'DTW : une courbe étirée s’aligne, une courbe inversée non', `${f(w.normDistance, 3)} contre ${f(wFar.normDistance, 3)}`);
  const ref = referenceCurves('power', 'serve');
  ok(ref.peaksMs.pelvis < ref.peaksMs.thorax && ref.peaksMs.thorax < ref.peaksMs.elbow && ref.peaksMs.elbow < ref.peaksMs.wrist, 'courbes de référence : ordre proximal → distal', JSON.stringify(ref.peaksMs));
  if (D && E) {
    const frames = D.makeDemoServe(), res = E.analyze(frames, { stroke: 'serve', hand: 'right', source: 'demo' });
    const cs = classifyStyle(res);
    const cmp = compareToReference(res, cs.ranking[0].key);
    ok(cmp && Number.isFinite(cmp.dtw.combined) && cmp.timing.length === 4 && cmp.phases.length >= 2, 'comparaison phase par phase au plus proche archétype', `${cs.ranking[0].label} · DTW ${f(cmp.dtw.combined, 3)} · ${cmp.phases.map((p) => `${p.key} ${p.deltaMs > 0 ? '+' : ''}${p.deltaMs} ms`).join(', ')}`);
    const { runOptimization } = await import('../app/core/optimizer.js');
    const opt = await runOptimization({ res, stroke: 'serve', goal: 'balanced', budget: 'quick' });
    const tg = targetGesture(opt, res);
    const mono = tg.timeMap.every((k, i, arr) => i === 0 || k.tGhost > arr[i - 1].tGhost);
    ok(tg && tg.simulated && mono && Number.isFinite(mapTime(tg.timeMap, -0.1)) && tg.params.kneeFlex, 'geste cible : courbes, carte temporelle croissante, consignes', `genoux ${f(tg.params.kneeFlex.from, 0)} → ${f(tg.params.kneeFlex.to, 0)}°, vitesse ×${f(tg.speedScale, 3)}`);
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
