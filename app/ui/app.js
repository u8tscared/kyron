// KYRON · application : démarrage, routage par hash, mode Simple / Avancé, profil joueur
import { $, $$, store, on, emit, reduced, LEVEL_FR, esc } from './util.js';
import { S } from './state.js';
import { loadCore, M } from './core.js';

const ROUTES = ['seance', 'optimiseur', 'materiel', 'balle', 'progression', 'coach'];
const views = {};          // modules de vue chargés
const loaders = {
  seance: () => import('./seance.js'),
  optimiseur: () => import('./optim.js'),
  materiel: () => import('./bench.js'),
  balle: () => import('./bench.js'),
  progression: () => import('./progression.js'),
  coach: () => import('./coach.js'),
};
let route = null;

// ---------- Démarrage ----------
const bootLog = $('#bootLog');
const bootT0 = performance.now();
function logLine(msg, ok) {
  const d = document.createElement('div');
  const t = ((performance.now() - bootT0) / 1000).toFixed(3);
  d.innerHTML = `<span style="color:var(--dim)">${t}</span><span class="m2">${esc(msg)}</span><span class="ld"></span><span class="${ok === false ? 'ko' : 'ok'}">${ok === false ? 'ABSENT' : 'OK'}</span>`;
  bootLog.appendChild(d);
  while (bootLog.children.length > 8) bootLog.firstChild.remove();
}
function bootOut() {
  const b = $('#boot'); if (!b) return;
  if (reduced()) { b.remove(); return; }
  b.classList.add('out');
  setTimeout(() => b.remove(), 650);
}
$('#boot').addEventListener('click', bootOut);

// ---------- Mode ----------
function setMode(m) {
  S.mode = m === 'adv' ? 'adv' : 'simple';
  document.body.classList.toggle('adv', S.mode === 'adv');
  $$('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === S.mode)));
  store.set('kyron-mode', S.mode);
  emit('mode', S.mode);
}
$('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });

// ---------- Profil ----------
const pop = $('#profPop');
function profSummary() {
  const p = S.profile;
  $('#profSum').textContent = `${(p.height / 100).toFixed(2).replace('.', ',')} m · ${p.hand === 'right' ? 'D' : 'G'} · ${LEVEL_FR[p.level] || ''}`;
}
function fillProfile() { const p = S.profile; $('#pfH').value = p.height; $('#pfW').value = p.weight; $('#pfHand').value = p.hand; $('#pfLvl').value = p.level; }
function togglePop(open) {
  const o = open ?? pop.hidden;
  pop.hidden = !o; $('#profBtn').setAttribute('aria-expanded', String(o));
  if (o) { fillProfile(); $('#pfH').focus(); }
}
$('#profBtn').addEventListener('click', (e) => { e.stopPropagation(); togglePop(); });
document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== $('#profBtn')) togglePop(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) togglePop(false); });
$('#profOk').addEventListener('click', () => {
  const h = Math.max(120, Math.min(230, +$('#pfH').value || 180));
  const w = Math.max(30, Math.min(160, +$('#pfW').value || 75));
  const prev = { ...S.profile };
  S.profile = { height: h, weight: w, hand: $('#pfHand').value, level: $('#pfLvl').value };
  S.profileSet = true;
  store.set('kyron-profile', S.profile);
  profSummary(); togglePop(false);
  emit('profile', { prev, next: S.profile });
});

// ---------- Routage ----------
async function show(r) {
  if (!ROUTES.includes(r)) r = 'seance';
  route = r;
  $$('.tabs a').forEach((a) => { if (a.dataset.r === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $$('main.view').forEach((v) => { v.hidden = v.dataset.view !== r; });
  try {
    const mod = views[r] || (views[r] = await loaders[r]());
    if (route !== r) return;
    await mod.show?.(r);
  } catch (e) {
    console.error(`[kyron] vue ${r}`, e);
  }
  emit('route', r);
}
export const currentRoute = () => route;
window.addEventListener('hashchange', () => { show(location.hash.slice(1)); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); });

// ---------- Lancement ----------
(async function start() {
  setMode(S.mode);
  profSummary();
  logLine('Initialisation de l\'instrument', true);
  await loadCore(({ label, ok }) => logLine(label, ok));
  if (!M.engine) logLine('Analyse impossible sans moteur', false);
  // Les modules qui tournent en arrière-plan (séance + optimiseur) sont chargés dès le départ
  const [seance, optim, prog] = await Promise.all([loaders.seance(), loaders.optimiseur(), loaders.progression()]);
  views.seance = seance; views.optimiseur = optim; views.progression = prog;
  optim.init?.();
  import('./report.js').then((m) => m.initReport()).catch((e) => console.warn('[kyron] export', e));
  await seance.init?.();
  logLine('Démo prête', true);
  const r = location.hash.slice(1);
  await show(ROUTES.includes(r) ? r : 'seance');
  setTimeout(bootOut, reduced() ? 0 : 380);
})();

