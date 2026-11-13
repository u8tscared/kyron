// KYRON · compression de la vidéo avant l'envoi (Supabase gratuit : 50 Mo par fichier).
// Au-delà de ~45 Mo, on ré-encode dans le navigateur pour viser ≤ 40 Mo : durée et horodatage conservés,
// 720p au plus (grand côté 1280), cadence d'origine gardée (ralenti 120/240 i/s), images clés toutes les secondes
// pour un replay image par image avec le squelette.
//  1. WebCodecs (VideoDecoder/VideoEncoder) + Mediabunny (lib/mediabunny.min.mjs, MPL-2.0, chargé à la demande) :
//     démultiplexage MP4/MOV, décodage, mise à l'échelle, encodage H.264 (sinon HEVC/VP9/AV1), multiplexage MP4.
//  2. Secours : canvas + MediaRecorder en lisant la vidéo à vitesse réelle (lent, cadence ≤ 60 i/s), vidéos courtes seulement.
//  3. Sinon : on rend la vidéo d'origine (l'envoi gère déjà le refus « video_too_large » en gardant l'analyse).
// Les fonctions de calcul (planCompression, fitDims, retryBitrate) sont pures et testées sous node.

export const MB = 1024 * 1024;
export const COMPRESS = Object.freeze({
  threshold: 45 * MB,      // au-dessus : on compresse
  target: 40 * MB,         // taille visée
  maxLong: 1280,           // 720p au plus
  overhead: 0.04,          // conteneur MP4 + marge de l'encodeur
  maxVideoBps: 8_000_000,  // inutile d'aller plus haut en 720p
  audioMaxShare: 0.15,     // le son ne doit pas manger plus de 15 % du budget, sinon on le retire
  keyFrameInterval: 1,     // s
  recorderMaxSec: 90,      // secours MediaRecorder : lecture à vitesse réelle, on plafonne
  // Paliers de définition selon le débit vidéo disponible (bits/s) : en dessous, on réduit la taille d'image.
  ladder: [[1280, 1_200_000], [854, 550_000], [640, 220_000]],
});

const even = (x) => Math.max(2, Math.round(x / 2) * 2);

// Dimensions de sortie : grand côté ≤ maxLong, proportions gardées, nombres pairs, jamais d'agrandissement.
export function fitDims(width, height, maxLong = COMPRESS.maxLong) {
  const w = +width, h = +height;
  if (!(w > 0 && h > 0)) return null;
  const s = Math.min(1, maxLong / Math.max(w, h));
  return { width: even(w * s), height: even(h * s) };
}

// Plan de compression. size en octets, duration en s, width/height d'affichage, audioBps débit du son d'origine (0 si aucun).
// → { needed:false } | { needed:true, ok:false, reason } | { needed:true, ok:true, width, height, videoBps, keepAudio, audioBps, estBytes, targetBytes }
export function planCompression({ size, duration, width, height, audioBps = 0 } = {}, opts = {}) {
  const o = { ...COMPRESS, ...opts };
  if (!(size > o.threshold)) return { needed: false };
  if (!(duration > 0) || !Number.isFinite(duration)) return { needed: true, ok: false, reason: 'duration' };
  const budget = o.target * 8 * (1 - o.overhead);              // bits
  let keepAudio = audioBps > 0 && (audioBps * duration) <= budget * o.audioMaxShare;
  const aBps = keepAudio ? Math.ceil(audioBps) : 0;
  const vBps = Math.floor((budget - aBps * duration) / duration);
  const videoBps = Math.min(o.maxVideoBps, vBps);
  const step = o.ladder.find(([, min]) => videoBps >= min);
  if (!step) return { needed: true, ok: false, reason: 'too_long' };
  const dims = fitDims(width || step[0], height || Math.round(step[0] * 9 / 16), step[0]);
  if (!dims) return { needed: true, ok: false, reason: 'dims' };
  const estBytes = Math.round(((videoBps + aBps) * duration) / 8 / (1 - o.overhead / 2));
  return { needed: true, ok: true, ...dims, videoBps, keepAudio, audioBps: aBps, estBytes, targetBytes: o.target };
}

