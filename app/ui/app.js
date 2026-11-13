// KYRON · application : démarrage, comptes, routage par hash, navigation, mode Simple / Expert
import { $, $$, on, emit, reduced, esc } from './util.js';
import { S } from './state.js';
import { loadCore, M } from './core.js';
import { account } from './acct.js';
import { applyProfile, setMode, profile, firstName } from './prefs.js';
import './glossary.js';

// Écrans : vue affichée, module chargé, onglet actif, titre court et écran parent (bouton retour)
const R = {
  bienvenue: { view: 'bienvenue', load: () => import('./onboard.js'), bare: true, open: true },
  accueil: { view: 'accueil', load: () => import('./home.js'), tab: 'accueil' },
  analyser: { view: 'analyser', load: () => import('./analyse.js'), tab: 'analyser', title: 'Analyser' },
  resultats: { view: 'resultats', load: () => import('./seance.js'), tab: 'accueil', title: 'Ton analyse', back: 'accueil', open: true },
  geste: { view: 'geste', load: () => import('./optim.js'), tab: 'labo', title: 'Ton geste idéal', back: 'labo' },
  progres: { view: 'progres', load: () => import('./progression.js'), tab: 'progres' },
  profil: { view: 'profil', load: () => import('./profil.js'), tab: 'profil' },
  labo: { view: 'labo', load: () => import('./home.js'), tab: 'labo', title: 'Labo', back: 'accueil' },
  materiel: { view: 'materiel', load: () => import('./bench.js'), tab: 'labo', title: 'Matériel & cordage', back: 'labo' },
  balle: { view: 'balle', load: () => import('./bench.js'), tab: 'labo', title: 'Balle', back: 'labo' },
  match: { view: 'match', load: () => import('./match.js'), tab: 'labo', title: 'Match', back: 'labo' },
  coach: { view: 'coach', load: () => import('./coach.js'), tab: 'labo', title: 'Coach IA', back: 'labo' },
  eleves: { view: 'eleves', load: () => import('./eleves.js'), tab: 'labo', title: 'Élèves', back: 'labo' },
  apropos: { view: 'apropos', load: async () => ({}), tab: 'profil', title: 'À propos des mesures', back: 'profil', open: true },
};
// Anciennes adresses → nouvelles
const ALIAS = { seance: 'resultats', optimiseur: 'geste', progression: 'progres', '': 'accueil' };
const views = {};
let route = null, ready = false;

// ---------- Démarrage ----------
const bootLog = $('#bootLog');
const bootT0 = performance.now();
function logLine(msg, ok) {
  const d = document.createElement('div');
  const t = ((performance.now() - bootT0) / 1000).toFixed(3);
  d.innerHTML = `<span style="color:var(--dim)">${t}</span><span class="m2">${esc(msg)}</span><span class="ld"></span><span class="${ok === false ? 'ko' : 'ok'}">${ok === false ? 'absent' : 'ok'}</span>`;
  bootLog.appendChild(d);
  while (bootLog.children.length > 7) bootLog.firstChild.remove();
}
function bootOut() {
  const b = $('#boot'); if (!b) return;
  if (reduced()) { b.remove(); return; }
  b.classList.add('out');
  setTimeout(() => b.remove(), 650);
}
$('#boot').addEventListener('click', bootOut);

// ---------- Mode ----------
$('#modeTog').addEventListener('click', () => setMode(S.mode === 'adv' ? 'simple' : 'adv'));
on('mode', () => { if (route) paintChrome(route); });

