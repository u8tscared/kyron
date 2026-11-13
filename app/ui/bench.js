// KYRON · bancs Matériel et Balle (repris de materiel-v0), branchés sur le profil et la dernière analyse
import { $, $$, f, fi, esc, fit, C, clamp, on, emit, DISP, STROKE_FR, analyzable } from './util.js';
import { S, cur } from './state.js';
import { M } from './core.js';
import { SWING_DEF, swingFromAnalysis, racketOf, tensionNow } from './physics-ui.js';
import { renderMat2, renderBal2 } from './bench2.js';

let built = false, raf = 0, mcWorker = null, mcTimer = 0, mcKey = '';
const P = () => M.physics;
const view = () => (!$('#v-materiel').hidden ? 'materiel' : !$('#v-balle').hidden ? 'balle' : null);

export function show(r) {
  if (!P()) { $(r === 'balle' ? '#bAside' : '#mAside').innerHTML = '<p class="empty">Module de physique indisponible pour le moment.</p>'; return; }
  if (!built) build();
  if (!S.swing) S.swing = { stroke: analyzable(cur()?.type || 'serve'), ...swingFromAnalysis(cur()?.type || 'serve') };
  sync();
  schedule();
}

function build() {
  built = true;
  $('#mAside').innerHTML = racketFs('m') + leadsFs('m') + stringFs('m') + swingFs('m');
  $('#bAside').innerHTML = swingFs('b') + condFs('b') + `<fieldset><legend><i>03</i>Matériel</legend><p class="hint" id="b_eq"></p><a class="btn sm" href="#materiel">Régler le matériel</a></fieldset>`;
  // Sur téléphone, les groupes de réglages se replient (seul le premier reste ouvert)
  const narrow = matchMedia('(max-width: 980px)').matches;
  for (const id of ['#mAside', '#bAside']) {
    $$(`${id} fieldset`).forEach((fs, i) => {
      const lg = fs.querySelector('legend'); if (!lg) return;
      lg.setAttribute('role', 'button'); lg.tabIndex = 0; lg.classList.add('tog');
      if (narrow && i > 0) fs.classList.add('closed');
      lg.setAttribute('aria-expanded', String(!fs.classList.contains('closed')));
      const t = () => { fs.classList.toggle('closed'); lg.setAttribute('aria-expanded', String(!fs.classList.contains('closed'))); };
      lg.addEventListener('click', t); lg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t(); } });
    });
  }
  for (const id of ['#mAside', '#bAside']) {
    $(id).addEventListener('input', onInput);
    $(id).addEventListener('change', onInput);
    $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-reset]'); if (b) { resetSwing(); } });
  }
  for (const id of ['#mStroke', '#bStroke']) $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const st = b.dataset.s;
    S.swing = { stroke: st, ...swingFromAnalysis(st) };
    sync(); schedule();
  });
  $('#mGoal').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#mGoal button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); schedule(); });
  $('#mcBtn').onclick = () => runMC(true);
  on('session', () => { S.swing = null; if (view()) show(view()); });
  on('stroke', () => { S.swing = null; if (view()) show(view()); });
  on('equipment-set', () => { sync(); schedule(); });
  on('profile', () => { if (view()) schedule(); });
  on('opt', () => { if (S.opt.status === 'done' && S.swing?.fromAnalysis && !S.swing.anglesFromOpt) { S.swing = null; if (view()) show(view()); } });
  on('mode', () => { if (view()) schedule(); });
  addEventListener('resize', () => { if (view()) schedule(); });
}

