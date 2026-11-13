// KYRON · comptes et données (séances, vidéos, profil).
//
// Deux moteurs derrière la même API (`account`) :
//  - 'cloud' : Supabase (vrais comptes email + mot de passe, base Postgres, vidéos dans un stockage privé).
//    Activé seulement si app/config.js est rempli ET que le client (app/lib/supabase.js) se charge.
//    Le client est importé à la demande : le mode local ne le télécharge jamais.
//  - 'local' : tout reste dans ce navigateur (IndexedDB). Les « comptes » locaux sont des profils d'appareil :
//    le mot de passe est dérivé par PBKDF2-SHA256 (sel aléatoire, 150 000 itérations) pour ne pas être stocké en
//    clair, mais ce n'est PAS une sécurité serveur : quiconque a accès au navigateur peut lire ou effacer les données.
//    Sans IndexedDB (navigation privée ancienne, stockage bloqué), tout reste en mémoire et `account.persistent === false`.
//
// Toutes les erreurs sont des `AccountError` (sous-classe d'Error) avec `.message` en français et `.code` stable.
// Contrat complet : docs/CONTRACTS.md, section « Comptes et données ».

import { SUPABASE } from '../config.js';

export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;   // plafond côté app (le serveur peut être plus strict)
export const MAX_RESULT_BYTES = 2.5 * 1024 * 1024;  // taille max de `result` une fois sérialisé
export const PBKDF2_ITERATIONS = 150000;
export const TUS_CHUNK = 6 * 1024 * 1024;            // Supabase impose des morceaux de 6 Mo pour l'envoi reprenable
export const BUCKET = 'videos';
const SESSION_KEY = 'kyron-account';                 // session locale (localStorage)
const LEGACY_CLAIM = 'kyron-legacy-claim';           // { local: userId, cloud: userId } : qui a repris l'ancien historique
const MIN_PASSWORD = 8;
const LEVELS = ['amateur', 'competition', 'pro', 'coach'];
const SOURCES = ['video', 'demo', '2cam', 'match'];
const MB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Erreurs
export class AccountError extends Error {
  constructor(code, message, extra) { super(message); this.name = 'AccountError'; this.code = code; if (extra) Object.assign(this, extra); }
}
export const MSG = {
  invalid_email: 'Adresse email invalide.',
  weak_password: `Mot de passe trop court : ${MIN_PASSWORD} caractères minimum.`,
  email_taken: 'Un compte existe déjà avec cet email. Connecte-toi, ou utilise « Mot de passe oublié ».',
  invalid_credentials: 'Email ou mot de passe incorrect.',
  email_not_confirmed: "Email pas encore confirmé : ouvre le lien reçu par email, puis reconnecte-toi.",
  confirm_email: 'Compte créé. Ouvre l’email de confirmation qui vient de t’être envoyé, puis connecte-toi.',
  not_signed_in: 'Connecte-toi d’abord.',
  not_found: 'Séance introuvable (déjà supprimée ?).',
  rate_limited: 'Trop de tentatives. Patiente une minute puis réessaie.',
  network: 'Pas de connexion au serveur. Vérifie ta connexion internet et réessaie.',
  storage_full: 'Plus assez de place sur cet appareil pour enregistrer. Supprime d’anciennes séances ou vidéos.',
  local_unsupported: 'En mode local (sans serveur), le mot de passe ne peut pas être réinitialisé par email : il n’existe que sur cet appareil. Crée un nouveau compte local si tu l’as oublié.',
  insecure_context: 'Les comptes locaux demandent une page sécurisée (adresse en https:// ou localhost).',
  setup_missing: 'Le serveur n’est pas prêt : le script docs/supabase-setup.sql n’a pas été exécuté dans Supabase.',
  upload_failed: 'L’envoi de la vidéo a échoué. Réessaie avec une meilleure connexion.',
  unknown: 'Une erreur inattendue est survenue. Réessaie.',
};
const fail = (code, message = MSG[code] || MSG.unknown, extra) => { throw new AccountError(code, message, extra); };
const mo = (b) => `${Math.round(b / MB)} Mo`;
export const tooLargeMessage = (size, cap) => `Vidéo trop lourde (${mo(size)}). Limite : ${mo(cap)}. Raccourcis la vidéo ou filme en 1080p plutôt qu’en 4K.`;

// Erreurs Supabase (auth, PostgREST, stockage, réseau) → AccountError
export function mapSupabaseError(err, fallback = 'unknown') {
  if (err instanceof AccountError) return err;
  const code = String(err?.code || err?.error_code || '');
  const msg = String(err?.message || err?.error_description || err?.error || '');
  const status = +(err?.status ?? err?.statusCode ?? 0);
  const is = (re) => re.test(msg) || re.test(code);
  let c = null;
  if (/^(invalid_credentials|invalid_grant)$/.test(code) || is(/invalid login credentials/i)) c = 'invalid_credentials';
  else if (/^(user_already_exists|email_exists)$/.test(code) || is(/already (been )?registered|already exists/i)) c = 'email_taken';
  else if (code === 'email_not_confirmed' || is(/email not confirmed/i)) c = 'email_not_confirmed';
  else if (code === 'weak_password' || is(/password should|weak password/i)) c = 'weak_password';
  else if (/^(email_address_invalid|validation_failed)$/.test(code) && /email/i.test(msg)) c = 'invalid_email';
  else if (/rate_limit/.test(code) || status === 429 || is(/rate limit|too many requests/i)) c = 'rate_limited';
  else if (status === 413 || is(/payload too large|maximum allowed size|entity too large/i)) c = 'video_too_large';
  else if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205' || is(/relation .* does not exist|could not find the (table|function)|bucket not found/i)) c = 'setup_missing';
  else if (err?.name === 'AuthRetryableFetchError' || err?.name === 'TypeError' || is(/failed to fetch|networkerror|network request failed|load failed|fetch failed/i)) c = 'network';
  else if (code === 'PGRST116') c = 'not_found';
  if (c === 'video_too_large') return new AccountError(c, 'Vidéo refusée par le serveur : elle dépasse la taille maximale autorisée par le projet Supabase (50 Mo sur l’offre gratuite).', { cause: err });
  if (c) return new AccountError(c, MSG[c], { cause: err });
  const e = new AccountError(fallback, MSG[fallback] || MSG.unknown, { cause: err });
  if (msg && fallback === 'unknown') e.message = `${MSG.unknown} (${msg.slice(0, 160)})`;
  return e;
}

