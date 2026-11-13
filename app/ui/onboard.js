// KYRON · premier lancement : 3 écrans de bienvenue animés → créer un compte / se connecter → profil en 3 étapes
import { $, $$, esc, reduced } from './util.js';
import { M } from './core.js';
import { account } from './acct.js';
import { LEVELS, profile, saveProfile } from './prefs.js';
import { ICON, ringSvg, toast } from './kit.js';

let slide = 0, authMode = 'up', pstep = 1, draft = {};
const root = () => $('#onbRoot');

export function show(_, sub) {
  if (account.user()) {
    if (profile?.onboarded) { location.hash = '#accueil'; return; }
    if (account.recovering) return newPassword();
    draft = { name: profile?.name || account.user()?.name || '', level: '', hand: profile?.hand || 'R', heightCm: '', massKg: '', racket: profile?.racket || '', strings: profile?.strings || '', stringTension: profile?.stringTension || '', ...draft };
    return profileStep(+sub?.replace(/\D/g, '') || pstep);
  }
  if (sub === 'compte' || sub === 'connexion') { authMode = sub === 'connexion' ? 'in' : 'up'; return auth(); }
  return slides();
}

// ---------- Bienvenue ----------
const SLIDES = [
  { t: 'Filme ton geste', d: 'Ton téléphone suffit. Pas de capteur, pas de matériel : pose-le au bord du court et joue.', art: () => `<svg viewBox="0 0 200 200" class="sa sa1" aria-hidden="true">
      <rect x="58" y="22" width="84" height="156" rx="14" class="ph"/><rect x="66" y="36" width="68" height="124" rx="4" class="scr"/>
      <circle cx="122" cy="46" r="3.5" class="rec"/><text x="114" y="49" text-anchor="end" class="t">REC</text>
      <g class="fig"><circle cx="100" cy="72" r="6" class="b"/><path d="M100 79 L100 112 M100 86 L90 98 L86 110 M100 86 L110 78 L114 64 M100 112 L93 132 L91 150 M100 112 L107 132 L110 150" class="b"/><path d="M114 64 L118 54" class="rk"/></g>
      <path d="M70 154h60" class="gl"/></svg>` },
  { t: 'KYRON mesure ton corps et la balle', d: '33 points de ton corps suivis image par image, la balle, la raquette, puis les forces sur tes articulations.', art: () => `<svg viewBox="0 0 200 200" class="sa sa2" aria-hidden="true">
      <path d="M30 170 H170" class="gl"/>
      <path d="M96 50 L96 104 M96 62 L80 82 L74 100 M96 62 L114 50 L124 28 M96 104 L84 136 L80 168 M96 104 L108 136 L114 168" class="trace"/>
      <circle cx="96" cy="40" r="9" class="trace"/>
      <path d="M124 28 L132 14" class="trace rk"/>
      <g class="jn"><circle cx="96" cy="62" r="3.4"/><circle cx="80" cy="82" r="3.4"/><circle cx="114" cy="50" r="3.4"/><circle cx="124" cy="28" r="3.4"/><circle cx="96" cy="104" r="3.4"/><circle cx="84" cy="136" r="3.4"/><circle cx="108" cy="136" r="3.4"/></g>
      <path d="M136 14 Q162 30 186 74" class="traj"/><circle cx="186" cy="74" r="3" class="ball"/>
      <path d="M84 136 m-12 -10 a16 16 0 0 1 8 -8" class="arc"/><text x="56" y="126" class="lbl">52°</text>
      <text x="150" y="20" class="lbl">137 km/h</text></svg>` },
  { t: 'Tu reçois tes 3 priorités', d: 'Un score, ce qui marche, ce qu’il faut corriger en premier, et un exercice pour progresser.', art: () => `<div class="sa sa3">${ringSvg(78, { size: 128, label: 'sur 100' })}<div class="sa3-l"><span><i>1</i>Plie davantage les genoux</span><span><i>2</i>Laisse le bassin partir d’abord</span><span><i>3</i>Va chercher la balle plus haut</span></div></div>` },
];
function slides() {
  const s = SLIDES[slide];
  root().innerHTML = `<div class="onb-in">
    <div class="onb-top"><span class="brand"><svg aria-hidden="true" style="color:#fff"><use href="#m1"/></svg><b>KYRON</b></span><a class="link-btn" href="#bienvenue/connexion">J’ai déjà un compte</a></div>
    <div class="onb-slide" id="onbSlide">
      <div class="onb-art">${s.art()}</div>
      <div class="onb-txt"><div class="eyebrow mono">${slide + 1} / 3</div><h1 class="h1">${esc(s.t)}</h1><p class="lead">${esc(s.d)}</p></div>
    </div>
    <div class="onb-foot">
      <div class="pdots wide">${SLIDES.map((_, i) => `<button type="button" class="${i === slide ? 'on' : i < slide ? 'done' : ''}" data-s="${i}" aria-label="Écran ${i + 1}"></button>`).join('')}</div>
      ${slide < 2 ? '<button type="button" class="btn solid big" id="onbNext">Continuer</button>' : '<a class="btn solid big" href="#bienvenue/compte">Créer mon compte</a>'}
      <button type="button" class="link-btn" id="onbDemo">${ICON.play}<span>Voir un exemple d’analyse</span></button>
    </div></div>`;
  const ring = root().querySelector('.ring'); if (ring) { ring.classList.add('anim'); }
  $('#onbNext')?.addEventListener('click', () => { slide = Math.min(2, slide + 1); slides(); });
  $$('.pdots button', root()).forEach((b) => b.addEventListener('click', () => { slide = +b.dataset.s; slides(); }));
  $('#onbDemo').onclick = async () => { (await import('./seance.js')).loadDemo(); location.hash = '#resultats'; };
  // balayage horizontal
  const el = $('#onbSlide'); let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) { slide = Math.max(0, Math.min(2, slide + (dx < 0 ? 1 : -1))); slides(); } });
}