// ---------- Champs ----------
const sl = (id, label, min, max, step, bind) => `<div class="sl"><label for="${id}">${label} <output id="${id}o"></output></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" data-bind="${bind}"></div>`;
function racketFs(p) {
  const R = P().RACKETS;
  const num = (k, l, st) => `<div class="field"><label for="${p}_${k}">${l}</label><input type="number" id="${p}_${k}" step="${st}" data-spec="${k}"></div>`;
  return `<fieldset><legend><i>01</i>Raquette</legend><select class="full" id="${p}_preset" data-bind="equipment.racket" aria-label="Modèle de raquette">${R.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
    ${num('mass', 'Masse cordée (g)', 1)}${num('balance', 'Équilibre (cm du bas)', 0.1)}${num('sw', 'Swingweight (kg·cm²)', 1)}${num('tw', 'Twistweight (kg·cm²)', 0.1)}${num('ra', 'Rigidité (RA)', 1)}${num('head', 'Tamis (in²)', 1)}
    <div class="field"><label for="${p}_pattern">Plan de cordage</label><select id="${p}_pattern" data-spec="pattern"><option>16x19</option><option>18x20</option></select></div></fieldset>`;
}
function leadsFs(p) {
  return `<fieldset><legend><i>02</i>Plombs (grammes)</legend>${Object.entries(P().LEAD_SPOTS).map(([k, s]) => sl(`${p}_ld_${k}`, esc(s.label), 0, 8, 0.5, `leads.${k}`)).join('')}</fieldset>`;
}
function stringFs(p) {
  return `<fieldset><legend><i>03</i>Cordage</legend>
    <div class="field"><label for="${p}_mat">Matériau</label><select id="${p}_mat" data-bind="equipment.string">${Object.entries(P().STRINGS).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('')}</select></div>
    <div class="field"><label for="${p}_gauge">Jauge (mm)</label><select id="${p}_gauge" data-bind="equipment.gauge">${[1.2, 1.25, 1.3, 1.35].map((g) => `<option value="${g}">${f(g, 2)}</option>`).join('')}</select></div>
    ${sl(`${p}_T`, 'Tension à la pose', 16, 30, 0.5, 'equipment.tension')}${sl(`${p}_days`, 'Jours depuis la pose', 0, 60, 1, 'equipment.days')}${sl(`${p}_hours`, 'Heures jouées depuis', 0, 40, 0.5, 'equipment.hours')}</fieldset>`;
}
function swingFs(p) {
  return `<fieldset><legend><i>${p === 'm' ? '04' : '01'}</i>Geste</legend>
    ${sl(`${p}_V`, "Vitesse de raquette à l'impact", 60, 200, 1, 'swing.V')}${sl(`${p}_A`, 'Trajectoire de raquette (+ = monte)', -15, 45, 0.5, 'swing.A')}
    ${sl(`${p}_P`, 'Angle de face (+ = ouverte)', -15, 20, 0.5, 'swing.P')}${sl(`${p}_U`, 'Balle qui arrive', 0, 140, 1, 'swing.U')}
    ${sl(`${p}_H`, 'Hauteur de contact', 0.4, 3.2, 0.01, 'swing.H')}${sl(`${p}_I`, "Point d'impact (cm du bas)", 44, 64, 0.5, 'swing.I')}${sl(`${p}_O`, 'Décentrage latéral', -4, 4, 0.25, 'swing.O')}
    <p class="hint" id="${p}_from"></p><button class="btn sm" type="button" data-reset>Reprendre la dernière analyse</button></fieldset>`;
}
function condFs(p) {
  return `<fieldset><legend><i>02</i>Conditions</legend>
    <div class="field"><label for="${p}_surf">Surface</label><select id="${p}_surf" data-bind="conditions.surface">${Object.entries(P().SURFACES).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('')}</select></div>
    ${sl(`${p}_alt`, 'Altitude', 0, 2500, 50, 'conditions.alt')}${sl(`${p}_temp`, 'Température', 0, 40, 1, 'conditions.temp')}${sl(`${p}_wind`, 'Vent (+ = dans le dos)', -8, 8, 0.5, 'conditions.wind')}</fieldset>`;
}
function resetSwing() { S.swing = { stroke: S.swing?.stroke || 'serve', ...swingFromAnalysis(S.swing?.stroke || 'serve') }; sync(); schedule(); }

const get = (path) => { const [a, b] = path.split('.'); return a === 'leads' ? S.equipment.leads[b] : S[a][b]; };
function set(path, v) {
  const [a, b] = path.split('.');
  if (a === 'leads') S.equipment.leads[b] = v; else S[a][b] = v;
  if (a === 'swing') S.swing.fromAnalysis = false;
}
function onInput(e) {
  const el = e.target;
  if (el.dataset.bind) {
    const path = el.dataset.bind;
    let v = el.type === 'range' || path.endsWith('gauge') ? +el.value : el.value;
    if (path === 'equipment.racket') { S.equipment.spec = null; }
    set(path, v);
  } else if (el.dataset.spec) {
    const base = S.equipment.spec || P().RACKETS.find((r) => r.id === S.equipment.racket);
    S.equipment.spec = { ...base, name: 'Ma raquette', [el.dataset.spec]: el.dataset.spec === 'pattern' ? el.value : +el.value };
  } else return;
  if (!el.dataset.bind?.startsWith('swing') && !el.dataset.bind?.startsWith('conditions')) emit('equipment', S.equipment);
  else if (el.dataset.bind?.startsWith('conditions')) emit('equipment', S.equipment);
  sync(el); schedule();
}

