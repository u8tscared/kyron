// KYRON · vue Séance : démo, import 1 ou 2 vidéos, extraction de pose, frappes, verdict, courbes, 3D
import { $, $$, f, fi, esc, fit, C, clamp, emit, on, STROKE_FR, analyzable, reduced, mean, linreg } from './util.js';
import { S, cur, curRes } from './state.js';
import { M, has, analyzeSessionSafe, qualitySafe, buildDemoSession, classify, comSeries, fatigueOf } from './core.js';
import { spinEstimate } from './physics-ui.js';
import { help } from './glossary.js';

export const P = { frames: [], res: null, i: 0, playing: false, speed: 0.25, clock: 0, yaw: -0.7, pitch: 0.25, com: [], trail: 0.3 };
// Points d'accroche des panneaux avancés (fantôme, annotations, charges…) : dessin sur la vidéo, sur la 3D, rendu
export const hooks = { frame: [], d3: [], render: [] };
export const api = { landmarker: () => getLandmarker(), detect: (lm, v, rate) => lm.detectForVideo(v, ++tsCounter * 1000 / rate), isBusy: () => busy, setCur: (i) => setCur(i), stop: () => stop(), frameAt: (t) => frameAt(t), redraw: () => drawFrame(), status: (m, p) => status(m, p), contentRect: (w, h) => contentRect(w, h) };
let busy = false, abortExt = null, extracting = false;
const vA = $('#vidA'), vB = $('#vidB');

// ====================== Initialisation ======================
export async function init() {
  bind();
  on('mode', () => requestAnimationFrame(() => { renderAll(); }));
  on('profile', ({ prev, next }) => {
    if (S.session?.source === 'video' && S.session.all && (prev.hand !== next.hand || prev.height !== next.height)) reanalyzeVideo('Profil mis à jour : analyse recalculée.');
    else renderVerdict();
  });
  on('opt', () => renderKpis());
  window.addEventListener('resize', () => { renderRing(); drawTimeline(); drawCharts(); drawFrame(); });
}
export function show() { requestAnimationFrame(() => { drawTimeline(); drawCharts(); drawFrame(); renderRing(); }); }

function status(msg, p) {
  emit('status', { msg, p });
  $('#statusMsg').textContent = msg;
  $('#statusBar').hidden = p == null;
  if (p != null) $('#statusBar i').style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
}

// ====================== Démo ======================
export function loadDemo() {
  if (!M.engine) { status("Le moteur d'analyse n'a pas pu être chargé : recharge la page."); return; }
  stop();
  vA.hidden = true; vA.removeAttribute('src'); $('#pip').hidden = true;
  const sess = buildDemoSession();
  if (!sess.strokes.length) { status('Démo indisponible pour le moment.'); return; }
  const q = qualitySafe(sess.strokes[0].frames, { width: 1920, height: 1080, duration: 2 });
  setSession({ ...sess, source: 'demo', quality: q, date: new Date().toISOString(), id: 'demo' });
  status(`Exemple : ${sess.strokes.length} frappes synthétiques d'un joueur droitier filmé à 120 images/s. Ce n'est pas toi : analyse ta vidéo pour voir ton propre geste.`);
  return S.session;
}

function setSession(sess, pick = 0) {
  S.session = sess;
  S.strokeIdx = clamp(pick, 0, sess.strokes.length - 1);
  $('#hudSrc').innerHTML = `SOURCE <b>${sess.source === 'demo' ? 'EXEMPLE' : sess.multi ? 'CAM A+B · FUSION' : 'CAM A'}</b>`;
  renderChips();
  pickStroke(S.strokeIdx, true);
  renderQuality(); renderFatigue();
  emit('session', sess);
}

function renderChips() {
  const st = S.session.strokes;
  $('#strokes').hidden = st.length < 2;
  $('#strokes').innerHTML = st.map((s, i) => `<button class="chip" data-i="${i}" aria-pressed="${i === S.strokeIdx}"><b>${i + 1}. ${esc(STROKE_FR[s.type] || s.type)}</b><span>Score <span class="mono">${s.res.score}</span>${s.ball?.speedKmh ? ` · <span class="mono">${fi(s.ball.speedKmh)}</span> km/h` : ''}</span></button>`).join('');
}

function pickStroke(i, silent) {
  stop();
  S.strokeIdx = i;
  $$('#strokes .chip').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
  const s = cur(); if (!s) return;
  P.frames = s.frames; P.res = s.res;
  P.com = comSeries(s.res, s.frames);
  setCur(s.res.impact);
  renderAll();
  if (!silent) emit('stroke', s);
}

// ====================== Import vidéo ======================
function bind() {
  $('#strokes').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) pickStroke(+b.dataset.i); });
  $('#speedSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#speedSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    P.speed = +b.dataset.sp; if (!vA.hidden) vA.playbackRate = Math.max(0.0625, P.speed);
  });
  $('#play').onclick = togglePlay;
  $('#prev').onclick = () => { stop(); setCur(P.i - 1); };
  $('#next').onclick = () => { stop(); setCur(P.i + 1); };
  $('#toImpact').onclick = () => { stop(); if (P.res) setCur(P.res.impact); };
  document.addEventListener('keydown', (e) => {
    if ($('#v-seance').hidden || e.target.closest('input,textarea,select')) return;
    if (e.key === 'ArrowLeft') { stop(); setCur(P.i - 1); } else if (e.key === 'ArrowRight') { stop(); setCur(P.i + 1); } else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlay(); }
  });
  const tl = $('#tl');
  tl.addEventListener('pointerdown', (e) => { stop(); tl.setPointerCapture(e.pointerId); seekTl(e); });
  tl.addEventListener('pointermove', (e) => { if (e.buttons) seekTl(e); });
  const v3 = $('#v3d'); let drag = null;
  v3.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: P.yaw, pitch: P.pitch }; v3.setPointerCapture(e.pointerId); v3.style.cursor = 'grabbing'; });
  v3.addEventListener('pointermove', (e) => { if (!drag) return; P.yaw = drag.yaw + (e.clientX - drag.x) * 0.01; P.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.01, -0.2, 1.3); draw3D(); });
  v3.addEventListener('pointerup', () => { drag = null; v3.style.cursor = 'grab'; });
}

let landmarker = null;
async function getLandmarker() {
  if (landmarker) return landmarker;
  status('Chargement du modèle de vision (≈ 9 Mo, une seule fois)…', 0.02);
  const vision = await import('../lib/vision_bundle.mjs');
  const base = new URL('../wasm', import.meta.url).href;
  const fileset = await vision.FilesetResolver.forVisionTasks(base);
  const modelAssetPath = new URL('../models/pose_model.wasm', import.meta.url).href;
  const mk = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  // Sur certains iPhone, le GPU ne répond jamais (ni succès ni erreur) : délai de 12 s puis repli sur le processeur.
  const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('délai GPU')), ms))]);
  try { landmarker = await withTimeout(mk('GPU'), 12000); } catch (e) { console.warn('[kyron] GPU indisponible, repli CPU', e); status('Chargement du modèle de vision (mode processeur)…', 0.03); landmarker = await mk('CPU'); }
  return landmarker;
}

