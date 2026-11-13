// KYRON · Progression : historique local (optionnel), courbes par métrique, objectifs, exercices validés par la mesure
import { $, $$, f, fi, esc, fit, C, on, store, mean, STROKE_FR, analyzable } from './util.js';
import { help } from './glossary.js';
import { S } from './state.js';
import { M } from './core.js';
import { renderLoad, renderPlan, initTts, refreshCue } from './prog2.js';
import { account } from './acct.js';
import { sessions, sessCard, bindOpen } from './home.js';
import { sheet, toast, reveal } from './kit.js';

const KEY = 'kyron-history', GKEY = 'kyron-goals';
let stroke = 'serve', inited = false, hist = [], pOpen = null;

const DEFS = [
  { key: 'score', label: 'Score du geste', unit: '/100', dec: 0, dir: 'up', def: () => 80 },
  { key: 'racketKmh', label: 'Vitesse de raquette', unit: 'km/h', dec: 0, dir: 'up', def: (v) => Math.round((v || 120) * 1.06) },
  { key: 'ballKmh', label: 'Vitesse de balle', unit: 'km/h', dec: 0, dir: 'up', def: (v) => Math.round((v || 150) * 1.06) },
  { key: 'kneeFlex', label: 'Flexion des genoux', unit: '°', dec: 0, dir: 'up', ref: 'kneeFlex' },
  { key: 'separation', label: 'Séparation hanches / épaules', unit: '°', dec: 0, dir: 'up', ref: 'separation' },
  { key: 'elbowImpact', label: "Coude à l'impact", unit: '°', dec: 0, dir: 'up', ref: 'elbowImpact' },
  { key: 'contactRatio', label: 'Hauteur de contact', unit: '× taille', dec: 2, dir: 'up', ref: 'contactRatio', only: 'serve' },
  { key: 'shoulderTurn', label: 'Rotation des épaules', unit: '°', dec: 0, dir: 'up', ref: 'shoulderTurn' },
  { key: 'headDrift', label: 'Stabilité de la tête', unit: 'cm', dec: 0, dir: 'down', ref: 'headDrift', scale: 100 },
  { key: 'inOrder', label: 'Chaîne en ordre', unit: '%', dec: 0, dir: 'up', scale: 100, def: () => 100 },
];
// Seuil de validation d'un exercice, par clé de constat
const GK = { racketKmh: 'racketKmh', ballKmh: 'ballKmh', inOrder: 'sequence' };
const CHECK = { legs: 'kneeFlex', separation: 'separation', sequence: 'inOrder', extension: 'elbowImpact', contact: 'contactRatio', head: 'headDrift', turn: 'shoulderTurn' };