// Recopie l'état dans les deux panneaux de réglages (sauf le champ en cours d'édition)
function sync(skip) {
  const eq = S.equipment, base = eq.spec || P().RACKETS.find((r) => r.id === eq.racket);
  $$('[data-bind]').forEach((el) => { if (el !== skip) { const v = get(el.dataset.bind); if (v != null) el.value = String(v); } });
  $$('[data-spec]').forEach((el) => { if (el !== skip) el.value = String(base[el.dataset.spec]); });
  const sw = S.swing;
  const out = {
    T: `${f(eq.tension, 1)} kg`, days: `${eq.days} j`, hours: `${f(eq.hours, 1)} h`,
    V: `${fi(sw.V)} km/h`, A: `${f(sw.A, 1)}°`, P: `${f(sw.P, 1)}°`, U: `${fi(sw.U)} km/h`, H: `${f(sw.H, 2)} m`, I: `${f(sw.I, 1)} cm`, O: `${f(sw.O, 2)} cm`,
    alt: `${S.conditions.alt} m`, temp: `${S.conditions.temp} °C`, wind: `${f(S.conditions.wind, 1)} m/s`,
  };
  for (const p of ['m', 'b']) {
    for (const [k, v] of Object.entries(out)) { const o = $(`#${p}_${k}o`); if (o) o.textContent = v; }
    for (const k of Object.keys(P().LEAD_SPOTS)) { const o = $(`#${p}_ld_${k}o`); if (o) o.textContent = `${f(eq.leads[k] || 0, 1)} g`; }
    const vo = $(`#${p}_Vo`); if (vo) vo.className = sw.fromAnalysis ? 'from' : '';
    const fr = $(`#${p}_from`); if (fr) fr.innerHTML = sw.fromAnalysis ? `<span class="acc">●</span> Vitesse et hauteur reprises de la frappe analysée (${esc(STROKE_FR[cur()?.type] || '')})${sw.anglesFromOpt ? ', angles de raquette et de face estimés par l\'optimiseur' : ''}.` : `Geste type d'un joueur de compétition${cur() ? ', ou modifié à la main' : ''}.`;
  }
  for (const id of ['#mStroke', '#bStroke']) $$(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === sw.stroke)));
  const be = $('#b_eq'); if (be) { const rk = racketOf(); be.textContent = `${rk.name} · ${P().STRINGS[eq.string].label} ${f(eq.gauge, 2)} mm · ${f(tensionNow(), 1)} kg aujourd'hui.`; }
}

function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

// ---------- Calculs ----------
function read() {
  const eq = S.equipment, sw = S.swing;
  const baseSpec = eq.spec || P().RACKETS.find((r) => r.id === eq.racket);
  const stock = P().customize(baseSpec, {}), rk = P().customize(baseSpec, eq.leads);
  const Tnow = tensionNow(eq);
  const imp = { rk, string: eq.string, tension: Tnow, gauge: eq.gauge, V: sw.V / 3.6, alpha: sw.A, phi: sw.P, u: sw.U / 3.6, impactCm: sw.I, offCenter: sw.O };
  const rho = P().airDensity(S.conditions.alt, S.conditions.temp, S.conditions.hum);
  return { eq, sw, stock, rk, Tnow, imp, rho, h0: sw.H, wind: S.conditions.wind, surface: S.conditions.surface, target: SWING_DEF[sw.stroke].target };
}
const kpi = (label, val, unit, d, cls = '', dcls = '') => `<div class="kpi ${cls}"><div class="lbl">${label}</div><b>${val}<small>${unit}</small></b><div class="d ${dcls}">${d || '&nbsp;'}</div></div>`;
const sgn = (v, d = 1, u = '') => Math.abs(v) < 10 ** -d / 2 ? 'stock' : `${v > 0 ? '+' : '−'}${f(Math.abs(v), d)}${u} vs stock`;

function render() {
  const v = view(); if (!v || !P() || !S.swing) return;
  const c = read();
  if (v === 'materiel') renderMateriel(c); else renderBalle(c);
  try { if (v === 'materiel') renderMat2(c); else renderBal2(c); } catch (e) { console.warn('[kyron] banc v2', e); }
}