let tsCounter = 0;
function loadMeta(v, file) {
  return new Promise((res, rej) => {
    let done = false;
    const ok = () => { if (done) return; done = true; clearTimeout(to); res(); };
    // On attend une image décodée (loadeddata), pas seulement les métadonnées : sinon Safari iOS peut ne jamais répondre au premier déplacement.
    v.onloadeddata = ok;
    v.onloadedmetadata = () => { if (v.readyState >= 2) ok(); };
    v.onerror = () => { if (done) return; done = true; clearTimeout(to); rej(new Error('format vidéo non lu par ce navigateur. Essaie un .mp4 ou .mov (H.264).')); };
    const to = setTimeout(() => { if (v.readyState >= 1) ok(); else { done = true; rej(new Error("la vidéo ne se charge pas dans ce navigateur. Essaie de l'exporter en .mp4 (H.264) ou avec Safari / Chrome à jour.")); } }, 15000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    try { v.load(); } catch (e) { /* rien */ }
  });
}
// Déplacement à l'instant t avec délai de garde : Safari ne déclenche pas toujours « seeked »
// (même instant qu'avant, vidéo hors écran…). Au-delà de 2,5 s on continue quand même.
function seekTo(v, t) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(to); v.removeEventListener('seeked', fin); res(); };
    const to = setTimeout(fin, 2500);
    v.addEventListener('seeked', fin);
    if (Math.abs(v.currentTime - t) < 1e-4) { fin(); return; }
    v.currentTime = t;
  });
}

// Extraction image par image : pose MediaPipe + image réduite ~480 px pour le suivi de balle
async function extract(v, label, p0, p1, signal) {
  const lm = await getLandmarker();
  const dur = Math.min(v.duration || 0, 20);
  const rate = S.mode === 'adv' ? 120 : 60;
  const step = 1 / rate, frames = [];
  let tracker = null, cv = null, cg = null, rkt = null;
  if (has('ball', 'createBallTracker') && v.videoWidth) {
    try {
      const sc = Math.min(1, 480 / v.videoWidth), w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
      cv = document.createElement('canvas'); cv.width = w; cv.height = h; cg = cv.getContext('2d', { willReadFrequently: true });
      tracker = M.ball.createBallTracker({ width: w, height: h });
    } catch (e) { console.warn('[kyron] suivi de balle désactivé', e); tracker = null; }
  }
  if (has('racket', 'createRacketTracker') && v.videoWidth) {
    try {
      const sc = Math.min(1, 480 / v.videoWidth), w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
      if (!cv) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; cg = cv.getContext('2d', { willReadFrequently: true }); }
      rkt = M.racket.createRacketTracker({ width: cv.width, height: cv.height, hand: S.profile.hand, heightM: S.profile.height / 100 });
    } catch (e) { console.warn('[kyron] suivi de raquette désactivé', e); rkt = null; }
  }
  let court = null;
  const t0 = performance.now();
  let lastUi = 0;
  for (let t = 0; t < dur; t += step) {
    if (signal.aborted) throw Object.assign(new Error('annulé'), { name: 'AbortError' });
    await seekTo(v, t);
    const out = lm.detectForVideo(v, ++tsCounter * 1000 / rate);
    if (out.landmarks?.length && out.worldLandmarks?.length) {
      frames.push({ t, img: out.landmarks[0].map((q) => ({ x: q.x, y: q.y, v: q.visibility ?? 1 })), world: out.worldLandmarks[0].map((q) => ({ x: q.x, y: -q.y, z: -q.z })) });
    }
    if (tracker || rkt) {
      let id = null;
      try { cg.drawImage(v, 0, 0, cv.width, cv.height); id = cg.getImageData(0, 0, cv.width, cv.height); } catch (e) { tracker = null; rkt = null; }
      if (id && tracker) { try { tracker.push(t, id); } catch (e) { tracker = null; } }
      if (id && rkt) { try { rkt.push(t, id, frames[frames.length - 1]?.t === t ? frames[frames.length - 1] : null); } catch (e) { console.warn('[kyron] raquette', e); rkt = null; } }
      // Calibration automatique du court sur la première image exploitable
      if (id && court === null && has('court', 'calibrateCourt')) { try { court = M.court.calibrateCourt(id) || false; if (court && !(court.conf > 0.25)) court = false; } catch (e) { court = false; } }
    }
    // Mise à jour de l'écran toutes les ~250 ms, qu'un joueur soit trouvé ou non (avant : bloqué si aucune pose)
    if (performance.now() - lastUi > 250 || t + step >= dur) {
      lastUi = performance.now();
      const el = (performance.now() - t0) / 1000, pr = t / dur, eta = pr > 0.03 ? el / pr - el : null;
      status(`${label} · analyse image par image ${f(t, 1)} / ${f(dur, 1)} s · ${frames.length} poses${tracker ? ' · balle suivie' : ''}${eta != null ? ` · reste ≈ ${f(eta, 0)} s` : ''}`, p0 + (p1 - p0) * pr);
      emit('analysis', { stage: 'pose', p: p0 + (p1 - p0) * pr, t, dur, poses: frames.length, eta, ball: !!tracker, racket: !!rkt, frame: frames[frames.length - 1] || null, label });
      drawLive(v, frames[frames.length - 1]);
    }
  }
  let ball = null;
  if (tracker) { try { ball = { ...tracker.result(), dims: { w: cv.width, h: cv.height } }; } catch (e) { ball = null; } }
  let racket = null;
  if (rkt) { try { racket = rkt.result(); } catch (e) { racket = null; } }
  // Image de référence (réduite) gardée pour la calibration manuelle du court
  let still = null;
  try { if (cv) { const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; c2.getContext('2d').drawImage(cv, 0, 0); still = c2; } } catch (e) { still = null; }
  return { frames, rate, ball, racket, court: court || null, still, meta: { width: v.videoWidth, height: v.videoHeight, duration: v.duration }, truncated: v.duration > 20 };
}

