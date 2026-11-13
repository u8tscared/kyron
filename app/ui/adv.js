// KYRON · Séance, panneaux avancés de la vague 2 : charges articulaires, raquette, jeu de jambes, style,
// fantôme du geste optimal (vidéo + 3D) et annotations synchronisées au temps.
import { $, $$, f, fi, esc, fit, C, clamp, on, store, analyzable, STROKE_FR } from './util.js';
import { S, cur } from './state.js';
import { M, has } from './core.js';
import { P, hooks, api } from './seance.js';
import { dynOf, racketOf, footworkOf, asymmetries, handOf } from './ana.js';

let ghostOn = false, ghost = null, annMode = false, styleRef = null;
const kpi = (label, val, unit, d, cls = '', dcls = '') => `<div class="kpi ${cls}"><div class="lbl">${label}</div><b>${val}<small>${unit}</small></b><div class="d ${dcls}">${d || '&nbsp;'}</div></div>`;
const srcBadge = (src) => `<span class="src ${src}">${{ mesure: 'Mesuré', estimation: 'Estimé', demo: 'Démo', simulation: 'Simulé', optimiseur: 'Estimé (optimiseur)' }[src] || src}</span>`;
const ms = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${fi(Math.abs(v))} ms` : '—');
const visible = () => !$('#v-seance').hidden;

export function init() {
  hooks.render.push(renderAdv);
  hooks.frame.push(drawGhost2D, drawAnn);
  hooks.d3.push(drawGhost3D);
  on('mode', () => requestAnimationFrame(renderAdv));
  on('opt', () => { if (S.opt.status === 'done') { ghost = null; updateGhostBtn(); if (S.mode === 'adv' && visible()) { try { renderRacket(); } catch (e) { console.warn('[kyron] raquette', e); } } } else updateGhostBtn(); });
  on('profile', () => requestAnimationFrame(renderAdv));
  on('route', (r) => { if (r === 'seance') requestAnimationFrame(renderAdv); });
  addEventListener('resize', () => { if (visible() && S.mode === 'adv') { dynBase = null; drawDyn(); renderRacketCanvases(); } });
  for (const id of ['#ghostBtn', '#ghostBtn3']) $(id)?.addEventListener('click', toggleGhost);
  $('#styleSeg')?.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; styleRef = b.dataset.k; renderStyle(); });
  bindAnn();
  renderAdv();
}

function renderAdv() {
  ghost = null; updateGhostBtn(); renderAnnList();
  if (S.mode !== 'adv' || !cur()) return;
  for (const fn of [renderDyn, renderRacket, renderFootwork, renderStyle]) { try { fn(); } catch (e) { console.warn('[kyron] panneau avancé', e); } }
}

// ====================== Charges articulaires (dynamics.js) ======================
let dynBase = null;
const DYN_LINES = [
  { k: 'ir', label: 'Épaule · rotation interne', get: (s) => s.shoulderTorque?.ir, c: '#fff', w: 2 },
  { k: 'valg', label: 'Coude · valgus', get: (s) => s.elbowValgus, c: C.s2, w: 1.6 },
  { k: 'lumb', label: 'Lombaires (L5/S1)', get: (s) => s.lumbarTorque?.total, c: C.s3, w: 1.6, dash: [5, 3] },
  { k: 'knee', label: 'Genou le plus chargé', get: (s) => (s.kneeTorque ? s.kneeTorque.left.map((v, i) => Math.max(v, s.kneeTorque.right[i])) : null), c: C.s4, w: 1.6 },
];
function renderDyn() {
  const el = $('#dynK'); if (!el) return;
  const d = dynOf();
  if (!d) { el.innerHTML = ''; $('#dynAl').innerHTML = `<p class="empty">${has('dynamics', 'inverseDynamics') ? 'Calcul impossible sur cette frappe (pose incomplète).' : 'Module de dynamique inverse indisponible pour le moment.'}</p>`; return; }
  const pk = d.peaks || {}, W = S.profile.weight;
  const per = (p) => (p?.perKg != null ? `${f(p.perKg, 2)} N·m/kg` : '');
  const when = (p) => (p ? `${ms(p.msFromImpact)} / impact` : '');
  const T = M.dynamics.THRESHOLDS || {};
  const lvl = (p, th) => (p?.perKg != null && th ? (p.perKg >= th.high ? 'att' : '') : '');
  el.innerHTML = [
    kpi('Réaction du sol', pk.grfVertical ? f(pk.grfVertical.value, 1) : '—', '× poids', `${when(pk.grfVertical)}`, '', pk.grfVertical?.value >= (T.grfVertical?.high ?? 9) ? 'att' : ''),
    kpi('Épaule · rot. interne', pk.shoulderIR ? fi(pk.shoulderIR.value) : '—', 'N·m', `${per(pk.shoulderIR)} · ${when(pk.shoulderIR)}`, '', lvl(pk.shoulderIR, T.shoulderIR)),
    kpi('Coude · valgus', pk.elbowValgus ? fi(pk.elbowValgus.value) : '—', 'N·m', `${per(pk.elbowValgus)} · ${when(pk.elbowValgus)}`, '', lvl(pk.elbowValgus, T.elbowValgus)),
    kpi('Lombaires', pk.lumbar ? fi(pk.lumbar.value) : '—', 'N·m', `${per(pk.lumbar)} · ${when(pk.lumbar)}`, '', lvl(pk.lumbar, T.lumbar)),
    kpi('Genou', pk.knee ? fi(pk.knee.value) : '—', 'N·m', `${pk.knee?.side === 'left' ? 'gauche' : pk.knee?.side === 'right' ? 'droit' : ''} ${per(pk.knee)}`, '', lvl(pk.knee, T.knee)),
    kpi('Confiance', fi((d.confidence || 0) * 100), '%', 'plafonnée : une seule caméra'),
  ].join('');
  const sev = ['', 'Repère', 'Attention', 'Élevé'];
  $('#dynAl').innerHTML = d.alerts?.length
    ? `<ul class="issues">${d.alerts.map((a) => `<li><b class="${a.severity >= 3 ? 'acc' : ''}">${esc(a.label)}</b> · ${sev[a.severity] || ''} — ${esc(a.detail)}</li>`).join('')}</ul>`
    : '<p class="note">Aucun pic au-dessus des repères publiés sur cette frappe.</p>';
  $('#dynNote').textContent = `Modèle : ${W} kg, ${f(S.profile.height / 100, 2)} m, 14 segments + raquette. Une seule caméra : ± 30 à 50 % sur les pics. Les repères sont publiés dans la littérature, ce ne sont pas des limites médicales.`;
  dynBase = null; drawDyn();
}
function drawDyn() {
  const cv = $('#dynCv'); if (!cv || S.mode !== 'adv') return;
  const d = dynOf(); if (!d) return;
  const s = d.series, r = P.res, n = s.t.length;
  const i0 = Math.max(0, r.phases[0].i0), i1 = Math.min(n - 1, r.phases[4].i1);
  if (!dynBase) {
    const { g, w, h } = fit(cv);
    const pad = { l: 40, r: 10, t: 14, b: 20 }, split = h * 0.68;
    const X = (i) => pad.l + (i - i0) / ((i1 - i0) || 1) * (w - pad.l - pad.r);
    const lines = DYN_LINES.map((L) => ({ ...L, v: L.get(s) })).filter((L) => L.v);
    const yMax = Math.max(10, ...lines.flatMap((L) => L.v.slice(i0, i1 + 1).map(Math.abs))) * 1.08;
    const Y = (v) => split - (v / yMax) * (split - pad.t);
    g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.strokeStyle = C.rule; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const k of [0, 0.5, 1]) { g.beginPath(); g.moveTo(pad.l, Y(yMax * k)); g.lineTo(w - pad.r, Y(yMax * k)); g.stroke(); g.fillText(`${fi(yMax * k)}`, pad.l - 5, Y(yMax * k)); }
    g.textAlign = 'left'; g.fillText('N·M', 4, pad.t - 4);
    const xi = X(r.impact); g.strokeStyle = C.acc; g.beginPath(); g.moveTo(xi, pad.t); g.lineTo(xi, h - pad.b); g.stroke();
    for (const L of lines) {
      g.strokeStyle = L.c; g.lineWidth = L.w; g.setLineDash(L.dash || []); g.beginPath();
      for (let i = i0; i <= i1; i++) { const y = Y(Math.abs(L.v[i])); i === i0 ? g.moveTo(X(i), y) : g.lineTo(X(i), y); }
      g.stroke(); g.setLineDash([]);
      let im = i0; for (let i = i0; i <= i1; i++) if (Math.abs(L.v[i]) > Math.abs(L.v[im])) im = i;
      g.fillStyle = '#000'; g.strokeStyle = L.c; g.lineWidth = 1.5; g.beginPath(); g.arc(X(im), Y(Math.abs(L.v[im])), 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // Réaction du sol (poids de corps)
    const gv = s.grf?.vertical;
    if (gv) {
      const top = split + 12, bot = h - pad.b, gm = Math.max(2, ...gv.slice(i0, i1 + 1)) * 1.05;
      const Yg = (v) => bot - (v / gm) * (bot - top);
      g.strokeStyle = C.rule; g.lineWidth = 1; g.beginPath(); g.moveTo(pad.l, Yg(1)); g.lineTo(w - pad.r, Yg(1)); g.stroke();
      g.fillStyle = C.mute; g.textAlign = 'right'; g.fillText('1 PC', pad.l - 5, Yg(1)); g.textAlign = 'left'; g.fillText('SOL', 4, top);
      g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.beginPath();
      for (let i = i0; i <= i1; i++) { const y = Yg(gv[i]); i === i0 ? g.moveTo(X(i), y) : g.lineTo(X(i), y); }
      g.stroke();
    }
    const snap = document.createElement('canvas'); snap.width = cv.width; snap.height = cv.height; snap.getContext('2d').drawImage(cv, 0, 0);
    dynBase = { snap, X, pad, h, i0, i1 };
  }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(dynBase.snap, 0, 0);
  const dpr = cv.width / (cv.getBoundingClientRect().width || 1); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (P.i >= dynBase.i0 && P.i <= dynBase.i1) { const x = dynBase.X(P.i); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, dynBase.pad.t); g.lineTo(x, dynBase.h - dynBase.pad.b); g.stroke(); }
}
hooks.frame.push(() => { if (S.mode === 'adv' && dynBase) drawDyn(); });

// ====================== Raquette (racket.js) ======================
function renderRacket() {
  const el = $('#rkA'); if (!el) return;
  const rk = racketOf(); if (!rk) { el.innerHTML = ''; return; }
  const ip = rk.impactPoint;
  el.innerHTML = [
    kpi('Vitesse de la tête', rk.headSpeedKmh != null ? fi(rk.headSpeedKmh) : '—', 'km/h', rk.source === 'mesure' ? 'mesurée dans le plan de l\'image (borne basse)' : 'estimée par la chaîne du bras'),
    kpi('Angle de face', rk.faceAngleDeg != null ? `${rk.faceAngleDeg > 0 ? '+' : ''}${f(rk.faceAngleDeg, 1)}` : '—', '°', rk.faceAngleDeg == null ? '' : rk.faceAngleDeg > 0 ? 'face ouverte (vers le haut)' : 'face fermée (vers le bas)'),
    kpi('Trajectoire', rk.pathAngleDeg != null ? `${rk.pathAngleDeg > 0 ? '+' : ''}${f(rk.pathAngleDeg, 1)}` : '—', '°', 'sur les 30 ms avant l\'impact (+ = monte)'),
    kpi('Point d\'impact', ip ? f(ip.offCenterCm, 1) : '—', ip ? 'cm' : '', ip ? `du centre · ${ip.alongCm > 0 ? 'vers le haut' : 'vers le cœur'} ${f(Math.abs(ip.alongCm), 1)} cm` : 'balle non visible à l\'impact'),
  ].join('');
  const fromTxt = rk.source === 'demo' ? 'Démo synthétique : pas d\'image, la tête de raquette est placée dans le prolongement de l\'avant-bras.'
    : rk.source === 'mesure' ? `Cadre détecté dans l'image (${esc(rk.detected || '')} images), normale de la face par l'ellipse du tamis, confiance ${fi(rk.conf * 100)} %.`
      : `Cadre peu visible${rk.detected ? ` (${esc(rk.detected)} images détectées)` : ''} : modèle avant-bras${rk.faceFrom === 'optimiseur' ? ', angle de face estimé par l\'optimiseur' : ''}.`;
  $('#rkSrc').innerHTML = `${srcBadge(rk.source)} ${fromTxt}`;
  renderRacketCanvases();
}
function renderRacketCanvases() {
  const rk = racketOf(); if (!rk || !$('#rkFace')) return;
  // Tamis vu de face : ellipse 34 × 26 cm, cordage, zone idéale, point d'impact
  {
    const { g, w, h } = fit($('#rkFace'));
    if (w < 60 || h < 60) return;
    const sc = Math.min((h - 30) / 36, (w - 20) / 28), cx = w / 2, cy = h / 2 - 4;
    g.strokeStyle = C.rule; g.lineWidth = 1;
    g.save(); g.beginPath(); g.ellipse(cx, cy, 13 * sc, 17 * sc, 0, 0, Math.PI * 2); g.clip();
    for (let x = -12; x <= 12; x += 1.6) { g.beginPath(); g.moveTo(cx + x * sc, cy - 18 * sc); g.lineTo(cx + x * sc, cy + 18 * sc); g.stroke(); }
    for (let y = -16; y <= 16; y += 1.7) { g.beginPath(); g.moveTo(cx - 14 * sc, cy + y * sc); g.lineTo(cx + 14 * sc, cy + y * sc); g.stroke(); }
    g.restore();
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, cy, 13 * sc, 17 * sc, 0, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 3 * sc, cy + 16.6 * sc); g.lineTo(cx, cy + 22 * sc); g.lineTo(cx + 3 * sc, cy + 16.6 * sc); g.stroke();
    g.setLineDash([3, 3]); g.strokeStyle = C.s3; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy + 1 * sc, 4.5 * sc, 5.5 * sc, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.font = `9.5px ${C.mono}`; g.fillStyle = C.mute; g.textAlign = 'center'; g.fillText('ZONE IDÉALE', cx, cy + 9 * sc);
    const ip = rk.impactPoint;
    if (ip) {
      const x = cx + ip.acrossCm * sc, y = cy - ip.alongCm * sc;
      g.fillStyle = C.acc; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.acc; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke();
    } else {
      g.fillStyle = C.mute; g.fillText('IMPACT NON MESURÉ', cx, h - 8);
    }
  }
  // Trajectoire de la tête autour de l'impact (image)
  {
    const { g, w, h } = fit($('#rkPath'));
    const pts = rk.path; if (pts.length < 2 || w < 60 || h < 60) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sc = Math.min((w - 30) / ((x1 - x0) * 1.6 || 1), (h - 30) / ((y1 - y0) || 1));
    const X = (x) => w / 2 + (x - (x0 + x1) / 2) * 1.6 * sc, Y = (y) => h / 2 + (y - (y0 + y1) / 2) * sc;
    g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], al = clamp(1 - Math.abs(b.t) / 0.4, 0.15, 1);
      g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = 1 + al * 2; g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke();
    }
    let ii = 0; pts.forEach((p, i) => { if (Math.abs(p.t) < Math.abs(pts[ii].t)) ii = i; });
    g.fillStyle = C.acc; g.beginPath(); g.arc(X(pts[ii].x), Y(pts[ii].y), 5, 0, Math.PI * 2); g.fill();
    g.font = `9.5px ${C.mono}`; g.fillStyle = C.mute; g.textAlign = 'left'; g.fillText('−400 MS → +150 MS · IMPACT EN ORANGE', 8, 14);
  }
}

// ====================== Jeu de jambes (footwork.js) ======================
function renderFootwork() {
  const el = $('#fwK'); if (!el) return;
  const fw = footworkOf(); if (!fw) { el.innerHTML = ''; return; }
  const ps = fw.perStroke, sp = fw.splitInfo;
  el.innerHTML = [
    kpi('Base d\'appui', f(fw.base, 2), 'm', `${f(fw.baseRatio, 2)} × ta taille à l'impact`),
    kpi('Pas d\'allègement', fw.split != null ? ms(fw.split * 1000) : 'non vu', '', sp ? `${fi(sp.airMs)} ms en l'air · appuis ${f(sp.stanceM, 2)} m${sp.firstStep ? ` · 1er pas ${sp.firstStep.foot === 'L' || sp.firstStep.k === 'L' ? 'gauche' : 'droit'}` : ''}` : fw.split != null ? 'avant l\'impact, deux pieds décollés' : 'aucun petit saut détecté avant la frappe', '', fw.split == null && analyzable(cur().type) !== 'serve' ? 'att' : ''),
    ps ? kpi('Déplacement avant la frappe', f(ps.amplitudeM, 2), 'm', `vers la ${esc(ps.side)} · pointe ${f(ps.peakSpeed, 1)} m/s`) : kpi('Pas d\'ajustement', fi(fw.steps), '', fw.stepT?.length ? fw.stepT.slice(0, 4).map((x) => `${x.side} ${ms(x.t * 1000)}`).join(' · ') : 'aucun déplacement > 12 cm'),
    ps?.support ? kpi('Pied d\'appui à l\'impact', ps.support === 'L' ? 'GAUCHE' : 'DROIT', '', `transfert ${fw.transfer != null ? fi(fw.transfer * 100) : '—'} cm`) : kpi('Transfert du poids', fw.transfer != null ? fi(fw.transfer * 100) : '—', 'cm', 'centre de masse, fin de l\'armé → impact'),
  ].join('');
  $('#fwSrc').innerHTML = `${srcBadge(fw.source)} ${fw.module ? `Module jeu de jambes${fw.comDistance != null ? ` : ${f(fw.comDistance, 1)} m parcourus sur la vidéo, pointe ${f(fw.comMaxSpeed, 1)} m/s` : ''}${fw.conf != null ? `, confiance ${fi(fw.conf * 100)} %` : ''}.` : 'Calculé à partir des chevilles et du centre de masse.'} ${S.session?.court ? 'Court calibré : positions au sol en mètres.' : 'Sans calibration du court, seul le déplacement latéral est mesuré (calibre le court dans l\'onglet Balle).'}${fw.asym?.alerts?.length ? ` <span class="acc">${fw.asym.alerts.map((a) => esc(a.text)).join(' ')}</span>` : ''}`;
  const as = asymmetries();
  $('#fwAsym tbody').innerHTML = as.length ? as.map((x) => `<tr><td>${esc(x.label)}<br><small class="note">${esc(x.a)} / ${esc(x.b)}</small></td><td class="n">${x.va != null ? f(x.va, x.unit === '/100' || x.unit === '°' || x.unit === '%' ? 0 : 0) : '—'} / ${x.vb != null ? f(x.vb, 0) : '—'} <small class="note">${esc(x.unit)}</small></td><td class="n">${x.gapPct != null ? `<span class="${x.gapPct > 12 ? 'att' : ''}">${fi(x.gapPct)} %</span>` : '—'}</td></tr>`).join('')
    : '<tr><td colspan="3" class="note">Il faut au moins un coup droit et un revers dans la séance pour comparer les deux côtés.</td></tr>';
}

