// KYRON · Accueil (salut, grand bouton, dernières séances, une info de progrès, accès au Labo) et Labo (outils experts)
import { $, $$, f, fi, esc, on, STROKE_FR } from './util.js';
import { S } from './state.js';
import { account } from './acct.js';
import { firstName } from './prefs.js';
import { ICON, STROKE_ART, fmtDate, toast, sheet, reveal } from './kit.js';

let cache = null, cacheAt = 0;
export async function sessions(force) {
  if (!account.user()) return [];
  if (!force && cache && performance.now() - cacheAt < 4000) return cache;
  try { cache = await account.listSessions({ limit: 60 }); cacheAt = performance.now(); } catch (e) { console.warn('[kyron] séances', e); cache = cache || []; }
  return cache;
}
on('saved', () => { cache = null; });
on('account', () => { cache = null; });

export async function show(name) {
  if (name === 'labo') return labo();
  return home();
}

// ---------- Carte de séance (réutilisée par Progrès) ----------
export function sessCard(x) {
  const sm = x.summary || {};
  const st = STROKE_FR[x.stroke] || STROKE_FR[sm.stroke] || 'Séance';
  const art = STROKE_ART[x.stroke] || STROKE_ART[sm.stroke] || STROKE_ART.forehand;
  return `<button type="button" class="sess rv" data-open="${esc(x.id)}">
    <span class="sess-th">${x.thumbUrl ? `<img src="${esc(x.thumbUrl)}" alt="" loading="lazy">` : `<span class="sess-art">${art}</span>`}${x.hasVideo ? `<i class="has-v">${ICON.play}</i>` : ''}</span>
    <span class="sess-t"><b>${esc(st)}</b><small>${esc(fmtDate(x.createdAt))}${sm.count ? ` · ${sm.count} frappe${sm.count > 1 ? 's' : ''}` : ''}${x.source === '2cam' ? ' · 2 caméras' : ''}</small>${sm.top ? `<small class="sess-top">${esc(sm.top)}</small>` : ''}</span>
    <span class="sess-sc"><b class="mono">${Number.isFinite(sm.score) ? sm.score : '—'}</b><small>score</small></span></button>`;
}
export function bindOpen(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-open]'); if (!b || b.disabled) return;
    b.disabled = true; b.classList.add('busy');
    try {
      const rec = await account.getSession(b.dataset.open);
      await (await import('./seance.js')).openSaved(rec);
      try { sessionStorage.setItem('kyron-open', rec.id); } catch (e2) { /* rien */ }
      location.hash = '#resultats';
    } catch (err) { toast(`Impossible d’ouvrir cette séance : ${err?.message || err}`, 'err'); }
    finally { b.disabled = false; b.classList.remove('busy'); }
  });
}

// Une info de progrès mise en avant (comparaison simple, en phrase)
function insight(list) {
  const real = list.filter((x) => Number.isFinite(x.summary?.score));
  if (!real.length) return null;
  const last = real[0];
  const same = real.filter((x) => (x.summary?.stroke || x.stroke) === (last.summary?.stroke || last.stroke));
  const st = (STROKE_FR[last.summary?.stroke || last.stroke] || 'geste').toLowerCase();
  if (same.length >= 2) {
    const first = same[same.length - 1], d = last.summary.score - first.summary.score;
    const n = same.length;
    if (d > 0) return { big: `+${d}`, unit: 'points', txt: `Ton score de ${st} a progressé de ${d} point${d > 1 ? 's' : ''} en ${n} séances.`, up: true };
    if (d < 0) return { big: `${d}`, unit: 'points', txt: `Ton score de ${st} a baissé de ${-d} point${d < -1 ? 's' : ''} depuis ta première séance. Regarde ta priorité ci-dessous.` };
    return { big: '=', unit: '', txt: `Ton score de ${st} est stable sur ${n} séances.` };
  }
  return { big: String(last.summary.score), unit: '/100', txt: last.summary.top ? `Ta priorité pour ton ${st}\u00a0: ${last.summary.top.charAt(0).toLowerCase()}${last.summary.top.slice(1)}.` : `Premier score enregistré pour ton ${st}. Refilme dans quelques jours pour voir ta progression.` };
}