// ---------- Historique : séances enregistrées dans le compte (account.listSessions) ----------
export function history() { return hist; }
// Séances d'avant les comptes (reprises par migrateLegacy) : { strokes: {type: n}, metrics: {type: m} }
function byTypeOf(sm) {
  if (!sm) return null;
  if (sm.byType && typeof sm.byType === 'object') return sm.byType;
  if (sm.metrics && typeof sm.metrics === 'object') { const o = {}; for (const [t, m] of Object.entries(sm.metrics)) if (m && typeof m === 'object') o[t] = { n: sm.strokes?.[t] ?? 1, m, exercises: [] }; return Object.keys(o).length ? o : null; }
  return null;
}
async function loadHist(force) {
  const list = await sessions(force);
  hist = list.map((x) => ({ ...x, byType: byTypeOf(x.summary) })).filter((x) => x.byType).map((x) => ({ id: x.id, date: x.createdAt, label: '', source: x.source === 'demo' ? 'exemple' : x.source, multi: x.source === '2cam' || !!x.summary.multi, count: x.summary.count || 0, byType: x.byType, fatigue: x.summary.fatigue ?? null }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return list;
}

export function entryOf(sess) {
  const byType = {};
  for (const s of sess.strokes) {
    const t = analyzable(s.type); (byType[t] ||= []).push(s);
  }
  const out = {};
  for (const [t, list] of Object.entries(byType)) {
    const m = (fn) => { const v = list.map(fn).filter(Number.isFinite); return v.length ? mean(v) : null; };
    out[t] = {
      n: list.length,
      m: {
        score: m((s) => s.res.score), racketKmh: m((s) => s.res.metrics.racketSpeed * 3.6),
        ballKmh: m((s) => (s.ball?.speedKmh ?? s.res.metrics.ballSpeedKmh)), ballMeasured: list.some((s) => s.ball?.speedKmh),
        kneeFlex: m((s) => s.res.metrics.kneeFlex), separation: m((s) => s.res.metrics.separation), elbowImpact: m((s) => s.res.metrics.elbowImpact),
        contactRatio: m((s) => s.res.metrics.contactRatio), shoulderTurn: m((s) => s.res.metrics.shoulderTurn), headDrift: m((s) => s.res.metrics.headDrift),
        inOrder: m((s) => (s.res.inOrder ? 1 : 0)),
      },
      exercises: [...new Map(list.flatMap((s) => s.res.findings.filter((x) => x.sev > 0).map((x) => [x.exercise, { key: x.exercise, finding: x.key, ...(M.engine?.EXERCISES?.[x.exercise] || {}) }]))).values()].slice(0, 3),
    };
  }
  return { id: sess.id, date: sess.date, label: sess.label || '', source: sess.source, multi: !!sess.multi, count: sess.strokes.length, byType: out, fatigue: sess.fatigue?.slopePct ?? null };
}


// Exemple affiché tant que l'historique est vide (jamais enregistré)
function example() {
  const base = S.session?.source === 'demo' ? entryOf(S.session) : null;
  const out = [];
  const now = Date.now();
  for (let k = 0; k < 7; k++) {
    const p = k / 6;
    const byType = {};
    for (const t of ['serve', 'forehand', 'backhand']) {
      const b = base?.byType[t]?.m || { score: 64, racketKmh: 118, ballKmh: 150, kneeFlex: 40, separation: 18, elbowImpact: 158, contactRatio: 1.15, shoulderTurn: 70, headDrift: 0.12, inOrder: 0.5 };
      const j = (a) => 1 + Math.sin(k * 2.3 + a) * 0.02;
      byType[t] = { n: 6 + (k % 3), m: {
        score: Math.min(96, (b.score - 9) + p * 14) * j(1), racketKmh: (b.racketKmh * 0.93 + p * b.racketKmh * 0.09) * j(2), ballKmh: (b.ballKmh * 0.93 + p * b.ballKmh * 0.09) * j(3),
        kneeFlex: (b.kneeFlex - 10 + p * 16) * j(4), separation: (b.separation - 6 + p * 10) * j(5), elbowImpact: Math.min(178, (b.elbowImpact - 8 + p * 12) * j(6)),
        contactRatio: b.contactRatio != null ? (b.contactRatio - 0.05 + p * 0.07) * j(7) : null, shoulderTurn: (b.shoulderTurn - 12 + p * 18) * j(8), headDrift: Math.max(0.03, (b.headDrift ?? 0.1) * (1.4 - p * 0.6)),
        inOrder: Math.min(1, 0.3 + p * 0.7),
      }, exercises: k === 0 ? (base?.byType[t]?.exercises || []) : [] };
    }
    out.push({ id: `ex${k}`, date: new Date(now - (6 - k) * 5 * 86400e3).toISOString(), source: 'exemple', count: 18, byType });
  }
  return out;
}

const gkey = () => `${GKEY}:${account.user()?.id || 'local'}`;
const goals = () => store.get(gkey(), store.get(GKEY, {}));
function goalFor(def, latest) {
  const g = goals()[stroke]?.[def.key];
  if (Number.isFinite(g)) return g;
  if (def.ref) { const r = M.engine?.REFS?.[stroke]?.[def.ref]; if (r) return def.dir === 'down' ? r.hi * (def.scale || 1) : r.lo * (def.scale || 1); }
  return def.def ? def.def(latest) : null;
}

// ---------- Vue ----------
export async function show() {
  if (!inited) {
    inited = true;
    $('#pStroke').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; stroke = b.dataset.s; render(); });
    addEventListener('resize', () => { if (!$('#v-progression').hidden) render(); });
    bindOpen($('#pSess'));
    $('#pSess').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { e.stopPropagation(); askDelete(b.dataset.del); } }, true);
    $('#pMore').addEventListener('click', () => { pOpen = !pIsOpen(); syncMore(); if (pIsOpen()) render(); });
    on('mode', () => { syncMore(); if (!$('#v-progression').hidden) render(); });
    syncMore();
  }
  const list = await loadHist();
  // coup affiché : celui de la dernière séance
  const lastT = hist[hist.length - 1] && Object.keys(hist[hist.length - 1].byType)[0];
  if (lastT && !hist.some((e) => e.byType[stroke])) stroke = lastT;
  else if (S.session?.strokes?.length && S.session.source !== 'demo') stroke = analyzable(S.session.strokes[S.strokeIdx]?.type || stroke);
  renderSessions(list);
  render();
}
const pIsOpen = () => (pOpen == null ? S.mode === 'adv' : pOpen);
function syncMore() {
  const o = pIsOpen();
  $('#pFull').classList.toggle('open', o); $('#v-progression').classList.toggle('all', o);
  $('#pMore').setAttribute('aria-expanded', String(o));
  $('#pMore span').textContent = o ? 'Masquer le détail' : 'Voir le détail';
}
function renderSessions(list) {
  $('#pSessN').textContent = list.length ? `${list.length} séance${list.length > 1 ? 's' : ''}` : '';
  $('#pSess').innerHTML = list.length ? list.slice(0, 30).map((x) => `<div class="sess-w">${sessCard(x)}<button type="button" class="sess-del" data-del="${esc(x.id)}" aria-label="Supprimer cette séance"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg></button></div>`).join('')
    : '<div class="empty-home"><p>Aucune séance enregistrée pour l’instant. Chaque vidéo que tu analyses s’ajoute ici automatiquement.</p><div class="ec-acts"><a class="btn solid" href="#analyser">Analyser un geste</a></div></div>';
  reveal($('#pSess'));
}
function askDelete(id) {
  sheet.open({ title: 'Supprimer cette séance ?', html: '<p class="sh-lead">La séance, ses mesures et sa vidéo seront effacées de ton historique.</p><div class="ec-acts"><button type="button" class="btn danger-btn" id="sdGo">Supprimer</button><button type="button" class="btn" data-close>Annuler</button></div>',
    onMount: (b) => { b.querySelector('#sdGo').onclick = async () => { try { await account.deleteSession(id); sheet.close(); toast('Séance supprimée.'); const list = await loadHist(true); renderSessions(list); render(); } catch (e) { toast(e?.message || 'Suppression impossible.', 'err'); } }; } });
}

