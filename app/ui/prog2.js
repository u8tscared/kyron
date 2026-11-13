// KYRON · Progression, vague 2 : charge aiguë / chronique et prévention (load.js), programme hebdomadaire généré à
// partir des écarts mesurés (H04), retour audio entre deux frappes via la capacité « tts » (H06).
import { $, $$, f, fi, esc, fit, C, on, store, STROKE_FR, analyzable, mean } from './util.js';
import { S, cur } from './state.js';
import { M, has } from './core.js';
import { ttsP } from './caps.js';
import { dynOf } from './ana.js';

const kpi = (label, val, unit, d, cls = '', dcls = '') => `<div class="kpi ${cls}"><div class="lbl">${label}</div><b>${val}<small>${unit}</small></b><div class="d ${dcls}">${d || '&nbsp;'}</div></div>`;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// ---------- Charge ----------
function loadHistory(H) {
  const byDay = new Map();
  for (const e of H) {
    const k = dayKey(e.date), list = byDay.get(k) || [];
    for (const [t, v] of Object.entries(e.byType || {})) for (let i = 0; i < (v.n || 0); i++) list.push({ type: t, racketKmh: v.m?.racketKmh ?? undefined });
    byDay.set(k, list);
  }
  return [...byDay.entries()].map(([date, strokes]) => ({ date, strokes }));
}
// Exemple de charge (5 semaines, montée trop rapide la dernière) tant qu'aucune séance n'est enregistrée
function exampleLoad() {
  const out = [], now = Date.now();
  for (let d = 34; d >= 0; d--) {
    const wd = new Date(now - d * 86400e3).getDay();
    if (![1, 3, 5, 6].includes(wd)) continue;
    const n = Math.round((d < 7 ? 70 : 38) + (wd === 6 ? 15 : 0));
    const strokes = [];
    for (let i = 0; i < n; i++) strokes.push({ type: i % 4 === 0 ? 'serve' : i % 3 ? 'forehand' : 'backhand', racketKmh: i % 4 === 0 ? 150 : 115 });
    out.push({ date: dayKey(now - d * 86400e3), strokes });
  }
  return out;
}
export function renderLoad(H, ex) {
  const el = $('#ldK'); if (!el) return;
  if (!has('load', 'computeLoad')) { el.innerHTML = '<p class="empty">Module de charge indisponible pour le moment.</p>'; return null; }
  const hist = ex ? exampleLoad() : loadHistory(H);
  let L = null; try { L = M.load.computeLoad(hist, { today: dayKey(Date.now()) }); } catch (e) { console.warn('[kyron] charge', e); }
  if (!L) { el.innerHTML = '<p class="empty">Pas assez de séances pour calculer la charge.</p>'; return null; }
  const z = L.zone || {};
  el.innerHTML = [
    kpi('Ratio aiguë / chronique', Number.isFinite(L.acwr) ? f(L.acwr, 2) : '—', '', esc(z.label || ''), 'hero', z.key === 'danger' || z.key === 'caution' ? 'att' : ''),
    kpi('Charge aiguë', f(L.acute, 1), 'UA/j', '7 derniers jours'),
    kpi('Charge chronique', f(L.chronic, 1), 'UA/j', '28 derniers jours'),
    kpi('Cette semaine', fi(L.weekLoad), 'UA', Number.isFinite(L.weekChangePct) ? `${L.weekChangePct >= 0 ? '+' : '−'}${fi(Math.abs(L.weekChangePct))} % vs semaine passée` : '', '', L.weekChangePct > 15 ? 'att' : ''),
  ].join('');
  $('#ldAl').innerHTML = (L.alerts?.length ? `<ul class="issues">${L.alerts.map((a) => `<li><b class="${a.severity >= 3 ? 'acc' : ''}">${esc(a.label)}</b> — ${esc(a.detail)}</li>`).join('')}</ul>` : `<p class="note">${esc(z.detail || 'Charge stable.')}</p>`)
    + (L.advice?.text ? `<div class="advice"><b>Conseil de volume</b><p>${esc(L.advice.text)}${L.advice.strokesPerWeek ? ` Fourchette : ${fi(L.advice.strokesPerWeek[0])} à ${fi(L.advice.strokesPerWeek[1])} frappes sur la semaine.` : ''}</p></div>` : '');
  $('#ldNote').textContent = `${ex ? 'Exemple. ' : ''}Charge par frappe ≈ (vitesse de raquette / 100 km/h)², × 1,6 pour un service. Le ratio sert à piloter le volume, il ne prédit pas une blessure. Confiance ${fi((L.confidence ?? 0) * 100)} %.`;
  drawLoad(L);
  return L;
}
function drawLoad(L) {
  const { g, w, h } = fit($('#ldCv'));
  const d = L.daily.slice(-35); if (!d.length) return;
  const pad = { l: 34, r: 10, t: 12, b: 20 };
  const yMax = Math.max(1, ...d.map((x) => Math.max(x.load, x.acute, x.chronic))) * 1.1;
  const bw = (w - pad.l - pad.r) / d.length;
  const X = (i) => pad.l + i * bw + bw / 2, Y = (v) => h - pad.b - v / yMax * (h - pad.t - pad.b);
  g.font = `10px ${C.mono}`; g.fillStyle = C.mute; g.strokeStyle = C.rule; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const k of [0, 0.5, 1]) { g.beginPath(); g.moveTo(pad.l, Y(yMax * k)); g.lineTo(w - pad.r, Y(yMax * k)); g.stroke(); g.fillText(fi(yMax * k), pad.l - 4, Y(yMax * k)); }
  d.forEach((x, i) => { if (x.load > 0) { g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(X(i) - bw * 0.35, Y(x.load), bw * 0.7, h - pad.b - Y(x.load)); } });
  const line = (k, col, dash) => { g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(dash || []); g.beginPath(); d.forEach((x, i) => (i ? g.lineTo(X(i), Y(x[k])) : g.moveTo(X(i), Y(x[k])))); g.stroke(); g.setLineDash([]); };
  line('chronic', C.s3, [5, 4]); line('acute', '#fff');
  const lst = d[d.length - 1]; g.fillStyle = L.zone?.key === 'danger' || L.zone?.key === 'caution' ? C.acc : '#fff'; g.beginPath(); g.arc(X(d.length - 1), Y(lst.acute), 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.mute; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  [0, Math.floor(d.length / 2), d.length - 1].forEach((i) => g.fillText(new Date(d[i].date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }), X(i), h - 5));
}