// ---------- Compte ----------
function auth(msg, info) {
  const up = authMode === 'up';
  root().innerHTML = `<div class="onb-in narrow">
    <div class="onb-top"><a class="icon-btn" href="#bienvenue" aria-label="Retour">${ICON.back}</a><span class="brand"><svg aria-hidden="true" style="color:#fff"><use href="#m1"/></svg><b>KYRON</b></span><span style="width:44px"></span></div>
    <h1 class="h1">${up ? 'Crée ton compte' : 'Content de te revoir'}</h1>
    <p class="lead">${up ? 'Tes séances, ta progression et tes vidéos restent dans ton compte.' : 'Connecte-toi pour retrouver tes séances.'}</p>
    <form class="form" id="authF" novalidate>
      ${up ? '<label class="fld"><span>Prénom</span><input name="name" autocomplete="given-name" required maxlength="60" placeholder="Ton prénom"></label>' : ''}
      <label class="fld"><span>E-mail</span><input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="toi@exemple.fr"></label>
      <label class="fld"><span>Mot de passe</span><input name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" required minlength="${up ? 8 : 1}" placeholder="${up ? '8 caractères minimum' : ''}"></label>
      ${info ? `<p class="finfo">${esc(info)}</p>` : ''}<p class="ferr" id="authErr" role="alert">${msg ? esc(msg) : ''}</p>
      <button class="btn solid big" type="submit" id="authGo">${up ? 'Créer mon compte' : 'Se connecter'}</button>
      ${up ? '' : '<button type="button" class="link-btn" id="authReset">Mot de passe oublié ?</button>'}
    </form>
    <p class="swap">${up ? 'Déjà un compte ?' : 'Pas encore de compte ?'} <a href="#bienvenue/${up ? 'connexion' : 'compte'}">${up ? 'Se connecter' : 'Créer un compte'}</a></p>
    <p class="note fine">${account.backend === 'cloud' ? 'Données hébergées en Europe, chiffrées. Tu peux supprimer ton compte à tout moment depuis ton profil.' : 'Ton compte est enregistré sur cet appareil, dans ce navigateur.'}</p>
  </div>`;
  const F = $('#authF');
  F.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(F));
    const err = (m) => { $('#authErr').textContent = m; };
    if (up && !String(d.name || '').trim()) return err('Indique ton prénom.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email || '').trim())) return err('Cette adresse e-mail n’a pas l’air valide.');
    if (up && String(d.password || '').length < 8) return err('Le mot de passe doit faire au moins 8 caractères.');
    const btn = $('#authGo'); btn.disabled = true; btn.classList.add('loading'); err('');
    try {
      if (up) { draft = { name: String(d.name).trim() }; await account.signUp({ email: String(d.email).trim(), password: d.password, name: String(d.name).trim() }); }
      else await account.signIn({ email: String(d.email).trim(), password: d.password });
      // onChange (app.js) recharge le profil et réaffiche le bon écran ; on force au cas où
      setTimeout(() => { if (location.hash.startsWith('#bienvenue')) location.hash = '#bienvenue/profil'; }, 50);
    } catch (ex) {
      if (ex?.code === 'confirm_email') { authMode = 'in'; history.replaceState(null, '', '#bienvenue/connexion'); auth('', ex.message); return; }
      err(ex?.message || 'Une erreur est survenue.'); btn.disabled = false; btn.classList.remove('loading');
    }
  });
  $('#authReset')?.addEventListener('click', async () => {
    const email = String(new FormData(F).get('email') || '').trim();
    if (!email) { $('#authErr').textContent = 'Écris ton e-mail ci-dessus, puis appuie à nouveau.'; return; }
    try { await account.resetPassword(email); toast('Un e-mail de réinitialisation vient de partir.'); } catch (ex) { $('#authErr').textContent = ex?.message || 'Impossible pour le moment.'; }
  });
  setTimeout(() => F.querySelector('input')?.focus({ preventScroll: true }), reduced() ? 0 : 250);
}

