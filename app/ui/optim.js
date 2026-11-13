// KYRON · Optimiseur : lancement automatique après chaque analyse, compteur en direct, nuage, frontière, sensibilité
import { $, $$, f, fi, big, esc, fit, C, clamp, on, emit, reduced, STROKE_FR, analyzable, DISP } from './util.js';
import { S, cur } from './state.js';
import { M, optimize, has } from './core.js';
import { SWING_DEF, tensionNow } from './physics-ui.js';
import { help } from './glossary.js';
import { ICON, reveal as revealEls } from './kit.js';

const BUDGET_N = { quick: 1e6, full: 10e6, max: 50e6 };
let ctl = null, debounce = 0, raf = 0, shown = 0, lastTick = 0, reveal = 1, hoverPt = null;
const O = () => S.opt;

export function init() {
  on('session', () => schedule(0));
  on('stroke', () => schedule(450));
  on('profile', () => schedule(300));
  on('equipment', () => { if (O().status === 'done') schedule(1200); });
  on('mode', () => { if (visible()) render(); });
  $('#optRun').onclick = () => run(O().budget === 'max' ? 'max' : 'full');
  $('#optMax').onclick = () => run('max');
  $('#goalSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#goalSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    O().goal = b.dataset.g; run('full');
  });
  const cv = $('#cloud');
  cv.addEventListener('pointermove', (e) => { hoverPt = { x: e.offsetX, y: e.offsetY }; drawCloud(); });
  cv.addEventListener('pointerleave', () => { hoverPt = null; $('#cloudTip').hidden = true; drawCloud(); });
  window.addEventListener('resize', () => { if (visible()) { drawCloud(); drawTrace(); } });
  coreGrid();
  $('#gMore').addEventListener('click', () => { gOpen = !gIsOpen(); syncG(); if (gIsOpen()) requestAnimationFrame(() => { drawCloud(); drawTrace(); }); });
  on('mode', syncG);
  syncG();
}
let gOpen = null;
const gIsOpen = () => (gOpen == null ? S.mode === 'adv' : gOpen);
function syncG() {
  const o = gIsOpen();
  $('#gFull').classList.toggle('open', o);
  $('#gMore').setAttribute('aria-expanded', String(o));
  $('#gMore span').textContent = o ? 'Masquer le détail' : 'Voir le détail de la simulation';
}
export function show() { render(); loop(); revealEls($('#gHow')); }
const visible = () => !$('#v-optimiseur').hidden;

function schedule(ms) { clearTimeout(debounce); debounce = setTimeout(() => run('full'), ms); }

function equipmentForOpt() {
  const e = S.equipment;
  return { racket: e.spec ? { ...e.spec, id: e.racket } : e.racket, spec: e.spec, leads: { ...e.leads }, string: e.string, tension: e.tension, gauge: e.gauge, days: e.days, hours: e.hours, tensionNow: tensionNow(e) };
}

export async function run(budget = 'full') {
  const s = cur(); if (!s?.res) return;
  ctl?.abort(); ctl = new AbortController();
  const my = ctl;
  const stroke = analyzable(s.type);
  Object.assign(S.opt, { status: 'running', budget, progress: { p: 0, trials: 0, trialsPerSec: 0 }, result: null, error: null, startedAt: performance.now(), trace: [], stroke, forIdx: S.strokeIdx });
  shown = 0; reveal = 0;
  busyDot(true); render(); loop();
  try {
    const result = await optimize({
      res: s.res, stroke, equipment: equipmentForOpt(), conditions: { ...S.conditions }, goal: O().goal, budget,
      profile: { ...S.profile }, heightM: S.profile.height / 100, level: S.profile.level, dispersion: DISP[S.profile.level] || DISP.competition,
      signal: my.signal,
      onProgress: (p) => {
        if (my !== ctl) return;
        O().progress = p;
        if (p?.best?.ballKmh) O().trace.push([performance.now() - O().startedAt, p.best.ballKmh]);
        emit('opt', O());
      },
    });
    if (my !== ctl) return;
    Object.assign(S.opt, { status: 'done', result, endedAt: performance.now() });
    reveal = reduced() ? 1 : 0;
    if (result?.best?.ballKmh) O().trace.push([performance.now() - O().startedAt, result.best.ballKmh]);
  } catch (e) {
    if (my !== ctl || e?.name === 'AbortError') return;
    console.warn('[kyron] optimisation', e);
    Object.assign(S.opt, { status: 'error', error: e?.message || String(e) });
  } finally {
    if (my === ctl) { busyDot(false); emit('opt', O()); if (visible()) { render(); loop(); } }
  }
}