function renderMateriel(c) {
  const Pm = P(), rk = c.rk, s0 = c.stock;
  const im = Pm.impact(c.imp), im0 = Pm.impact({ ...c.imp, rk: s0 });
  const Me = Pm.effectiveMass(rk, c.imp.impactCm), Me0 = Pm.effectiveMass(s0, c.imp.impactCm);
  const hl = (rk.balance - 68.58 / 2) / 0.3175;
  $('#rkK').innerHTML = [
    kpi('Masse', f(rk.mass, 1), 'g', sgn(rk.mass - s0.mass, 1, ' g')),
    kpi('Équilibre', f(rk.balance, 1), 'cm', hl < 0 ? `${f(-hl, 1)} pts tête légère` : `${f(hl, 1)} pts tête lourde`),
    kpi('Swingweight', f(rk.sw, 1), 'kg·cm²', sgn(rk.sw - s0.sw, 1)),
    kpi('Twistweight', f(rk.tw, 2), 'kg·cm²', sgn(rk.tw - s0.tw, 2)),
    kpi('Masse effective', f(Me * 1000, 0), 'g', sgn((Me - Me0) * 1000, 0, ' g')),
    kpi('Balle', f(im.speed * 3.6, 0), 'km/h', sgn((im.speed - im0.speed) * 3.6, 1, ' km/h'), 'hero', im.speed > im0.speed + 0.01 ? 'up' : ''),
    ...(S.mode === 'adv' ? [kpi('Centre de percussion', f(rk.cop, 1), 'cm', 'pivot à 10 cm'), kpi('Effort de swing', f(rk.sw / s0.sw * 100, 1), '%', 'à vitesse égale, ∝ SW')] : []),
  ].join('');
  drawRacket(rk, c.eq.leads, c.imp.impactCm);
  // Cordage
  const k = Pm.bedStiffness(rk, c.eq.string, c.Tnow, c.eq.gauge);
  const loss = (1 - c.Tnow / c.eq.tension) * 100;
  const Sx = Pm.STRINGS[c.eq.string], poly = c.eq.string.includes('poly');
  $('#stK').innerHTML = [
    kpi("Tension aujourd'hui", f(c.Tnow, 1), 'kg', `−${f(loss, 1)} % depuis la pose`, 'hero', loss >= 20 ? 'att' : ''),
    kpi('Raideur du lit', f(k / 1000, 1), 'kN/m', ''),
    kpi('Temps de contact', f(im.tContact * 1000, 2), 'ms', ''),
    kpi('Restitution', f(im.e, 3), '', 'COR balle / cordage'),
  ].join('');
  $('#stAlert').innerHTML = loss >= 20 || (poly && c.eq.hours >= 15)
    ? `<div class="alert"><b>Recorder maintenant.</b> Ton ${esc(Sx.label.toLowerCase())} a perdu ${f(loss, 0)} % de tension${poly ? ` et compte ${f(c.eq.hours, 0)} h de jeu : un polyester perd son retour élastique (moins d'effet, plus de chocs dans le bras) bien avant de casser` : ''}.</div>`
    : `<p class="note" style="margin-top:12px">Recordage conseillé dans environ ${daysLeft(c)} jours au rythme actuel.</p>`;
  drawTension(c);
  const goal = $('#mGoal [aria-pressed="true"]')?.dataset.g || 'spin';
  const recs = Pm.recommendStrings({ ...c.imp, rk }, goal);
  $('#recs').innerHTML = recs.map((r, i) => `<div class="rec"><span class="lbl">${i === 0 ? 'Meilleur choix' : 'Alternative ' + i}</span><b>${esc(Pm.STRINGS[r.string].label)} ${f(r.gauge, 2)} mm · ${f(r.tension, 0)} kg</b><span class="m">${f(r.speed, 0)} km/h · ${f(r.spin, 0)} tr/min</span><span class="m">contrôle ${f(r.control * 100, 0)} % · confort ${f(r.comfort * 100, 0)} %${S.mode === 'adv' ? ` · contact ${f(r.tContact * 1000, 2)} ms` : ''}</span><button class="btn sm" data-str="${r.string}" data-g="${r.gauge}" data-t="${r.tension}" style="margin-top:8px;justify-self:start">Monter ce cordage</button></div>`).join('');
  $$('#recs [data-str]').forEach((b) => { b.onclick = () => { Object.assign(S.equipment, { string: b.dataset.str, gauge: +b.dataset.g, tension: +b.dataset.t, days: 0, hours: 0 }); emit('equipment', S.equipment); sync(); schedule(); }; });
  // Impact
  $('#imK').innerHTML = [
    kpi('Vitesse de balle', f(im.speed * 3.6, 0), 'km/h', c.imp.u > 0 ? `balle entrante ${fi(c.imp.u * 3.6)} km/h` : 'balle lancée', 'hero'),
    kpi('Effet', f(Math.abs(im.spinRpm), 0), 'tr/min', im.spinRpm >= 0 ? 'lift' : 'slice'),
    kpi('Angle de départ', f(im.launch, 1), '°', '+ = vers le haut'),
    kpi('Force maximale', f(im.peakForce, 0), 'N', `≈ ${f(im.peakForce / 9.81, 0)} kg pendant ${f(im.tContact * 1000, 1)} ms`),
    kpi('Confort', f(im.comfort * 100, 0), '%', 'vibrations transmises', '', im.comfort < 0.45 ? 'att' : ''),
    kpi('Restitution apparente', f(im.eA, 3), '', 'raquette libre'),
  ].join('');
  // Comparateur (succès avec la dispersion du niveau)
  const nom = { v: im.speed, launch: im.launch, spinRpm: im.spinRpm, h0: c.h0, rho: c.rho, wind: c.wind, surface: c.surface };
  const disp = DISP[S.profile.level] || DISP.competition;
  const rows = [{ ...(c.eq.spec || Pm.RACKETS.find((r) => r.id === c.eq.racket)), name: 'Ta raquette (réglée)', id: 'mine', leads: c.eq.leads }, ...Pm.RACKETS.map((r) => ({ ...r, leads: {} }))];
  $('#cmp tbody').innerHTML = rows.map((r) => {
    const rk2 = Pm.customize(r, r.leads);
    const sf = typeof Pm.swingSpeedFactor === 'function' ? Pm.swingSpeedFactor(rk2, c.rk) : 1;
    const i2 = Pm.impact({ ...c.imp, rk: rk2, V: c.imp.V * (Number.isFinite(sf) ? sf : 1) });
    let launch = i2.launch;
    if (typeof Pm.launchWindow === 'function') { try { const lw = Pm.launchWindow({ v: i2.speed, spinRpm: i2.spinRpm, h0: c.h0, rho: c.rho, wind: c.wind, target: c.target }); const lo = lw?.lo ?? lw?.[0], hi = lw?.hi ?? lw?.[1]; if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) launch = (lo + hi) / 2; } catch (e) { /* angle actuel */ } }
    const sr = Pm.successRate({ ...nom, v: i2.speed, spinRpm: i2.spinRpm, launch }, c.target, disp, 250);
    return `<tr class="${r.id === 'mine' ? 'cur' : ''}"><td>${esc(r.name)}</td><td class="n">${f(rk2.mass, 0)} g</td><td class="n">${f(rk2.sw, 0)}</td><td class="n">${f(i2.speed * 3.6, 0)} km/h</td><td class="n">${f(Math.abs(i2.spinRpm), 0)}</td><td class="n">${f(i2.comfort * 100, 0)} %</td><td class="n">${f(sr.rate * 100, 0)} %</td></tr>`;
  }).join('');
}