// ---------------------------------------------------------------------------------------------
// Petits utilitaires
export const normEmail = (e) => String(e ?? '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const cryptoObj = () => globalThis.crypto;
export function uuid() {
  const c = cryptoObj();
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const toB64 = (bytes) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const b64Text = (s) => toB64(new TextEncoder().encode(String(s)));
const iso = (d) => { const t = d instanceof Date ? d : new Date(d ?? Date.now()); return Number.isFinite(t.getTime()) ? t.toISOString() : new Date().toISOString(); };
const isBlob = (v) => typeof Blob !== 'undefined' && v instanceof Blob;

// Mot de passe local : PBKDF2-SHA256. Protège le mot de passe lui-même (réutilisé ailleurs), pas les données.
export async function hashPassword(password, { salt, iterations = PBKDF2_ITERATIONS } = {}) {
  const subtle = cryptoObj()?.subtle; if (!subtle) fail('insecure_context');
  const s = salt ? fromB64(salt) : cryptoObj().getRandomValues(new Uint8Array(16));
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations }, key, 256);
  return { salt: toB64(s), hash: toB64(new Uint8Array(bits)), iterations };
}
export async function verifyPassword(password, rec) {
  const h = await hashPassword(password, { salt: rec.salt, iterations: rec.iterations });
  let d = h.hash.length ^ rec.hash.length;
  for (let i = 0; i < Math.min(h.hash.length, rec.hash.length); i++) d |= h.hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return d === 0;
}

// ---------------------------------------------------------------------------------------------
// Profil
export function defaultProfile(name = '') {
  return { name: String(name || '').slice(0, 60), level: 'amateur', hand: 'R', heightCm: 180, massKg: 75, mode: 'simple', onboarded: false };
}
const clampN = (v, a, b, d) => { const n = +v; return Number.isFinite(n) ? Math.round(Math.max(a, Math.min(b, n))) : d; };
const str = (v, n = 80) => (v == null || v === '' ? undefined : String(v).slice(0, n));
// Fusionne et valide ; les champs inconnus (ex. goals) sont conservés tels quels.
export function normProfile(p = {}, base = defaultProfile()) {
  const o = { ...base, ...p };
  o.name = String(o.name ?? '').slice(0, 60);
  o.level = LEVELS.includes(o.level) ? o.level : ({ loisir: 'amateur', club: 'amateur' }[o.level] || 'amateur');
  o.hand = o.hand === 'L' || o.hand === 'left' ? 'L' : 'R';
  o.heightCm = clampN(o.heightCm, 100, 240, 180);
  o.massKg = clampN(o.massKg, 25, 200, 75);
  o.mode = o.mode === 'expert' || o.mode === 'adv' ? 'expert' : 'simple';
  o.onboarded = !!o.onboarded;
  for (const k of ['sex', 'racket', 'strings']) { const v = str(o[k]); if (v === undefined) delete o[k]; else o[k] = v; }
  return o;
}

// ---------------------------------------------------------------------------------------------
// Réduction de `result` : JSON pur, nombres arrondis (7 chiffres significatifs), tableaux typés courts convertis,
// longs tableaux typés retirés ; puis, si c'est encore trop gros, retrait des plus gros tableaux d'images
// (frames, landmarks…) en priorité, puis des plus gros tableaux restants. Marque `framesDropped: true` + `droppedPaths`.
const FRAMEISH = /^(frames|landmarks|worldlandmarks|world|img|poses?|poseframes|series|track|balltrack|trail|com|raw|samples|positions)$/i;
export function stripResult(result, { maxBytes = MAX_RESULT_BYTES } = {}) {
  if (result == null) return null;
  const dropped = [], stack = new Set();
  const clean = (v, path, depth) => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? v : +v.toPrecision(7)) : null;
    if (t === 'string' || t === 'boolean') return v;
    if (t !== 'object' || depth > 48) return undefined;
    if (ArrayBuffer.isView(v)) {
      if (!(v instanceof DataView) && v.length <= 4096 && typeof v[0] !== 'bigint') return Array.from(v, (x) => clean(x, '', depth + 1));
      dropped.push(path); return undefined;
    }
    if (v instanceof ArrayBuffer || isBlob(v) || v instanceof Map || v instanceof Set || typeof v.nodeType === 'number' || typeof v.then === 'function') return undefined;
    if (v instanceof Date) return v.toISOString();
    if (stack.has(v)) return undefined;
    stack.add(v);
    let out;
    if (Array.isArray(v)) out = v.map((x, i) => { const c = clean(x, `${path}[${i}]`, depth + 1); return c === undefined ? null : c; });
    else {
      out = {};
      for (const k of Object.keys(v)) { const c = clean(v[k], path ? `${path}.${k}` : k, depth + 1); if (c !== undefined) out[k] = c; }
    }
    stack.delete(v);
    return out;
  };
  let out = clean(result, '', 0);
  if (out === undefined) return null;
  if (typeof out !== 'object' || Array.isArray(out)) out = { value: out };
  // Taille JSON approchée (unités UTF-16) de chaque nœud ; candidats = tableaux ≥ 16 Ko
  const MINC = 16 * 1024;
  const measure = (v, parent, key, path, cands) => {
    if (v === null || typeof v !== 'object') return { size: JSON.stringify(v).length, has: false };
    let size = 2, has = false, n = 0;
    if (Array.isArray(v)) {
      v.forEach((x, i) => { const r = measure(x, v, i, `${path}[${i}]`, cands); size += r.size + (n++ ? 1 : 0); has ||= r.has; });
    } else {
      for (const k of Object.keys(v)) { const r = measure(v[k], v, k, path ? `${path}.${k}` : k, cands); size += JSON.stringify(k).length + 1 + r.size + (n++ ? 1 : 0); has ||= r.has; }
    }
    if (Array.isArray(v) && size >= MINC && parent) { cands.push({ parent, key, path, size, leaf: !has, frameish: FRAMEISH.test(String(key)) || FRAMEISH.test(String(path.split('.').pop()).replace(/\[\d+\]$/, '')) }); has = true; }
    return { size, has };
  };
  for (let pass = 0; pass < 8; pass++) {
    const cands = [];
    let total = measure(out, null, null, '', cands).size;
    if (total <= maxBytes) break;
    const leaf = cands.filter((c) => c.leaf).sort((a, b) => (b.frameish - a.frameish) || (b.size - a.size));
    if (!leaf.length) {
      // Dernier recours : ne garder que les valeurs simples du premier niveau
      const keep = {};
      for (const [k, v] of Object.entries(out)) if (v === null || typeof v !== 'object') keep[k] = v; else dropped.push(k);
      out = keep; break;
    }
    for (const c of leaf) {
      if (total <= maxBytes) break;
      c.parent[c.key] = null; dropped.push(c.path); total -= c.size - 4;
    }
    if (total <= maxBytes) break;
  }
  if (dropped.length) { out.framesDropped = true; out.droppedPaths = dropped.slice(0, 50); }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Correspondances base Supabase ↔ objets de l'app (testées sans serveur)