function busyDot(on) { $('.tabs a[data-r="labo"]')?.classList.toggle('busy', on); document.body.classList.toggle('opt-busy', on); }
function coreGrid() {
  const n = O().result?.workers || Math.max(1, Math.min(32, (navigator.hardwareConcurrency || 4) - 1));
  $('#oCoreGrid').innerHTML = Array.from({ length: n }, () => '<i></i>').join('');
  $('#oCores').textContent = n;
}

// Boucle d'animation : compteur interpolé (60 i/s) + révélation du nuage
function loop() {
  cancelAnimationFrame(raf);
  lastTick = performance.now();
  const tick = (now) => {
    if (!visible()) return;
    const dt = (now - lastTick) / 1000; lastTick = now;
    const o = O();
    const N = BUDGET_N[o.budget] || 1e7;
    let target = 0;
    if (o.status === 'running') {
      const p = o.progress || {};
      target = Math.min(N, Math.max(p.trials || 0, shown + (p.trialsPerSec || 0) * dt * 0.95));
      target = Math.min(target, (p.trials || 0) + (p.trialsPerSec || 0) * 0.6);
    } else if (o.status === 'done') target = o.result?.trials || N;
    shown = o.status === 'done' ? shown + (target - shown) * Math.min(1, dt * 8) : Math.max(shown, target);
    if (o.status === 'done' && Math.abs(target - shown) < 1) shown = target;
    paintCounter();
    if (o.status === 'running') drawCloud();
    if (o.status === 'done' && reveal < 1) { reveal = Math.min(1, reveal + dt / 1.1); drawCloud(); }
    if (o.status === 'running' || reveal < 1 || shown !== target) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function paintCounter() {
  const o = O(), N = BUDGET_N[o.budget] || 1e7;
  $('#oTrials').innerHTML = `${fi(shown)}<small>variantes</small>`;
  const el = ((o.status === 'running' ? performance.now() : (o.endedAt || performance.now())) - (o.startedAt || performance.now())) / 1000;
  $('#oTime').textContent = `${f(o.status === 'done' && o.result?.ms ? o.result.ms / 1000 : el, 1)} s`;
  const rate = o.status === 'done' && o.result?.ms ? o.result.trials / (o.result.ms / 1000) : o.progress?.trialsPerSec;
  $('#oRate').textContent = rate ? big(rate) : '—';
  $('#oBar').style.width = `${clamp(o.status === 'done' ? 1 : (o.progress?.p ?? shown / N), 0, 1) * 100}%`;
}

const PL = {
  kneeFlex: ['Flexion des genoux', '°', 0], separation: ['Torsion hanches / épaules', '°', 0], elbowImpact: ["Coude à l'impact", '°', 0],
  contactRatio: ['Hauteur de contact', '× taille', 2], d1: ['Bassin → buste', 'ms', 0], d2: ['Buste → coude', 'ms', 0], d3: ['Coude → poignet', 'ms', 0],
  alphaDeg: ['Trajectoire de raquette', '°', 1], phiDeg: ['Angle de face', '°', 1], launchDeg: ['Angle de départ de la balle', '°', 1],
};

function render() {
  const o = O(), r = o.result, s = cur();
  coreGrid();
  $('#optTop').className = `opt-top ${o.status === 'running' ? 'running' : o.status === 'done' ? 'done' : ''}`;
  $('#oBudget').textContent = big(BUDGET_N[o.budget] || 1e7);
  $('#oSrc').textContent = s ? `· ${STROKE_FR[s.type]}${S.session?.strokes?.length > 1 ? `, frappe ${S.strokeIdx + 1}` : ''}${S.session?.source === 'demo' ? ' (exemple)' : ''}` : '';
  const st = { idle: "En attente d'une analyse", running: 'Simulation en cours', done: 'Simulation terminée', error: 'Simulation interrompue' }[o.status];
  $('#oState').innerHTML = o.status === 'running' ? `<span class="live"><i></i>${st}</span>` : st;
  $('#optMax').disabled = !s; $('#optRun').disabled = !s;
  paintCounter();
  if (o.status === 'error') { $('#oMsg').textContent = `Le moteur n'a pas pu terminer : ${o.error}`; }
  const cb = r?.current?.ballKmh, bb = r?.best?.ballKmh;
  const pb = o.progress?.best;
  if (r && Number.isFinite(cb) && Number.isFinite(bb)) {
    $('#oGain').innerHTML = `${fi(cb)} → ${fi(bb)}<small>km/h</small>`;
    const vg = (bb / cb - 1) * 100;
    $('#oPct').innerHTML = `${vg >= 0 ? '+' : '−'}${f(Math.abs(vg), 1)}<small>% vitesse${Number.isFinite(r.best.gainPct) && Math.abs(r.best.gainPct - vg) > 0.5 ? ` · objectif ${r.best.gainPct >= 0 ? '+' : '−'}${f(Math.abs(r.best.gainPct), 1)} %` : ''}</small>`;
    const top = r.sensitivity?.[0];
    const sr = (x) => Number.isFinite(x) ? `${f(x * 100, 0)} %` : null;
    $('#oMsg').innerHTML = `${fi(r.trials)} variantes simulées en ${f(r.ms / 1000, 1)} s sur ${r.workers || 1} cœur${(r.workers || 1) > 1 ? 's' : ''}.`
      + (top ? ` Le levier n° 1 : <b style="color:#fff;font-weight:500">${esc(top.label)}</b>${top.from != null && top.to != null ? ` (${fmtP(top.key, top.from)} → ${fmtP(top.key, top.to)}${top.unit ? ' ' + esc(top.unit) : ''})` : ''}, ${f(top.gainPct, 1)} % à lui seul.` : '')
      + (r.rejected?.total ? ` ${fi(r.rejected.total)} variantes écartées car trop risquées pour l'épaule, le genou ou le dos.` : '')
      + (sr(r.current?.successRate) && sr(r.best?.successRate) ? ` Balles bonnes : ${sr(r.current.successRate)} → ${sr(r.best.successRate)}.` : '')
      + (r.engine === 'repli' ? ' <span style="color:var(--mute)">(moteur de repli mono-cœur : nuage et matériel arrivent avec l\'optimiseur complet)</span>' : '');
  } else if (o.status === 'running') {
    $('#oGain').innerHTML = pb?.ballKmh ? `… → ${fi(pb.ballKmh)}<small>km/h</small>` : '—';
    $('#oPct').innerHTML = pb?.gainPct != null ? `+${f(pb.gainPct, 1)}<small>%</small>` : '—';
    $('#oMsg').textContent = 'Chaque variante est un geste complet : impact raquette-balle, vol dans l\'air, rebond, et contrôle des contraintes sur l\'épaule, le coude et le dos.';
  } else if (o.status === 'idle') { $('#oGain').textContent = '—'; $('#oPct').textContent = '—'; }
  renderSens(r); renderBest(r, s); renderEq(r);
  renderGeste(o, r, s);
  drawCloud(); drawTrace();
}

// ---------- Vue simple : avant / après + changements en phrases ----------
const SENT = {
  kneeFlex: ['Plie davantage les genoux avant de pousser vers la balle', 'Plie un peu moins les genoux'],
  separation: ['Tourne les épaules plus loin que les hanches pendant la préparation', 'Réduis la torsion entre hanches et épaules'],
  elbowImpact: ['Tends davantage le bras au moment de l’impact', 'Garde le coude un peu plus fléchi à l’impact'],
  contactRatio: ['Va chercher la balle plus haut', 'Frappe la balle un peu plus bas'],
  d1: ['Laisse le bassin partir un peu avant le buste', 'Enchaîne plus vite le bassin et le buste'],
  d2: ['Attends un peu plus avant de lancer le bras', 'Lance le bras plus tôt après la rotation du buste'],
  d3: ['Laisse le poignet fouetter un peu plus tard', 'Relâche le poignet plus tôt après le coude'],
  alphaDeg: ['Fais monter davantage la raquette vers la balle', 'Fais passer la raquette plus à plat'],
  phiDeg: ['Ouvre un peu plus la face de la raquette', 'Ferme un peu plus la face de la raquette'],
  launchDeg: ['Vise un peu plus haut au-dessus du filet', 'Vise un peu plus bas, plus tendu'],
};
const GKEY = { kneeFlex: 'kneeFlex', separation: 'separation', elbowImpact: 'elbowImpact', contactRatio: 'contactRatio', d1: 'sequence', d2: 'sequence', d3: 'sequence' };
function sentence(x) {
  const t = SENT[x.key]; if (!t) return esc(x.label);
  const up = Number.isFinite(x.from) && Number.isFinite(x.to) ? x.to >= x.from : true;
  return t[up ? 0 : 1];
}
function renderGeste(o, r, s) {
  const empty = !s;
  $('#gEmpty').hidden = !empty;
  $('#optTop').hidden = empty; $('#gResult').hidden = empty; $('#gMore').hidden = empty; $('.goal-row').hidden = empty;
  if (empty) {
    $('#gEmpty').innerHTML = `<span class="ec-ic">${ICON.ghost}</span><h2>Le simulateur part de ton geste</h2><p>Analyse d’abord une vidéo : KYRON pourra ensuite rejouer ton geste des millions de fois et te montrer comment gagner en vitesse et en effet, sans risque pour ton corps.</p><div class="ec-acts"><a class="btn solid" href="#analyser">Analyser un geste</a><button class="btn" type="button" id="gDemo">Voir un exemple</button></div>`;
    $('#gDemo').onclick = async () => { (await import('./seance.js')).loadDemo(); render(); };
    return;
  }
  const el = $('#gResult');
  if (o.status === 'running' || o.status === 'idle') {
    const pb = o.progress?.best;
    el.innerHTML = `<div class="g-wait"><span class="live"><i></i>Recherche en cours</span><p>Chaque variante est un geste complet : impact raquette-balle, vol dans l’air, rebond, puis contrôle des contraintes sur ton épaule, ton coude et ton dos.${pb?.ballKmh ? ` Meilleure vitesse trouvée pour l’instant : <b class="mono">${fi(pb.ballKmh)} km/h</b>.` : ''}</p></div>`;
    return;
  }
  if (o.status === 'error' || !r) { el.innerHTML = `<div class="g-wait"><p>Le simulateur n’a pas pu terminer${o.error ? ` : ${esc(o.error)}` : ''}. Réessaie avec « Relancer » dans le détail.</p></div>`; return; }
  const c = r.current || {}, b = r.best || {};
  const card = (lbl, g, a, z, unit, d, dec = 0) => {
    if (!Number.isFinite(z)) return '';
    const diff = Number.isFinite(a) ? z - a : null;
    return `<div class="ba-c"><span class="lbl">${lbl}${help(g)}</span><div class="ba-v"><span class="mono was">${Number.isFinite(a) ? f(a, dec) : '—'}</span><span class="arr">→</span><b class="mono">${f(z, dec)}</b><small>${unit}</small></div>${diff != null ? `<span class="ba-d ${Math.abs(diff) < (dec ? 0.5 : 1) ? '' : diff > 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${f(Math.abs(diff), dec)} ${unit}${d ? ` · ${d}` : ''}</span>` : ''}</div>`;
  };
  const sens = (r.sensitivity || []).filter((x) => Number.isFinite(x.gainPct) && x.gainPct > 0.15).slice(0, 3);
  const rej = r.rejected?.total || 0;
  el.innerHTML = `<div class="ba">
      ${card('Vitesse de balle', 'ballKmh', c.ballKmh, b.ballKmh, 'km/h')}
      ${card('Effet', 'spin', Number.isFinite(c.spinRpm) ? Math.abs(c.spinRpm) : null, Number.isFinite(b.spinRpm) ? Math.abs(b.spinRpm) : null, 'tr/min')}
      ${card('Balles dans le court', 'successRate', Number.isFinite(c.successRate) ? c.successRate * 100 : null, Number.isFinite(b.successRate) ? b.successRate * 100 : null, '%')}
      <div class="ba-c safe"><span class="lbl">Marge de sécurité${help('safety')}</span><div class="ba-v"><span class="safe-ic">${ICON.shield}</span><b>Respectée</b></div><span class="ba-d">${rej ? `${fi(rej)} variantes trop risquées écartées` : 'Épaule, coude, dos et genoux dans les repères'}</span></div>
    </div>
    <h3 class="g-h">${sens.length ? `Les ${sens.length} changements qui rapportent le plus` : 'Changements proposés'}${help('sensitivity')}</h3>
    ${sens.length ? `<ol class="changes">${sens.map((x, i) => `<li class="${i === 0 ? 'top' : ''}"><i class="mono">${i + 1}</i><div><b>${sentence(x)}</b>${GKEY[x.key] ? help(GKEY[x.key]) : ''}<span class="ch-v mono">${fmtP(x.key, x.from)} → ${fmtP(x.key, x.to)}${x.unit ? ` ${esc(x.unit)}` : ''}</span></div><span class="ch-g mono">+${f(x.gainPct, 1)} %</span></li>`).join('')}</ol>` : '<p class="muted">Ton geste est déjà proche du meilleur compromis pour cet objectif.</p>'}
    <p class="note g-note">Ce sont des simulations à partir de ta vidéo. Travaille un changement à la fois, refilme, et compare.</p>`;
}

const fmtP = (k, v) => !Number.isFinite(v) ? '—' : f(v, PL[k]?.[2] ?? (Math.abs(v) < 10 ? 2 : 0));

function renderSens(r) {
  const el = $('#sens');
  const list = r?.sensitivity?.filter((x) => Number.isFinite(x.gainPct)) || [];
  if (!list.length) { el.innerHTML = `<p class="note">${O().status === 'running' ? 'Calcul de la sensibilité à la fin de la recherche…' : 'Lance une analyse pour voir quels réglages rapportent le plus.'}</p>`; return; }
  const mx = Math.max(...list.map((x) => Math.abs(x.gainPct)), 0.1);
  el.innerHTML = list.slice(0, 8).map((x) => `<div class="sens-r"><span>${esc(x.label)}${x.from != null && x.to != null ? `<small>${fmtP(x.key, x.from)} → ${fmtP(x.key, x.to)}${x.unit ? ' ' + esc(x.unit) : ''}</small>` : ''}</span><span class="track"><i style="width:${Math.max(2, Math.abs(x.gainPct) / mx * 100)}%"></i></span><span class="mono">${x.gainPct >= 0 ? '+' : '−'}${f(Math.abs(x.gainPct), 1)} %</span></div>`).join('');
}

function renderBest(r, s) {
  const tb = $('#bestGest tbody');
  if (!r?.best?.params) { tb.innerHTML = `<tr><td colspan="2" class="note" style="padding:14px 16px">${O().status === 'running' ? 'Recherche du meilleur geste…' : '—'}</td></tr>`; return; }
  const x = s?.res?.simInput || {}, sw = SWING_DEF[analyzable(s?.type)] || {};
  const curP = { kneeFlex: x.kneeFlex, separation: x.separation, elbowImpact: x.elbowImpact, contactRatio: analyzable(s?.type) === 'serve' ? x.contactRatio : null, d1: x.d1, d2: x.d2, d3: x.d3, alphaDeg: sw.A, phiDeg: sw.P, launchDeg: null, ...(r.current?.params || {}) };
  const rows = Object.entries(r.best.params).filter(([k, v]) => Number.isFinite(v) && PL[k] && (k !== 'contactRatio' || analyzable(s?.type) === 'serve'));
  tb.innerHTML = rows.map(([k, v]) => {
    const c = curP[k], ch = Number.isFinite(c) && Math.abs(v - c) > (PL[k][2] ? 0.01 : 0.5);
    return `<tr><td>${PL[k][0]}</td><td class="n">${Number.isFinite(c) ? `<span style="color:var(--mute)">${fmtP(k, c)}</span> → ` : ''}<span class="${ch ? 'att' : ''}">${fmtP(k, v)}</span> ${PL[k][1]}</td></tr>`;
  }).join('')
    + `<tr class="cur"><td>Vitesse de balle</td><td class="n">${fi(r.current?.ballKmh)} → ${fi(r.best.ballKmh)} km/h</td></tr>`
    + (Number.isFinite(r.best.spinRpm) ? `<tr><td>Effet</td><td class="n">${Number.isFinite(r.current?.spinRpm) ? fi(r.current.spinRpm) + ' → ' : ''}${fi(r.best.spinRpm)} tr/min</td></tr>` : '')
    + (Number.isFinite(r.best.successRate) ? `<tr><td>Balles bonnes</td><td class="n">${Number.isFinite(r.current?.successRate) ? f(r.current.successRate * 100, 0) + ' → ' : ''}${f(r.best.successRate * 100, 0)} %</td></tr>` : '');
}

function renderEq(r) {
  const tb = $('#bestEq tbody'), e = r?.equipment?.best, P = M.physics;
  $('#eqLbl').textContent = r?.equipment?.gainPct != null ? `${r.equipment.gainPct >= 0 ? '+' : ''}${f(r.equipment.gainPct, 1)} % avec ce matériel` : '';
  if (!e) { tb.innerHTML = `<tr><td colspan="2" class="note" style="padding:14px 16px">${O().status === 'running' ? 'Banc matériel en cours…' : r ? 'Indisponible avec ce moteur.' : '—'}</td></tr>`; return; }
  const rk = typeof e.racket === 'string' ? (P?.RACKETS.find((x) => x.id === e.racket)?.name || e.racket) : (e.racket?.name || '—');
  const leads = e.leads && typeof e.leads === 'object' ? Object.entries(e.leads).filter(([, g]) => g > 0).map(([k, g]) => `${f(g, 1)} g ${P?.LEAD_SPOTS[k]?.label || k}`).join(', ') : '';
  const str = P?.STRINGS[e.string]?.label || e.string || '—';
  tb.innerHTML = `<tr><td>Raquette</td><td class="n">${esc(rk)}</td></tr>`
    + `<tr><td>Plombs</td><td class="n">${esc(leads || 'aucun')}</td></tr>`
    + `<tr><td>Cordage</td><td class="n">${esc(str)}${Number.isFinite(e.gauge) ? ` ${f(e.gauge, 2)} mm` : ''}</td></tr>`
    + (Number.isFinite(e.tension) ? `<tr><td>Tension</td><td class="n">${f(e.tension, 1)} kg</td></tr>` : '')
    + (Number.isFinite(e.ballKmh) ? `<tr class="cur"><td>Vitesse de balle</td><td class="n">${fi(e.ballKmh)} km/h</td></tr>` : '')
    + (Number.isFinite(e.spinRpm) ? `<tr><td>Effet</td><td class="n">${fi(e.spinRpm)} tr/min</td></tr>` : '')
    + (Number.isFinite(e.successRate) ? `<tr><td>Balles bonnes</td><td class="n">${f(e.successRate * 100, 0)} %</td></tr>` : '')
    + `<tr><td colspan="2"><button class="btn sm" id="applyEq">Appliquer au banc matériel</button></td></tr>`;
  $('#applyEq').onclick = () => {
    const eq = S.equipment;
    if (typeof e.racket === 'string') { eq.racket = e.racket; eq.spec = null; }
    if (e.leads) eq.leads = { h12: 0, h10_2: 0, h9_3: 0, throat: 0, handle: 0, ...e.leads };
    if (e.string) eq.string = e.string;
    if (Number.isFinite(e.tension)) eq.tension = e.tension;
    if (Number.isFinite(e.gauge)) eq.gauge = e.gauge;
    emit('equipment-set', eq);
    location.hash = '#materiel';
  };
}

// ---------- Nuage de points ----------
function strideOf(cl, r) {
  const hint = r?.cloudStride || cl?.stride;
  if (hint) return hint;
  for (const s of [2, 3, 4, 5, 6, 8]) {
    if (cl.length % s) continue;
    let ok = true;
    for (let i = 0; i < Math.min(60, cl.length / s); i++) { const v = cl[i * s], y = cl[i * s + 1]; if (!(v > 10 && v < 400 && y >= 0 && y <= 1.0001)) { ok = false; break; } }
    if (ok) return s;
  }
  return 2;
}

function drawCloud() {
  const cv = $('#cloud'); if (!cv || !visible()) return;
  const { g, w, h } = fit(cv);
  const o = O(), r = o.result;
  const pad = { l: 44, r: 16, t: 24, b: 32 };
  const cl = r?.cloud || o.progress?.cloud || null;
  const st = cl ? strideOf(cl, r) : 2;
  const n = cl ? Math.floor(cl.length / st) : 0;
  const fr = r?.frontier || [];
  // Bornes
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < n; i++) { const v = cl[i * st]; if (v < x0) x0 = v; if (v > x1) x1 = v; }
  for (const p of fr) { x0 = Math.min(x0, p.ballKmh); x1 = Math.max(x1, p.ballKmh); }
  for (const v of [r?.current?.ballKmh, r?.best?.ballKmh]) if (Number.isFinite(v)) { x0 = Math.min(x0, v); x1 = Math.max(x1, v); }
  if (!Number.isFinite(x0)) { const c = cur()?.res?.metrics?.ballSpeedKmh || 150; x0 = c * 0.75; x1 = c * 1.2; }
  const span = (x1 - x0) || 10; x0 -= span * 0.04; x1 += span * 0.04;
  const X = (v) => pad.l + (v - x0) / (x1 - x0) * (w - pad.l - pad.r), Y = (s) => pad.t + (1 - s) * (h - pad.t - pad.b);
  // Grille
  g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.strokeStyle = C.rule; g.lineWidth = 1;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const s of [0, 0.25, 0.5, 0.75, 0.9, 1]) { g.setLineDash(s === 0.9 ? [3, 4] : []); g.beginPath(); g.moveTo(pad.l, Y(s)); g.lineTo(w - pad.r, Y(s)); g.stroke(); g.fillText(`${Math.round(s * 100)} %`, pad.l - 6, Y(s)); }
  g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'top';
  const stp = niceStep((x1 - x0) / Math.max(3, Math.floor((w - 80) / 80)));
  for (let v = Math.ceil(x0 / stp) * stp; v <= x1; v += stp) { g.fillText(fi(v), X(v), h - pad.b + 8); g.strokeStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.moveTo(X(v), pad.t); g.lineTo(X(v), h - pad.b); g.stroke(); }
  g.textAlign = 'right'; g.fillText('VITESSE DE BALLE KM/H', w - pad.r, h - 12);
  g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('↑ BALLES BONNES', pad.l + 6, 4);
  // Points
  if (n) {
    const lim = Math.floor(n * (reveal < 1 ? easeOut(reveal) : 1));
    g.fillStyle = 'rgba(180,180,176,.42)';
    for (let i = 0; i < lim; i++) { const x = X(cl[i * st]), y = Y(cl[i * st + 1]); g.fillRect(x - 1, y - 1, 2, 2); }
  } else if (o.status === 'running') {
    // balayage de recherche pendant le calcul
    const t = (performance.now() / 1600) % 1, xs = pad.l + t * (w - pad.l - pad.r);
    const grd = g.createLinearGradient(xs - 80, 0, xs, 0); grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,.12)');
    g.fillStyle = grd; g.fillRect(xs - 80, pad.t, 80, h - pad.t - pad.b);
    g.fillStyle = '#fff'; g.fillRect(xs, pad.t, 1, h - pad.t - pad.b);
    g.fillStyle = C.mute; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXPLORATION DE L\'ESPACE DES GESTES…', (pad.l + w - pad.r) / 2, pad.t + 20);
  } else if (r && !cl) {
    g.fillStyle = C.mute; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NUAGE INDISPONIBLE AVEC CE MOTEUR', (pad.l + w - pad.r) / 2, (pad.t + h - pad.b) / 2);
  }
  // Frontière
  if (fr.length > 1 && reveal > 0.3) {
    const pts = [...fr].sort((a, b) => a.ballKmh - b.ballKmh);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.globalAlpha = Math.min(1, (reveal - 0.3) / 0.5); g.beginPath();
    pts.forEach((p, i) => { const x = X(p.ballKmh), y = Y(p.successRate); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke(); g.globalAlpha = 1;
  }
  // Actuel / optimum
  const mark = (v, s, col, label, ring, below) => {
    if (!Number.isFinite(v)) return;
    const x = X(v), y = Number.isFinite(s) ? Y(s) : h - pad.b;
    g.strokeStyle = col; g.fillStyle = ring ? '#000' : col; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, ring ? 7 : 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
    if (ring) { g.beginPath(); g.moveTo(x - 12, y); g.lineTo(x - 8, y); g.moveTo(x + 8, y); g.lineTo(x + 12, y); g.moveTo(x, y - 12); g.lineTo(x, y - 8); g.moveTo(x, y + 8); g.lineTo(x, y + 12); g.stroke(); }
    const left = below ? x > pad.l + 150 : x > w - 140;
    g.fillStyle = C.ink; g.font = `10.5px ${C.mono}`; g.textAlign = left ? 'right' : 'left'; g.textBaseline = below ? 'top' : 'bottom';
    g.fillText(label, x + (left ? -12 : 12), below ? y + 8 : y - 8);
  };
  if (r) {
    mark(r.current?.ballKmh, r.current?.successRate, C.acc, `ACTUEL ${fi(r.current?.ballKmh)} KM/H`, false, true);
    if (reveal >= 0.6) mark(r.best?.ballKmh, r.best?.successRate, '#fff', `OPTIMUM ${fi(r.best?.ballKmh)} KM/H`, true);
  }
  $('#cloudLbl').textContent = n ? `${fi(n)} variantes affichées sur ${big(r?.trials || 0)}` : '';
  // Survol
  const tip = $('#cloudTip');
  if (hoverPt && (fr.length || n)) {
    let best = null, bd = 900;
    for (const p of fr) { const d = (X(p.ballKmh) - hoverPt.x) ** 2 + (Y(p.successRate) - hoverPt.y) ** 2; if (d < bd) { bd = d; best = { v: p.ballKmh, s: p.successRate, l: p.launchDeg, k: 'Frontière' }; } }
    if (!best && n) for (let i = 0; i < n; i += 1) { const x = X(cl[i * st]), y = Y(cl[i * st + 1]); const d = (x - hoverPt.x) ** 2 + (y - hoverPt.y) ** 2; if (d < bd) { bd = d; best = { v: cl[i * st], s: cl[i * st + 1], k: 'Variante' }; } }
    if (best) {
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(best.v), pad.t); g.lineTo(X(best.v), h - pad.b); g.moveTo(pad.l, Y(best.s)); g.lineTo(w - pad.r, Y(best.s)); g.stroke(); g.setLineDash([]);
      tip.hidden = false; tip.style.left = `${clamp(X(best.v), 90, w - 90)}px`; tip.style.top = `${Y(best.s)}px`;
      tip.innerHTML = `${best.k} · <b>${fi(best.v)} km/h</b> · <b>${f(best.s * 100, 0)} %</b> bonnes${Number.isFinite(best.l) ? ` · départ ${f(best.l, 1)}°` : ''}`;
    } else tip.hidden = true;
  } else tip.hidden = true;
}
const easeOut = (t) => 1 - (1 - t) ** 3;
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