// ====================== Style (style.js) ======================
function renderStyle() {
  const el = $('#styRank'); if (!el) return;
  const s = cur();
  if (!s || !has('style', 'classifyStyle')) { el.innerHTML = '<p class="empty">Module de style indisponible pour le moment.</p>'; $('#styPh tbody').innerHTML = ''; $('#styleSeg').innerHTML = ''; return; }
  const st = analyzable(s.type);
  let cs = null; try { cs = M.style.classifyStyle(s.res, st); } catch (e) { cs = null; }
  if (!cs?.ranking?.length) { el.innerHTML = '<p class="empty">Pas assez de mesures pour situer ce geste.</p>'; return; }
  el.innerHTML = cs.ranking.map((r, i) => `<div class="sens-r"><div>${esc(r.label)}${r.risk ? ' <span class="acc">· geste à risque</span>' : ''}<small>typicité ${fi(r.typicality * 100)} % · distance ${f(r.d, 1)}</small></div><div class="track"><i style="width:${Math.max(2, r.p * 100)}%${i ? ';background:var(--s3)' : ''}"></i></div><div class="mono">${fi(r.p * 100)} %</div></div>`).join('')
    + `<p class="note" style="margin-top:6px">Ce qui te distingue de « ${esc(cs.ranking[0].label)} » : ${cs.contributions.slice(0, 3).map((c) => `${esc(c.label.toLowerCase())} (${c.z > 0 ? '+' : '−'}${f(Math.abs(c.z), 1)} σ)`).join(', ')}.</p>`
    + `<p class="note" style="margin-top:6px">${esc(cs.notice || '')}</p>`;
  const arch = M.style.ARCHETYPES?.[st] || [];
  if (!styleRef || !arch.some((a) => a.key === styleRef)) styleRef = cs.ranking[0].key;
  $('#styleSeg').innerHTML = arch.map((a) => `<button data-k="${a.key}" aria-pressed="${a.key === styleRef}">${esc(a.label.split(' (')[0])}</button>`).join('');
  let cmp = null; try { cmp = M.style.compareToReference(s.res, styleRef, { stroke: st }); } catch (e) { cmp = null; }
  if (!cmp) { $('#styPh tbody').innerHTML = ''; return; }
  const rows = [
    ...cmp.phases.map((p) => ({ l: p.label, a: p.playerMs, b: p.refMs, d: p.deltaMs, k: 'phase' })),
    ...cmp.timing.map((p) => ({ l: `Pic ${p.label.toLowerCase()}`, a: p.playerMs, b: p.refMs, d: p.deltaMs, k: 'pic' })),
  ];
  $('#styPh tbody').innerHTML = rows.map((r) => `<tr><td>${esc(r.l)}</td><td class="n">${r.a < 0 ? '−' : ''}${fi(Math.abs(r.a))} ms</td><td class="n">${r.b < 0 ? '−' : ''}${fi(Math.abs(r.b))} ms</td><td class="n"><span class="${Math.abs(r.d) > (r.k === 'phase' ? 80 : 25) ? 'att' : ''}">${ms(r.d)}</span></td></tr>`).join('');
  $('#styDtw').textContent = `Écart de forme (DTW) : ${f(cmp.dtw.combined, 2)} — bassin ${f(cmp.dtw.byChannel.pelvis, 2)}, buste ${f(cmp.dtw.byChannel.thorax, 2)}, coude ${f(cmp.dtw.byChannel.elbow, 2)}, poignet ${f(cmp.dtw.byChannel.wrist, 2)}. 0 = même enchaînement.`;
}

