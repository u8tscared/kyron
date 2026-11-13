// KYRON · parcours « Analyser » : choix du coup → guide de tournage → filmer / importer → analyse en direct → résultats
import { $, $$, f, fi, esc, fit, C, on, emit, reduced, STROKE_FR } from './util.js';
import { S } from './state.js';
import { M } from './core.js';
import { account } from './acct.js';
import { ICON, STROKE_ART, toast } from './kit.js';

let stroke = null, root = null, running = false, live = null, raf = 0;
const STROKES = [
  { k: 'serve', t: 'Service', d: 'Lancer, armé, frappe au-dessus de la tête.' },
  { k: 'forehand', t: 'Coup droit', d: 'Du côté de ta main de frappe.' },
  { k: 'backhand', t: 'Revers', d: 'À une ou deux mains.' },
];

export function show(_, sub) {
  root = $('#anaRoot');
  if (running) { if (sub !== 'analyse') history.replaceState(null, '', '#analyser/analyse'); return; }
  if (sub === 'guide') return guide();
  return choose();
}

const dots = (n) => `<div class="pdots" aria-label="Étape ${n} sur 3">${[1, 2, 3].map((i) => `<i class="${i < n ? 'done' : i === n ? 'on' : ''}"></i>`).join('')}</div>`;

// ---------- 1. Choix du coup ----------
function choose() {
  root.innerHTML = `<div class="flow">${dots(1)}
    <h1 class="h1 rv">Quel geste veux-tu analyser ?</h1>
    <p class="lead rv">Un seul type de coup par vidéo : l’analyse est plus précise.</p>
    <div class="stroke-cards">${STROKES.map((s) => `<button type="button" class="sc rv" data-k="${s.k}"><span class="sc-art">${STROKE_ART[s.k]}</span><span class="sc-t"><b>${s.t}</b><small>${s.d}</small></span><span class="sc-go">${ICON.next}</span></button>`).join('')}</div>
    <button type="button" class="link-btn rv" data-k="auto">Plusieurs coups dans la même vidéo ? <u>Détection automatique</u></button>
    <div class="flow-foot rv"><button type="button" class="link-btn" id="anaDemo">${ICON.play}<span>Voir un exemple d’analyse</span></button></div>
  </div>`;
  stagger();
  root.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { stroke = b.dataset.k === 'auto' ? null : b.dataset.k; location.hash = '#analyser/guide'; }));
  $('#anaDemo').onclick = demoRun;
}

// ---------- 2. Guide de tournage ----------
function guide() {
  const st = stroke ? STROKE_FR[stroke] : 'Tes coups';
  const tip = stroke === 'serve' ? 'Pour le service, filme de côté, du côté de ton bras de frappe. En deuxième vue, de dos derrière la ligne de fond.' : 'Filme de côté, du côté de ton bras de frappe, au niveau de la ligne de fond.';
  root.innerHTML = `<div class="flow">${dots(2)}
    <div class="eyebrow rv">${esc(st)}</div>
    <h1 class="h1 rv">Place ton téléphone</h1>
    <figure class="film rv">${FILM_SVG}<figcaption class="sr">Schéma : téléphone posé à hauteur de hanche, à 3 ou 4 mètres sur le côté du joueur, joueur entier dans le cadre.</figcaption></figure>
    <ul class="checks">
      <li class="rv"><i>${ICON.check}</i><div><b>De côté, à 3–4 mètres</b><span>${esc(tip)}</span></div></li>
      <li class="rv"><i>${ICON.check}</i><div><b>À hauteur de hanche</b><span>Posé sur un sac, un banc ou un trépied, bien stable. En mode paysage ou portrait.</span></div></li>
      <li class="rv"><i>${ICON.check}</i><div><b>Tout ton corps dans le cadre</b><span>Des pieds jusqu’à la raquette bras levé. Évite le contre-jour.</span></div></li>
      <li class="rv"><i>${ICON.check}</i><div><b>Ralenti si possible</b><span>120 ou 240 images/s (Appareil photo › Ralenti). C’est ce qui change le plus la précision.</span></div></li>
      <li class="rv"><i>${ICON.check}</i><div><b>3 à 5 gestes, 20 secondes maximum</b><span>KYRON découpe chaque frappe tout seul.</span></div></li>
    </ul>
    <details class="twocam rv"><summary><span>Tu as deux téléphones ?</span><small>Option 2 caméras</small></summary>
      <p>Filme le même geste en même temps de côté et de dos. KYRON synchronise les deux vidéos et reconstruit ton geste en 3D : la profondeur est bien plus précise.</p>
      <label class="btn">${ICON.upload}<span>Importer les 2 vidéos</span><input type="file" accept="video/*" multiple id="in2" aria-label="Importer deux vidéos"></label></details>
    <div class="sticky-acts">
      <label class="btn solid big">${ICON.camera}<span>Filmer</span><input type="file" accept="video/*" capture="environment" id="inCam" aria-label="Filmer avec l’appareil photo"></label>
      <label class="btn big">${ICON.upload}<span>Importer</span><input type="file" accept="video/*" id="inFile" aria-label="Importer une vidéo"></label>
    </div>
  </div>`;
  stagger();
  for (const id of ['#inCam', '#inFile', '#in2']) $(id).addEventListener('change', (e) => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) run(fs.slice(0, 2)); });
}