// ---------- Programme hebdomadaire (H04) ----------
// Construit à partir des constats de la séance (gravité, exercices), des écarts de timing au style de référence,
// des alertes de charges articulaires et du conseil de volume.
export function renderPlan(L, ex) {
  const el = $('#plan'); if (!el) return;
  const st = S.session?.strokes || [];
  if (!st.length) { el.innerHTML = '<p class="empty">Analyse une séance pour générer ton programme.</p>'; return; }
  const fx = new Map();
  for (const s of st) for (const x of s.res.findings || []) if (x.sev > 0) { const p = fx.get(x.key); if (!p || p.sev < x.sev) fx.set(x.key, { ...x, stroke: analyzable(s.type), n: (p?.n || 0) + 1 }); else p.n++; }
  const prio = [...fx.values()].sort((a, b) => b.sev - a.sev || b.n - a.n).slice(0, 3);
  const EX = M.engine?.EXERCISES || {};
  const exOf = (x) => EX[x.exercise] || { name: x.title, dose: '3 × 10 répétitions', check: '' };
  // Écart de timing le plus fort (style.js) sur la frappe affichée
  let phaseGap = null;
  try {
    const s = cur(); if (s && has('style', 'classifyStyle') && has('style', 'compareToReference')) {
      const cs = M.style.classifyStyle(s.res, analyzable(s.type)); const cmp = cs.ranking?.length ? M.style.compareToReference(s.res, cs.ranking[0].key, { stroke: analyzable(s.type) }) : null;
      phaseGap = cmp?.phases?.slice().sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs))[0] || null;
    }
  } catch (e) { phaseGap = null; }
  const d = dynOf(); const joint = d?.alerts?.filter((a) => a.severity >= 2) || [];
  const risky = L && (L.zone?.key === 'danger' || L.zone?.key === 'caution');
  const spw = L?.advice?.strokesPerWeek, perDay = spw ? Math.round(((spw[0] + spw[1]) / 2) / 4) : 60;
  const serves = L?.advice?.servesPerSession ?? 20;
  const physio = [];
  if (joint.some((a) => /épaule|shoulder/i.test(a.key + a.label))) physio.push('Rotateurs externes de l\'épaule à l\'élastique, 3 × 15');
  if (joint.some((a) => /coude|elbow/i.test(a.key + a.label))) physio.push('Excentrique des fléchisseurs du poignet, 3 × 12');
  if (joint.some((a) => /lomb|lumbar/i.test(a.key + a.label))) physio.push('Gainage anti-rotation (Pallof), 3 × 30 s');
  if (prio.some((x) => x.key === 'legs') || joint.some((a) => /genou|knee/i.test(a.key + a.label))) physio.push('Squats sautés amortis, 4 × 6');
  if (!physio.length) physio.push('Gainage et mobilité de hanches, 20 min');
  const t1 = prio[0] ? exOf(prio[0]) : null, t2 = prio[1] ? exOf(prio[1]) : t1, t3 = prio[2] ? exOf(prio[2]) : null;
  const days = [
    { d: 'Lundi', k: 'Technique', items: [t1 && `${t1.name} — ${t1.dose}`, `${perDay} frappes au panier, ${STROKE_FR[prio[0]?.stroke] || 'coup principal'}`].filter(Boolean) },
    { d: 'Mardi', k: 'Physique', items: physio },
    { d: 'Mercredi', k: risky ? 'Repos' : 'Timing', items: risky ? ['Repos complet : ta charge récente est au-dessus de ton habitude'] : [phaseGap ? `Rythme de la phase « ${phaseGap.label} » : ${phaseGap.deltaMs < 0 ? 'ralentis' : 'accélère'} de ≈ ${fi(Math.abs(phaseGap.deltaMs))} ms (frappes au métronome)` : 'Frappes au métronome, 3 × 10', t3 && `${t3.name} — ${t3.dose}`].filter(Boolean) },
    { d: 'Jeudi', k: 'Technique', items: [t2 && `${t2.name} — ${t2.dose}`, `Services : ${serves} maximum`].filter(Boolean) },
    { d: 'Vendredi', k: 'Repos actif', items: ['Mobilité, étirements, 20 min'] },
    { d: 'Samedi', k: 'Jeu', items: [`Match ou jeu à thème, en gardant le point 1 : ${prio[0]?.title || 'chaîne cinétique'}`, 'Filme 2 minutes pour la prochaine analyse'] },
    { d: 'Dimanche', k: 'Repos', items: ['Récupération'] },
  ];
  el.innerHTML = days.map((x) => `<div class="day ${/Repos/.test(x.k) ? 'rest' : ''}"><div class="lbl">${x.d}</div><b>${esc(x.k)}</b><ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  $('#planNote').textContent = `Généré à partir de ${prio.length} écart${prio.length > 1 ? 's' : ''} prioritaire${prio.length > 1 ? 's' : ''} de la séance${phaseGap ? ', du timing comparé au style le plus proche' : ''}${joint.length ? ', des alertes de charge articulaire' : ''}${L ? ` et du conseil de volume${ex ? ' (exemple)' : ''}` : ''}. Un repère d'entraînement, pas une prescription médicale.`;
}