// Second essai quand l'encodeur a dépassé la cible : débit corrigé au prorata, avec 10 % de marge.
export function retryBitrate(videoBps, outBytes, targetBytes = COMPRESS.target) {
  if (!(outBytes > 0)) return videoBps;
  return Math.max(100_000, Math.floor(videoBps * (targetBytes / outBytes) * 0.9));
}

// Cadence mesurée → cadence d'encodage : entier si on en est proche (240, 120, 60…), sinon 29,97 / 59,94 / 119,88 gardés.
export function normFps(fps) {
  const f = +fps;
  if (!(f > 0) || !Number.isFinite(f)) return null;
  const r = Math.round(f);
  return Math.abs(f - r) / r < 3e-4 ? r : Math.round(f * 1000) / 1000;
}

// Débit corrigé après l'étalonnage : si l'encodeur a produit realBps pour asked demandés, on demande au prorata
// (10 % de marge). On ne monte jamais au-dessus du débit planifié (un encodeur sous la cible, c'est déjà bon).
export function calibrateBitrate(asked, realBps, { maxVideoBps = COMPRESS.maxVideoBps } = {}) {
  if (!(realBps > 0) || !(asked > 0)) return asked;
  const ratio = realBps / asked;
  if (ratio <= 1.05) return Math.min(asked, maxVideoBps);
  return Math.max(100_000, Math.floor((asked / ratio) * 0.9));
}

// Définition adaptée au débit : on descend d'un palier si le débit passe sous le minimum de la définition actuelle
// (ou si forceDown). Jamais d'agrandissement.
export function adjustDims({ width, height }, bps, { forceDown = false, ladder = COMPRESS.ladder } = {}) {
  const long = Math.max(width, height);
  const want = ladder.find(([, min]) => bps >= min)?.[0];
  let newLong = want && want < long ? want : long;
  if (forceDown && newLong === long) newLong = ladder.map(([l]) => l).find((l) => l < long) ?? long;
  return fitDims(width, height, newLong);
}

// Essai suivant quand l'encodage complet dépasse la cible : débit au prorata, définition réduite au besoin
// et dans tous les cas à partir du 3ᵉ essai.
export function nextPass(plan, outBytes, pass, o = COMPRESS) {
  const bps = retryBitrate(plan.videoBps, outBytes, o.target ?? COMPRESS.target);
  return { ...adjustDims(plan, bps, { forceDown: pass >= 2, ladder: o.ladder ?? COMPRESS.ladder }), videoBps: bps };
}

const abortErr = () => Object.assign(new Error('Compression annulée'), { name: 'AbortError' });

// ---------- 1. WebCodecs + Mediabunny ----------
let mbP = null;
const loadMb = () => (mbP ??= import('../lib/mediabunny.min.mjs'));
export const hasWebCodecs = () => typeof globalThis.VideoEncoder === 'function' && typeof globalThis.VideoDecoder === 'function';

// Lit durée, dimensions, cadence et débit du son. null si le fichier n'est pas lisible.
export async function probe(file) {
  const mb = await loadMb();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) return null;
    const at = await input.getPrimaryAudioTrack();
    const [duration, width, height, vs] = await Promise.all([input.computeDuration(), vt.getDisplayWidth(), vt.getDisplayHeight(), vt.computePacketStats(300)]);
    const as = at ? await at.computePacketStats(300) : null;
    return { duration, width, height, fps: vs.averagePacketRate, codec: await vt.getCodec(), audioBps: as ? as.averageBitrate : 0 };
  } finally { input.dispose?.(); }
}