function drawTrace() {
  const cv = $('#optTrace'); if (!cv || S.mode !== 'adv' || !visible()) return;
  const { g, w, h } = fit(cv);
  const tr = O().trace; if (tr.length < 2) { g.fillStyle = C.mute; g.font = `10px ${C.mono}`; g.fillText(O().status === 'running' ? 'EN ATTENTE DES PREMIERS RÉSULTATS…' : '—', 14, 24); return; }
  const pad = { l: 40, r: 10, t: 12, b: 20 };
  const t1 = tr[tr.length - 1][0] || 1, lo = Math.min(...tr.map((p) => p[1])) - 1, hi = Math.max(...tr.map((p) => p[1])) + 1;
  const X = (t) => pad.l + t / t1 * (w - pad.l - pad.r), Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  g.strokeStyle = C.rule; g.fillStyle = C.mute; g.font = `10px ${C.mono}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of [lo + 1, hi - 1]) { g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(w - pad.r, Y(v)); g.stroke(); g.fillText(fi(v), pad.l - 6, Y(v)); }
  g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
  tr.forEach(([t, v], i) => { i ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v)); });
  g.stroke();
  g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(`${f(t1 / 1000, 1)} s`, w - pad.r, h - pad.b + 6);
}

// Rafraîchit l'affichage pendant le calcul (au plus ~6 fois par seconde pour le texte)
let lastRender = 0;
on('opt', () => { if (!visible()) return; const now = performance.now(); if (now - lastRender > 160 || O().status !== 'running') { lastRender = now; render(); } });
