// KYRON · Profil : identité, mode Simple / Expert, corps, matériel, liens, déconnexion, suppression du compte
import { $, $$, esc, on } from './util.js';
import { S } from './state.js';
import { M } from './core.js';
import { account } from './acct.js';
import { LEVELS, profile, saveProfile, setMode } from './prefs.js';
import { ICON, sheet, toast, reveal } from './kit.js';

on('mode', () => { if (!$('#v-profil').hidden) paintMode(); });

export function show() {
  const root = $('#profRoot');
  const u = account.user() || {}, p = profile || {};
  const R = M.physics?.RACKETS || [], ST = M.physics?.STRINGS || {};
  root.innerHTML = `<div class="prof">
    <div class="who rv"><span class="avatar big">${esc((p.name || u.name || '·')[0]?.toUpperCase() || '·')}</span><div><h1 class="h1">${esc(p.name || u.name || 'Ton profil')}</h1><p class="muted">${esc(u.email || '')} · ${account.backend === 'cloud' ? 'compte en ligne' : 'compte sur cet appareil'}</p></div></div>

    <section class="card rv"><div class="card-h"><h2>Affichage</h2></div>
      <div class="modes" role="radiogroup" aria-label="Niveau de détail">
        <button type="button" role="radio" data-m="simple"><b>Simple</b><small>L’essentiel en clair : ton score, tes 3 priorités, un exercice. Le détail reste à un geste.</small></button>
        <button type="button" role="radio" data-m="adv"><b>Expert</b><small>Toutes les données : courbes, chaîne cinétique en ms, charges articulaires, valeurs brutes, 3D.</small></button>
      </div></section>

    <section class="card rv"><div class="card-h"><h2>Ton jeu</h2><span class="saved" id="pfSaved" aria-live="polite"></span></div>
      <form class="form" id="pfForm">
        <label class="fld"><span>Prénom</span><input name="name" maxlength="60" value="${esc(p.name || '')}"></label>
        <div class="fld"><span>Niveau</span><select name="level">${LEVELS.map((l) => `<option value="${l.k}" ${p.level === l.k ? 'selected' : ''}>${l.t}</option>`).join('')}</select></div>
        <div class="fld"><span>Main</span><div class="seg2" role="radiogroup" aria-label="Main de frappe"><button type="button" role="radio" data-h="R" aria-checked="${p.hand !== 'L'}">Droitier</button><button type="button" role="radio" data-h="L" aria-checked="${p.hand === 'L'}">Gaucher</button></div></div>
        <div class="two"><label class="fld"><span>Taille</span><span class="unit"><input name="heightCm" type="number" inputmode="numeric" min="120" max="230" value="${esc(p.heightCm || '')}"><em>cm</em></span></label>
        <label class="fld"><span>Poids</span><span class="unit"><input name="massKg" type="number" inputmode="numeric" min="30" max="160" value="${esc(p.massKg || '')}"><em>kg</em></span></label></div>
        <p class="why"><i>${ICON.info}</i><span>Ta taille donne l’échelle de la vidéo ; ton poids sert à calculer les forces sur tes articulations.</span></p>
        <div class="two"><label class="fld"><span>Raquette</span><select name="racket"><option value="">Standard</option>${R.map((r) => `<option value="${r.id}" ${p.racket === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label class="fld"><span>Cordage</span><select name="material"><option value="">Je ne sais pas</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${p.strings === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label></div>
        <label class="fld"><span>Tension du cordage</span><span class="unit"><input name="tension" type="number" inputmode="decimal" min="15" max="35" step="0.5" value="${esc(p.stringTension || '')}" placeholder="24"><em>kg</em></span></label>
        <p class="ferr" id="pfErr2" role="alert"></p>
        <button class="btn solid" type="submit">Enregistrer</button>
      </form></section>

    <section class="card rv links">
      <a href="#labo">${ICON.lab}<span>Le labo<small>Outils avancés</small></span>${ICON.next}</a>
      <a href="#apropos">${ICON.info}<span>À propos des mesures<small>Ce qui est mesuré, estimé, simulé</small></span>${ICON.next}</a>
      <button type="button" id="pfOut">${ICON.logout}<span>Se déconnecter</span></button>
      <button type="button" id="pfDel" class="danger">${ICON.trash}<span>Supprimer mon compte<small>Profil, séances et vidéos, définitivement</small></span></button>
    </section>
    <p class="note ver">KYRON Lab · v3</p>
  </div>`;
  reveal(root);
  paintMode();
  $$('.modes button', root).forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.m); toast(b.dataset.m === 'adv' ? 'Mode expert activé.' : 'Mode simple activé.'); }));
  let hand = p.hand === 'L' ? 'L' : 'R';
  $$('.seg2 button', root).forEach((b) => b.addEventListener('click', () => { hand = b.dataset.h; $$('.seg2 button', root).forEach((x) => x.setAttribute('aria-checked', String(x === b))); }));
  $('#pfForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const h = +d.heightCm, w = +d.massKg, t = +d.tension;
    const err = (m) => { $('#pfErr2').textContent = m; };
    if (!String(d.name || '').trim()) return err('Indique ton prénom.');
    if (!(h >= 120 && h <= 230)) return err('Ta taille doit être entre 120 et 230 cm.');
    if (!(w >= 30 && w <= 160)) return err('Ton poids doit être entre 30 et 160 kg.');
    err('');
    try {
      await saveProfile({ name: String(d.name).trim(), level: d.level, hand, heightCm: Math.round(h), massKg: Math.round(w), racket: d.racket || null, strings: d.material || null, stringTension: t >= 15 && t <= 35 ? t : null });
      $('#pfSaved').textContent = 'Enregistré';
      setTimeout(() => { const el = $('#pfSaved'); if (el) el.textContent = ''; }, 2500);
      $('.who .h1', root).textContent = String(d.name).trim();
    } catch (ex) { err(ex?.message || 'Enregistrement impossible.'); }
  });
  $('#pfOut').onclick = async () => { await account.signOut(); S.session = null; location.hash = '#bienvenue'; };
  $('#pfDel').onclick = () => sheet.open({
    title: 'Supprimer ton compte ?',
    html: `<p class="sh-lead">Ton profil, toutes tes séances et tes vidéos seront effacés. C’est définitif.</p><label class="fld"><span>Écris SUPPRIMER pour confirmer</span><input id="delOk" autocomplete="off"></label><p class="ferr" id="delErr"></p><div class="ec-acts"><button type="button" class="btn danger-btn" id="delGo">Supprimer définitivement</button><button type="button" class="btn" data-close>Annuler</button></div>`,
    onMount: (b) => {
      b.querySelector('#delGo').onclick = async () => {
        if (b.querySelector('#delOk').value.trim().toUpperCase() !== 'SUPPRIMER') { b.querySelector('#delErr').textContent = 'Écris SUPPRIMER pour confirmer.'; return; }
        try { await account.deleteAccount(); sheet.close(); S.session = null; toast('Compte supprimé.'); location.hash = '#bienvenue'; } catch (ex) { b.querySelector('#delErr').textContent = ex?.message || 'Suppression impossible.'; }
      };
    },
  });
}
function paintMode() { $$('#profRoot .modes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === S.mode))); }