async function home() {
  const root = $('#homeRoot');
  const n = firstName();
  const h = new Date().getHours();
  const hello = h < 5 || h >= 18 ? 'Bonsoir' : 'Salut';
  root.innerHTML = `<div class="home">
    <div class="hello rv"><div class="eyebrow">${esc(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h1 class="h1">${hello}${n ? ` ${esc(n)}` : ''}.</h1></div>
    <a class="hero-cta rv" href="#analyser"><span class="hc-grid" aria-hidden="true"></span><i class="aim a"></i><i class="aim b"></i><i class="aim c"></i><i class="aim d"></i>
      <span class="hc-art" aria-hidden="true">${STROKE_ART.serve}</span>
      <span class="hc-t"><span class="eyebrow">Moins d’une minute</span><b>Analyser un geste</b><small>Service, coup droit ou revers, filmé avec ton téléphone.</small></span>
      <span class="hc-go">${ICON.scan}</span></a>
    <div id="homeIns"></div>
    <section class="home-sec"><div class="sec-h"><h2>Tes dernières séances</h2><a class="lnk" href="#progres">Tout voir</a></div><div class="sess-list" id="homeSess"><div class="sk"></div><div class="sk"></div></div></section>
    <a class="lab-card rv" href="#labo"><span class="lc-ic">${ICON.lab}</span><span><b>Le labo</b><small>Ton geste idéal, matériel et cordage, balle, match, élèves…</small></span><span class="lc-go">${ICON.next}</span></a>
  </div>`;
  reveal(root);
  const list = await sessions();
  if (!document.body.contains(root) || $('#v-accueil').hidden) return;
  const ins = insight(list);
  $('#homeIns').innerHTML = ins ? `<div class="insight rv"><span class="in-n mono ${ins.up ? 'up' : ''}">${esc(ins.big)}<small>${esc(ins.unit)}</small></span><p>${esc(ins.txt)}</p><a class="lnk" href="#progres">Progrès</a></div>` : '';
  const el = $('#homeSess');
  if (!list.length) {
    el.innerHTML = `<div class="empty-home rv"><h3>Ta première analyse, en 3 étapes</h3><ol>
      <li><i class="mono">1</i><span><b>Pose ton téléphone</b> à hauteur de hanche, de côté, à 3–4 m.</span></li>
      <li><i class="mono">2</i><span><b>Filme 3 à 5 gestes</b>, au ralenti si possible.</span></li>
      <li><i class="mono">3</i><span><b>Reçois tes 3 priorités</b> et un exercice pour progresser.</span></li></ol>
      <div class="ec-acts"><a class="btn solid" href="#analyser">C’est parti</a><button type="button" class="btn" id="homeDemo">Voir un exemple</button></div></div>`;
    $('#homeDemo').onclick = async () => { (await import('./seance.js')).loadDemo(); location.hash = '#resultats'; };
  } else {
    el.innerHTML = list.slice(0, 4).map(sessCard).join('');
    bindOnce(el);
  }
  reveal($('#homeIns')); reveal(el);
}
function bindOnce(el) { if (!el.dataset.b) { el.dataset.b = '1'; bindOpen(el); } }

// ---------- Labo ----------
const TOOLS = [
  { h: '#geste', ic: 'ghost', t: 'Ton geste idéal', d: 'Le simulateur rejoue ton geste des millions de fois et te dit quoi changer pour gagner en vitesse et en effet, sans risque.', star: true },
  { h: '#materiel', ic: 'racket', t: 'Matériel & cordage', d: 'Raquette, plombs, tension, hybrides : leur effet réel sur ta balle et ton bras.' },
  { h: '#balle', ic: 'ball', t: 'Balle & trajectoire', d: 'Vol, rebond selon la surface, marge au-dessus du filet, carte des impacts.' },
  { h: '#match', ic: 'court', t: 'Analyse de match', d: 'Caméra derrière toi : points, enchaînements, carte de chaleur, profil de l’adversaire.' },
  { h: '#resultats', ic: 'chart', t: 'Comparaison aux styles pros', d: 'Ton geste phase par phase face à des styles types de haut niveau (dans l’analyse complète).', needs: true, expert: true },
  { h: '#eleves', ic: 'team', t: 'Élèves (coach)', d: 'Tes joueurs, leurs séances, tes corrections validées avant envoi.' },
  { h: '#coach', ic: 'chat', t: 'Coach IA', d: 'Pose tes questions sur ta séance : il répond avec tes chiffres, sans rien inventer.' },
  { h: '#resultats', ic: 'doc', t: 'Rapport', d: 'Exporte un rapport complet de ta séance (dans l’analyse, bouton « Exporter »).', needs: true },
  { h: '#apropos', ic: 'info', t: 'À propos des mesures', d: 'Ce qui est mesuré, estimé ou simulé, et avec quelle précision.' },
];
function labo() {
  const root = $('#labRoot');
  root.innerHTML = `<div class="page-head"><div><div class="eyebrow">Outils avancés</div><h1 class="h1 disp">Labo</h1><p class="lead">Tout ce que KYRON sait calculer, pour aller plus loin que les 3 priorités.</p></div></div>
    <div class="tools">${TOOLS.map((x, i) => `<a class="tool rv ${x.star ? 'star' : ''}" href="${x.h}" data-i="${i}"><span class="tl-ic">${ICON[x.ic]}</span><span class="tl-t"><b>${x.t}</b><small>${x.d}</small></span><span class="tl-go">${ICON.next}</span></a>`).join('')}</div>`;
  reveal(root);
  $$('.tool', root).forEach((a) => a.addEventListener('click', (e) => {
    const t = TOOLS[+a.dataset.i];
    if (t.needs && !S.session) { e.preventDefault(); sheet.open({ title: t.t, html: `<p class="sh-lead">Il faut d’abord une analyse : ouvre une séance depuis l’accueil ou analyse un nouveau geste.</p><div class="ec-acts"><a class="btn solid" href="#analyser" data-close>Analyser un geste</a></div>` }); return; }
    if (t.expert) { e.preventDefault(); import('./prefs.js').then((p) => { p.setMode('adv'); location.hash = '#resultats'; setTimeout(() => document.getElementById('styRank')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 500); }); }
  }));
}