// ---------- Profil en 3 étapes ----------
function profileStep(n) {
  pstep = Math.max(1, Math.min(3, n));
  const head = (t, d) => `<div class="onb-top"><button type="button" class="icon-btn" id="pBack" aria-label="Retour" ${pstep === 1 ? 'style="visibility:hidden"' : ''}>${ICON.back}</button><div class="pdots"><i class="${pstep > 1 ? 'done' : 'on'}"></i><i class="${pstep > 2 ? 'done' : pstep === 2 ? 'on' : ''}"></i><i class="${pstep === 3 ? 'on' : ''}"></i></div><span style="width:44px"></span></div>
    <div class="eyebrow">Ton profil · ${pstep} sur 3</div><h1 class="h1">${t}</h1>${d ? `<p class="lead">${d}</p>` : ''}`;
  let body = '';
  if (pstep === 1) {
    body = `${head('Faisons connaissance')}
      <label class="fld"><span>Prénom</span><input id="pfName" autocomplete="given-name" maxlength="60" value="${esc(draft.name || '')}" placeholder="Ton prénom"></label>
      <div class="fld"><span>Ton niveau</span><div class="lvls" role="radiogroup" aria-label="Ton niveau">${LEVELS.map((l) => `<button type="button" role="radio" aria-checked="${draft.level === l.k}" data-l="${l.k}"><b>${l.t}</b><small>${l.d}</small></button>`).join('')}</div></div>
      <p class="note" id="lvlNote">${modeNote(draft.level)}</p>`;
  } else if (pstep === 2) {
    body = `${head('Ton corps', 'Pour transformer ta vidéo en vraies distances et calculer les forces sur tes articulations.')}
      <div class="fld"><span>Tu joues</span><div class="seg2" role="radiogroup" aria-label="Main de frappe"><button type="button" role="radio" data-h="R" aria-checked="${draft.hand !== 'L'}">Droitier</button><button type="button" role="radio" data-h="L" aria-checked="${draft.hand === 'L'}">Gaucher</button></div></div>
      <div class="two"><label class="fld"><span>Taille</span><span class="unit"><input id="pfH" type="number" inputmode="numeric" min="120" max="230" value="${esc(draft.heightCm || '')}" placeholder="180"><em>cm</em></span></label>
      <label class="fld"><span>Poids</span><span class="unit"><input id="pfW" type="number" inputmode="numeric" min="30" max="160" value="${esc(draft.massKg || '')}" placeholder="75"><em>kg</em></span></label></div>
      <p class="why"><i>${ICON.info}</i><span>Ta taille donne l’échelle de la vidéo (les vitesses en km/h). Ton poids sert à calculer les forces sur ton épaule, ton coude, ton dos et tes genoux.</span></p>`;
  } else {
    const R = M.physics?.RACKETS || [], ST = M.physics?.STRINGS || {};
    body = `${head('Ta raquette', 'Facultatif : ça affine le calcul de la balle et les conseils de cordage. Tu pourras le changer plus tard.')}
      <div class="fld"><span>Le modèle le plus proche</span><div class="rk-list" role="radiogroup" aria-label="Raquette">${R.map((r) => `<button type="button" role="radio" aria-checked="${draft.racket === r.id}" data-r="${r.id}"><b>${esc(r.name)}</b><small class="mono">${r.mass} g · ${r.head} po²</small></button>`).join('')}<button type="button" role="radio" aria-checked="${!draft.racket}" data-r=""><b>Je ne sais pas</b><small>On prend une raquette standard</small></button></div></div>
      <div class="two"><label class="fld"><span>Cordage</span><select id="pfStr"><option value="">Je ne sais pas</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${draft.strings === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <label class="fld"><span>Tension</span><span class="unit"><input id="pfT" type="number" inputmode="decimal" min="15" max="35" step="0.5" value="${esc(draft.stringTension || '')}" placeholder="24"><em>kg</em></span></label></div>`;
  }
  root().innerHTML = `<div class="onb-in narrow pf">${body}<p class="ferr" id="pfErr" role="alert"></p>
    <div class="sticky-acts"><button type="button" class="btn solid big" id="pNext">${pstep < 3 ? 'Continuer' : 'C’est parti'}</button>${pstep === 3 ? '<button type="button" class="link-btn" id="pSkip">Passer cette étape</button>' : ''}</div></div>`;
  const R = root();
  $('#pBack', R)?.addEventListener('click', () => profileStep(pstep - 1));
  $$('.lvls button', R).forEach((b) => b.addEventListener('click', () => { draft.level = b.dataset.l; $$('.lvls button', R).forEach((x) => x.setAttribute('aria-checked', String(x === b))); $('#lvlNote').innerHTML = modeNote(draft.level); }));
  $$('.seg2 button', R).forEach((b) => b.addEventListener('click', () => { draft.hand = b.dataset.h; $$('.seg2 button', R).forEach((x) => x.setAttribute('aria-checked', String(x === b))); }));
  $$('.rk-list button', R).forEach((b) => b.addEventListener('click', () => { draft.racket = b.dataset.r; $$('.rk-list button', R).forEach((x) => x.setAttribute('aria-checked', String(x === b))); }));
  $('#pNext').addEventListener('click', next);
  $('#pSkip')?.addEventListener('click', () => { draft.racket = ''; draft.strings = ''; draft.stringTension = null; finish(); });
}
const modeNote = (l) => (!l ? 'Ton niveau règle le niveau de détail de l’app. Tu pourras le changer.' : l === 'amateur' ? 'On démarre en <b>mode simple</b> : l’essentiel, en clair. Le mode expert reste à un geste.' : 'On démarre en <b>mode expert</b> : toutes les données, courbes et valeurs brutes. Le mode simple reste à un geste.');