function daysLeft(c) {
  const e = c.eq;
  for (let d = e.days; d <= e.days + 120; d++) {
    const h = e.hours + (d - e.days) * (e.days ? e.hours / e.days : 1);
    if (P().tensionAfter(e.string, e.tension, d, h) <= e.tension * 0.8 || (e.string.includes('poly') && h >= 15)) return d - e.days;
  }
  return '120+';
}

function drawRacket(rk, leads, impactCm) {
  const { g, w, h } = fit($('#rkCv'));
  const L = 68.6, sc = (h - 30) / L, cx = w / 2, y = (cm) => h - 15 - cm * sc;
  const headLen = 33, headW = 25, hy = y(L - headLen / 2);
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
  for (let i = -7; i <= 7; i++) { const x = cx + i * headW / 16 * sc; const dy = headLen / 2 * sc * Math.sqrt(Math.max(0, 1 - (i / 8) ** 2)); g.beginPath(); g.moveTo(x, hy - dy); g.lineTo(x, hy + dy); g.stroke(); }
  for (let j = -8; j <= 8; j++) { const yy = hy + j * headLen / 19 * sc; const dx = headW / 2 * sc * Math.sqrt(Math.max(0, 1 - (j / 9.5) ** 2)); g.beginPath(); g.moveTo(cx - dx, yy); g.lineTo(cx + dx, yy); g.stroke(); }
  g.strokeStyle = C.ink2; g.lineWidth = 2;
  g.beginPath(); g.ellipse(cx, hy, headW / 2 * sc, headLen / 2 * sc, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - 1.4 * sc, y(24)); g.lineTo(cx - headW / 2.6 * sc, y(L - headLen + 1)); g.moveTo(cx + 1.4 * sc, y(24)); g.lineTo(cx + headW / 2.6 * sc, y(L - headLen + 1)); g.stroke();
  g.strokeRect(cx - 1.6 * sc, y(24), 3.2 * sc, 24 * sc);
  const narrow = w < 360, ext = narrow ? 44 : 70;
  const mark = (cm, label, col, side) => { g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx - ext, y(cm)); g.lineTo(cx + ext, y(cm)); g.stroke(); g.setLineDash([]); g.font = `${narrow ? 9.5 : 10.5}px ${C.mono}`; g.textAlign = side > 0 ? 'left' : 'right'; g.textBaseline = 'middle'; g.fillText(label, side > 0 ? cx + ext + 6 : cx - ext - 6, y(cm)); };
  mark(rk.balance, `ÉQUILIBRE ${f(rk.balance, 1)}`, C.ink, 1);
  mark(rk.cop, `PERCUSSION ${f(rk.cop, 1)}`, C.mute, -1);
  mark(impactCm, `IMPACT ${f(impactCm, 1)}`, C.acc, impactCm > rk.cop - 2 && impactCm < rk.cop + 2 ? 1 : -1);
  g.fillStyle = C.acc;
  for (const [k, gr] of Object.entries(leads)) {
    if (!gr) continue; const s = P().LEAD_SPOTS[k]; const r = 3 + gr * 0.7;
    const pts = s.lat ? [-1, 1].map((sd) => [cx + sd * Math.min(headW / 2 - 0.5, s.lat) * sc, y(s.d)]) : [[cx, y(s.d)]];
    for (const [px, py] of pts) { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); }
  }
}

