// KYRON · onglet Match : vidéo de match en caméra fixe (derrière le joueur) → frappes, rebonds, positions → match.js :
// statistiques, carte de chaleur, enchaînements, profil de l'adversaire.
import { $, $$, f, fi, esc, fit, C, clamp, STROKE_FR } from './util.js';
import { S } from './state.js';
import { M, has, analyzeSessionSafe } from './core.js';
import { api } from './seance.js';

let inited = false, data = null, busy = false, abort = null;
const kpi = (label, val, unit, d, cls = '', dcls = '') => `<div class="kpi ${cls}"><div class="lbl">${label}</div><b>${val}<small>${unit}</small></b><div class="d ${dcls}">${d || '&nbsp;'}</div></div>`;
const MAX_S = 90, RATE = 25;

export function show() {
  if (!inited) {
    inited = true;
    $('#mFile').addEventListener('change', (e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) importMatch(fl); });
    $('#mDemo').addEventListener('click', () => { if (!busy) runDemo(); });
    $('#mCancel').addEventListener('click', () => abort?.abort());
    addEventListener('resize', () => { if (!$('#v-match').hidden && data) drawHeat(); });
    if (!data) runDemo();
  }
  if (data) requestAnimationFrame(render);
}
const status = (m, p) => { $('#mMsg').textContent = m; $('#mBar').hidden = p == null; if (p != null) $('#mBar i').style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`; };

// ---------- Démo : un set court synthétique, analysé par le vrai module ----------
function rng(seed) { let x = seed; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
function demoEvents() {
  const r = rng(42), g = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
  const strokes = [], bounces = [], positions = [];
  let t = 3, px = 0.5, py = -12.6;
  for (let p = 0; p < 34; p++) {
    const serveNear = Math.floor(p / 4) % 2 === 0;
    const len = 1 + Math.floor(r() * r() * 9);
    let side = p % 2 ? -1 : 1;
    if (serveNear) {
      px = side * 1.2; py = -12.2;
      if (r() < 0.32) { strokes.push({ t, type: 'serve', conf: 0.9 }); bounces.push({ t: t + 0.55, x: -side * (2 + r() * 2), y: 7 + r() * 0.8 }); t += 7 + r() * 6; }
      strokes.push({ t, type: 'serve', conf: 0.9 });
      bounces.push({ t: t + 0.55, x: -side * (0.6 + r() * 3.2), y: 1.5 + r() * 4.6 }); t += 1.3;
    } else {
      bounces.push({ t, x: side * (0.5 + r() * 3.4), y: -(1.8 + r() * 4.2) }); t += 0.5;
    }
    let lastOut = false;
    for (let k = 0; k < len; k++) {
      // Déplacement du joueur proche vers la balle
      const tx = clamp(g() * 2.2 + (r() < 0.62 ? -1.4 : 1.2), -5, 5), ty = -12.2 + g() * 1.3 - (r() < 0.25 ? 1.5 : 0);
      for (let s = 0; s < 8; s++) { px += (tx - px) * 0.25; py += (ty - py) * 0.25; positions.push({ t: t - 0.8 + s * 0.1, x: px, y: py }); }
      const type = tx < -0.3 ? 'backhand' : 'forehand';
      strokes.push({ t, type, conf: 0.8 });
      const out = k === len - 1 && r() < 0.45;
      bounces.push({ t: t + 0.7, x: clamp(g() * 2.4, -5.5, 5.5), y: out ? 12.2 + r() : 5 + r() * 6.4 }); t += 1.1;
      if (out) { lastOut = true; break; }
      if (k < len - 1 || r() < 0.5) { const ox = r() < 0.6 ? -(1.2 + r() * 2.6) : 0.5 + r() * 3; bounces.push({ t: t + 0.4, x: ox, y: -(4 + r() * 7.5) }); t += 1.0; }
    }
    if (!lastOut && r() < 0.4) bounces.push({ t: t + 0.3, x: g() * 3, y: -(10.5 + r() * 2.8) });
    t += 12 + r() * 10;
  }
  return { strokes, bounces, positions, duration: t };
}
function runDemo() {
  if (!has('match', 'analyzeMatch')) { status('Module d\'analyse de match indisponible pour le moment.'); return; }
  const ev = demoEvents();
  const res = M.match.analyzeMatch({ strokes: ev.strokes, bounces: ev.bounces, positions: ev.positions });
  data = { res, source: 'demo', label: 'Démo synthétique', duration: ev.duration, cal: true, bounces: ev.bounces };
  status(`Démo : ${res.summary.points} points synthétiques (≈ ${fi(ev.duration / 60)} min), analysés par le module match. Importe ta vidéo, caméra fixe derrière toi, court entier dans le champ.`);
  render();
}

// ---------- Import d'une vidéo de match ----------
async function importMatch(file) {
  if (busy) return;
  if (api.isBusy()) { status('Une analyse de séance est en cours, attends qu\'elle finisse.'); return; }
  if (!has('match', 'analyzeMatch')) { status('Module d\'analyse de match indisponible pour le moment.'); return; }
  busy = true; abort = new AbortController(); const signal = abort.signal;
  $('#mCancel').hidden = false; $('#mDemo').disabled = true; $('#mFileLbl').style.pointerEvents = 'none';
  const v = $('#mVid');
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('format vidéo non lu par ce navigateur (essaie un .mp4 H.264).')); v.src = URL.createObjectURL(file); });
    status('Chargement du modèle de pose…', 0.02);
    const lm = await api.landmarker();
    const dur = Math.min(v.duration || 0, MAX_S);
    const sc = Math.min(1, 480 / v.videoWidth), w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cg = cv.getContext('2d', { willReadFrequently: true });
    const tracker = has('ball', 'createBallTracker') ? M.ball.createBallTracker({ width: w, height: h }) : null;
    const frames = []; let cal = null;
    const t0 = performance.now();
    for (let t = 0; t < dur; t += 1 / RATE) {
      if (signal.aborted) throw Object.assign(new Error('annulé'), { name: 'AbortError' });
      await new Promise((res) => { v.onseeked = res; v.currentTime = t; });
      const out = api.detect(lm, v, RATE);
      if (out.landmarks?.length && out.worldLandmarks?.length) frames.push({ t, img: out.landmarks[0].map((q) => ({ x: q.x, y: q.y, v: q.visibility ?? 1 })), world: out.worldLandmarks[0].map((q) => ({ x: q.x, y: -q.y, z: -q.z })) });
      cg.drawImage(v, 0, 0, w, h);
      const id = cg.getImageData(0, 0, w, h);
      if (tracker) { try { tracker.push(t, id); } catch (e) { /* suivi interrompu */ } }
      if (cal === null && has('court', 'calibrateCourt')) { try { cal = M.court.calibrateCourt(id) || false; } catch (e) { cal = false; } }
      if (frames.length % 10 === 0) { const el = (performance.now() - t0) / 1000, pr = t / dur; status(`Match · ${f(t, 0)} / ${f(dur, 0)} s · ${frames.length} poses${cal ? ' · court calibré' : ''}${pr > 0.03 ? ` · reste ≈ ${f(el / pr - el, 0)} s` : ''}`, 0.04 + pr * 0.9); }
    }
    status('Frappes, rebonds, points…', 0.96);
    await new Promise((r) => setTimeout(r, 0));
    const sess = frames.length > 20 ? analyzeSessionSafe(frames, { hand: S.profile.hand, height: S.profile.height / 100 }) : { strokes: [] };
    const strokes = sess.strokes.map((s) => ({ t: s.frames[s.res.impact].t, type: s.type, conf: s.conf ?? 0.6 }));
    const track = tracker ? (tracker.result()?.track || []) : [];
    const positions = cal && has('court', 'feetOnGround') ? frames.map((fr) => { const g = M.court.feetOnGround(cal, fr); return g ? { t: fr.t, ...g } : null; }).filter(Boolean) : [];
    const res = M.match.analyzeMatch({ strokes, ballTrack: track, cal: cal || null, positions });
    data = { res, source: 'video', label: file.name, duration: dur, cal: !!cal, truncated: v.duration > MAX_S };
    status(`${file.name} · ${f(dur, 0)} s analysées${data.truncated ? ` (les ${MAX_S} premières)` : ''} · ${strokes.length} frappes · ${res.summary.points} points${cal ? '' : ' · court non détecté : pas de carte au sol (filme le court entier, depuis le fond, caméra haute)'}.`);
    render();
  } catch (e) {
    status(e.name === 'AbortError' ? 'Analyse annulée.' : `Analyse interrompue : ${e.message}`);
  } finally {
    busy = false; abort = null; $('#mCancel').hidden = true; $('#mDemo').disabled = false; $('#mFileLbl').style.pointerEvents = '';
  }
}

// ---------- Rendu ----------
function render() {
  if (!data) return;
  const { res } = data, sm = res.summary;
  $('#mTag').textContent = data.source === 'demo' ? 'Match · démo synthétique' : `Match · ${data.label}`;
  $('#mK').innerHTML = [
    kpi('Points', fi(sm.points), '', `${fi(sm.won)} gagnés · ${fi(sm.lost)} perdus · ${fi(sm.unknown)} inconnus`, 'hero'),
    kpi('1re balle', sm.firstServePct != null ? fi(sm.firstServePct) : '—', '%', `${fi(sm.servePoints)} points au service · ${fi(sm.doubleFaults)} double${sm.doubleFaults > 1 ? 's' : ''} faute${sm.doubleFaults > 1 ? 's' : ''}`),
    kpi('Échange moyen', f(sm.meanRally, 1), 'frappes', 'les deux joueurs, estimé'),
    kpi('Tes frappes', fi(sm.strokes), '', Object.entries(sm.byType).filter(([, n]) => n).map(([k, n]) => `${(STROKE_FR[k] || k).toLowerCase()} ${n}`).join(' · ')),
  ].join('');
  $('#mSeq tbody').innerHTML = res.sequences?.length ? res.sequences.slice(0, 8).map((q) => `<tr><td>${esc(q.label)}</td><td class="n">${fi(q.count)}</td><td class="n">${q.successPct != null ? `<span class="${q.successPct < 40 ? 'att' : ''}">${fi(q.successPct)} %</span>` : '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="note">Pas assez de frappes enchaînées.</td></tr>';
  const o = res.opponent || {};
  const bars = (obj, labels) => Object.entries(obj || {}).map(([k, v]) => `<div class="sens-r"><div>${esc(labels[k] || k)}</div><div class="track"><i style="width:${Math.max(2, v)}%"></i></div><div class="mono">${fi(v)} %</div></div>`).join('');
  $('#mOpp').innerHTML = o.shots ? `<div class="lbl" style="margin-bottom:8px">Direction de ses coups (vue de ton côté) · ${fi(o.shots)} rebonds</div><div class="sens">${bars(o.direction, { gauche: 'Ta gauche', centre: 'Centre', droite: 'Ta droite' })}</div>
    <div class="lbl" style="margin:14px 0 8px">Profondeur</div><div class="sens">${bars(o.depth, { court: 'Courte', milieu: 'Milieu', profond: 'Profonde' })}</div>
    ${o.serves ? `<div class="lbl" style="margin:14px 0 8px">Ses services · ${fi(o.serves)}</div><div class="sens">${bars(o.serve, { large: 'Large', corps: 'Corps', T: 'Au T' })}</div>` : ''}
    <p class="note" style="margin-top:12px">${o.favourite ? `Il joue surtout ${o.favourite === 'centre' ? 'au centre' : `sur ta ${o.favourite}`}${(S.profile.hand === 'right' && o.favourite === 'gauche') || (S.profile.hand === 'left' && o.favourite === 'droite') ? ' : ton revers' : ''}.` : ''}</p>`
    : '<p class="empty">Aucun rebond adverse observé : il faut voir la balle rebondir de ton côté.</p>';
  $('#mPts tbody').innerHTML = res.points.slice(0, 40).map((p, i) => `<tr><td class="n">${i + 1}</td><td>${p.server === 'near' ? 'Toi' : p.server === 'far' ? 'Lui' : '—'}${p.doubleFault ? ' <span class="att">DF</span>' : p.firstServeFault ? ' <small class="note">2e balle</small>' : ''}</td><td>${p.strokes.map((k) => esc((STROKE_FR[k] || k).toLowerCase())).join(' → ') || '—'}</td><td class="n">${p.outcome ? `<span class="${p.outcome === 'perdu' ? 'att' : ''}">${p.outcome}</span>` : '—'}</td></tr>`).join('');
  $('#mNotes').innerHTML = `${data.source === 'demo' ? '<span class="src demo">Démo</span> ' : '<span class="src estimation">Estimé</span> '}Confiance globale ${fi(res.conf * 100)} %. ${(res.notes || []).map(esc).join(' ')}`;
  drawHeat();
}
function drawHeat() {
  const hm = data?.res?.heatmap, cv = $('#mHeat'); if (!cv) return;
  const { g, w, h } = fit(cv);
  const CW = 5.485, L = 11.885, top = 0, bot = -L - 4;
  const sc = Math.min((w - 24) / (2 * CW + 2), (h - 24) / (top - bot + 0.5)), ox = w / 2, oy = 12;
  const T = (x, y) => [ox + x * sc, oy + (top - y) * sc];
  if (hm) {
    const mx = Math.max(...hm.share) || 1;
    for (let r = 0; r < hm.rows; r++) for (let c = 0; c < hm.cols; c++) {
      const v = hm.share[r * hm.cols + c]; if (!v) continue;
      const [x, y] = T(hm.x0 + c * hm.cell, hm.y0 + (r + 1) * hm.cell);
      g.fillStyle = `rgba(255,255,255,${0.08 + 0.75 * Math.sqrt(v / mx)})`; g.fillRect(x, y, hm.cell * sc + 0.5, hm.cell * sc + 0.5);
    }
  }
  g.strokeStyle = C.rule2; g.lineWidth = 1;
  const line = (x1, y1, x2, y2) => { const a = T(x1, y1), b = T(x2, y2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
  line(-CW, -L, CW, -L); line(-CW, -L, -CW, 0); line(CW, -L, CW, 0); line(-4.115, -L, -4.115, 0); line(4.115, -L, 4.115, 0); line(-4.115, -6.4, 4.115, -6.4); line(0, -6.4, 0, 0);
  g.strokeStyle = '#fff'; g.lineWidth = 2; line(-CW - 0.9, 0, CW + 0.9, 0);
  g.font = `9.5px ${C.mono}`; g.fillStyle = C.mute; g.textAlign = 'center';
  const nb = T(0, 0); g.fillText('FILET', nb[0], nb[1] + 12);
  if (hm) {
    const [px, py] = T(hm.peak.x, hm.peak.y); g.strokeStyle = C.acc; g.lineWidth = 1.6; g.beginPath(); g.arc(px, py, 8, 0, Math.PI * 2); g.stroke();
    $('#mHeatLbl').textContent = `${fi(hm.behindBaselinePct)} % du temps derrière la ligne de fond · ${fi(hm.seconds)} s suivies`;
  } else {
    g.fillStyle = C.mute; g.fillText('COURT NON CALIBRÉ : PAS DE POSITIONS AU SOL', w / 2, h / 2);
    $('#mHeatLbl').textContent = '';
  }
}