async function encodeOnce(mb, file, plan, codec, { onProgress, signal, trim = null, audio = plan.keepAudio }) {
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  try {
    const conv = await mb.Conversion.init({
      input, output, tracks: 'primary', showWarnings: false, ...(trim ? { trim } : {}),
      // Cadence d'origine imposée (ralenti 120/240 i/s compris), donnée aussi à l'encodeur pour son contrôle de débit.
      // Les horodatages sont alignés sur la grille 1/fps (écart < 1 image).
      video: { width: plan.width, height: plan.height, fit: 'contain', codec, ...(plan.frameRate ? { frameRate: plan.frameRate } : {}), quality: new mb.Quality({ bitrate: plan.videoBps }), keyFrameInterval: COMPRESS.keyFrameInterval, forceTranscode: true },
      audio: audio ? {} : { discard: true },
    });
    if (!conv.isValid || !conv.utilizedTracks.some((t) => t.isVideoTrack?.() ?? t.type === 'video')) {
      throw new Error(`conversion impossible (${conv.discardedTracks.map((d) => d.reason).join(', ') || 'piste vidéo absente'})`);
    }
    conv.onProgress = (p) => onProgress?.(p);
    const stop = () => { conv.cancel().catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try { await conv.execute(); } finally { signal?.removeEventListener('abort', stop); }
    if (signal?.aborted) throw abortErr();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally { input.dispose?.(); }
}

async function viaWebCodecs(file, { onProgress, signal, opts }) {
  const mb = await loadMb();
  const src = await probe(file);
  if (!src) throw new Error('piste vidéo illisible');
  let plan = planCompression({ size: file.size, ...src }, opts);
  if (!plan.needed) return null;
  if (!plan.ok) throw new Error(`compression impossible (${plan.reason})`);
  plan = { ...plan, frameRate: normFps(src.fps) };
  const o = { ...COMPRESS, ...opts }, target = plan.targetBytes, D = src.duration;
  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: plan.width, height: plan.height, quality: new mb.Quality({ bitrate: plan.videoBps }) });
  if (!codec) throw new Error('aucun encodeur vidéo disponible');
  const abortable = (e) => { if (e?.name === 'AbortError' || signal?.aborted) throw abortErr(); };

  // 1. Étalonnage sur 2 s au milieu (là où est le geste) : les encodeurs dépassent souvent le débit demandé sur
  //    une image bruitée (ralenti en intérieur). On mesure, on corrige. Si l'encodeur refuse la cadence du ralenti
  //    (encodeur matériel limité), on redescend à 120 puis 60 i/s : images en trop sautées, horodatages justes.
  const rates = [plan.frameRate, ...[120, 60].filter((r) => plan.frameRate && r < plan.frameRate)];
  let calibrated = false, lastErr = null;
  for (const frameRate of rates) {
    const test = { ...plan, frameRate };
    try {
      const len = Math.min(2, D / 2), t0 = Math.max(0, D / 2 - len / 2);
      const b = await encodeOnce(mb, file, test, codec, { signal, audio: false, trim: { start: t0, end: t0 + len } });
      const bps = calibrateBitrate(plan.videoBps, (b.size * 8) / len, o);
      plan = { ...test, ...adjustDims(plan, bps, o), videoBps: bps };
      calibrated = true; break;
    } catch (e) { abortable(e); lastErr = e; console.warn(`[kyron] compression à ${frameRate ?? 'cadence d’origine'} i/s impossible`, e); }
  }
  if (!calibrated) throw lastErr || new Error('encodage impossible');
  onProgress?.(0.03, 1);

  // 2. Encodage complet ; si la cible est encore dépassée, nouvel essai avec débit corrigé, puis définition réduite.
  let blob = null, passes = 0;
  while (passes < 3) {
    passes++;
    const b = await encodeOnce(mb, file, plan, codec, { onProgress: (p) => onProgress?.(passes === 1 ? 0.03 + p * 0.94 : p * 0.97, passes), signal });
    if (!blob || b.size < blob.size) blob = b;
    if (b.size <= target * 1.08) break;
    plan = { ...plan, ...nextPass(plan, b.size, passes, o) };
  }
  const out = await probe(blob).catch(() => null);
  onProgress?.(1, passes);
  return {
    blob,
    info: {
      compressed: true, method: 'webcodecs', codec, passes, fromBytes: file.size, bytes: blob.size,
      width: out?.width ?? plan.width, height: out?.height ?? plan.height, videoKbps: Math.round(plan.videoBps / 1000), audio: plan.keepAudio,
      srcFps: round1(src.fps), fps: round1(out?.fps ?? plan.frameRate ?? src.fps), frameRate: plan.frameRate,
      duration: round3(out?.duration ?? D), srcDuration: round3(D),
    },
  };
}

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const round3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