// Analyse d'une ou deux vidéos. Renvoie la séance (ou lève une erreur en français). opts.stroke force le type de coup.
export function cancelAnalysis() { abortExt?.abort(); }
export const isBusy = () => busy;
export async function importVideos(files, opts = {}) {
  if (!M.engine) throw new Error("le moteur d'analyse n'a pas pu être chargé : recharge la page.");
  if (busy) throw new Error('une analyse est déjà en cours.');
  busy = true; stop();
  abortExt = new AbortController();
  const signal = abortExt.signal;
  $('#scene').classList.add('scanning');
  let out = null, fail = null;
  extracting = true; fit(ov);
  $('#hudPh').textContent = 'Extraction'; $('#hudPh').className = 'ph';
  const multi = files.length === 2;
  try {
    vA.hidden = false; $('#pip').hidden = !multi;
    await loadMeta(vA, files[0]);
    $('#scene').classList.toggle('portrait', vA.videoHeight > vA.videoWidth);
    $('#hudSrc').innerHTML = `SRC <b>${esc(files[0].name.slice(0, 22))}</b>`;
    const A = await extract(vA, multi ? 'Caméra A' : 'Vidéo', 0.04, multi ? 0.5 : 0.96, signal);
    if (A.frames.length < 20) throw new Error("aucun joueur détecté sur assez d'images. Cadre le joueur en entier, bien éclairé.");
    let all = A.frames, offset = 0, corr = null, B = null;
    if (multi) {
      await loadMeta(vB, files[1]);
      B = await extract(vB, 'Caméra B', 0.5, 0.94, signal);
      if (B.frames.length >= 20 && has('sync', 'syncByWrist')) {
        try {
          const s = M.sync.syncByWrist(A.frames, B.frames, S.profile.hand);
          offset = s.offset || 0; corr = s.corr;
          if (has('sync', 'fuseViews')) all = M.sync.fuseViews(A.frames, B.frames, offset) || A.frames;
        } catch (e) { console.warn('[kyron] synchro', e); }
      }
    }
    status('Découpe des frappes, classification et mesures…', 0.97);
    await new Promise((r) => setTimeout(r, 0));
    emit('analysis', { stage: 'compute', p: 0.97 });
    const sess = analyzeSessionSafe(all, { hand: S.profile.hand, height: S.profile.height / 100, forceStroke: opts.stroke || undefined });
    if (!sess.strokes.length) throw new Error("aucune frappe exploitable trouvée. Filme au moins un geste complet, de la préparation à l'accompagnement.");
    const quality = qualitySafe(all, A.meta);
    const full = { ...sess, source: 'video', multi, all, offset, corr, quality, ballTrack: A.ball, racketTrack: A.racket, court: A.court, still: A.still, label: files.map((x) => x.name).join(' + '), date: new Date().toISOString(), id: `s${Date.now()}`, rate: A.rate, meta: A.meta, forceStroke: opts.stroke || null, files };
    attachBall(full);
    setSession(full, sess.summary?.bestIdx ?? 0);
    const nb = full.strokes.length;
    status(`${A.frames.length} poses à ${A.rate} images/s${A.truncated ? ' (20 premières secondes)' : ''}${multi ? ` · caméras synchronisées (décalage ${f(offset * 1000, 0)} ms${corr != null ? `, corrélation ${f(corr, 2)}` : ''})` : ''} · ${nb} frappe${nb > 1 ? 's' : ''} détectée${nb > 1 ? 's' : ''}.`);
    out = full;
  } catch (err) {
    fail = err;
    if (err.name === 'AbortError') status('Analyse annulée.');
    else { console.warn(err); status(`Analyse interrompue : ${err.message}`); }
    if (!S.session || S.session.source === 'demo') { vA.hidden = true; $('#pip').hidden = true; }
  } finally {
    busy = false; abortExt = null; extracting = false;
    $('#scene').classList.remove('scanning');
    if (S.session) { pickStroke(S.strokeIdx, true); }
  }
  if (fail) throw fail;
  return out;
}

// ---------- Séances enregistrées ----------
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1e3) / 1e3 : v);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 1e2) / 1e2 : v);
// Longue vidéo : on ne garde que les images autour des frappes (± 0,25 s) pour rester sous la taille max d'une séance
function framesToKeep(sess) {
  const all = sess.all || [];
  if (all.length <= 1400) return all;
  const win = sess.strokes.map((s) => [s.frames[0].t - 0.25, s.frames[s.frames.length - 1].t + 0.25]);
  return all.filter((fr) => win.some(([a, b]) => fr.t >= a && fr.t <= b));
}
// Données nécessaires pour rouvrir une séance à l'identique (poses + suivis), sans les images
export function packSession(sess = S.session) {
  if (!sess || sess.source !== 'video') return null;
  return {
    v: 1, rate: sess.rate, multi: !!sess.multi, offset: sess.offset || 0, corr: sess.corr ?? null, label: sess.label || '', meta: sess.meta || null, forceStroke: sess.forceStroke || null,
    quality: sess.quality || null, court: sess.court || null, ballTrack: sess.ballTrack || null, racketTrack: sess.racketTrack || null,
    frames: framesToKeep(sess).map((fr) => ({ t: r4(fr.t), img: fr.img.map((q) => [r4(q.x), r4(q.y), r2(q.v)]), world: fr.world.map((q) => [r3(q.x), r3(q.y), r3(q.z)]) })),
  };
}
export async function openSaved({ id, result, videoUrl, createdAt }) {
  if (!result?.frames?.length) throw new Error(result?.legacy ? 'séance d’avant les comptes : seules ses mesures ont été conservées (voir Progrès).' : 'cette séance ne contient pas les données du geste.');
  stop();
  const all = result.frames.map((fr) => ({ t: fr.t, img: fr.img.map(([x, y, v]) => ({ x, y, v })), world: fr.world.map(([x, y, z]) => ({ x, y, z })) }));
  const sess = analyzeSessionSafe(all, { hand: S.profile.hand, height: S.profile.height / 100, forceStroke: result.forceStroke || undefined });
  if (!sess.strokes.length) throw new Error('aucune frappe retrouvée dans cette séance.');
  $('#pip').hidden = true;
  if (videoUrl) {
    vA.hidden = false;
    try { await new Promise((res, rej) => { vA.onloadedmetadata = res; vA.onerror = rej; vA.src = videoUrl; }); $('#scene').classList.toggle('portrait', vA.videoHeight > vA.videoWidth); } catch (e) { vA.hidden = true; vA.removeAttribute('src'); }
  } else { vA.hidden = true; vA.removeAttribute('src'); }
  const full = { ...sess, source: 'video', multi: result.multi, all, offset: result.offset, corr: result.corr, quality: result.quality, ballTrack: result.ballTrack, racketTrack: result.racketTrack, court: result.court, still: null, label: result.label, date: createdAt || new Date().toISOString(), id: id || `s${Date.now()}`, savedId: id, rate: result.rate, meta: result.meta, forceStroke: result.forceStroke };
  attachBall(full);
  setSession(full, sess.summary?.bestIdx ?? 0);
  status('Séance rouverte depuis ton historique.');
  return full;
}
// Miniature JPEG : image de la vidéo à l'impact de la meilleure frappe, squelette par-dessus
export async function thumbnail(sess = S.session) {
  try {
    if (!sess || vA.hidden || !vA.videoWidth) return null;
    const s = sess.strokes[sess.summary?.bestIdx ?? 0] || sess.strokes[0];
    const fr = s.frames[s.res.impact] || s.frames[0];
    await new Promise((res) => { const to = setTimeout(res, 1500); vA.onseeked = () => { clearTimeout(to); res(); }; vA.currentTime = fr.t; });
    const W = 360, H = Math.round(W * vA.videoHeight / vA.videoWidth);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(vA, 0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, W, H);
    skeleton(g, fr, (p) => [p.x * W, p.y * H], { x: 0, y: 0, w: W, h: H });
    return await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.78));
  } catch (e) { console.warn('[kyron] miniature', e); return null; }
}

function attachBall(sess) {
  const tr = sess.ballTrack?.track;
  if (!tr?.length || !has('ball', 'estimateBallFlight')) return;
  for (const s of sess.strokes) {
    try {
      const t0 = s.frames[0].t, t1 = s.frames[s.frames.length - 1].t;
      const track = tr.filter((p) => p.t >= t0 && p.t <= t1);
      s.ballTrack = track;
      const b = track.length >= 3 ? M.ball.estimateBallFlight(track, s.res, { heightM: S.profile.height / 100 }) : null;
      s.ball = b && Number.isFinite(b.speedKmh) ? b : null;
    } catch (e) { s.ball = null; }
  }
}

function reanalyzeVideo(msg) {
  const sess = S.session; if (!sess?.all) return;
  const n = analyzeSessionSafe(sess.all, { hand: S.profile.hand, height: S.profile.height / 100 });
  if (!n.strokes.length) return;
  const full = { ...sess, ...n };
  attachBall(full);
  setSession(full, Math.min(S.strokeIdx, n.strokes.length - 1));
  status(msg);
}