export const videoPath = (userId, id) => `${userId}/${id}.mp4`;
export const thumbPath = (userId, id) => `${userId}/${id}.jpg`;
export function sessionToRow({ id, userId, stroke, source, createdAt, summary, result, videoPath: vp = null, thumbPath: tp = null }) {
  return { id, user_id: userId, stroke: stroke ?? null, source, created_at: iso(createdAt), summary: summary ?? {}, result: result ?? null, video_path: vp, thumb_path: tp };
}
export function rowToItem(row, thumbUrl = null) {
  return { id: row.id, stroke: row.stroke ?? null, source: row.source, createdAt: row.created_at ? iso(row.created_at) : null, summary: row.summary || {}, thumbUrl: thumbUrl || null, hasVideo: !!row.video_path };
}
export function mapAuthUser(u, profileName) {
  if (!u) return null;
  const email = u.email || '';
  return { id: u.id, email, name: profileName || u.user_metadata?.name || email.split('@')[0] || '' };
}
function checkSession(s) {
  if (!s || typeof s !== 'object') fail('invalid_session', 'Séance invalide.');
  if (!SOURCES.includes(s.source)) fail('invalid_session', `Source de séance inconnue : « ${s.source} ».`);
}

// ---------------------------------------------------------------------------------------------
// Envoi reprenable (protocole TUS, celui de Supabase Storage) : morceaux de 6 Mo, reprise à l'octet près après
// une coupure (HEAD → Upload-Offset), jeton rafraîchi à chaque morceau (envois longs > 1 h).
export async function tusUpload({ endpoint, getToken, apikey, bucket, path, blob, contentType, onProgress, fetch: f = globalThis.fetch, chunk = TUS_CHUNK, retries = 5, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const hdr = async (x) => ({ 'Tus-Resumable': '1.0.0', authorization: `Bearer ${await getToken()}`, apikey, ...x });
  const meta = [['bucketName', bucket], ['objectName', path], ['contentType', contentType || 'video/mp4'], ['cacheControl', '3600']].map(([k, v]) => `${k} ${b64Text(v)}`).join(',');
  const bad = async (r) => { let body = ''; try { body = await r.text(); } catch (e) { /* rien */ } return mapSupabaseError({ status: r.status, message: body || `HTTP ${r.status}` }, 'upload_failed'); };
  let r;
  try { r = await f(endpoint, { method: 'POST', headers: await hdr({ 'Upload-Length': String(blob.size), 'Upload-Metadata': meta, 'x-upsert': 'true' }) }); }
  catch (e) { throw mapSupabaseError(e, 'upload_failed'); }
  if (!r.ok) throw await bad(r);
  const loc = r.headers.get('Location'); if (!loc) fail('upload_failed');
  const url = new URL(loc, endpoint).href;
  let off = 0, tries = 0;
  onProgress?.(0, { loaded: 0, total: blob.size });
  while (off < blob.size) {
    try {
      const res = await f(url, { method: 'PATCH', headers: await hdr({ 'Upload-Offset': String(off), 'Content-Type': 'application/offset+octet-stream' }), body: blob.slice(off, Math.min(blob.size, off + chunk)) });
      if (!res.ok) {
        const e = await bad(res);
        e.retryable = res.status >= 500 || res.status === 409 || res.status === 423 || res.status === 429;
        throw e;
      }
      const next = +res.headers.get('Upload-Offset');
      off = Number.isFinite(next) && next > off ? next : Math.min(blob.size, off + chunk);
      tries = 0;
      onProgress?.(off / blob.size, { loaded: off, total: blob.size });
    } catch (e) {
      const retryable = e.retryable ?? !(e instanceof AccountError);
      if (!retryable || ++tries > retries) throw e instanceof AccountError ? e : mapSupabaseError(e, 'upload_failed');
      await sleep(Math.min(8000, 500 * 2 ** (tries - 1)));
      try {
        const h = await f(url, { method: 'HEAD', headers: await hdr({}) });
        const o = +h.headers.get('Upload-Offset');
        if (h.ok && Number.isFinite(o)) off = o;
      } catch (e2) { /* on réessaie au même offset */ }
    }
  }
  return { path };
}

// ---------------------------------------------------------------------------------------------
// Stockage clé-valeur (localStorage) avec repli mémoire
export function webKv(ls = (() => { try { return globalThis.localStorage; } catch (e) { return null; } })()) {
  const mem = new Map();
  let ok = false;
  try { if (ls) { ls.setItem('kyron-probe', '1'); ls.removeItem('kyron-probe'); ok = true; } } catch (e) { ok = false; }
  return {
    persistent: ok,
    get(k, d = null) { try { if (ok) { const v = ls.getItem(k); return v == null ? d : JSON.parse(v); } } catch (e) { /* repli */ } return mem.has(k) ? mem.get(k) : d; },
    set(k, v) { try { if (ok) { ls.setItem(k, JSON.stringify(v)); return; } } catch (e) { /* repli */ } mem.set(k, v); },
    del(k) { try { if (ok) ls.removeItem(k); } catch (e) { /* rien */ } mem.delete(k); },
  };
}

// Base locale : adaptateur minimal { persistent, get, put, del, list(store, userId?) }.
// memoryDb() sert de repli et aux tests ; idbDb() est la vraie base IndexedDB 'kyron'.
const STORES = ['users', 'profiles', 'sessions', 'blobs'];
const jclone = (v) => (v == null || isBlob(v) ? v : JSON.parse(JSON.stringify(v)));
export function memoryDb() {
  const s = Object.fromEntries(STORES.map((n) => [n, new Map()]));
  return {
    persistent: false,
    async get(st, k) { return jclone(s[st].get(k)); },
    async put(st, k, v) { s[st].set(k, jclone(v)); },
    async del(st, k) { s[st].delete(k); },
    async list(st, userId) { return [...s[st].values()].filter((v) => userId == null || v?.userId === userId).map(jclone); },
  };
}
export async function idbDb(name = 'kyron', idb = globalThis.indexedDB) {
  if (!idb) throw new Error('IndexedDB indisponible');
  const db = await new Promise((res, rej) => {
    let req;
    try { req = idb.open(name, 1); } catch (e) { rej(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const n of STORES) if (!d.objectStoreNames.contains(n)) { const os = d.createObjectStore(n); if (n === 'sessions') os.createIndex('userId', 'userId'); }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
    req.onblocked = () => rej(new Error('IndexedDB bloquée'));
  });
  const run = (st, mode, fn) => new Promise((res, rej) => {
    const tx = db.transaction(st, mode), r = fn(tx.objectStore(st));
    tx.oncomplete = () => res(r?.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('transaction annulée'));
  });
  const quota = (e) => { if (e?.name === 'QuotaExceededError') throw new AccountError('storage_full', MSG.storage_full, { cause: e }); throw e; };
  return {
    persistent: true,
    get: (st, k) => run(st, 'readonly', (os) => os.get(k)),
    put: (st, k, v) => run(st, 'readwrite', (os) => os.put(v, k)).catch(quota),
    del: (st, k) => run(st, 'readwrite', (os) => os.delete(k)),
    list: (st, userId) => run(st, 'readonly', (os) => (userId != null && st === 'sessions' ? os.index('userId').getAll(userId) : os.getAll()))
      .then((all) => (userId == null || st === 'sessions' ? all : all.filter((v) => v?.userId === userId))),
  };
}

// ---------------------------------------------------------------------------------------------
// Moteur local
function localBackend(ctx) {
  const { db, kv } = ctx;
  let user = null;
  const urls = new Map();   // URL d'objets créées (révoquées à la déconnexion / suppression)
  const objUrl = (key, blob) => {
    if (!blob || typeof URL?.createObjectURL !== 'function') return null;
    if (urls.has(key)) return urls.get(key);
    const u = URL.createObjectURL(blob); urls.set(key, u); return u;
  };
  const revoke = (prefix) => { for (const [k, u] of urls) if (!prefix || k.startsWith(prefix)) { try { URL.revokeObjectURL(u); } catch (e) { /* rien */ } urls.delete(k); } };
  const pub = (rec) => ({ id: rec.id, email: rec.email, name: rec.name });
  const meta = async (id) => { const m = await db.get('sessions', id); if (!m || m.userId !== user?.id) fail('not_found'); return m; };
  return {
    kind: 'local',
    async restore() {
      const s = kv.get(SESSION_KEY, null);
      if (!s?.email) return null;
      const rec = await db.get('users', s.email);
      if (!rec || rec.id !== s.userId) { kv.del(SESSION_KEY); return null; }
      return (user = pub(rec));
    },
    async signUp(email, password, name) {
      if (await db.get('users', email)) fail('email_taken', 'Un compte local existe déjà avec cet email sur cet appareil. Connecte-toi.');
      const h = await hashPassword(password, { iterations: ctx.iterations });
      const rec = { id: uuid(), email, name: name || email.split('@')[0], ...h, createdAt: iso() };
      await db.put('users', email, rec);
      kv.set(SESSION_KEY, { userId: rec.id, email });
      return (user = pub(rec));
    },
    async signIn(email, password) {
      const rec = await db.get('users', email);
      if (!rec || !(await verifyPassword(password, rec))) fail('invalid_credentials');
      kv.set(SESSION_KEY, { userId: rec.id, email });
      return (user = pub(rec));
    },
    async signOut() { kv.del(SESSION_KEY); revoke(); user = null; },
    async resetPassword() { fail('local_unsupported'); },
    async updatePassword(password) {
      const rec = await db.get('users', user.email);
      await db.put('users', user.email, { ...rec, ...(await hashPassword(password, { iterations: ctx.iterations })) });
    },
    async setName(name) { const rec = await db.get('users', user.email); if (rec) { await db.put('users', user.email, { ...rec, name }); user = { ...user, name }; } },
    async getProfileData() { return (await db.get('profiles', user.id))?.data ?? null; },
    async putProfileData(data) { await db.put('profiles', user.id, { userId: user.id, data, updatedAt: iso() }); },
    async insertSession(s, { onProgress } = {}) {
      const id = uuid();
      if (s.video) await db.put('blobs', `${id}:video`, s.video);
      if (s.thumb) await db.put('blobs', `${id}:thumb`, s.thumb);
      await db.put('blobs', `${id}:result`, { userId: user.id, result: s.result });
      await db.put('sessions', id, { id, userId: user.id, stroke: s.stroke ?? null, source: s.source, createdAt: s.createdAt, summary: s.summary ?? {}, hasVideo: !!s.video, hasThumb: !!s.thumb, seq: Date.now() });
      onProgress?.(1, { loaded: s.video?.size || 0, total: s.video?.size || 0 });
      return id;
    },
    async insertMany(list) { const ids = []; for (const s of list) ids.push(await this.insertSession(s)); return ids; },
    async listSessions(limit) {
      const all = (await db.list('sessions', user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.seq || 0) - (a.seq || 0)).slice(0, limit);
      const out = [];
      for (const m of all) {
        const thumb = m.hasThumb ? await db.get('blobs', `${m.id}:thumb`) : null;
        out.push({ id: m.id, stroke: m.stroke, source: m.source, createdAt: m.createdAt, summary: m.summary, thumbUrl: objUrl(`${m.id}:thumb`, thumb), hasVideo: !!m.hasVideo });
      }
      return out;
    },
    async legacyKeys() { return new Set((await db.list('sessions', user.id)).map((m) => m.summary?.legacyKey).filter(Boolean)); },
    async getSession(id) {
      const m = await meta(id);
      const r = await db.get('blobs', `${id}:result`);
      const [thumb, video] = [m.hasThumb ? await db.get('blobs', `${id}:thumb`) : null, m.hasVideo ? await db.get('blobs', `${id}:video`) : null];
      return { id, stroke: m.stroke, source: m.source, createdAt: m.createdAt, summary: m.summary, thumbUrl: objUrl(`${id}:thumb`, thumb), hasVideo: !!m.hasVideo, result: r?.result ?? null, videoUrl: objUrl(`${id}:video`, video) };
    },
    async deleteSession(id) {
      await meta(id);
      revoke(`${id}:`);
      for (const k of ['video', 'thumb', 'result']) await db.del('blobs', `${id}:${k}`);
      await db.del('sessions', id);
    },
    async deleteAccount() {
      for (const m of await db.list('sessions', user.id)) { for (const k of ['video', 'thumb', 'result']) await db.del('blobs', `${m.id}:${k}`); await db.del('sessions', m.id); }
      await db.del('profiles', user.id);
      await db.del('users', user.email);
      await this.signOut();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Moteur Supabase
async function cloudBackend(ctx, cfg) {
  const mod = await ctx.loadClient();
  const sb = mod.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kyron-auth' } });
  const base = cfg.url.replace(/\/+$/, '');
  let user = null;
  const E = (err, fb) => mapSupabaseError(err, fb);
  const q = async (p, fb) => { const { data, error } = await p; if (error) throw E(error, fb); return data; };
  const token = async () => { const { data } = await sb.auth.getSession(); if (!data?.session) fail('not_signed_in'); return data.session.access_token; };
  const store = () => sb.storage.from(BUCKET);
  const upload = async (path, blob, onProgress) => {
    const contentType = blob.type || (path.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4');
    if (blob.size <= TUS_CHUNK) {
      onProgress?.(0, { loaded: 0, total: blob.size });
      await q(store().upload(path, blob, { contentType, upsert: true }), 'upload_failed');
      onProgress?.(1, { loaded: blob.size, total: blob.size });
      return;
    }
    await tusUpload({ endpoint: `${base}/storage/v1/upload/resumable`, getToken: token, apikey: cfg.anonKey, bucket: BUCKET, path, blob, contentType, onProgress, fetch: ctx.fetch });
  };
  const signed = async (paths) => {
    const ps = paths.filter(Boolean); if (!ps.length) return new Map();
    const { data, error } = await store().createSignedUrls(ps, 3600);
    if (error) return new Map();
    return new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  };
  const back = {
    kind: 'cloud',
    client: sb,
    async restore() {
      const { data } = await sb.auth.getSession();
      return (user = mapAuthUser(data?.session?.user));
    },
    async signUp(email, password, name) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: ctx.redirectTo() } });
      if (error) throw E(error);
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) fail('email_taken');
      if (!data.session) fail('confirm_email');
      return (user = mapAuthUser(data.user));
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw E(error);
      return (user = mapAuthUser(data.user));
    },
    async signOut() { const { error } = await sb.auth.signOut(); user = null; if (error && !/session/i.test(error.message || '')) throw E(error); },
    async resetPassword(email) { await q(sb.auth.resetPasswordForEmail(email, { redirectTo: ctx.redirectTo() })); },
    async updatePassword(password) { await q(sb.auth.updateUser({ password })); },
    async setName(name) { await q(sb.auth.updateUser({ data: { name } })); user = { ...user, name }; },
    async getProfileData() { return (await q(sb.from('profiles').select('data').eq('id', user.id).maybeSingle()))?.data ?? null; },
    async putProfileData(data) { await q(sb.from('profiles').upsert({ id: user.id, data, updated_at: iso() })); },
    async insertSession(s, { onProgress } = {}) {
      const id = uuid();
      const vp = s.video ? videoPath(user.id, id) : null, tp = s.thumb ? thumbPath(user.id, id) : null;
      let videoErr = null;
      if (tp) { try { await upload(tp, s.thumb); } catch (e) { /* vignette facultative */ } }
      if (vp) { try { await upload(vp, s.video, onProgress); } catch (e) { videoErr = e; } }
      const row = sessionToRow({ id, userId: user.id, ...s, videoPath: videoErr ? null : vp, thumbPath: tp });
      try { await q(sb.from('sessions').insert(row)); }
      catch (e) { try { await store().remove([vp, tp].filter(Boolean)); } catch (e2) { /* rien */ } throw e; }
      if (videoErr) {
        // L'analyse est enregistrée, la vidéo non : on le dit clairement, avec l'id de la séance.
        const why = videoErr.code === 'video_too_large' ? videoErr.message : MSG.upload_failed;
        throw new AccountError(videoErr.code || 'upload_failed', `Analyse enregistrée, mais sans la vidéo. ${why}`, { sessionId: id, cause: videoErr });
      }
      return id;
    },
    async insertMany(list) {
      const rows = list.map((s) => sessionToRow({ id: uuid(), userId: user.id, ...s }));
      for (let i = 0; i < rows.length; i += 50) await q(sb.from('sessions').insert(rows.slice(i, i + 50)));
      return rows.map((r) => r.id);
    },
    async listSessions(limit) {
      const rows = await q(sb.from('sessions').select('id, stroke, source, created_at, summary, video_path, thumb_path').order('created_at', { ascending: false }).limit(limit));
      const urls = await signed(rows.map((r) => r.thumb_path));
      return rows.map((r) => rowToItem(r, urls.get(r.thumb_path)));
    },
    async legacyKeys() {
      const rows = await q(sb.from('sessions').select('legacyKey:summary->>legacyKey').not('summary->>legacyKey', 'is', null));
      return new Set(rows.map((r) => r.legacyKey).filter(Boolean));
    },
    async getSession(id) {
      const row = await q(sb.from('sessions').select('*').eq('id', id).maybeSingle());
      if (!row) fail('not_found');
      const urls = await signed([row.thumb_path, row.video_path]);
      return { ...rowToItem(row, urls.get(row.thumb_path)), result: row.result ?? null, videoUrl: urls.get(row.video_path) || null };
    },
    async deleteSession(id) {
      const row = await q(sb.from('sessions').select('id, video_path, thumb_path').eq('id', id).maybeSingle());
      if (!row) fail('not_found');
      const files = [row.video_path, row.thumb_path].filter(Boolean);
      if (files.length) await q(store().remove(files));
      await q(sb.from('sessions').delete().eq('id', id));
    },
    async deleteAccount() {
      // 1) fichiers (l'API de stockage est obligatoire pour effacer des objets), 2) compte via la fonction SQL
      // delete_my_account() qui supprime l'utilisateur (profil et séances suivent par ON DELETE CASCADE).
      for (;;) {
        const files = await q(store().list(user.id, { limit: 100 }));
        if (!files?.length) break;
        await q(store().remove(files.map((f) => `${user.id}/${f.name}`)));
        if (files.length < 100) break;
      }
      await q(sb.rpc('delete_my_account'));
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* le compte n'existe plus */ }
      user = null;
    },
  };
  sb.auth.onAuthStateChange((event, session) => {
    // Rappel synchrone (recommandé par Supabase) ; on prévient l'app hors de la pile
    const u = mapAuthUser(session?.user);
    setTimeout(() => ctx.onAuth(event, u), 0);
  });
  return back;
}

// ---------------------------------------------------------------------------------------------
// Ancien historique (avant les comptes) : clés localStorage de progression.js, eleves.js, app.js/state.js
export const LEGACY_KEYS = { history: 'kyron-history', goals: 'kyron-goals', eleves: 'kyron-eleves', profile: 'kyron-profile', mode: 'kyron-mode' };
function summaryFromEntry(e) {
  const by = e?.byType && typeof e.byType === 'object' ? e.byType : {};
  const types = Object.entries(by).filter(([, v]) => v && typeof v === 'object');
  const strokes = Object.fromEntries(types.map(([t, v]) => [t, v.n ?? null]));
  let sw = 0, sc = 0;
  for (const [, v] of types) { const s = v.m?.score; if (Number.isFinite(s)) { sw += v.n || 1; sc += s * (v.n || 1); } }
  const metrics = Object.fromEntries(types.map(([t, v]) => [t, v.m || {}]));
  const dominant = types.sort((a, b) => (b[1].n || 0) - (a[1].n || 0))[0]?.[0] ?? null;
  return { dominant, summary: { score: sw ? Math.round(sc / sw) : null, count: e?.count ?? null, strokes, metrics, label: e?.label || '', legacy: true } };
}
// Lit les anciennes clés et produit { profile: patch|null, sessions: [...] } (pur, testé)
export function legacyToImport(read) {
  const sessions = [];
  const hist = read(LEGACY_KEYS.history);
  if (Array.isArray(hist)) {
    for (const e of hist) {
      if (!e || !e.id || e.source === 'exemple' || String(e.id).startsWith('ex')) continue;
      const { dominant, summary } = summaryFromEntry(e);
      sessions.push({ stroke: dominant, source: e.multi ? '2cam' : 'video', createdAt: iso(e.date), summary: { ...summary, legacyKey: `history:${e.id}` }, result: { legacy: true, from: 'progression', entry: e } });
    }
  }
  const el = read(LEGACY_KEYS.eleves);
  if (el && Array.isArray(el.students)) {
    for (const st of el.students) {
      if (!st || st.example) continue;
      for (const s of st.sessions || []) {
        if (!s || s.source === 'exemple') continue;
        const { dominant, summary } = summaryFromEntry(s.entry || {});
        sessions.push({
          stroke: dominant, source: 'video', createdAt: iso(s.date),
          summary: { ...summary, label: s.label || summary.label, student: { id: st.id, name: st.name, level: st.level }, legacyKey: `eleves:${st.id}:${s.id}` },
          result: { legacy: true, from: 'eleves', student: { id: st.id, name: st.name, level: st.level }, entry: s.entry || null, corrections: s.corrections || [], notes: s.notes || [] },
        });
      }
    }
  }
  let profile = null;
  const p = read(LEGACY_KEYS.profile);
  if (p && typeof p === 'object') {
    profile = {};
    if (Number.isFinite(+p.height)) profile.heightCm = +p.height;
    if (Number.isFinite(+p.weight)) profile.massKg = +p.weight;
    if (p.hand) profile.hand = p.hand === 'left' ? 'L' : 'R';
    if (p.level) profile.level = { loisir: 'amateur', club: 'amateur', competition: 'competition', pro: 'pro' }[p.level] || 'amateur';
  }
  const mode = read(LEGACY_KEYS.mode);
  if (mode === 'adv' || mode === 'simple') (profile ||= {}).mode = mode === 'adv' ? 'expert' : 'simple';
  const goals = read(LEGACY_KEYS.goals);
  if (goals && typeof goals === 'object' && Object.keys(goals).length) (profile ||= {}).goals = goals;
  return { profile, sessions };
}

// ---------------------------------------------------------------------------------------------
// Fabrique (les dépendances sont injectables pour les tests) et instance unique `account`
export function createAccount(opts = {}) {
  const config = opts.config ?? SUPABASE;
  const kv = opts.kv ?? webKv();
  const ctx = {
    kv,
    iterations: opts.iterations ?? PBKDF2_ITERATIONS,
    fetch: opts.fetch ?? ((...a) => globalThis.fetch(...a)),
    loadClient: opts.loadClient ?? (() => import('../lib/supabase.js')),
    redirectTo: opts.redirectTo ?? (() => { try { return location.origin + location.pathname; } catch (e) { return undefined; } }),
    onAuth: (event, u) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      if (event === 'PASSWORD_RECOVERY') state.recovering = true;
      if (event === 'SIGNED_OUT' && !u) { if (state.user) setUser(null, event); return; }
      if (u && (u.id !== state.user?.id || event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED')) setUser({ ...u, name: state.user?.id === u.id ? state.user.name : u.name }, event);
    },
  };
  const maxVideo = opts.maxVideoBytes ?? (Number.isFinite(+config?.maxVideoMB) && +config.maxVideoMB > 0 ? +config.maxVideoMB * MB : MAX_VIDEO_BYTES);
  const maxResult = opts.maxResultBytes ?? MAX_RESULT_BYTES;
  const subs = new Set();
  const state = { backend: null, user: null, persistent: true, initP: null, recovering: false };
  const setUser = (u, event) => {
    const changed = (u?.id || null) !== (state.user?.id || null) || event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED';
    state.user = u;
    if (changed) for (const fn of [...subs]) { try { fn(u, { event }); } catch (e) { console.warn('[kyron] compte', e); } }
  };
  const need = () => { if (!state.user) fail('not_signed_in'); return state.backend; };
  const wrap = async (fn) => { try { return await fn(); } catch (e) { throw mapSupabaseError(e); } };
  const credentials = ({ email, password } = {}) => {
    const em = normEmail(email);
    if (!validEmail(em)) fail('invalid_email');
    if (typeof password !== 'string' || !password) fail('invalid_credentials', 'Saisis ton mot de passe.');
    return em;
  };

  async function initLocal() {
    let db;
    try { db = await (opts.openDb ?? (() => idbDb()))(); } catch (e) { db = null; }
    if (!db) { db = memoryDb(); console.warn('[kyron] IndexedDB indisponible : comptes et séances gardés en mémoire seulement.'); }
    state.persistent = !!db.persistent && kv.persistent !== false;
    return localBackend({ ...ctx, db });
  }

  const api = {
    get backend() { return state.backend?.kind ?? 'local'; },
    get persistent() { return state.persistent; },
    // true après un lien « mot de passe oublié » (cloud) : l'app doit proposer updatePassword()
    get recovering() { return state.recovering; },
    get ready() { return !!state.backend; },
    async init() {
      state.initP ||= (async () => {
        const filled = !!(config && String(config.url || '').trim() && String(config.anonKey || '').trim());
        if (filled) {
          try { state.backend = await cloudBackend(ctx, { ...config, url: String(config.url).trim(), anonKey: String(config.anonKey).trim() }); state.persistent = true; }
          catch (e) { console.warn('[kyron] client Supabase indisponible, repli en mode local', e); state.backend = null; }
        }
        if (!state.backend) state.backend = await initLocal();
        let u = null;
        try { u = await state.backend.restore(); } catch (e) { u = null; }
        state.user = u;
        if (u) for (const fn of [...subs]) { try { fn(u, { event: 'RESTORED' }); } catch (e) { /* rien */ } }
        return u;
      })();
      return state.initP;
    },
    async signUp({ email, password, name } = {}) {
      await api.init();
      const em = normEmail(email);
      if (!validEmail(em)) fail('invalid_email');
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) fail('weak_password');
      const nm = String(name ?? '').trim().slice(0, 60) || em.split('@')[0];
      const u = await wrap(() => state.backend.signUp(em, password, nm));
      setUser(u, 'SIGNED_IN');
      try { const p = await state.backend.getProfileData(); if (!p) await state.backend.putProfileData(normProfile({ name: nm }, defaultProfile(nm))); } catch (e) { /* profil créé plus tard */ }
      return u;
    },
    async signIn({ email, password } = {}) {
      await api.init();
      const em = credentials({ email, password });
      const u = await wrap(() => state.backend.signIn(em, password));
      try { const p = await state.backend.getProfileData(); if (p?.name) u.name = p.name; } catch (e) { /* rien */ }
      setUser(u, 'SIGNED_IN');
      return u;
    },
    async signOut() {
      await api.init();
      await wrap(() => state.backend.signOut());
      state.recovering = false;
      setUser(null, 'SIGNED_OUT');
    },
    async resetPassword(email) {
      await api.init();
      const em = normEmail(email);
      if (!validEmail(em)) fail('invalid_email');
      await wrap(() => state.backend.resetPassword(em));
    },
    // Ajout : nouveau mot de passe pour l'utilisateur connecté (après un lien de réinitialisation en mode cloud)
    async updatePassword(password) {
      await api.init(); need();
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) fail('weak_password');
      await wrap(() => state.backend.updatePassword(password));
      state.recovering = false;
    },
    user() { return state.user ? { ...state.user } : null; },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },

    async getProfile() {
      await api.init(); const b = need();
      const d = await wrap(() => b.getProfileData());
      return normProfile(d || {}, defaultProfile(state.user.name));
    },
    async saveProfile(patch = {}) {
      await api.init(); const b = need();
      const cur = await wrap(() => b.getProfileData());
      const next = normProfile(patch, normProfile(cur || {}, defaultProfile(state.user.name)));
      await wrap(() => b.putProfileData(next));
      if (next.name && next.name !== state.user.name) {
        try { await b.setName(next.name); } catch (e) { /* le profil fait foi */ }
        state.user = { ...state.user, name: next.name };
      }
      return next;
    },

    async saveSession(s, { onProgress } = {}) {
      await api.init(); const b = need();
      checkSession(s);
      for (const [k, v] of [['video', s.video], ['thumb', s.thumb]]) if (v != null && !isBlob(v)) fail('invalid_session', `Le champ « ${k} » doit être un fichier (Blob).`);
      if (s.video && s.video.size > maxVideo) fail('video_too_large', tooLargeMessage(s.video.size, maxVideo), { size: s.video.size, max: maxVideo });
      if (s.thumb && s.thumb.size > 5 * MB) s = { ...s, thumb: null };
      const clean = {
        stroke: s.stroke == null ? null : String(s.stroke).slice(0, 40), source: s.source, createdAt: iso(s.createdAt),
        summary: stripResult(s.summary ?? {}, { maxBytes: 64 * 1024 }) || {}, result: stripResult(s.result, { maxBytes: maxResult }),
        video: s.video || null, thumb: s.thumb || null,
      };
      return wrap(() => b.insertSession(clean, { onProgress }));
    },
    async listSessions({ limit = 50 } = {}) {
      await api.init(); const b = need();
      return wrap(() => b.listSessions(Math.max(1, Math.min(1000, +limit || 50))));
    },
    async getSession(id) { await api.init(); const b = need(); return wrap(() => b.getSession(String(id))); },
    async deleteSession(id) { await api.init(); const b = need(); await wrap(() => b.deleteSession(String(id))); },
    async deleteAccount() {
      await api.init(); const b = need();
      await wrap(() => b.deleteAccount());
      const claim = kv.get(LEGACY_CLAIM, {}) || {};
      if (claim[b.kind] === state.user?.id) { delete claim[b.kind]; kv.set(LEGACY_CLAIM, claim); }
      setUser(null, 'SIGNED_OUT');
    },

    // Reprend l'ancien historique de cet appareil dans le compte connecté. Une seule fois par appareil et par moteur :
    // le premier compte qui le reprend le « réclame » (sur une tablette partagée, l'historique ne se copie pas
    // dans chaque compte). Rejouable sans doublon (clé legacyKey dans summary). Les anciennes clés ne sont pas effacées.
    async migrateLegacy() {
      await api.init(); const b = need();
      const claim = kv.get(LEGACY_CLAIM, {}) || {};
      if (claim[b.kind] && claim[b.kind] !== state.user.id) return { imported: 0, skipped: 0, reason: 'already_claimed' };
      const legacy = opts.legacyRead ?? ((k) => kv.get(k, null));
      const { profile, sessions } = legacyToImport(legacy);
      if (!sessions.length && !profile) return { imported: 0, skipped: 0, reason: 'nothing' };
      const have = await wrap(() => b.legacyKeys());
      const todo = sessions.filter((s) => !have.has(s.summary.legacyKey)).map((s) => ({ ...s, result: stripResult(s.result, { maxBytes: maxResult }) }));
      if (todo.length) await wrap(() => b.insertMany(todo));
      if (profile) {
        const cur = normProfile((await wrap(() => b.getProfileData())) || {}, defaultProfile(state.user.name));
        if (!cur.legacyImported) {
          // L'ancien profil ne remplace que ce que l'utilisateur n'a pas déjà renseigné lui-même
          const patch = cur.onboarded ? { goals: cur.goals ?? profile.goals } : { ...profile, goals: cur.goals ?? profile.goals };
          if (patch.goals === undefined) delete patch.goals;
          await wrap(() => b.putProfileData(normProfile({ ...patch, legacyImported: true }, cur)));
        }
      }
      kv.set(LEGACY_CLAIM, { ...claim, [b.kind]: state.user.id });
      return { imported: todo.length, skipped: sessions.length - todo.length };
    },
  };
  return api;
}

export const account = createAccount();