// ---------- Retour audio entre deux frappes (H06) ----------
let tts = null, ttsState = 'idle', auto = false, lastSaid = '';
export function cueFor(s = cur()) {
  if (!s) return '';
  const r = s.res, fx = (r.findings || []).filter((x) => x.sev > 0).sort((a, b) => b.sev - a.sev)[0];
  const kmh = Math.round(r.metrics.racketSpeed * 3.6);
  return `${STROKE_FR[s.type] || 'Frappe'} : score ${r.score}, raquette à ${kmh} kilomètres heure. ${fx ? `Priorité : ${fx.title}.` : 'Rien à corriger de prioritaire, garde ce geste.'}`;
}
export async function initTts() {
  const box = $('#ttsBox'); if (!box) return;
  tts = await ttsP;
  if (!tts || typeof tts.speak !== 'function') { box.hidden = true; return; }
  box.hidden = false;
  auto = store.get('kyron-tts-auto', false) === true;
  $('#ttsAuto').setAttribute('aria-pressed', String(auto));
  tts.onState?.((e) => {
    ttsState = e.state; $('#ttsStop').hidden = e.state === 'idle';
    if (e.state === 'idle' && (e.reason === 'unavailable' || e.reason === 'not_granted')) box.hidden = true;
  });
  $('#ttsSay').addEventListener('click', () => say(cueFor()));
  $('#ttsStop').addEventListener('click', () => { tts.stop?.().catch(() => {}); });
  $('#ttsAuto').addEventListener('click', () => { auto = !auto; store.set('kyron-tts-auto', auto); $('#ttsAuto').setAttribute('aria-pressed', String(auto)); });
  on('stroke', () => { $('#ttsTxt').textContent = cueFor(); if (auto) say(cueFor()); });
  $('#ttsTxt').textContent = cueFor();
}
function say(txt) {
  if (!tts || !txt) return;
  $('#ttsTxt').textContent = txt; lastSaid = txt;
  tts.speak(txt.slice(0, 1900), { language: 'fr' }).catch((e) => {
    if (e?.code === 'not_granted' || e?.code === 'unavailable') $('#ttsBox').hidden = true;
    else if (e?.code !== 'stopped') $('#ttsMsg').textContent = e?.code === 'no_gesture' ? 'Clique d\'abord sur « Écouter » pour autoriser la lecture.' : e?.code === 'rate_limited' ? 'Trop de lectures pour le moment, réessaie dans un instant.' : '';
  });
}
export function refreshCue() { const t = $('#ttsTxt'); if (t) t.textContent = cueFor(); }
export { mean };
