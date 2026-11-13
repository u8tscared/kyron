// KYRON · Matériel et Balle, vague 2 : vibrations et confort du bras, simulateur d'hybride, carte des rebonds avec
// ellipse de dispersion, calibration du court (automatique + 4 points), profil de rebond par surface.
import { $, $$, f, fi, esc, fit, C, clamp, STROKE_FR } from './util.js';
import { S } from './state.js';
import { M, has } from './core.js';
import { ballStats } from './ana.js';

const P = () => M.physics;
const kpi = (label, val, unit, d, cls = '', dcls = '') => `<div class="kpi ${cls}"><div class="lbl">${label}</div><b>${val}<small>${unit}</small></b><div class="d ${dcls}">${d || '&nbsp;'}</div></div>`;
const srcBadge = (src) => `<span class="src ${src}">${{ mesure: 'Mesuré', estimation: 'Estimé', demo: 'Démo', simulation: 'Simulé' }[src] || src}</span>`;
let bound = false, last = null;
const HY = { mains: { material: 'poly', gauge: 1.25, tension: 24 }, crosses: { material: 'gut', gauge: 1.3, tension: 23 } };

function bind() {
  if (bound) return; bound = true;
  const box = $('#hyCtl');
  if (box && P()) {
    const mats = Object.entries(P().STRINGS).filter(([k]) => k !== 'hybrid');
    const side = (k, l) => `<fieldset class="hyf"><legend>${l}</legend>
      <div class="field"><label for="hy_${k}_m">Matériau</label><select id="hy_${k}_m" data-h="${k}.material">${mats.map(([m, s]) => `<option value="${m}">${esc(s.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="hy_${k}_g">Jauge (mm)</label><select id="hy_${k}_g" data-h="${k}.gauge">${[1.2, 1.25, 1.3, 1.35].map((g) => `<option value="${g}">${f(g, 2)}</option>`).join('')}</select></div>
      <div class="sl"><label for="hy_${k}_t">Tension <output id="hy_${k}_to"></output></label><input type="range" id="hy_${k}_t" min="16" max="30" step="0.5" data-h="${k}.tension"></div></fieldset>`;
    box.innerHTML = side('mains', 'Montants') + side('crosses', 'Travers');
    $$('[data-h]', box).forEach((el) => { const [a, b] = el.dataset.h.split('.'); el.value = String(HY[a][b]); });
    box.addEventListener('input', (e) => {
      const el = e.target.closest('[data-h]'); if (!el) return;
      const [a, b] = el.dataset.h.split('.'); HY[a][b] = b === 'material' ? el.value : +el.value;
      if (last) renderHybrid(last);
    });
    $('#hySwap')?.addEventListener('click', () => { const t = HY.mains; HY.mains = HY.crosses; HY.crosses = t; $$('[data-h]', box).forEach((el) => { const [a, b] = el.dataset.h.split('.'); el.value = String(HY[a][b]); }); if (last) renderHybrid(last); });
  }
  $('#calAuto')?.addEventListener('click', () => calibrate('auto'));
  $('#calManual')?.addEventListener('click', () => calibrate('manual'));
  $('#calCv')?.addEventListener('click', onCalClick);
}

// ====================== Matériel ======================
export function renderMat2(c) {
  bind(); last = c;
  const Pm = P(); if (!Pm) return;
  if (typeof Pm.vibration !== 'function') { $('#vibK').innerHTML = '<p class="empty">Modèle de vibration indisponible pour le moment.</p>'; }
  else {
    const im = Pm.impact(c.imp);
    const v = Pm.vibration(c.rk, c.imp.impactCm, c.imp.offCenter, im);
    const vC = Pm.vibration(c.rk, v.nodesCm[1], 0, im);
    $('#vibK').innerHTML = [
      kpi('Indice de confort', fi(v.comfortIndex), '/100', `${fi(vC.comfortIndex)} au nœud du tamis`, 'hero', v.comfortIndex < 60 ? 'att' : ''),
      kpi('Fréquence propre', fi(v.freqHz), 'Hz', `raquette libre · RA ${fi(c.rk.ra)}`),
      kpi('Vibration au manche', f(v.amplitudeRel, 2), '× réf.', 'réf. = raquette de contrôle frappée en haut du tamis', '', v.amplitudeRel > 0.8 ? 'att' : ''),
      kpi('Choc dans le bras', fi(v.armShockN), 'N', `centre de percussion à ${f(v.copCm, 1)} cm`),
      kpi('Torsion', f(v.twistNm, 1), 'N·m', `décentrage ${f(c.imp.offCenter, 2)} cm`, '', v.twistNm > 20 ? 'att' : ''),
      kpi('Impulsion de la balle', f(v.impulseNs, 2), 'N·s', `contact ${f(im.tContact * 1000, 1)} ms`),
    ].join('');
    drawVib(c, v);
    $('#vibNote').textContent = `Ton point d'impact : ${f(c.imp.impactCm, 1)} cm du bas du manche (réglage « Point d'impact » à gauche). Le bras encaisse le moins quand l'impact tombe entre le nœud de vibration (${f(v.nodesCm[1], 0)} cm) et le centre de percussion (${f(v.copCm, 0)} cm). Modèle de poutre à un mode : à lire en relatif, pas comme une mesure clinique.`;
  }
  renderHybrid(c);
}
function drawVib(c, v) {
  const { g, w, h } = fit($('#vibCv'));
  if (w < 60 || h < 40) return;
  const L = c.rk.length || 68.6, pad = 24, X = (cm) => pad + cm / L * (w - 2 * pad), mid = h * 0.52, A = h * 0.28;
  const beta = 4.730041, sig = 0.982502, shape = (xi) => { const b = beta * xi; return (Math.cosh(b) + Math.cos(b) - sig * (Math.sinh(b) + Math.sin(b))) / 2; };
  // Cadre (manche + tamis) en filigrane
  g.strokeStyle = C.rule2; g.lineWidth = 1; g.strokeRect(X(0), mid - 6, X(17) - X(0), 12);
  g.beginPath(); g.ellipse(X(51.5), mid, Math.max(1, X(68.6) - X(51.5) - 2), 22, 0, 0, Math.PI * 2); g.stroke();
  // Déformée du premier mode
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
  for (let k = 0; k <= 100; k++) { const xi = k / 100, x = X(xi * L), y = mid - shape(xi) * A * 0.9; k ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.setLineDash([3, 4]); g.strokeStyle = C.s3; g.beginPath(); g.moveTo(X(0), mid); g.lineTo(X(L), mid); g.stroke(); g.setLineDash([]);
  g.font = `10px ${C.mono}`; g.textAlign = 'center';
  for (const [i, n] of v.nodesCm.entries()) { g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.beginPath(); g.arc(X(n), mid, 4, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = C.mute; g.fillText(`NŒUD ${f(n, 0)}`, X(n), mid + (i ? 34 : 24)); }
  g.strokeStyle = C.s2; g.beginPath(); g.moveTo(X(v.copCm), mid - A); g.lineTo(X(v.copCm), mid + A); g.stroke(); g.fillStyle = C.mute; g.fillText(`CP ${f(v.copCm, 0)}`, X(v.copCm), mid - A - 6);
  g.fillStyle = C.acc; g.beginPath(); g.arc(X(c.imp.impactCm), mid, 6, 0, Math.PI * 2); g.fill();
  g.fillText('IMPACT', X(c.imp.impactCm), h - 8);
  g.fillStyle = C.mute; g.textAlign = 'left'; g.fillText('MAIN', X(2), mid - 14);
  g.textAlign = 'right'; g.fillText(`${fi(v.freqHz)} HZ`, w - 6, 14);
}
function renderHybrid(c) {
  const Pm = P(); const el = $('#hyT tbody'); if (!el || !Pm) return;
  if (typeof Pm.stringProps !== 'function') { el.innerHTML = '<tr><td colspan="6" class="note">Simulateur d\'hybride indisponible pour le moment.</td></tr>'; return; }
  for (const k of ['mains', 'crosses']) { const o = $(`#hy_${k}_to`); if (o) o.textContent = `${f(HY[k].tension, 1)} kg`; }
  const eq = S.equipment, base = { ...c.imp, rk: c.rk };
  const hy = JSON.parse(JSON.stringify(HY)), inv = { mains: hy.crosses, crosses: hy.mains };
  const rows = [
    { l: `Actuel · ${esc(Pm.stringProps(eq.string).label)}`, s: eq.string, T: c.Tnow, g: eq.gauge, T0: eq.tension },
    { l: `Hybride · ${esc(Pm.stringLabel(hy))}`, s: hy, cur: true },
    { l: `Inversé · ${esc(Pm.stringLabel(inv))}`, s: inv },
  ];
  el.innerHTML = rows.map((r) => {
    const im = Pm.impact({ ...base, string: r.s, tension: r.T, gauge: r.g ?? eq.gauge });
    const pr = Pm.stringProps(r.s), k = Pm.bedStiffness(c.rk, r.s, r.T, r.g ?? eq.gauge);
    const T30 = Pm.tensionAfter(r.s, r.T0, 30, 15), T0 = r.T0 ?? (0.55 * r.s.mains.tension + 0.45 * r.s.crosses.tension);
    return `<tr class="${r.cur ? 'cur' : ''}"><td>${r.l}</td><td class="n">${f(im.speed * 3.6, 1)}</td><td class="n">${fi(im.spinRpm)}</td><td class="n">${fi(im.comfort * 100)}</td><td class="n">${f(k / 1000, 1)}</td><td class="n">−${fi((1 - T30 / T0) * 100)} %</td></tr>`;
  }).join('');
  const pr = Pm.stringProps(hy);
  $('#hyNote').textContent = `Montants ${f(HY.mains.tension, 1)} kg, travers ${f(HY.crosses.tension, 1)} kg. Frottement corde sur corde ${pr.muSS != null ? f(pr.muSS, 2) : '—'} : plus il est bas, plus les montants glissent et reviennent (effet « snapback », ${f(pr.snap, 2)}). Perte de tension : 30 jours, 15 h de jeu. Même geste que le banc.`;
  let rec = null; try { rec = Pm.recommendStrings(base, $('#mGoal button[aria-pressed="true"]')?.dataset.g || 'spin', { hybrids: true }); } catch (e) { rec = null; }
  $('#hyRec').innerHTML = rec?.length ? `<b>Pour l'objectif choisi au panneau 03</b> : ${rec.map((r) => `${esc(r.label)} à ${f(r.tension, 1)} kg`).join(' · ')}.` : '';
}

// ====================== Balle ======================
export function renderBal2(c) {
  bind(); last = c;
  renderBounceMap(c); renderCourtCal(); renderSurfaces(c);
}
function renderBounceMap(c) {
  const el = $('#bmK'); if (!el) return;
  const st = S.swing?.stroke || 'serve';
  const bs = ballStats(st);
  if (!bs || !bs.bounces?.length) {
    el.innerHTML = ''; $('#bmSrc').innerHTML = `Aucune frappe « ${esc(STROKE_FR[st] || st)} » dans la séance : choisis un autre coup en haut.`;
    const { g, w, h } = fit($('#bmCv')); drawCourtTop(g, w, h, st); return;
  }
  const e = bs.ellipse, Pm = P();
  const inRate = bs.map?.inPct != null ? bs.map.inPct / 100 : bs.bounces.filter((b) => b.y > 0 && b.y <= (st === 'serve' ? 6.4 : 11.885) && Math.abs(b.x) <= 4.115).length / bs.bounces.length;
  // Étendue de l'ellipse le long du court (profondeur) et en travers
  const ext = (ang) => (e ? 2 * Math.sqrt((e.rx * Math.cos(e.angle - ang)) ** 2 + (e.ry * Math.sin(e.angle - ang)) ** 2) : null);
  el.innerHTML = [
    kpi('Effet moyen', bs.spinRpm != null ? fi(Math.abs(bs.spinRpm)) : '—', 'tr/min', bs.spinFrom === 'mesure' ? `mesuré sur ${bs.spinN} trajectoire${bs.spinN > 1 ? 's' : ''}` : 'estimé par le modèle d\'impact'),
    kpi('Profondeur', bs.map?.meanDepthM != null ? f(bs.map.meanDepthM, 1) : '—', 'm', 'distance moyenne à la ligne de fond'),
    kpi('Dispersion', e ? `${f(ext(Math.PI / 2), 1)} × ${f(ext(0), 1)}` : '—', 'm', 'longueur × largeur, 95 %'),
    kpi('Balles dans le court', fi(inRate * 100), '%', `${bs.bounces.length} rebonds`),
  ].join('');
  const txt = bs.source === 'mesure' ? 'Rebonds observés dans la vidéo et projetés au sol par la calibration du court.'
    : `Les rebonds ne sont pas observés : chaque frappe de la séance est rejouée ${bs.source === 'demo' ? '(démo)' : ''} avec la dispersion de ton niveau, en visant le milieu de la fenêtre sûre.`;
  $('#bmSrc').innerHTML = `${srcBadge(bs.source)} ${txt}`;
  const { g, w, h } = fit($('#bmCv'));
  const T = drawCourtTop(g, w, h, st);
  for (const b of bs.bounces) { const [x, y] = T(b.x, b.y); g.fillStyle = b.sim ? 'rgba(255,255,255,.55)' : '#fff'; g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); }
  if (e) {
    // Ellipse : axes dans le repère court, tracée point par point (l'échelle n'est pas isotrope)
    g.strokeStyle = C.acc; g.lineWidth = 1.6; g.beginPath();
    for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2, lx = e.rx * Math.cos(a), ly = e.ry * Math.sin(a); const x = e.cx + lx * Math.cos(e.angle) - ly * Math.sin(e.angle), y = e.cy + lx * Math.sin(e.angle) + ly * Math.cos(e.angle); const [px, py] = T(x, y); k ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke(); const [cx, cy] = T(e.cx, e.cy); g.fillStyle = C.acc; g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
  }
}
// Court vu de dessus, moitié adverse (repère : x en travers, y depuis le filet). Renvoie la projection.
function drawCourtTop(g, w, h, st) {
  const L = 11.885, Wd = 5.485, pad = 16;
  const sc = Math.min((w - 2 * pad) / (2 * Wd + 2), (h - 2 * pad) / (L + 3));
  const ox = w / 2, oy = h - pad - 1.2 * sc;
  const T = (x, y) => [ox + x * sc, oy - y * sc];
  g.strokeStyle = C.rule2; g.lineWidth = 1;
  const line = (x1, y1, x2, y2) => { const a = T(x1, y1), b = T(x2, y2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
  line(-Wd, L, Wd, L); line(-Wd, 0, -Wd, L); line(Wd, 0, Wd, L); line(-4.115, 0, -4.115, L); line(4.115, 0, 4.115, L);
  line(-4.115, 6.4, 4.115, 6.4); line(0, 0, 0, 6.4);
  if (st === 'serve') { g.fillStyle = 'rgba(255,255,255,.04)'; const a = T(0, 6.4), b = T(4.115, 0); g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
  g.strokeStyle = '#fff'; g.lineWidth = 2; line(-Wd - 0.9, 0, Wd + 0.9, 0);
  g.font = `9.5px ${C.mono}`; g.fillStyle = C.mute; g.textAlign = 'center'; const nb = T(0, 0); g.fillText('FILET', nb[0], nb[1] + 14);
  return T;
}

// ---------- Calibration du court ----------
// Démo : la calibration de l'image de synthèse reste à part (elle ne concerne pas les squelettes de démo)
const calOf = () => (S.session?.source === 'demo' ? S.demoCourt : S.session?.court) || null;
function setCal(cal) { if (S.session?.source === 'demo') S.demoCourt = cal; else S.session.court = cal; }
let calImg = null, calPts = null, calMsg = '';
function refImage() {
  const st = S.session?.still;
  if (st && st.width) return { cv: st, synthetic: false };
  // Démo : image de court de synthèse, en perspective depuis le fond (pour montrer la détection automatique)
  const W = 480, H = 270, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.fillStyle = '#2d4a63'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3a6a7c'; g.fillRect(0, 0, W, 70);
  if (M.court?.homographyFromPoints && M.court.COURT_LINES) {
    const D = 5.485, L = 11.885;
    const Hm = M.court.homographyFromPoints([{ x: -D, y: -L }, { x: D, y: -L }, { x: D, y: L }, { x: -D, y: L }], [{ x: 40, y: 258 }, { x: 440, y: 258 }, { x: 320, y: 92 }, { x: 160, y: 92 }]);
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 2.2; g.lineCap = 'round';
    for (const [x1, y1, x2, y2] of M.court.COURT_LINES) { const a = M.court.applyHomography(Hm, { x: x1, y: y1 }), b = M.court.applyHomography(Hm, { x: x2, y: y2 }); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    const n1 = M.court.applyHomography(Hm, { x: -6.4, y: 0 }), n2 = M.court.applyHomography(Hm, { x: 6.4, y: 0 });
    g.strokeStyle = 'rgba(20,20,20,.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(n1.x, n1.y - 1); g.lineTo(n2.x, n2.y - 1); g.stroke();
  }
  return { cv, synthetic: true };
}
function calibrate(mode) {
  if (!has('court', 'calibrateCourt')) { calMsg = 'Module de calibration du court indisponible pour le moment.'; renderCourtCal(); return; }
  calImg = calImg || refImage();
  if (mode === 'auto') {
    calPts = null;
    const t0 = performance.now();
    let cal = null;
    try { const id = calImg.cv.getContext('2d').getImageData(0, 0, calImg.cv.width, calImg.cv.height); cal = M.court.calibrateCourt(id); } catch (e) { cal = null; }
    if (cal && S.session) { setCal(cal); calMsg = `Court détecté automatiquement en ${fi(performance.now() - t0)} ms, confiance ${fi((cal.conf || 0) * 100)} %${calImg.synthetic ? ' (image de synthèse : démo)' : ''}.`; }
    else calMsg = 'Lignes du court non trouvées automatiquement. Clique les 4 coins du court en simple à la main.';
  } else { calPts = []; calMsg = 'Clique les 4 coins du court en simple : fond proche gauche, fond proche droite, fond éloigné droite, fond éloigné gauche.'; }
  renderCourtCal();
}
function onCalClick(e) {
  if (!calPts || !calImg) return;
  const cv = $('#calCv'), b = cv.getBoundingClientRect(), r = calRect(b.width, b.height);
  const x = (e.clientX - b.left - r.x) / r.w, y = (e.clientY - b.top - r.y) / r.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  calPts.push({ x, y });
  if (calPts.length === 4) {
    const cal = M.court.calibrateManual?.(calPts, { width: calImg.cv.width, height: calImg.cv.height });
    if (cal && S.session) { setCal(cal); calMsg = 'Calibration manuelle enregistrée : les positions au sol sont maintenant en mètres.'; }
    else calMsg = 'Ces 4 points ne forment pas un court plausible : recommence dans l\'ordre indiqué.';
    calPts = null;
  } else calMsg = `Point ${calPts.length} / 4 placé. ${['', 'Suivant : fond proche droite.', 'Suivant : fond éloigné droite.', 'Suivant : fond éloigné gauche.'][calPts.length]}`;
  renderCourtCal();
}
function calRect(w, h) { const iw = calImg.cv.width, ih = calImg.cv.height, s = Math.min(w / iw, h / ih); return { x: (w - iw * s) / 2, y: (h - ih * s) / 2, w: iw * s, h: ih * s }; }
function renderCourtCal() {
  const cv = $('#calCv'); if (!cv) return;
  if (!S.session?.still && calImg && !calImg.synthetic) calImg = null;
  if (S.session?.still && calImg?.synthetic) calImg = null;
  calImg = calImg || refImage();
  const { g, w, h } = fit(cv);
  const r = calRect(w, h);
  g.globalAlpha = 0.75; g.drawImage(calImg.cv, r.x, r.y, r.w, r.h); g.globalAlpha = 1;
  const cal = calOf();
  if (cal && M.court?.toImage && M.court.COURT_LINES) {
    g.strokeStyle = C.acc; g.lineWidth = 1.6;
    for (const [x1, y1, x2, y2] of M.court.COURT_LINES) {
      const a = M.court.toImage(cal, { x: x1, y: y1 }), b = M.court.toImage(cal, { x: x2, y: y2 });
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      g.beginPath(); g.moveTo(r.x + a.x * r.w, r.y + a.y * r.h); g.lineTo(r.x + b.x * r.w, r.y + b.y * r.h); g.stroke();
    }
  }
  (calPts || []).forEach((p, i) => { const x = r.x + p.x * r.w, y = r.y + p.y * r.h; g.fillStyle = C.acc; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = `10px ${C.mono}`; g.fillText(String(i + 1), x + 8, y - 6); });
  const cam = cal?.camera, ce = cam?.center;
  const hgt = cam?.heightM ?? (ce ? ce.z ?? ce[2] : null);
  $('#calK').innerHTML = cal ? [
    kpi('Source', cal.source === 'manual' ? 'MANUELLE' : 'AUTO', '', cal.source === 'manual' ? '4 points cliqués' : `${cal.lines ?? '—'} droites trouvées`),
    kpi('Confiance', fi((cal.conf ?? 0) * 100), '%', ''),
    kpi('Hauteur caméra', Number.isFinite(hgt) ? f(hgt, 1) : '—', 'm', 'estimée par la perspective'),
    kpi('Focale', Number.isFinite(cam?.f) ? fi(cam.f) : '—', 'px', `image ${cal.width} × ${cal.height}`),
  ].join('') : '';
  $('#calMsg').textContent = calMsg || (calImg.synthetic ? 'Démo : image de court de synthèse. Avec ta vidéo, la dernière image sert de référence (caméra fixe).' : 'Image de référence : dernière image de ta vidéo.');
  $('#calCv').classList.toggle('picking', !!calPts);
}

// ---------- Rebond selon la surface ----------
function renderSurfaces(c) {
  const Pm = P(), el = $('#sfT tbody'); if (!el || !Pm) return;
  if (typeof Pm.bounceProfile !== 'function') { el.innerHTML = '<tr><td colspan="6" class="note">Profil de rebond indisponible pour le moment.</td></tr>'; return; }
  const im = Pm.impact(c.imp);
  const res = Object.entries(Pm.SURFACES).map(([k, s]) => ({ k, s, b: Pm.bounceProfile(im.speed, im.launch, im.spinRpm, k, { h0: c.h0, x0: 0, rho: c.rho, wind: c.wind }) }));
  el.innerHTML = res.map(({ k, s, b }) => (b ? `<tr class="${k === c.surface ? 'cur' : ''}"><td>${esc(s.label)}<br><small class="note">rapidité ${fi(b.courtPace)}</small></td><td class="n">${fi(b.out.kmh)} km/h<br><small class="note">${fi(b.speedKeptPct)} % gardés</small></td><td class="n">${f(b.out.angleDeg, 1)}°<br><small class="note">${b.kick >= 0 ? '+' : '−'}${f(Math.abs(b.kick), 1)}° kick</small></td><td class="n">${f(b.peakH, 2)} m</td><td class="n">${b.heightAtReceiver != null ? `${f(b.heightAtReceiver, 2)} m` : '—'}</td><td>${b.slide ? 'glisse' : 'roule'}</td></tr>`
    : `<tr><td>${esc(s.label)}</td><td colspan="5" class="note">pas de rebond (balle dans le filet)</td></tr>`)).join('');
  // Courbes après le rebond, une par surface
  const { g, w, h } = fit($('#sfCv'));
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const ok = res.filter((r) => r.b);
  if (!ok.length) return;
  const xMax = 9, yMax = Math.max(1.5, ...ok.map((r) => r.b.peakH)) * 1.15;
  const X = (x) => pad.l + x / xMax * (w - pad.l - pad.r), Y = (y) => h - pad.b - y / yMax * (h - pad.t - pad.b);
  g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.strokeStyle = C.rule; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let y = 0; y <= yMax; y += 0.5) { g.beginPath(); g.moveTo(pad.l, Y(y)); g.lineTo(w - pad.r, Y(y)); g.stroke(); g.fillText(`${f(y, 1)}`, pad.l - 4, Y(y)); }
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; for (let x = 0; x <= xMax; x += 2) g.fillText(`${x} m`, X(x), h - 6);
  const cols = { hard: '#fff', clay: C.s2, grass: C.s3, indoor: C.s4 };
  for (const { k, b } of ok) {
    const vx = b.out.vx, vy = b.out.vy, gr = 9.81;
    g.strokeStyle = cols[k] || '#fff'; g.lineWidth = k === c.surface ? 2.4 : 1.4; g.setLineDash(k === c.surface ? [] : [4, 3]); g.beginPath();
    for (let t = 0; t <= 1.2; t += 0.01) { const x = vx * t, y = vy * t - gr * t * t / 2; if (y < 0 || x > xMax) break; t ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }
    g.stroke(); g.setLineDash([]);
  }
  g.fillStyle = C.acc; g.beginPath(); g.arc(X(0), Y(0), 4, 0, Math.PI * 2); g.fill();
  $('#sfLeg').innerHTML = ok.map(({ k, s }) => `<span><i class="${k === c.surface ? '' : 'dash'}" style="--c:${cols[k]}"></i>${esc(s.label)}</span>`).join('') + '<span><i class="dot" style="--c:var(--acc)"></i>Rebond</span>';
}