// ---------- Routage ----------
function parse(h) {
  const raw = (h || '').replace(/^#/, '');
  const [name, ...rest] = raw.split('/');
  const n = ALIAS[name] ?? name;
  return { name: R[n] ? n : 'accueil', sub: rest.join('/') };
}
function guard(name) {
  const u = account.user();
  if (!u) return R[name].open ? name : 'bienvenue';
  if (!profile?.onboarded || account.recovering) return 'bienvenue';
  if (name === 'resultats' && !S.session) return 'accueil';
  return name;
}
function paintChrome(name) {
  const r = R[name];
  document.body.classList.toggle('bare', !!r.bare);
  document.body.dataset.route = name;
  $$('#tabs a').forEach((a) => { if (a.dataset.r === r.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const signed = !!account.user();
  const back = r.back && (signed || name !== 'resultats') ? r.back : (!signed && name !== 'bienvenue' ? 'bienvenue' : null);
  $('#backBtn').hidden = !back;
  if (back) $('#backBtn').href = `#${back}`;
  document.body.classList.toggle('sub', !!back);
  $('#topTitle').textContent = r.title || '';
  document.body.classList.toggle('guest', !signed);
  const n = firstName();
  $('#avatar').textContent = n ? n[0].toUpperCase() : '·';
}

async function show(h) {
  let { name, sub } = parse(h);
  const g = guard(name);
  if (g !== name) { name = g; sub = ''; history.replaceState(null, '', `#${name}`); }
  else if ((location.hash || '').replace(/^#/, '').split('/')[0] !== name) history.replaceState(null, '', `#${name}${sub ? `/${sub}` : ''}`);
  const prevRoute = route;
  route = name;
  paintChrome(name);
  const viewKey = R[name].view;
  $$('main.view').forEach((v) => {
    const on = v.dataset.view === viewKey;
    if (on && v.hidden) { v.hidden = false; v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
    else if (!on) v.hidden = true;
  });
  if (prevRoute !== name) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  try {
    const mod = views[name] || (views[name] = await R[name].load());
    if (route !== name) return;
    await mod.show?.(name, sub);
  } catch (e) {
    console.error(`[kyron] vue ${name}`, e);
  }
  emit('route', name);
}
export const currentRoute = () => route;
export const go = (h) => { if (location.hash === `#${h}`) show(h); else location.hash = h; };
window.addEventListener('hashchange', () => { if (ready) show(location.hash); });
on('nav', (h) => go(h));

// Changement de compte (connexion, déconnexion) : on recharge le profil et on renvoie au bon écran
const migrated = new Set();
async function syncAccount() {
  let p = null;
  try { p = account.user() ? await account.getProfile() : null; } catch (e) { console.warn('[kyron] profil', e); }
  applyProfile(p || (account.user() ? { name: account.user().name, mode: 'simple', onboarded: false } : null));
  if (!account.user()) { S.session = null; }
  else if (!migrated.has(account.user().id)) {
    migrated.add(account.user().id);
    // Ancien historique de cet appareil (avant les comptes) repris une seule fois dans le compte
    account.migrateLegacy?.().then((r) => { if (r?.imported) emit('saved', {}); }).catch((e) => console.warn('[kyron] migration', e));
  }
  emit('account', account.user());
}

// ---------- Lancement ----------
(async function start() {
  setMode(S.mode, { persist: false });
  logLine('Initialisation', true);
  const accP = account.init().then(() => true).catch((e) => { console.warn('[kyron] comptes', e); return false; });
  await loadCore(({ label, ok }) => logLine(label, ok));
  if (!M.engine) logLine('Analyse impossible sans moteur', false);
  logLine(account.backend === 'cloud' ? 'Comptes en ligne' : 'Comptes sur cet appareil', await accP);
  await syncAccount();
  // Modules qui tournent en arrière-plan (séance + optimiseur + progression)
  const [seance, optim, prog] = await Promise.all([import('./seance.js'), import('./optim.js'), import('./progression.js')]);
  views.resultats = seance; views.geste = optim; views.progres = prog;
  optim.init?.();
  await seance.init?.();
  (await import('./results.js')).init();
  import('./report.js').then((m) => m.initReport()).catch((e) => console.warn('[kyron] export', e));
  try { (await import('./adv.js')).init(); } catch (e) { console.warn('[kyron] panneaux avancés', e); }
  import('./prog2.js').then((m) => m.initTts()).catch((e) => console.warn('[kyron] audio', e));
  logLine('Prêt', true);
  account.onChange?.(async () => { await syncAccount(); if (ready) show(location.hash); });
  // Rechargement sur une analyse : on rouvre la dernière séance ouverte dans cet onglet
  try {
    const id = sessionStorage.getItem('kyron-open');
    if (id && account.user() && /^#(resultats|geste|seance|optimiseur)/.test(location.hash)) await seance.openSaved(await account.getSession(id));
  } catch (e) { console.warn('[kyron] reprise de séance', e); }
  ready = true;
  await show(location.hash);
  setTimeout(bootOut, reduced() ? 0 : 300);
})();