// Corrige le type d'une frappe (classification manuelle)
function retype(type) {
  const s = cur(); if (!s) return;
  try {
    const res = M.engine.analyze(s.frames, { stroke: analyzable(type), hand: S.session.source === 'demo' ? 'right' : S.profile.hand, source: S.session.source === 'demo' ? 'demo' : 'video' });
    s.type = type; s.res = res; s.conf = 1;
    if (s.ballTrack && has('ball', 'estimateBallFlight')) { try { s.ball = M.ball.estimateBallFlight(s.ballTrack, res, { heightM: S.profile.height / 100 }); } catch (e) { /* rien */ } }
    renderChips(); pickStroke(S.strokeIdx);
    emit('session', S.session);
  } catch (e) { status(`Impossible d'analyser comme ${STROKE_FR[type]} : ${e.message}`); }
}

// ====================== Lecture ======================
function frameAt(t) {
  const fr = P.frames; if (!fr.length) return 0;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t)) lo--;
  return lo;
}
function seekVideo(t) {
  if (!vA.hidden && vA.src && Math.abs(vA.currentTime - t) > 0.004) vA.currentTime = t;
  if (!$('#pip').hidden && vB.src) { const tb = t - (S.session?.offset || 0); if (tb >= 0 && Math.abs(vB.currentTime - tb) > 0.004) vB.currentTime = tb; }
}
function setCur(i) {
  P.i = clamp(i, 0, P.frames.length - 1);
  P.clock = P.frames[P.i]?.t || 0;
  seekVideo(P.clock);
  drawFrame();
}
const playIcon = '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';
const pauseIcon = '<svg viewBox="0 0 14 14"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>';
function stop() {
  P.playing = false; $('#play').innerHTML = playIcon; $('#play').setAttribute('aria-label', 'Lecture');
  if (!vA.hidden) vA.pause(); vB.pause();
}
function togglePlay() {
  if (P.playing) return stop();
  if (!P.frames.length) return;
  P.playing = true; $('#play').innerHTML = pauseIcon; $('#play').setAttribute('aria-label', 'Pause');
  if (P.i >= P.frames.length - 1) setCur(0);
  const useVid = !vA.hidden && vA.src;
  if (useVid) { vA.playbackRate = Math.max(0.0625, P.speed); vA.play().catch(() => {}); if (!$('#pip').hidden) { vB.playbackRate = vA.playbackRate; vB.play().catch(() => {}); } }
  let last = performance.now();
  const end = P.frames[P.frames.length - 1].t;
  const tick = (now) => {
    if (!P.playing) return;
    if (useVid) { P.clock = vA.currentTime; if (vA.ended || P.clock >= end) stop(); }
    else { P.clock += (now - last) / 1000 * P.speed; if (P.clock >= end) { P.clock = end; stop(); } }
    last = now;
    P.i = frameAt(P.clock); drawFrame();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ====================== Rendu : verdict ======================
function renderAll() {
  if (!P.res) return;
  renderVerdict(); renderFixes(); renderTable(); renderEx(); renderAsks();
  drawTimeline(); drawCharts(); drawFrame(); renderRing();
  for (const fn of hooks.render) { try { fn(); } catch (e) { console.warn('[kyron] panneau', e); } }
}

function headline(sc) { return sc >= 85 ? 'Geste de haut niveau' : sc >= 72 ? 'Base solide, à affiner' : sc >= 58 ? 'De la vitesse en réserve' : 'Chaîne à reconstruire'; }

function renderVerdict() {
  const s = cur(), r = P.res; if (!s || !r) return;
  const n = S.session.strokes.length;
  const conf = r.confidence != null ? ` · confiance ${Math.round(r.confidence * 100)} %` : '';
  $('#vType').innerHTML = `<label style="display:inline-flex;gap:8px;align-items:center">Frappe ${S.strokeIdx + 1}/${n} ·
    <select id="typeSel" aria-label="Type de frappe" style="background:#000;border:1px solid var(--rule2);color:#fff;font:inherit;letter-spacing:.1em;text-transform:uppercase;padding:2px 4px">
    ${['serve', 'forehand', 'backhand', 'volley', 'smash'].map((k) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${STROKE_FR[k]}</option>`).join('')}</select></label>${s.conf != null && s.conf < 1 ? ` <span style="color:var(--mute)">auto ${Math.round(s.conf * 100)} %</span>` : ''}`;
  $('#vType').title = conf;
  $('#typeSel').onchange = (e) => retype(e.target.value);
  $('#vHead').textContent = headline(r.score);
  const top = r.findings[0];
  $('#vText').textContent = top && top.key !== 'ok' ? `Priorité : ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}.` : 'Aucun écart majeur sur cette frappe.';
  renderKpis();
  // Chaîne cinétique
  const t = r.series.t, t0 = t[r.phases[1].i0], t1 = t[Math.min(r.n - 1, r.impact + Math.round(r.fps * 0.05))];
  const pos = (x) => clamp(((x - t0) / ((t1 - t0) || 1)) * 100, 0, 100);
  const badSeg = new Set();
  r.sequence.forEach((q, i) => { if (i > 0 && q.t < r.sequence[i - 1].t) badSeg.add(q.key); });
  r.gaps.forEach((g, i) => { if (g < 15 || g > 90) badSeg.add(r.sequence[i + 1].key); });
  $('#chainState').innerHTML = r.inOrder ? 'ordre respecté' : '<span class="acc">ordre rompu</span>';
  $('#chain').innerHTML = r.sequence.map((q) => `<div class="chain-row"><span>${q.label}</span><div class="lane"><span class="imp" style="left:${pos(t[r.impact])}%"></span><i class="${badSeg.has(q.key) ? 'att' : ''}" style="left:calc(${pos(q.t)}% - 1px)"></i></div><span style="text-align:right;color:var(--mute)">${q.ms > 0 ? '+' : ''}${q.ms} ms</span></div>`).join('')
    + `<div class="gaps">${r.gaps.map((g, i) => `<span class="${g < 15 || g > 90 ? 'att' : ''}">${['Bassin → buste', 'Buste → coude', 'Coude → poignet'][i]} ${g} ms</span>`).join('')}</div>`;
}

function renderKpis() {
  const s = cur(), r = P.res; if (!s || !r) return;
  const m = r.metrics;
  const meas = s.ball && Number.isFinite(s.ball.speedKmh);
  const ballKmh = meas ? s.ball.speedKmh : m.ballSpeedKmh;
  const oc = S.opt.status === 'done' && S.opt.forIdx === S.strokeIdx ? S.opt.result?.current : null;
  const spin = Number.isFinite(oc?.spinRpm) ? { rpm: Math.abs(oc.spinRpm), label: `${oc.spinRpm >= 0 ? 'lift' : 'slice'} · calé par l'optimiseur` } : spinEstimate(s.type, m.racketSpeed);
  const k = (label, val, unit, d, badge, cls = '', g = '') => `<div class="kpi ${cls}">${badge || ''}<div class="lbl">${label}${g ? help(g) : ''}</div><b>${val}<small>${unit}</small></b><div class="d">${d || '&nbsp;'}</div></div>`;
  const items = [
    k('Vitesse de balle', fi(ballKmh), 'km/h', meas ? `suivie sur ${s.ballTrack?.length || 0} images${s.ball.launchDeg != null ? ` · départ ${f(s.ball.launchDeg, 1)}°` : ''}` : 'modèle : raquette × restitution', meas ? '<span class="badge meas">Mesurée</span>' : '<span class="badge">Estimée</span>', 'hero', 'ballKmh'),
    k('Vitesse de raquette', fi(m.racketSpeed * 3.6), 'km/h', `poignet ${f(m.wristSpeed, 1)} m/s`, '<span class="badge">Estimée</span>', '', 'racketKmh'),
    k('Effet', spin ? fi(spin.rpm) : '—', 'tr/min', spin ? spin.label : '', '<span class="badge">Estimé</span>', '', 'spin'),
    k('Chaîne cinétique', r.inOrder ? 'En ordre' : '<span class="acc">Rompue</span>', '', `${r.gaps.join(' · ')} ms`, '', '', 'sequence'),
  ];
  if (S.mode === 'adv') {
    if (Number.isFinite(m.shoulderIRVel)) items.push(k('Rotation interne épaule', fi(m.shoulderIRVel), '°/s', 'pic avant impact'));
    if (Number.isFinite(m.comShift)) items.push(k('Transfert du poids', f(m.comShift * 100, 0), 'cm', 'centre de masse arrière → avant'));
    if (Number.isFinite(m.balance)) items.push(k('Équilibre à l\'impact', f(m.balance, 2), '', 'indice 0–1, cible ≥ 0,6'));
    if (Number.isFinite(m.tossApex)) items.push(k('Lancer de balle', f(m.tossApex, 2), 'm', Number.isFinite(m.tossForward) ? `${f(m.tossForward * 100, 0)} cm devant le pied` : ''));
    else if (Number.isFinite(m.tossDrop)) items.push(k('Lancer au-dessus du contact', f(m.tossDrop * 100, 0), 'cm', Number.isFinite(m.tossForward) ? `${f(m.tossForward * 100, 0)} cm devant le pied` : ''));
    items.push(k('Bassin · buste', `${fi(m.pelvisOmega)} / ${fi(m.thoraxOmega)}`, '°/s', 'pics de vitesse angulaire'));
    items.push(k('Taille estimée', f(m.height, 2), 'm', `profil : ${f(S.profile.height / 100, 2)} m`));
  }
  $('#vKpis').innerHTML = items.join('');
}