function next() {
  const err = (m) => { $('#pfErr').textContent = m; };
  if (pstep === 1) {
    draft.name = $('#pfName').value.trim();
    if (!draft.name) return err('Indique ton prénom.');
    if (!draft.level) return err('Choisis ton niveau.');
    return profileStep(2);
  }
  if (pstep === 2) {
    const h = +$('#pfH').value, w = +$('#pfW').value;
    if (!(h >= 120 && h <= 230)) return err('Ta taille doit être entre 120 et 230 cm.');
    if (!(w >= 30 && w <= 160)) return err('Ton poids doit être entre 30 et 160 kg.');
    draft.heightCm = Math.round(h); draft.massKg = Math.round(w);
    return profileStep(3);
  }
  const mat = $('#pfStr').value, t = +$('#pfT').value;
  draft.strings = mat || ''; draft.stringTension = t >= 15 && t <= 35 ? t : null;
  finish();
}
async function finish() {
  const btn = $('#pNext'); btn.disabled = true; btn.classList.add('loading');
  try {
    await saveProfile({ name: draft.name, level: draft.level, hand: draft.hand === 'L' ? 'L' : 'R', heightCm: draft.heightCm, massKg: draft.massKg, racket: draft.racket || null, strings: draft.strings || null, stringTension: draft.stringTension || null, mode: draft.level === 'amateur' ? 'simple' : 'expert', onboarded: true });
    draft = {}; pstep = 1; slide = 0;
    location.hash = '#accueil';
  } catch (e) { $('#pfErr').textContent = e?.message || 'Enregistrement impossible.'; btn.disabled = false; btn.classList.remove('loading'); }
}

// ---------- Nouveau mot de passe (lien « mot de passe oublié » reçu par e-mail) ----------
function newPassword() {
  root().innerHTML = `<div class="onb-in narrow">
    <div class="onb-top"><span class="brand"><svg aria-hidden="true" style="color:#fff"><use href="#m1"/></svg><b>KYRON</b></span></div>
    <h1 class="h1">Nouveau mot de passe</h1><p class="lead">Choisis ton nouveau mot de passe pour ton compte.</p>
    <form class="form" id="npF" novalidate><label class="fld"><span>Mot de passe</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="8 caractères minimum"></label>
    <p class="ferr" id="npErr" role="alert"></p><button class="btn solid big" type="submit">Enregistrer</button></form></div>`;
  $('#npF').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = String(new FormData(e.target).get('password') || '');
    if (pw.length < 8) { $('#npErr').textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
    try { await account.updatePassword(pw); toast('Mot de passe modifié.'); location.hash = '#accueil'; } catch (ex) { $('#npErr').textContent = ex?.message || 'Impossible pour le moment.'; }
  });
}