// ====================== Fantôme du geste optimal (style.targetGesture + mapTime) ======================
function optForCur() { return S.opt.status === 'done' && S.opt.forIdx === S.strokeIdx && S.opt.result?.best ? S.opt.result : null; }
function updateGhostBtn() {
  const ok = !!optForCur() && has('style', 'targetGesture');
  for (const id of ['#ghostBtn', '#ghostBtn3']) {
    const b = $(id); if (!b) continue;
    b.disabled = !ok; b.setAttribute('aria-pressed', String(ghostOn && ok));
    b.title = ok ? 'Superpose le geste cible calculé par l\'optimiseur' : 'Disponible quand l\'optimiseur a fini pour cette frappe';
    b.textContent = ghostOn && ok ? 'Masquer le geste optimal' : 'Montrer le geste optimal';
  }
  const info = $('#ghostInfo');
  if (info) {
    info.hidden = !(ghostOn && ok);
    const gs = ok && ghostOn ? getGhost() : null;
    if (gs) info.innerHTML = `<b>Fantôme</b> geste cible simulé · ${Object.values(gs.params).filter((p) => Number.isFinite(p.delta) && Math.abs(p.delta) > 0.5).slice(0, 4).map((p) => `${esc(p.label.toLowerCase())} ${p.delta > 0 ? '+' : '−'}${f(Math.abs(p.delta), p.unit === '× taille' ? 2 : 0)} ${esc(p.unit)}`).join(' · ') || 'proche de ton geste'}. Simulation, pas une vidéo.`;
  }
}
function toggleGhost() { ghostOn = !ghostOn; updateGhostBtn(); api.redraw(); }
function getGhost() {
  if (ghost) return ghost;
  const opt = optForCur(); if (!opt || !has('style', 'targetGesture')) return null;
  try { ghost = M.style.targetGesture(opt, P.res); } catch (e) { ghost = null; }
  if (ghost?.timeMap?.length) ghost.inv = ghost.timeMap.map((k) => ({ tPlayer: k.tGhost, tGhost: k.tPlayer }));
  return ghost;
}
const lerpP = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * k, v: a.v });
// Pose du fantôme à l'image courante : le geste du joueur rejoué sur la carte temporelle cible, coude et genoux
// ajustés vers les valeurs optimales autour des instants où l'optimiseur les a fixées.
function ghostPose(space) {
  const gs = getGhost(); if (!gs || !P.frames.length) return null;
  const fr = P.frames, r = P.res, tI = fr[r.impact].t, tRel = fr[P.i].t - tI;
  const tSrc = tI + M.style.mapTime(gs.inv, tRel);
  const j = clamp(api.frameAt(tSrc), 0, fr.length - 1);
  const j2 = clamp(fr[j].t <= tSrc ? j + 1 : j - 1, 0, fr.length - 1);
  const k = fr[j2].t !== fr[j].t ? clamp((tSrc - fr[j].t) / (fr[j2].t - fr[j].t), 0, 1) : 0;
  const pose = fr[j][space].map((p, i) => lerpP(p, fr[j2][space][i], k));
  const R = handOf() === 'right', sh = R ? 12 : 11, el = R ? 14 : 13, wr = R ? 16 : 15, hand = R ? [16, 18, 20, 22] : [15, 17, 19, 21];
  const prm = gs.params || {};
  const wImp = Math.exp(-((tRel / 0.09) ** 2));
  const tLoad = (fr[r.phases[1]?.i1 ?? r.impact].t - tI), wLoad = Math.exp(-(((tRel - tLoad) / 0.15) ** 2));
  const flip = space === 'img' ? -1 : 1; // image : y vers le bas
  // Coude : extension vers la cible à l'impact (rotation de l'avant-bras dans le plan bras / avant-bras)
  const dEl = Number.isFinite(prm.elbowImpact?.delta) ? prm.elbowImpact.delta * wImp : 0;
  if (Math.abs(dEl) > 0.3) {
    const E = pose[el], U = { x: pose[sh].x - E.x, y: pose[sh].y - E.y }, F = { x: pose[wr].x - E.x, y: pose[wr].y - E.y };
    const cr = U.x * F.y - U.y * F.x, ang = (cr >= 0 ? 1 : -1) * dEl * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
    for (const h of hand) { const q = pose[h]; const dx = q.x - E.x, dy = q.y - E.y; q.x = E.x + dx * c - dy * s; q.y = E.y + dx * s + dy * c; }
  }
  // Genoux : flexion supplémentaire pendant la charge → le haut du corps descend
  const dK = Number.isFinite(prm.kneeFlex?.delta) ? prm.kneeFlex.delta * wLoad : 0;
  if (Math.abs(dK) > 0.5) {
    const thigh = Math.hypot(pose[23].x - pose[25].x, pose[23].y - pose[25].y);
    const drop = thigh * Math.sin(Math.abs(dK) * Math.PI / 180) * 0.6 * Math.sign(dK);
    for (let i = 0; i <= 24; i++) if (pose[i]) pose[i].y += -flip * drop;
    for (const i of [25, 26]) if (pose[i]) pose[i].y += -flip * drop * 0.5;
  }
  return pose;
}
function drawGhost2D(g, Pt) {
  if (!ghostOn || !optForCur()) return;
  const pose = ghostPose('img'); if (!pose) return;
  const B = M.engine?.BONES || [];
  g.save(); g.setLineDash([5, 4]); g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
  for (const [a, b] of B) { const pa = pose[a], pb = pose[b]; if (!pa || !pb) continue; g.beginPath(); g.moveTo(...Pt(pa)); g.lineTo(...Pt(pb)); g.stroke(); }
  g.setLineDash([]);
  const wr = pose[handOf() === 'right' ? 16 : 15];
  if (wr) { const [x, y] = Pt(wr); g.strokeStyle = C.acc; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke(); }
  g.restore();
}
function drawGhost3D(g, pr) {
  if (!ghostOn || !optForCur()) return;
  const pose = ghostPose('world'); if (!pose) return;
  const B = M.engine?.BONES || [];
  g.save(); g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2;
  for (const [a, b] of B) { const A = pr(pose[a]), Bq = pr(pose[b]); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(Bq[0], Bq[1]); g.stroke(); }
  g.restore();
}