function drawTension(c) {
  const { g, w, h } = fit($('#stCv'));
  const e = c.eq, pad = { l: 34, r: 10, t: 10, b: 22 }, X = (d) => pad.l + d / 60 * (w - pad.l - pad.r);
  const lo = e.tension * 0.6, hi = e.tension * 1.02, Y = (t) => pad.t + (1 - (t - lo) / (hi - lo)) * (h - pad.t - pad.b);
  g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.strokeStyle = C.rule; g.lineWidth = 1;
  for (const t of [lo, (lo + hi) / 2, e.tension]) { g.beginPath(); g.moveTo(pad.l, Y(t)); g.lineTo(w - pad.r, Y(t)); g.stroke(); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(f(t, 0), pad.l - 6, Y(t)); }
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; for (const d of [0, 15, 30, 45, 60]) g.fillText(`${d} j`, X(d), h - 6);
  g.strokeStyle = C.acc; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(pad.l, Y(e.tension * 0.8)); g.lineTo(w - pad.r, Y(e.tension * 0.8)); g.stroke(); g.setLineDash([]);
  const rate = e.days ? e.hours / e.days : 1;
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
  for (let d = 0; d <= 60; d += 0.5) { const t = P().tensionAfter(e.string, e.tension, d, d * rate); d === 0 ? g.moveTo(X(d), Y(t)) : g.lineTo(X(d), Y(t)); }
  g.stroke();
  g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.beginPath(); g.arc(X(e.days), Y(c.Tnow), 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = C.ink; g.textAlign = X(e.days) > w - 90 ? 'right' : 'left'; g.fillText(`AUJ. ${f(c.Tnow, 1)} KG`, X(e.days) + (X(e.days) > w - 90 ? -8 : 8), Y(c.Tnow) - 8);
}

// ---------- Balle ----------
function renderBalle(c) {
  const Pm = P();
  const im = Pm.impact(c.imp);
  const nom = { v: im.speed, launch: im.launch, spinRpm: im.spinRpm, h0: c.h0, rho: c.rho, wind: c.wind, surface: c.surface };
  const tr = Pm.flight(nom), flat = Pm.flight({ ...nom, spinRpm: 0 }), vac = Pm.flight({ ...nom, spinRpm: 0, rho: 0 });
  const ok = Pm.isIn(tr, c.target);
  $('#trLbl').innerHTML = ok.ok ? 'balle bonne' : `<span class="acc">${ok.why === 'filet' ? 'balle dans le filet' : 'balle longue'}</span>`;
  drawCourt(tr, flat, vac, c.target);
  const lim = c.target === 'service' ? Pm.COURT.service : Pm.COURT.base;
  $('#trK').innerHTML = [
    kpi('Vitesse au départ', f(im.speed * 3.6, 0), 'km/h', `effet ${f(Math.abs(im.spinRpm), 0)} tr/min ${im.spinRpm >= 0 ? 'lift' : 'slice'}`, 'hero'),
    kpi('Hauteur au filet', tr.netY != null ? f(tr.netY, 2) : '—', 'm', tr.netY != null ? `marge ${f((tr.netY - 0.914 - 0.0335) * 100, 0)} cm` : '', '', tr.netY != null && tr.netY - 0.95 < 0.15 ? 'att' : ''),
    kpi('Rebond à', tr.bounce ? f(tr.bounce.x, 2) : '—', 'm', tr.bounce ? `${f(lim - tr.bounce.x, 2)} m avant la ligne` : '', '', tr.bounce && lim - tr.bounce.x < 0.5 ? 'att' : ''),
    kpi('Vitesse au rebond', tr.bounce ? f(tr.bounce.speed, 0) : '—', 'km/h', tr.bounce ? `−${f((1 - tr.bounce.speed / (im.speed * 3.6)) * 100, 0)} % dans l'air` : ''),
    kpi('Hauteur du rebond', tr.after ? f(tr.after.peak, 2) : '—', 'm', tr.after ? `angle ${f(tr.after.angle, 0)}°` : ''),
    kpi('Temps de vol', f(tr.flightTime * 1000, 0), 'ms', `air ${f(c.rho, 3)} kg/m³`),
  ].join('');
  // Marge Monte-Carlo : relancée automatiquement quand les réglages changent
  const key = JSON.stringify([c.imp.V, c.imp.alpha, c.imp.phi, c.imp.u, c.imp.impactCm, c.imp.offCenter, c.h0, c.rho, c.wind, c.surface, c.target, S.equipment, S.profile.level]);
  if (key !== mcKey) { mcKey = key; clearTimeout(mcTimer); mcTimer = setTimeout(() => runMC(false), 500); }
  else if (S._mc) drawMC(S._mc);
}

function drawCourt(tr, flat, vac, target) {
  const Pm = P();
  const { g, w, h } = fit($('#trCv'));
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const xMax = 27, yMax = Math.max(3.4, ...tr.pts.map((p) => p[1])) + 0.2;
  const X = (x) => pad.l + x / xMax * (w - pad.l - pad.r), Y = (y) => h - pad.b - y / yMax * (h - pad.t - pad.b);
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(X(0), Y(0), X(Pm.COURT.base) - X(0), 3);
  g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const lines = [[0, 'FOND'], [Pm.COURT.net, 'FILET'], [Pm.COURT.service, 'SERVICE'], [Pm.COURT.base, 'FOND']];
  for (const [x, l] of lines) { g.strokeStyle = x === Pm.COURT.service && target === 'service' ? '#fff' : C.rule2; g.lineWidth = 1; g.beginPath(); g.moveTo(X(x), Y(0)); g.lineTo(X(x), Y(0) + 6); g.stroke(); if (w > 420 || l !== 'FOND' || x === 0) g.fillText(w > 420 ? `${l} ${f(x, 1)}` : l, X(x), h - 8); }
  g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(X(Pm.COURT.net), Y(0)); g.lineTo(X(Pm.COURT.net), Y(0.914)); g.stroke(); g.lineWidth = 1;
  g.textAlign = 'right'; g.strokeStyle = C.rule; g.textBaseline = 'middle';
  for (let yy = 1; yy <= yMax; yy += 1) { g.beginPath(); g.moveTo(pad.l, Y(yy)); g.lineTo(w - pad.r, Y(yy)); g.stroke(); g.fillText(`${yy} m`, pad.l - 4, Y(yy)); }
  const path = (pts, col, lw, dash) => { g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath(); pts.forEach((p, i) => { const x = X(Math.min(p[0], xMax)), y = Y(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]); g.lineWidth = 1; };
  path(vac.pts, C.s4, 1, [2, 4]);
  path(flat.pts, C.s3, 1, [5, 4]);
  path(tr.pts, '#fff', 2.2);
  g.fillStyle = C.ink; tr.pts.forEach((p, i) => { if (i % 25 === 0 && p[0] < xMax) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 1.6, 0, Math.PI * 2); g.fill(); } });
  if (tr.bounce) { g.fillStyle = C.acc; g.beginPath(); g.arc(X(tr.bounce.x), Y(0), 4.5, 0, Math.PI * 2); g.fill(); }
  if (tr.netY != null) { g.fillStyle = C.acc; g.beginPath(); g.arc(X(Pm.COURT.net), Y(tr.netY), 3, 0, Math.PI * 2); g.fill(); }
}