function render() {
  $$('#pStroke button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === stroke)));
  const real = history();
  const ex = !real.length;
  const H = ex ? example() : real;
  $('#pBanner').innerHTML = ex ? `<div class="ex-banner"><b>Exemple</b><span>Ces courbes sont un exemple. Dès ta première vidéo analysée, tes vraies mesures s'affichent ici.</span></div>` : '';
  $('#pClear').hidden = true;
  const rows = H.filter((e) => e.byType[stroke]);
  const cards = DEFS.filter((d) => !d.only || d.only === stroke).map((d) => {
    const pts = rows.map((e) => { const v = e.byType[stroke].m[d.key]; return Number.isFinite(v) ? v * (d.scale || 1) : null; });
    const vals = pts.filter(Number.isFinite);
    if (!vals.length) return '';
    const last = vals[vals.length - 1], first = vals[0], goal = goalFor(d, last);
    const ok = goal == null ? null : d.dir === 'down' ? last <= goal : last >= goal;
    const delta = vals.length > 1 ? last - first : null;
    return `<section class="panel mcard" data-k="${d.key}"><div class="ph"><h2>${esc(d.label)}${help(GK[d.key] || d.key)}</h2><span class="lbl">${ok == null ? '' : ok ? 'objectif atteint' : `<span class="acc">objectif ${f(goal, d.dec)} ${d.unit}</span>`}</span></div>
      <div class="row"><b>${f(last, d.dec)}<small>${d.unit}</small></b><span class="lbl" style="margin:0">${delta == null ? '1 séance' : `${delta >= 0 ? '+' : '−'}${f(Math.abs(delta), d.dec)} depuis le début`}</span></div>
      <canvas data-pts='${JSON.stringify(pts)}' data-goal="${goal ?? ''}" data-dir="${d.dir}"></canvas>
      <div class="goal"><label for="g_${d.key}">Mon objectif (${d.unit})</label><input type="number" id="g_${d.key}" data-gk="${d.key}" step="${d.dec ? 0.01 : 1}" value="${goal != null ? +goal.toFixed(d.dec) : ''}"></div></section>`;
  }).join('');
  $('#pCards').innerHTML = cards || `<p class="empty">Aucune séance de ${STROKE_FR[stroke].toLowerCase()} enregistrée pour l'instant.</p>`;
  $$('#pCards canvas').forEach(spark);
  $$('#pCards [data-gk]').forEach((i) => i.addEventListener('change', () => { const g = goals(); (g[stroke] ||= {})[i.dataset.gk] = +i.value; store.set(gkey(), g); render(); }));
  renderEx(rows);
  try { const L = renderLoad(real, ex); renderPlan(L, ex); refreshCue(); } catch (e) { console.warn('[kyron] progression v2', e); }
  $('#pTable tbody').innerHTML = [...H].reverse().slice(0, 30).map((e) => {
    const t = e.byType[stroke] || Object.values(e.byType)[0];
    return `<tr><td>${new Date(e.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</td><td>${e.source === 'exemple' ? 'exemple' : e.multi ? '2 caméras' : 'vidéo'}</td><td class="n">${e.count}</td><td class="n">${fi(t?.m.score)}</td><td class="n">${fi(t?.m.racketKmh)} km/h</td></tr>`;
  }).join('');
}

function spark(c) {
  const { g, w, h } = fit(c);
  const pts = JSON.parse(c.dataset.pts), goal = c.dataset.goal === '' ? null : +c.dataset.goal, down = c.dataset.dir === 'down';
  const vals = pts.filter(Number.isFinite); if (!vals.length) return;
  let lo = Math.min(...vals, goal ?? Infinity), hi = Math.max(...vals, goal ?? -Infinity);
  const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
  const X = (i) => 16 + i * (w - 32) / Math.max(1, pts.length - 1), Y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (h - 24);
  g.strokeStyle = C.rule; g.lineWidth = 1; g.beginPath(); g.moveTo(16, h - 12); g.lineTo(w - 16, h - 12); g.stroke();
  if (goal != null) { g.strokeStyle = 'rgba(255,255,255,.45)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(16, Y(goal)); g.lineTo(w - 16, Y(goal)); g.stroke(); g.setLineDash([]); g.fillStyle = C.mute; g.font = `9.5px ${C.mono}`; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('OBJECTIF', w - 16, Y(goal) - 3); }
  g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath(); let st = false;
  pts.forEach((v, i) => { if (!Number.isFinite(v)) return; st ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); st = true; }); g.stroke();
  pts.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const miss = goal != null && (down ? v > goal : v < goal), lastP = i === pts.length - 1;
    g.fillStyle = lastP ? (miss ? C.acc : '#fff') : '#000'; g.strokeStyle = miss && lastP ? C.acc : '#fff'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(X(i), Y(v), lastP ? 4.5 : 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
  });
}