const FILM_SVG = `<svg viewBox="0 0 340 190" class="film-svg" aria-hidden="true">
  <defs><pattern id="fg" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="rgba(255,255,255,.05)"/></pattern></defs>
  <rect width="340" height="190" fill="url(#fg)"/>
  <line x1="10" y1="168" x2="330" y2="168" class="gnd"/>
  <g class="fov"><path d="M62 112 L200 6 L200 168 Z" class="cone"/><rect x="200" y="6" width="84" height="162" class="frame"/></g>
  <g class="tripod"><line x1="62" y1="112" x2="50" y2="168"/><line x1="62" y1="112" x2="74" y2="168"/><line x1="62" y1="112" x2="62" y2="168"/></g>
  <rect x="55" y="100" width="14" height="24" rx="2.5" class="phone"/>
  <g class="who"><circle cx="240" cy="44" r="7" class="b"/><path d="M240 52 L240 98 M240 60 L228 76 L226 92 M240 60 L254 50 L262 34 M240 98 L232 132 L230 166 M240 98 L248 132 L252 166" class="b"/><path d="M262 34 L268 20" class="rk"/><ellipse cx="271" cy="14" rx="5" ry="7" class="rk"/>
    <g class="j"><circle cx="240" cy="60" r="2.4"/><circle cx="228" cy="76" r="2.4"/><circle cx="254" cy="50" r="2.4"/><circle cx="262" cy="34" r="2.4"/><circle cx="240" cy="98" r="2.4"/><circle cx="232" cy="132" r="2.4"/><circle cx="248" cy="132" r="2.4"/></g></g>
  <g class="dim"><line x1="62" y1="180" x2="240" y2="180"/><line x1="62" y1="176" x2="62" y2="184"/><line x1="240" y1="176" x2="240" y2="184"/><text x="151" y="177" text-anchor="middle">3 à 4 m</text></g>
  <line x1="40" y1="112" x2="300" y2="112" class="hip"/>
  <text x="80" y="107" class="cap">hauteur de hanche</text>
  <text x="194" y="16" text-anchor="end" class="cap">corps entier dans le cadre</text>
</svg>`;