function runMC(manual) {
  if (!P() || !S.swing) return;
  const c = read();
  try { mcWorker?.terminate(); mcWorker = new Worker(new URL('../core/margin-worker.js', import.meta.url), { type: 'module' }); }
  catch (e) { $('#mcNote').textContent = `Simulation indisponible ici : ${e.message}`; return; }
  $('#mcBtn').disabled = true; $('#mcRate').innerHTML = '…<small>%</small>';
  const disp = DISP[S.profile.level] || DISP.competition;
  const cfg = { imp: { ...c.imp }, h0: c.h0, rho: c.rho, wind: c.wind, surface: c.surface };
  mcWorker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'current') {
      $('#mcRate').innerHTML = `${f(d.cur.rate * 100, 1)}<small>%</small>`;
      $('#mcBar').innerHTML = `<i style="flex:${d.cur.rate};background:#fff"></i><i style="flex:${d.cur.net};background:var(--acc)"></i><i style="flex:${d.cur.long};background:var(--s4)"></i>`;
    }
    if (d.type === 'progress') $('#mcNote').textContent = `Balayage des vitesses… ${Math.round(d.p * 100)} % · ≈ ${fi(d.trials)} trajectoires simulées`;
    if (d.type === 'done') {
      $('#mcBtn').disabled = false; S._mc = d; drawMC(d);
      const best = d.pts.reduce((a, b) => (b.rate >= 0.9 && b.kmh > (a?.kmh || 0) ? b : a), null);
      const cp = d.pts.find((p) => p.isCur);
      $('#mcNote').textContent = `≈ ${fi(d.trials)} trajectoires simulées en ${f(d.ms / 1000, 1)} s, dispersion « ${S.profile.level} » (angle ± ${f(disp.angle, 1)}°, vitesse ± ${f(disp.speed * 100, 1)} %, effet ± ${f(disp.spin * 100, 0)} %). `
        + (best ? `Vitesse maximale en gardant 90 % de balles bonnes : ${f(best.kmh, 0)} km/h, départ à ${f(best.launch, 1)}°. ` : 'Aucune vitesse ne garde 90 % de balles bonnes avec cette dispersion : travaille la régularité avant la vitesse. ')
        + (cp && cp.launch != null ? `À ta vitesse actuelle, l'angle le plus sûr est ${f(cp.launch, 1)}° (${f(cp.rate * 100, 0)} %).` : '');
    }
  };
  mcWorker.onerror = (e) => { $('#mcBtn').disabled = false; $('#mcNote').textContent = `Simulation interrompue : ${e.message || 'erreur du moteur'}.`; };
  mcWorker.postMessage({ cfg, target: c.target, disp });
}