// ---------- 2. Secours : canvas + MediaRecorder (vitesse réelle) ----------
export const hasRecorder = () => typeof globalThis.MediaRecorder === 'function' && typeof document !== 'undefined'
  && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

function recorderMime() {
  const c = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return c.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
}

async function viaRecorder(file, { onProgress, signal, opts }) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('vidéo illisible')); });
    const o = { ...COMPRESS, ...opts };
    const plan = planCompression({ size: file.size, duration: v.duration, width: v.videoWidth, height: v.videoHeight, audioBps: 0 }, opts);
    if (!plan.needed) return null;
    if (!plan.ok) throw new Error(`compression impossible (${plan.reason})`);
    if (v.duration > o.recorderMaxSec) throw new Error('vidéo trop longue pour la compression de secours');
    const mime = recorderMime();
    const cv = document.createElement('canvas'); cv.width = plan.width; cv.height = plan.height;
    const g = cv.getContext('2d');
    const stream = cv.captureStream(60);
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: plan.videoBps });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    let live = true;
    const draw = () => {
      if (!live) return;
      g.drawImage(v, 0, 0, cv.width, cv.height);
      onProgress?.(Math.min(0.99, v.currentTime / v.duration));
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
    };
    const stop = () => { live = false; try { v.pause(); } catch (e) { /* rien */ } if (rec.state !== 'inactive') rec.stop(); };
    signal?.addEventListener('abort', stop, { once: true });
    v.onended = stop;
    rec.start(1000);
    await v.play();
    draw();
    await done;
    signal?.removeEventListener('abort', stop);
    if (signal?.aborted) throw abortErr();
    const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
    onProgress?.(1);
    return {
      blob,
      info: { compressed: true, method: 'mediarecorder', codec: rec.mimeType || mime, passes: 1, fromBytes: file.size, bytes: blob.size, width: plan.width, height: plan.height, videoKbps: Math.round(plan.videoBps / 1000), audio: false, srcFps: null, fps: null, duration: round3(v.duration), srcDuration: round3(v.duration), note: 'cadence limitée à l’affichage (≤ 60 i/s)' },
    };
  } finally { v.removeAttribute('src'); v.load?.(); URL.revokeObjectURL(url); }
}

// ---------- Point d'entrée ----------
// Ne lève jamais (sauf annulation) : rend { video, info }. onProgress(p ∈ [0,1], essai 1|2). video est la version compressée si elle est plus légère,
// sinon le fichier d'origine. info = null si aucune compression n'était nécessaire.
export async function prepareVideo(file, { onProgress, signal, opts = {} } = {}) {
  if (!file || !(file.size > (opts.threshold ?? COMPRESS.threshold))) return { video: file, info: null };
  const errors = [];
  const paths = [];
  if (hasWebCodecs()) paths.push(viaWebCodecs);
  if (hasRecorder()) paths.push(viaRecorder);
  for (const run of paths) {
    try {
      const r = await run(file, { onProgress, signal, opts });
      if (!r) return { video: file, info: null };
      if (r.blob.size > 0 && r.blob.size < file.size) return { video: r.blob, info: r.info };
      errors.push(`${r.info.method} : résultat plus lourd`);
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) throw abortErr();
      console.warn('[kyron] compression', e);
      errors.push(String(e?.message || e));
    }
  }
  return { video: file, info: { compressed: false, reason: errors.join(' ; ') || 'navigateur sans encodeur vidéo', fromBytes: file.size } };
}