function renderEx(rows) {
  const list = new Map();
  rows.forEach((e, i) => (e.byType[stroke].exercises || []).forEach((x) => { if (x?.name && !list.has(x.key)) list.set(x.key, { ...x, from: i }); }));
  const items = [...list.values()].map((x) => {
    const mk = CHECK[x.key];
    const def = DEFS.find((d) => d.key === mk);
    let ok = false, when = null;
    if (def) {
      const thr = def.key === 'inOrder' ? 1 : (() => { const r = M.engine?.REFS?.[stroke]?.[def.ref]; return r ? (def.dir === 'down' ? r.hi : r.lo) : null; })();
      for (let i = x.from + 1; i < rows.length && thr != null; i++) {
        const v = rows[i].byType[stroke].m[mk];
        if (Number.isFinite(v) && (def.dir === 'down' ? v <= thr : v >= thr)) { ok = true; when = rows[i].date; break; }
      }
    }
    return `<div class="it ${ok ? 'ok' : ''}"><span class="box" aria-hidden="true"></span><div><b>${esc(x.name)}</b><span>${esc(x.dose || '')} · validé si ${esc(x.check || '')}</span></div><span class="st">${ok ? `validé ${new Date(when).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}` : 'en cours'}</span></div>`;
  });
  $('#pEx').innerHTML = items.join('') || '<p class="empty">Les exercices prescrits par tes analyses apparaîtront ici et se cocheront tout seuls quand la mesure passera le seuil.</p>';
}

on('saved', () => { if (!$('#v-progression').hidden) show(); });