function drawMC(d) {
  const { g, w, h } = fit($('#mcCv'));
  const pad = { l: 38, r: 10, t: 12, b: 22 };
  const xs = d.pts.map((p) => p.kmh), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (v) => pad.l + (v - x0) / ((x1 - x0) || 1) * (w - pad.l - pad.r), Y = (r) => pad.t + (1 - r) * (h - pad.t - pad.b);
  g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.strokeStyle = C.rule; g.lineWidth = 1;
  for (const r of [0, 0.5, 0.9, 1]) { g.setLineDash(r === 0.9 ? [3, 4] : []); g.beginPath(); g.moveTo(pad.l, Y(r)); g.lineTo(w - pad.r, Y(r)); g.stroke(); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(`${r * 100} %`, pad.l - 5, Y(r)); }
  g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; d.pts.forEach((p, i) => { if (i % 2 === 0) g.fillText(f(p.kmh, 0), X(p.kmh), h - 6); });
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); d.pts.forEach((p, i) => (i ? g.lineTo(X(p.kmh), Y(p.rate)) : g.moveTo(X(p.kmh), Y(p.rate)))); g.stroke();
  d.pts.forEach((p) => { g.fillStyle = p.isCur ? C.acc : '#000'; g.strokeStyle = p.isCur ? C.acc : '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(p.kmh), Y(p.rate), p.isCur ? 5 : 3, 0, Math.PI * 2); g.fill(); g.stroke(); });
}