// ---------- 3. Analyse en direct ----------
const STEPS = [
  { k: 'model', t: 'Je prépare l’analyse' },
  { k: 'pose', t: 'Je repère ton corps, image par image' },
  { k: 'ball', t: 'Je suis la balle et la raquette' },
  { k: 'compute', t: 'Je découpe tes frappes et je calcule les forces' },
  { k: 'save', t: 'J’enregistre ta séance' },
];
function stage(title) {
  root.innerHTML = `<div class="flow ana">${dots(3)}
    <h1 class="h1">${esc(title)}</h1>
    <div class="ana-stage"><canvas id="anaCv" aria-label="Squelette détecté en direct"></canvas><i class="aim a"></i><i class="aim b"></i><i class="aim c"></i><i class="aim d"></i><div class="scanline"></div>
      <div class="ana-pct"><b class="mono" id="anaPct">0</b><small>%</small></div><div class="ana-hud mono" id="anaHud"></div></div>
    <ol class="ana-steps" id="anaSteps">${STEPS.map((s) => `<li data-k="${s.k}"><i class="st-i"></i><span>${s.t}<small></small></span></li>`).join('')}</ol>
    <div class="ana-acts"><button type="button" class="btn" id="anaCancel">Annuler</button></div>
    <p class="note ana-note">Garde cet écran ouvert. L’analyse se fait sur ton appareil${account.backend === 'cloud' ? ', puis ta séance est enregistrée dans ton compte' : ''}.</p>
  </div>`;
  live = { frame: null, trail: [], p: 0, shown: 0 };
  loopDraw();
}
function setStep(k, state, sub) {
  const li = root.querySelector(`#anaSteps [data-k="${k}"]`); if (!li) return;
  li.className = state; if (sub != null) li.querySelector('small').textContent = sub;
}
function loopDraw() {
  cancelAnimationFrame(raf);
  const cv = $('#anaCv'); if (!cv) return;
  const tick = () => {
    if (!document.body.contains(cv)) return;
    const { g, w, h } = fit(cv);
    // grille fine
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    for (let x = 0; x <= w; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const fr = live?.frame;
    if (fr?.img && M.engine?.BONES) {
      const xs = fr.img.map((p) => p.x), ys = fr.img.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const sc = Math.min((w * 0.8) / ((x1 - x0) || 1), (h * 0.84) / ((y1 - y0) || 1)) * 0.95;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const P = (p) => [w / 2 + (p.x - cx) * sc, h / 2 + (p.y - cy) * sc];
      live.trail.forEach((t, i) => { const al = (i + 1) / (live.trail.length + 1) * 0.35; g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = 1; const R = S.profile.hand === 'left' ? 15 : 16; const a = t.img[R]; if (a && i) { const b = live.trail[i - 1].img[R]; g.beginPath(); g.moveTo(...P(b)); g.lineTo(...P(a)); g.stroke(); } });
      g.lineCap = 'round';
      for (const [a, b] of M.engine.BONES) { const pa = fr.img[a], pb = fr.img[b]; if (!pa || !pb) continue; g.strokeStyle = 'rgba(244,244,242,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(...P(pa)); g.lineTo(...P(pb)); g.stroke(); }
      for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const p = fr.img[k]; if (!p) continue; const [x, y] = P(p); g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.lineWidth = 1.3; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.stroke(); g.fillStyle = C.acc; g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill(); }
    } else {
      g.fillStyle = C.mute; g.font = `13px ${C.body}`; g.textAlign = 'center'; g.fillText('Recherche du joueur…', w / 2, h / 2);
    }
    if (live) { live.shown += (live.p - live.shown) * 0.12; const el = $('#anaPct'); if (el) el.textContent = Math.round(live.shown * 100); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
on('analysis', (e) => {
  if (!live) return;
  live.p = Math.max(live.p, Math.min(0.97, e.p || 0));
  if (e.frame) { live.frame = e.frame; live.trail.push(e.frame); if (live.trail.length > 40) live.trail.shift(); }
  if (e.stage === 'pose') {
    setStep('model', 'done'); setStep('pose', 'on', `${fi(e.poses)} positions du corps trouvées`); setStep('ball', 'on', e.ball ? 'balle et raquette suivies à chaque image' : 'suivi indisponible sur ce navigateur');
    $('#anaHud').innerHTML = `T ${f(e.t, 1)} / ${f(e.dur, 1)} s${e.eta != null ? ` · reste ≈ ${f(e.eta, 0)} s` : ''}`;
  }
  if (e.stage === 'compute') { setStep('pose', 'done'); setStep('ball', 'done'); setStep('compute', 'on'); }
});
on('status', (e) => { if (live && e.p != null && e.p < 0.04) { setStep('model', 'on', 'modèle de vision, une seule fois'); live.p = Math.max(live.p, e.p); } });

async function run(files) {
  if (running) return;
  running = true;
  location.hash = '#analyser/analyse';
  stage('J’analyse ton geste');
  const seance = await import('./seance.js');
  $('#anaCancel').onclick = () => seance.cancelAnalysis();
  setStep('model', 'on');
  let sess = null;
  try {
    sess = await seance.importVideos(files, { stroke });
  } catch (e) {
    running = false; cancelAnimationFrame(raf); live = null;
    if (e?.name === 'AbortError') { location.hash = '#analyser/guide'; toast('Analyse annulée.'); return; }
    root.innerHTML = `<div class="flow">${dots(3)}<div class="empty-card err"><span class="ec-ic">${ICON.info}</span><h2>L’analyse n’a pas abouti</h2><p>${esc(cap(e?.message || 'erreur inconnue'))}</p>
      <ul class="tips"><li>Le joueur doit être entier dans le cadre, bien éclairé.</li><li>Un geste complet : de la préparation à la fin de l’accompagnement.</li><li>Format .mp4 ou .mov (H.264).</li></ul>
      <div class="ec-acts"><a class="btn solid" href="#analyser/guide">Réessayer</a><a class="btn" href="#analyser">Changer de coup</a></div></div></div>`;
    return;
  }
  setStep('compute', 'done');
  live.p = 1;
  // Enregistrement (en arrière-plan : on montre les résultats tout de suite)
  setStep('save', 'on');
  const save = saveSession(sess, seance).catch((e) => { console.warn('[kyron] sauvegarde', e); toast(`Séance non enregistrée : ${e?.message || e}`, 'err'); });
  await Promise.race([save, new Promise((r) => setTimeout(r, 900))]);
  setStep('save', 'done');
  running = false; cancelAnimationFrame(raf); live = null;
  location.hash = '#resultats';
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function saveSession(sess, seance) {
  if (!account.user()) return;
  const thumb = await seance.thumbnail(sess);
  const { entryOf } = await import('./progression.js');
  const entry = entryOf(sess);
  const best = sess.strokes[sess.summary?.bestIdx ?? 0] || sess.strokes[0];
  const summary = {
    score: best.res.score, meanScore: sess.summary?.meanScore ?? best.res.score, count: sess.strokes.length,
    stroke: best.type, top: best.res.findings.find((x) => x.sev > 0)?.title || null,
    ballKmh: Math.round(best.ball?.speedKmh ?? best.res.metrics.ballSpeedKmh), measuredBall: !!best.ball?.speedKmh,
    byType: entry.byType, multi: !!sess.multi, fatigue: entry.fatigue,
  };
  // Vidéo trop lourde pour le stockage en ligne (50 Mo sur l'offre gratuite) : on la compresse d'abord, en arrière-plan.
  let video = sess.files?.[0] || null;
  if (video && account.backend !== 'local') {
    const { prepareVideo, COMPRESS } = await import('./compress.js');
    if (video.size > COMPRESS.threshold) {
      let lastC = -1;
      toast('Compression de la vidéo…');
      const r = await prepareVideo(video, { onProgress: (p, pass = 1) => {
        const q = Math.round((p || 0) * 100), k = pass * 1000 + q;
        if (k >= lastC + 10 && q < 100) { lastC = k - (k % 10); toast(`Compression de la vidéo${pass > 1 ? ` (essai ${pass})` : ''}… ${q} %`); }
      } });
      video = r.video;
      if (r.info) summary.video = r.info;   // cadence d'origine / de sortie, définition, poids : utile au replay
    }
  }
  let lastP = -1;
  const id = await account.saveSession({
    stroke: stroke || best.type, source: sess.multi ? '2cam' : 'video', createdAt: sess.date, summary, result: seance.packSession(sess),
    video, thumb,
  }, { onProgress: (p) => { const q = Math.round((p || 0) * 100); if (q >= lastP + 20 && q < 100) { lastP = q; toast(`Enregistrement de ta séance… ${q} %`); } } });
  sess.savedId = id;
  try { sessionStorage.setItem('kyron-open', id); } catch (e) { /* rien */ }
  toast('Séance enregistrée dans ton historique.');
  emit('saved', { id });
}

// ---------- Exemple ----------
async function demoRun() {
  if (running) return;
  running = true;
  location.hash = '#analyser/analyse';
  stage('Exemple d’analyse');
  $('#anaCancel').textContent = 'Passer';
  let skip = false;
  $('#anaCancel').onclick = () => { skip = true; };
  const seance = await import('./seance.js');
  const sess = seance.loadDemo();
  const frames = sess?.strokes?.[0]?.frames || [];
  const T = reduced() ? 0 : 2600, t0 = performance.now();
  setStep('model', 'done');
  await new Promise((res) => {
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / (T || 1));
      if (live) {
        live.p = p * 0.98;
        const fr = frames[Math.min(frames.length - 1, Math.floor(p * frames.length))];
        if (fr) { live.frame = fr; live.trail.push(fr); if (live.trail.length > 40) live.trail.shift(); }
        setStep('pose', p > 0.45 ? 'done' : 'on', `${fi(Math.floor(p * frames.length))} positions du corps`);
        setStep('ball', p > 0.6 ? 'done' : p > 0.2 ? 'on' : '');
        setStep('compute', p > 0.9 ? 'done' : p > 0.6 ? 'on' : '');
      }
      if (p >= 1 || skip) res(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  running = false; cancelAnimationFrame(raf); live = null;
  location.hash = '#resultats';
}

function stagger() { $$('.rv', root).forEach((el, i) => { el.style.setProperty('--i', i); el.classList.add('in'); }); }