function renderRing() {
  const c = $('#ring'); if (!c || !P.res) return;
  const g = c.getContext('2d'), W = c.width, cx = W / 2, R = W / 2 - 16, sc = P.res.score;
  g.clearRect(0, 0, W, W);
  const a0 = 0.75 * Math.PI, span = 1.5 * Math.PI;
  for (let i = 0; i <= 50; i++) {
    const a = a0 + span * i / 50, on = i / 50 <= sc / 100, major = i % 5 === 0;
    g.strokeStyle = on ? (sc < 58 ? C.acc : '#fff') : 'rgba(255,255,255,.16)';
    g.lineWidth = major ? 4 : 2.5;
    const r1 = R - (major ? 22 : 16);
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cx + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.stroke();
  }
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `400 ${Math.round(W * 0.22)}px ${C.disp}`; g.fillText(String(sc), cx, cx - 4);
  g.fillStyle = C.mute; g.font = `500 ${Math.round(W * 0.055)}px ${C.mono}`; g.fillText('SCORE / 100', cx, cx + W * 0.17);
}

const sevTxt = ['Constat', 'Finition', 'Important', 'Critique'];
const fixHtml = (x, i) => `<div class="fix s${x.sev}"><i>${String(i + 1).padStart(2, '0')}</i><div><b>${esc(x.title)}</b><p>${esc(x.detail)}</p><span class="gain">${sevTxt[x.sev] || ''}${x.gain ? ` · gain estimé ≈ +${x.gain} % de vitesse` : ''}</span></div></div>`;
function renderFixes() {
  const r = P.res;
  $('#fixes').innerHTML = r.findings.slice(0, 3).map(fixHtml).join('');
  $('#fixesAll').innerHTML = r.findings.map(fixHtml).join('');
  $('#fixLbl').textContent = `${r.findings.filter((x) => x.sev > 0).length} écart${r.findings.filter((x) => x.sev > 0).length > 1 ? 's' : ''} détecté${r.findings.filter((x) => x.sev > 0).length > 1 ? 's' : ''}`;
}
// Formatage d'une mesure selon son unité
function fmtU(v, unit, key) {
  if (key === 'sequence') return `${v} ms`;
  if (!Number.isFinite(v)) return '—';
  if (unit === 'm') return `${f(v * 100, 0)} cm`;
  if (unit === '× taille') return `${f(v, 2)} ×`;
  if (unit === '°/s') return `${fi(v)} °/s`;
  if (unit === '°') return `${f(v, 0)}°`;
  if (unit === '0–1') return f(v, 2);
  return `${f(v, Math.abs(v) < 10 ? 2 : 0)}${unit ? ' ' + unit : ''}`;
}
function tgtU(it) {
  if (it.key === 'sequence') return `${it.lo}–${it.hi} ms`;
  const a = fmtU(it.lo, it.unit), b = fmtU(it.hi, it.unit);
  if (it.lo === 0 && it.unit === 'm') return `< ${b}`;
  return `${a.replace(/\s?(cm|°\/s|×|°)$/, '')}–${b}`;
}
function renderTable() {
  const r = P.res, m = r.metrics;
  const have = new Set(r.items.map((it) => it.key));
  const extra = [
    ['pelvisOmega', 'Vitesse angulaire du bassin (pic)', `${fi(m.pelvisOmega)} °/s`], ['thoraxOmega', 'Vitesse angulaire du buste (pic)', `${fi(m.thoraxOmega)} °/s`],
    ['wristSpeed', 'Vitesse du poignet (pic)', `${f(m.wristSpeed, 1)} m/s`], ['racketSpeed', 'Vitesse de raquette estimée', `${fi(m.racketSpeed * 3.6)} km/h`],
    ['shoulderElev', "Élévation de l'épaule à l'armé", `${fi(m.shoulderElev)}°`], ['shoulderAbdH', "Abduction horizontale à l'armé", `${fi(m.shoulderAbdH)}°`],
    ['shoulderRotExt', "Rotation externe à l'armé", `${fi(m.shoulderRotExt)}°`], ['shoulderIRVel', 'Rotation interne (pic)', `${fi(m.shoulderIRVel)} °/s`],
    ['comShift', 'Transfert du centre de masse', `${f(m.comShift * 100, 0)} cm`], ['balance', "Équilibre à l'impact", f(m.balance, 2)],
    ['tossApex', 'Sommet du lancer', `${f(m.tossApex, 2)} m`], ['tossDrop', 'Hauteur du lancer au-dessus du contact', `${f(m.tossDrop * 100, 0)} cm`], ['tossForward', 'Lancer devant le pied avant', `${f(m.tossForward * 100, 0)} cm`],
    ['height', 'Taille estimée', `${f(m.height, 2)} m`],
  ].filter(([k]) => !have.has(k) && Number.isFinite(m[k]));
  $('#mtable tbody').innerHTML = r.items.map((it) => `<tr><td>${esc(it.label)}${help(it.key)}</td><td class="n">${fmtU(it.value, it.unit, it.key)}</td><td class="n" style="color:var(--mute)">${tgtU(it)}</td><td><div class="bar-s"><i class="${it.score < 60 ? 'att' : ''}" style="width:${it.score}%"></i></div></td></tr>`).join('')
    + extra.map(([, a, b]) => `<tr><td>${a}</td><td class="n">${b}</td><td class="n" style="color:var(--mute)">—</td><td></td></tr>`).join('');
  $('#tblLbl').textContent = `${r.n} images · ${fi(r.fps)} i/s${Number.isFinite(r.confidence) ? ` · confiance ${Math.round(r.confidence * 100)} %` : ''}`;
}
function renderEx() {
  const r = P.res;
  $('#exs').innerHTML = r.exercises.length ? r.exercises.map((e) => `<div class="ex"><b>${esc(e.name)}</b><p>${esc(e.goal)}</p><span class="meta">${esc(e.dose)}</span><span class="meta" style="margin-top:6px">Validé si : <span class="ok">${esc(e.check)}</span></span></div>`).join('') : '<div class="ex"><p>Aucun exercice prioritaire : garde ce geste et augmente la vitesse progressivement.</p></div>';
}
function renderAsks() {
  const r = P.res, q = S.session.quality;
  const asks = [...(q?.issues || []).filter((x) => x.key !== 'fps' || !r.camera.some((c) => /ralenti/i.test(c.title))).map((x) => ({ title: x.label, why: x.detail })), ...r.camera];
  $('#asks').innerHTML = asks.slice(0, 4).map((c, i) => `<div class="ask"><b>Prise ${i + 1} · ${esc(c.title)}</b>${esc(c.why)}</div>`).join('');
}
function renderQuality() {
  const q = S.session.quality; if (!q) return;
  $('#qScore').innerHTML = `${q.score}<small>/100</small>`;
  $('#qMeter').style.width = `${q.score}%`; $('#qMeter').className = q.score < 60 ? 'att' : '';
  $('#qLbl').textContent = `${fi(q.fps)} i/s${S.session.multi ? ' · 2 caméras' : ''}`;
  $('#qIssues').innerHTML = q.issues?.length ? q.issues.map((x) => `<li><b style="color:#fff;font-weight:500">${esc(x.label)}</b> : ${esc(x.detail)}</li>`).join('') : '<li style="list-style:none">Prise exploitable : cadrage, cadence et visibilité corrects.</li>';
  $('#qIssues').querySelectorAll('li').forEach((li) => { if (!q.issues?.length) li.style.setProperty('--x', '0'); });
}
function renderFatigue() {
  const sess = S.session, fat = sess.fatigue;
  const type = cur()?.type;
  const pts = sess.strokes.filter((s) => s.type === type).map((s) => s.res.metrics.racketSpeed * 3.6);
  $('#fatLbl').textContent = `${pts.length} ${STROKE_FR[type]?.toLowerCase() || 'frappes'}`;
  if (pts.length < 2) { $('#fatigue').innerHTML = `<p class="note">${esc(fat?.detail || 'Pas assez de frappes de ce type pour mesurer une dérive.')}</p>`; return; }
  const W = 320, H = 90, lo = Math.min(...pts) * 0.97, hi = Math.max(...pts) * 1.02;
  const X = (i) => 12 + i * (W - 24) / (pts.length - 1), Y = (v) => H - 14 - (v - lo) / ((hi - lo) || 1) * (H - 26);
  const { slope, icpt } = linreg(pts);
  const alert = fat?.alert;
  $('#fatigue').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Vitesse de raquette frappe après frappe">
    <line x1="0" x2="${W}" y1="${H - 8}" y2="${H - 8}" stroke="rgba(255,255,255,.12)"/>
    <line x1="${X(0)}" x2="${X(pts.length - 1)}" y1="${Y(icpt)}" y2="${Y(icpt + slope * (pts.length - 1))}" stroke="${alert ? C.acc : 'rgba(255,255,255,.5)'}" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    <polyline fill="none" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${pts.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}"/>
    ${pts.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="#000" stroke="#fff" vector-effect="non-scaling-stroke"><title>Frappe ${i + 1} : ${fi(v)} km/h</title></circle>`).join('')}
  </svg><p class="note" style="margin-top:8px">${alert ? '<span class="acc">Alerte fatigue.</span> ' : ''}${esc(fat?.detail || fatigueOf(sess.strokes).detail)}</p>`;
}

// ====================== Dessin : scène ======================
const ov = $('#ov');
function contentRect(w, h) {
  if (vA.hidden || !vA.videoWidth) { const s = Math.min(w, h * 1.6); return { x: (w - s) / 2, y: (h - s / 1.6) / 2, w: s, h: s / 1.6, demo: true }; }
  const ar = vA.videoWidth / vA.videoHeight;
  let cw = w, ch = w / ar; if (ch > h) { ch = h; cw = h * ar; }
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}
function phaseAt(i) {
  const r = P.res; if (!r) return '—';
  if (Math.abs(i - r.impact) <= 1) return 'Impact';
  for (let k = r.phases.length - 1; k >= 0; k--) { const p = r.phases[k]; if (p.key !== 'impact' && i >= p.i0 && i <= p.i1) return p.label; }
  return i < r.phases[0].i0 ? 'Attente' : 'Retour';
}
const hitJoints = () => (handOf() === 'right' ? [12, 14, 16, 20] : [11, 13, 15, 19]);
const handOf = () => (S.session?.source === 'demo' ? 'right' : S.profile.hand);
const BONES = () => M.engine?.BONES || [];

function skeleton(g, fr, Pt, cr, opts = {}) {
  const hit = new Set(hitJoints());
  g.lineCap = 'round';
  for (const [a, b] of BONES()) {
    const pa = fr.img[a], pb = fr.img[b]; if (!pa || !pb) continue;
    g.globalAlpha = Math.min(1, ((pa.v ?? 1) + (pb.v ?? 1)) / 2 + 0.15) * (opts.alpha ?? 1);
    g.strokeStyle = hit.has(a) && hit.has(b) ? '#fff' : 'rgba(244,244,242,.72)';
    g.lineWidth = hit.has(a) && hit.has(b) ? 3 : 2.2;
    g.beginPath(); g.moveTo(...Pt(pa)); g.lineTo(...Pt(pb)); g.stroke();
  }
  g.globalAlpha = opts.alpha ?? 1;
  for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = fr.img[k]; if (!p) continue;
    const [x, y] = Pt(p);
    g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, hit.has(k) ? 5 : 4, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = C.acc; g.beginPath(); g.arc(x, y, hit.has(k) ? 2.4 : 1.6, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}
function racketTip(fr) {
  const R = handOf() === 'right', e = fr.img[R ? 14 : 13], w = fr.img[R ? 16 : 15];
  return { x: w.x + (w.x - e.x) * 2.1, y: w.y + (w.y - e.y) * 2.1, w };
}

// Aperçu pendant l'extraction
function drawLive(v, fr) {
  const { g, w, h } = fit(ov);
  if (!fr) return;
  const cr = contentRect(w, h);
  skeleton(g, fr, (p) => [cr.x + p.x * cr.w, cr.y + p.y * cr.h], cr);
  $('#hudT').innerHTML = `T <b>${f(fr.t, 3)} s</b>`;
  $('#hudPh').textContent = 'Extraction'; $('#hudPh').className = 'ph';
}

function drawFrame() {
  const fr = P.frames[P.i];
  if (extracting) return;
  const { g, w, h } = fit(ov);
  if (!fr) return;
  const cr = contentRect(w, h);
  const Pt = (p) => [cr.x + p.x * cr.w, cr.y + p.y * cr.h];
  if (cr.demo) {
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    for (let i = 0; i <= 24; i++) { const x = cr.x + cr.w * i / 24; g.beginPath(); g.moveTo(x, cr.y); g.lineTo(x, cr.y + cr.h); g.stroke(); }
    for (let i = 0; i <= 15; i++) { const y = cr.y + cr.h * i / 15; g.beginPath(); g.moveTo(cr.x, y); g.lineTo(cr.x + cr.w, y); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(cr.x, cr.y + cr.h * 0.955); g.lineTo(cr.x + cr.w, cr.y + cr.h * 0.955); g.stroke();
  }
  // Traînée de la tête de raquette (300 ms)
  const back = Math.round((P.res?.fps || 60) * P.trail);
  g.lineCap = 'round';
  for (let k = Math.max(1, P.i - back); k <= P.i; k++) {
    const a = racketTip(P.frames[k - 1]), b = racketTip(P.frames[k]);
    const al = (k - P.i + back) / back;
    g.strokeStyle = `rgba(255,255,255,${al * 0.75})`; g.lineWidth = 1 + al * 2.5;
    g.beginPath(); g.moveTo(...Pt(a)); g.lineTo(...Pt(b)); g.stroke();
  }
  // Raquette (prolongement de l'avant-bras)
  const tip = racketTip(fr);
  g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(...Pt(tip.w)); g.lineTo(...Pt(tip)); g.stroke();
  g.beginPath(); g.ellipse(...Pt(tip), 8, 8, 0, 0, Math.PI * 2); g.stroke();
  // Balle mesurée (si le module de suivi a trouvé une trajectoire)
  const bt = cur()?.ballTrack;
  if (bt?.length && !cr.demo) {
    const dims = S.session?.ballTrack?.dims || { w: vA.videoWidth || 1, h: vA.videoHeight || 1 };
    for (const p of bt) {
      if (p.t > fr.t || p.t < fr.t - 0.4) continue;
      const al = 1 - (fr.t - p.t) / 0.4;
      const norm = p.x <= 1.5 && p.y <= 1.5, bw = norm ? 1 : dims.w, bh = norm ? 1 : dims.h;
      const x = cr.x + (p.x / bw) * cr.w, y = cr.y + (p.y / bh) * cr.h;
      g.globalAlpha = al; g.strokeStyle = C.acc; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, Math.max(3, Math.min(30, (p.r || 3) * cr.w / (dims.w || 480))), 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
  }
  skeleton(g, fr, Pt, cr);
  for (const fn of hooks.frame) { try { fn(g, Pt, cr, fr); } catch (e) { console.warn('[kyron] calque', e); } }
  // HUD
  const r = P.res, i = P.i;
  $('#hudT').innerHTML = `T <b>${f(fr.t - P.frames[0].t, 3)} s</b> · IMG <b>${i + 1}/${P.frames.length}</b>`;
  const ph = phaseAt(i);
  $('#hudPh').textContent = ph; $('#hudPh').className = `ph${ph === 'Impact' ? ' imp' : ''}`;
  if (r?.series) {
    const s = r.series;
    const kf = r.stroke === 'serve' ? (handOf() === 'right' ? s.kneeL : s.kneeR)[i] : Math.max(s.kneeL[i], s.kneeR[i]);
    $('#hudFps').innerHTML = `<b>${fi(r.fps)}</b> I/S`;
    $('#hudA1').innerHTML = `GENOU <b>${fi(kf)}°</b>`;
    $('#hudA2').innerHTML = `COUDE <b>${fi(s.elbowAngle[i])}°</b>`;
    $('#hudA3').innerHTML = `POIGNET <b>${f(s.wristSpeed[i], 1)} M/S</b>`;
    $('#hudA4').innerHTML = `SÉPARATION <b>${fi(Math.abs(s.separation[i]))}°</b>`;
  }
  drawTimelineHead();
  if (S.mode === 'adv') { drawChartHeads(); draw3D(); }
}

// ====================== Frise des phases ======================
const tl = $('#tl'); let tlBase = null;
tl.getContext('2d', { willReadFrequently: true });
function drawTimeline() {
  const { g, w, h } = fit(tl);
  const r = P.res, fr = P.frames; if (!r || !fr.length) return;
  const T0 = fr[0].t, T1 = fr[fr.length - 1].t, X = (t) => ((t - T0) / ((T1 - T0) || 1)) * w;
  g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(0, 16, w, 16);
  const shade = { prep: 'rgba(255,255,255,.10)', load: 'rgba(255,255,255,.22)', accel: 'rgba(255,255,255,.42)', follow: 'rgba(255,255,255,.14)' };
  const short = { prep: 'PRÉPA', load: 'ARMÉ', accel: 'ACCÉL.', follow: 'ACCOMP.' };
  g.font = `10px ${C.mono}`; g.textBaseline = 'top';
  for (const p of r.phases) {
    if (p.key === 'impact') continue;
    const x0 = X(fr[p.i0].t), x1 = X(fr[p.i1].t);
    g.fillStyle = shade[p.key]; g.fillRect(x0, 16, Math.max(1, x1 - x0 - 1), 16);
    if (x1 - x0 > 44) { g.fillStyle = C.mute; g.fillText(short[p.key], x0 + 4, 37); }
  }
  for (let k = 0; k <= 20; k++) { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(Math.round(w * k / 20), 10, 1, k % 5 ? 3 : 5); }
  const xi = X(fr[r.impact].t);
  g.fillStyle = C.acc; g.fillRect(xi - 1, 8, 2, 28);
  g.fillText('IMPACT', Math.min(w - 46, xi + 5), 0);
  tlBase = g.getImageData(0, 0, tl.width, tl.height);
  drawTimelineHead();
}
function drawTimelineHead() {
  if (!tlBase || !P.frames.length) return;
  if (tlBase.width !== tl.width || tlBase.height !== tl.height) return drawTimeline();
  const g = tl.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(tlBase, 0, 0);
  const dpr = tl.width / (tl.getBoundingClientRect().width || 1);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const fr = P.frames, w = tl.width / dpr, x = ((fr[P.i].t - fr[0].t) / ((fr[fr.length - 1].t - fr[0].t) || 1)) * w;
  g.fillStyle = '#fff'; g.fillRect(x - 0.75, 12, 1.5, 24);
  g.beginPath(); g.moveTo(x - 5, 9); g.lineTo(x + 5, 9); g.lineTo(x, 15); g.fill();
}
function seekTl(e) {
  const rc = tl.getBoundingClientRect(), fr = P.frames; if (!fr.length) return;
  const u = clamp((e.clientX - rc.left) / rc.width, 0, 1);
  setCur(frameAt(fr[0].t + u * (fr[fr.length - 1].t - fr[0].t)));
}

// ====================== Courbes (mode avancé) ======================
const chartBase = new Map();
function chartRange(r) { return [Math.max(0, r.phases[0].i0), Math.min(r.n - 1, r.phases[4].i1)]; }
function drawChart(c, lines, opts = {}) {
  const { g, w, h } = fit(c);
  const r = P.res; if (!r) return;
  const pad = { l: 36, r: 10, t: 10, b: 22 };
  const [i0, i1] = chartRange(r);
  const t = r.series.t, X = (i) => pad.l + ((t[i] - t[i0]) / ((t[i1] - t[i0]) || 1)) * (w - pad.l - pad.r);
  const lo = opts.lo ?? 0, hi = opts.hi ?? 1, Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  g.strokeStyle = C.rule; g.lineWidth = 1; g.fillStyle = C.dim; g.font = `10px ${C.mono}`;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of opts.ticks || [0, 0.5, 1]) { const y = Y(v); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.fillText(opts.fmt ? opts.fmt(v) : `${Math.round(v * 100)} %`, pad.l - 6, y); }
  g.textAlign = 'right'; g.textBaseline = 'top'; g.fillStyle = C.mute;
  g.fillText(`${fi((t[i1] - t[i0]) * 1000)} ms`, w - pad.r, h - pad.b + 7);
  g.strokeStyle = C.acc; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(X(r.impact), pad.t); g.lineTo(X(r.impact), h - pad.b); g.stroke(); g.setLineDash([]);
  for (const L of lines) {
    const s = L.data; const k = L.norm ? Math.max(...s.slice(i0, i1 + 1).map(Math.abs)) || 1 : 1;
    g.strokeStyle = L.color; g.lineWidth = L.w || 2; g.setLineDash(L.dash || []); g.beginPath();
    for (let i = i0; i <= i1; i++) { const x = X(i), y = Y(s[i] / k); i === i0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke(); g.setLineDash([]);
    if (L.peak != null) { const x = X(L.peak), y = Y(s[L.peak] / k); g.fillStyle = '#000'; g.strokeStyle = L.color; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); if (L.label) { g.fillStyle = C.ink2; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(L.label, x, y - 7); } }
  }
  const snap = document.createElement('canvas'); snap.width = c.width; snap.height = c.height; snap.getContext('2d').drawImage(c, 0, 0);
  chartBase.set(c, { snap, X, pad, h, i0, i1 });
}
function drawCharts() {
  if (S.mode !== 'adv' || !P.res || $('#v-seance').hidden) return;
  const r = P.res, s = r.series, sq = Object.fromEntries(r.sequence.map((x) => [x.key, x.idx]));
  drawChart($('#chV'), [
    { data: s.pelvisOmega, color: C.s4, norm: true, peak: sq.pelvis, label: 'B' },
    { data: s.thoraxOmega, color: C.s3, norm: true, peak: sq.thorax, label: 'T' },
    { data: s.elbowVel.map((v) => Math.max(0, v)), color: C.s2, norm: true, peak: sq.elbow, label: 'C' },
    { data: s.wristSpeed, color: C.s1, norm: true, peak: sq.wrist, label: 'P' },
  ]);
  const knee = r.stroke === 'serve' ? (handOf() === 'right' ? s.kneeL : s.kneeR) : s.kneeL.map((v, i) => Math.max(v, s.kneeR[i]));
  drawChart($('#chA'), [
    { data: s.elbowAngle, color: C.s1 },
    { data: knee, color: C.s2, dash: [5, 4] },
    { data: s.separation.map(Math.abs), color: C.s3 },
  ], { lo: 0, hi: 180, ticks: [0, 45, 90, 135, 180], fmt: (v) => `${v}°` });
}
function drawChartHeads() {
  for (const c of [$('#chV'), $('#chA')]) {
    const b = chartBase.get(c); if (!b || b.snap.width !== c.width) continue;
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(b.snap, 0, 0);
    const dpr = c.width / (c.getBoundingClientRect().width || 1); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (P.i < b.i0 || P.i > b.i1) continue;
    const x = b.X(P.i); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, b.pad.t); g.lineTo(x, b.h - b.pad.b); g.stroke();
  }
}

// ====================== Squelette 3D + centre de masse ======================
function draw3D() {
  if (S.mode !== 'adv' || $('#v-seance').hidden) return;
  const v3 = $('#v3d');
  const { g, w, h } = fit(v3);
  const fr = P.frames[P.i]; if (!fr) return;
  const r = P.res, R = handOf() === 'right';
  const gy = Math.min(fr.world[27].y, fr.world[28].y) - 0.08;
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw), cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  const Sc = Math.min(w, h) / 2.7;
  const pr = (p) => { const x = p.x * cy - p.z * sy, z = p.x * sy + p.z * cy, y = p.y - gy - 0.9; const y2 = y * cp - z * sp, z2 = y * sp + z * cp; const k = 3.2 / (3.2 + z2); return [w / 2 + x * Sc * k, h * 0.56 - y2 * Sc * k, z2]; };
  // Sol : grille + cercle de visée
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    const a = pr({ x: i * 0.25, y: gy, z: -1.5 }), b = pr({ x: i * 0.25, y: gy, z: 1.5 }), c = pr({ x: -1.5, y: gy, z: i * 0.25 }), d = pr({ x: 1.5, y: gy, z: i * 0.25 });
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.moveTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.stroke();
  }
  // Trajectoire du poignet
  if (r) {
    const wi = R ? 16 : 15; g.strokeStyle = 'rgba(180,180,176,.55)'; g.lineWidth = 1.5; g.beginPath();
    for (let i = r.phases[0].i0; i <= r.phases[4].i1; i++) { const p = pr(P.frames[i].world[wi]); i === r.phases[0].i0 ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); }
    g.stroke();
  }
  // Trace du centre de masse au sol + point courant
  if (P.com.length) {
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([2, 3]); g.beginPath();
    P.com.forEach((c, i) => { const p = pr({ x: c.x, y: gy, z: c.z }); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.stroke(); g.setLineDash([]);
  }
  const hit = new Set(hitJoints());
  const segs = BONES().map(([a, b]) => ({ a, b, z: (pr(fr.world[a])[2] + pr(fr.world[b])[2]) / 2 })).sort((p, q) => q.z - p.z);
  g.lineCap = 'round';
  for (const { a, b } of segs) {
    const A = pr(fr.world[a]), B = pr(fr.world[b]);
    g.strokeStyle = hit.has(a) && hit.has(b) ? '#fff' : 'rgba(244,244,242,.7)'; g.lineWidth = hit.has(a) && hit.has(b) ? 3.2 : 2.4;
    g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
  }
  for (const k of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = pr(fr.world[k]); g.fillStyle = hit.has(k) ? C.acc : '#000'; g.strokeStyle = hit.has(k) ? C.acc : '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(p[0], p[1], hit.has(k) ? 4 : 3, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  const axis = (i, j) => { const A = pr(fr.world[i]), B = pr(fr.world[j]); const dx = B[0] - A[0], dy = B[1] - A[1]; g.strokeStyle = C.s3; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(A[0] - dx * 0.6, A[1] - dy * 0.6); g.lineTo(B[0] + dx * 0.6, B[1] + dy * 0.6); g.stroke(); g.setLineDash([]); };
  axis(23, 24); axis(11, 12);
  for (const fn of hooks.d3) { try { fn(g, pr, fr, gy); } catch (e) { console.warn('[kyron] calque 3D', e); } }
  const com = P.com[P.i];
  if (com) {
    const c = pr(com), gnd = pr({ x: com.x, y: gy, z: com.z });
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(gnd[0], gnd[1]); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(c[0], c[1], 7, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(c[0] - 11, c[1]); g.lineTo(c[0] + 11, c[1]); g.moveTo(c[0], c[1] - 11); g.lineTo(c[0], c[1] + 11); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(gnd[0], gnd[1], 5, 2.5, 0, 0, Math.PI * 2); g.fill();
  }
  if (r) {
    g.fillStyle = C.mute; g.font = `10.5px ${C.mono}`; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`SÉPARATION ${fi(Math.abs(r.series.separation[P.i]))}°`, 14, 14);
    if (com && P.com[0]) g.fillText(`CDM ${f((com.z - P.com[0].z) * 100, 0)} CM VERS L'AVANT · ${f(com.y - gy, 2)} M DU SOL`, 14, 30);
    g.textAlign = 'right'; g.fillText(`LACET ${fi(((P.yaw * 180 / Math.PI) % 360 + 360) % 360)}° · TANGAGE ${fi(P.pitch * 180 / Math.PI)}°`, w - 14, 14);
  }
}