// ====================== Annotations : dessin vectoriel synchronisé + notes ======================
const AKEY = 'kyron-annot';
const annKey = () => `${S.session?.id || 'demo'}#${S.strokeIdx}`;
export function annotationsAll() { const a = store.get(AKEY, {}); return a && typeof a === 'object' ? a : {}; }
export function annotationsFor(key = annKey()) { return annotationsAll()[key] || { draw: [], notes: [] }; }
function saveAnn(v) { const all = annotationsAll(); all[annKey()] = v; store.set(AKEY, all); }
let drawing = null;
function bindAnn() {
  const ov = $('#ov'), btn = $('#annBtn');
  if (!ov || !btn) return;
  btn.addEventListener('click', () => {
    annMode = !annMode; btn.setAttribute('aria-pressed', String(annMode));
    $('#scene').classList.toggle('annot', annMode);
    if (annMode) api.stop();
    api.status(annMode ? 'Mode annotation : dessine sur l\'image (le trait reste attaché à cet instant). Ajoute une note en dessous.' : 'Annotation terminée.');
  });
  const pos = (e) => { const b = ov.getBoundingClientRect(), cr = api.contentRect(b.width, b.height); return [clamp((e.clientX - b.left - cr.x) / cr.w, 0, 1), clamp((e.clientY - b.top - cr.y) / cr.h, 0, 1)]; };
  ov.addEventListener('pointerdown', (e) => { if (!annMode) return; e.preventDefault(); ov.setPointerCapture(e.pointerId); drawing = { t: P.frames[P.i]?.t ?? 0, pts: [pos(e)] }; });
  ov.addEventListener('pointermove', (e) => { if (!annMode || !drawing) return; drawing.pts.push(pos(e)); api.redraw(); });
  const end = () => {
    if (!drawing) return;
    if (drawing.pts.length > 1) { const a = annotationsFor(); a.draw.push({ t: +drawing.t.toFixed(4), pts: drawing.pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) }); saveAnn(a); renderAnnList(); }
    drawing = null; api.redraw();
  };
  ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
  $('#annClear').addEventListener('click', () => {
    const a = annotationsFor(), t = P.frames[P.i]?.t ?? 0;
    a.draw = a.draw.filter((d) => Math.abs(d.t - t) > 0.35); saveAnn(a); renderAnnList(); api.redraw();
  });
  $('#annForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = $('#annTxt').value.trim(); if (!txt) return;
    const a = annotationsFor(); a.notes.push({ t: +(P.frames[P.i]?.t ?? 0).toFixed(4), i: P.i, text: txt.slice(0, 400) });
    a.notes.sort((x, y) => x.t - y.t); saveAnn(a); $('#annTxt').value = ''; renderAnnList();
  });
  $('#annList').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'), del = e.target.closest('[data-del]');
    if (go) { api.stop(); api.setCur(api.frameAt(+go.dataset.go)); }
    if (del) { const a = annotationsFor(); a.notes.splice(+del.dataset.del, 1); saveAnn(a); renderAnnList(); }
  });
}
function renderAnnList() {
  const el = $('#annList'); if (!el || !S.session) return;
  const a = annotationsFor(), t0 = P.frames[0]?.t ?? 0;
  $('#annLbl').textContent = `${a.draw.length} dessin${a.draw.length > 1 ? 's' : ''} · ${a.notes.length} note${a.notes.length > 1 ? 's' : ''}`;
  el.innerHTML = a.notes.length ? a.notes.map((n, i) => `<div class="note-it"><button class="ibtn wide" data-go="${n.t}" aria-label="Aller à ${f(n.t - t0, 2)} s">${f(n.t - t0, 2)} s</button><p>${esc(n.text)}</p><button class="ibtn" data-del="${i}" aria-label="Supprimer la note"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 3 8 8M11 3l-8 8"/></svg></button></div>`).join('')
    : '<p class="note">Aucune note sur cette frappe. Place la lecture à l\'instant voulu, écris, puis ajoute : la note y reste attachée.</p>';
}
function drawAnn(g, Pt, cr, fr) {
  const a = annotationsFor(), list = drawing ? [...a.draw, drawing] : a.draw;
  if (!list.length) return;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const d of list) {
    const dt = Math.abs(d.t - fr.t); if (dt > 0.35 && d !== drawing) continue;
    g.globalAlpha = d === drawing ? 1 : clamp(1 - dt / 0.35, 0.15, 1);
    g.strokeStyle = C.acc; g.lineWidth = 3; g.beginPath();
    d.pts.forEach(([x, y], i) => { const X = cr.x + x * cr.w, Y = cr.y + y * cr.h; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.stroke();
  }
  g.restore();
  // Note la plus proche dans le temps : affichée en bas de l'image
  const n = a.notes.find((q) => Math.abs(q.t - fr.t) < 0.2);
  if (n) {
    g.save(); g.font = `12px ${C.body || 'sans-serif'}`; const txt = n.text.length > 70 ? `${n.text.slice(0, 68)}…` : n.text;
    const tw = Math.min(cr.w - 20, g.measureText(txt).width + 20), x = cr.x + (cr.w - tw) / 2, y = cr.y + cr.h - 64;
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(x, y, tw, 26); g.strokeStyle = C.acc; g.strokeRect(x, y, tw, 26);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x + tw / 2, y + 13, tw - 12); g.restore();
  }
}
export { STROKE_FR };
