// KYRON · tests des comptes et données (app/ui/account.js).  Exécution : node tests/account.test.mjs
// Sans dépendance ni réseau. Le moteur local tourne sur la base mémoire (même logique que IndexedDB, via l'adaptateur).
// Le moteur Supabase n'est PAS exercé contre un vrai serveur : on teste ses fonctions de correspondance, l'envoi
// reprenable (fetch simulé) et le choix du moteur avec un faux client.
// Les tests créent leurs instances avec config vide : ils ne dépendent pas du contenu de app/config.js.

import {
  createAccount, memoryDb, webKv, stripResult, legacyToImport, normProfile, sessionToRow, rowToItem, mapAuthUser,
  mapSupabaseError, tusUpload, hashPassword, verifyPassword, AccountError, videoPath, thumbPath, LEGACY_KEYS,
} from '../app/ui/account.js';

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);
const rejects = async (p, code) => { try { await p; return null; } catch (e) { return e instanceof AccountError && e.code === code ? e : (console.log('    erreur reçue :', e.code, e.message), null); } };
const fakeLs = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const LOCAL = { url: '', anonKey: '' };
const mk = (o = {}) => { const ls = o.ls || fakeLs(); const db = o.db || memoryDb(); return { ls, db, acc: createAccount({ config: LOCAL, kv: webKv(ls), openDb: async () => db, iterations: 2000, ...o.opts }) }; };

section('1. Mot de passe local (PBKDF2)');
{
  const h = await hashPassword('secret-123', { iterations: 1000 });
  ok(h.hash && h.salt && !JSON.stringify(h).includes('secret-123'), 'le mot de passe n’est pas stocké en clair');
  ok(await verifyPassword('secret-123', h), 'bon mot de passe accepté');
  ok(!(await verifyPassword('secret-124', h)), 'mauvais mot de passe refusé');
  const h2 = await hashPassword('secret-123', { iterations: 1000 });
  ok(h2.salt !== h.salt && h2.hash !== h.hash, 'sel aléatoire : deux empreintes différentes');
  const def = await hashPassword('x');
  ok(def.iterations === 150000, '150 000 itérations par défaut');
}

section('2. Inscription, connexion, erreurs');
{
  const { acc, ls, db } = mk();
  ok((await acc.init()) === null && acc.backend === 'local', 'config vide → mode local, personne de connecté');
  const events = [];
  const off = acc.onChange((u, e) => events.push([u?.email ?? null, e.event]));
  ok(await rejects(acc.signUp({ email: 'pas-un-email', password: 'abcdefgh' }), 'invalid_email'), 'email invalide refusé');
  ok(await rejects(acc.signUp({ email: 'a@b.fr', password: 'court' }), 'weak_password'), 'mot de passe trop court refusé');
  const u = await acc.signUp({ email: ' Lea@Club.FR ', password: 'motdepasse', name: 'Léa' });
  ok(u.email === 'lea@club.fr' && u.name === 'Léa' && u.id, 'inscription : email normalisé, nom gardé', u.id.slice(0, 8));
  ok(acc.user()?.id === u.id, 'connecté après inscription');
  const stored = await db.get('users', 'lea@club.fr');
  ok(stored && !JSON.stringify(stored).includes('motdepasse'), 'compte local stocké sans mot de passe en clair');
  const dup = await rejects(acc.signUp({ email: 'lea@club.fr', password: 'autrechose' }), 'email_taken');
  ok(dup && /existe déjà/.test(dup.message), 'email déjà utilisé refusé (message français)', dup?.message);
  await acc.signOut();
  ok(acc.user() === null, 'déconnexion');
  const bad = await rejects(acc.signIn({ email: 'lea@club.fr', password: 'faux-mot' }), 'invalid_credentials');
  ok(bad?.message === 'Email ou mot de passe incorrect.', 'mauvais mot de passe : « Email ou mot de passe incorrect. »');
  ok(await rejects(acc.signIn({ email: 'inconnu@club.fr', password: 'motdepasse' }), 'invalid_credentials'), 'email inconnu : même message (pas d’indice)');
  const u2 = await acc.signIn({ email: 'LEA@club.fr', password: 'motdepasse' });
  ok(u2.id === u.id, 'connexion (email insensible à la casse)');
  ok(JSON.stringify(events) === JSON.stringify([['lea@club.fr', 'SIGNED_IN'], [null, 'SIGNED_OUT'], ['lea@club.fr', 'SIGNED_IN']]), 'onChange : connexion / déconnexion / connexion', JSON.stringify(events));
  off();
  const reset = await rejects(acc.resetPassword('lea@club.fr'), 'local_unsupported');
  ok(reset && /mode local/.test(reset.message), 'mot de passe oublié en local : message clair');
  // Restauration de la session (nouvelle instance, même navigateur)
  const again = createAccount({ config: LOCAL, kv: webKv(ls), openDb: async () => db, iterations: 2000 });
  const r = await again.init();
  ok(r?.id === u.id && again.user()?.email === 'lea@club.fr', 'init() restaure la session enregistrée');
  ok(again.persistent === false, 'base mémoire → persistent === false');
  const noIdb = createAccount({ config: LOCAL, kv: webKv(fakeLs()), openDb: async () => { throw new Error('pas d’IndexedDB'); } });
  await noIdb.init();
  ok(noIdb.backend === 'local' && noIdb.persistent === false, 'sans IndexedDB : repli mémoire signalé');
  ok(await rejects(noIdb.listSessions(), 'not_signed_in'), 'action sans être connecté : not_signed_in');
}

section('3. Profil');
{
  const { acc } = mk();
  await acc.signUp({ email: 'hugo@club.fr', password: 'motdepasse', name: 'Hugo' });
  const p0 = await acc.getProfile();
  ok(p0.name === 'Hugo' && p0.level === 'amateur' && p0.hand === 'R' && p0.mode === 'simple' && p0.onboarded === false, 'profil par défaut', JSON.stringify(p0));
  const p1 = await acc.saveProfile({ level: 'coach', hand: 'L', heightCm: 187.4, massKg: 400, racket: 'Pure Aero', mode: 'expert', onboarded: true });
  ok(p1.level === 'coach' && p1.hand === 'L' && p1.heightCm === 187 && p1.massKg === 200 && p1.racket === 'Pure Aero', 'enregistrement validé (arrondi, bornes)');
  const p2 = await acc.saveProfile({ name: 'Hugo B.', level: 'n’importe quoi' });
  ok(p2.name === 'Hugo B.' && p2.level === 'amateur' && p2.hand === 'L' && p2.onboarded === true, 'patch partiel : le reste est conservé, valeur invalide corrigée');
  ok((await acc.getProfile()).name === 'Hugo B.' && acc.user().name === 'Hugo B.', 'relu identique, nom du compte mis à jour');
  ok(normProfile({ hand: 'left', mode: 'adv', level: 'club' }).hand === 'L' && normProfile({ mode: 'adv' }).mode === 'expert', 'anciens formats acceptés (left / adv / club)');
}

section('4. Séances : enregistrer, lister, relire, supprimer');
{
  const { acc } = mk();
  await acc.signUp({ email: 'ines@club.fr', password: 'motdepasse' });
  const vid = new Blob([new Uint8Array(1000)], { type: 'video/mp4' }), th = new Blob([new Uint8Array(50)], { type: 'image/jpeg' });
  const prog = [];
  const a = await acc.saveSession({ stroke: 'serve', source: 'video', createdAt: '2026-11-01T10:00:00Z', summary: { score: 70 }, result: { score: 70 }, video: vid, thumb: th }, { onProgress: (r) => prog.push(r) });
  const b = await acc.saveSession({ stroke: 'forehand', source: 'demo', createdAt: '2026-11-03T10:00:00Z', summary: { score: 80 }, result: { score: 80 } });
  const c = await acc.saveSession({ stroke: 'backhand', source: '2cam', createdAt: new Date('2026-11-02T10:00:00Z'), summary: { score: 75 }, result: { score: 75 } });
  ok(prog.at(-1) === 1, 'onProgress appelé jusqu’à 1');
  const list = await acc.listSessions({ limit: 10 });
  ok(list.map((s) => s.id).join() === [b, c, a].join(), 'liste du plus récent au plus ancien');
  ok(list[2].hasVideo === true && typeof list[2].thumbUrl === 'string' && list[0].hasVideo === false && list[0].thumbUrl === null, 'hasVideo / thumbUrl');
  ok(JSON.stringify(Object.keys(list[0]).sort()) === JSON.stringify(['createdAt', 'hasVideo', 'id', 'source', 'stroke', 'summary', 'thumbUrl']), 'forme des éléments de liste conforme au contrat');
  ok((await acc.listSessions({ limit: 2 })).length === 2, 'limit respecté');
  const g = await acc.getSession(a);
  ok(g.result?.score === 70 && g.summary.score === 70 && g.stroke === 'serve' && typeof g.videoUrl === 'string' && g.videoUrl.startsWith('blob:'), 'getSession : result + videoUrl (URL d’objet)');
  ok((await acc.getSession(b)).videoUrl === null, 'sans vidéo : videoUrl null');
  ok(await rejects(acc.saveSession({ stroke: 'serve', source: 'cinéma', summary: {}, result: {} }), 'invalid_session'), 'source inconnue refusée');
  const big = { size: 400 * 1024 * 1024, type: 'video/mp4' };
  Object.setPrototypeOf(big, Blob.prototype);
  const tooBig = await rejects(acc.saveSession({ stroke: 'serve', source: 'video', summary: {}, result: {}, video: big }), 'video_too_large');
  ok(tooBig && /300 Mo/.test(tooBig.message), 'vidéo > 300 Mo refusée avant tout envoi', tooBig?.message);
  await acc.deleteSession(c);
  ok((await acc.listSessions({ limit: 10 })).map((s) => s.id).join() === [b, a].join(), 'suppression');
  ok(await rejects(acc.getSession(c), 'not_found'), 'séance supprimée : not_found');
  // Isolation entre comptes du même appareil
  await acc.signOut();
  await acc.signUp({ email: 'autre@club.fr', password: 'motdepasse' });
  ok((await acc.listSessions()).length === 0, 'un autre compte ne voit pas ces séances');
  ok(await rejects(acc.getSession(a), 'not_found'), 'ni par son id');
  ok(await rejects(acc.deleteSession(a), 'not_found'), 'et ne peut pas la supprimer');
  await acc.deleteAccount();
  ok(acc.user() === null && await rejects(acc.signIn({ email: 'autre@club.fr', password: 'motdepasse' }), 'invalid_credentials'), 'deleteAccount : compte effacé et déconnecté');
  const back = await acc.signIn({ email: 'ines@club.fr', password: 'motdepasse' });
  ok(back && (await acc.listSessions()).length === 2, 'les données des autres comptes restent intactes');
}

section('5. Réduction de result');
{
  const frames = Array.from({ length: 2400 }, (_, i) => ({ t: i / 120, img: Array.from({ length: 33 }, (_, k) => ({ x: Math.random(), y: Math.random(), v: 0.987654321 })), world: Array.from({ length: 33 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() })) }));
  const res = { score: 72.123456789, metrics: { kneeFlex: 41.000000001 }, frames, buf: new Float32Array(100000), small: new Float32Array([1.5, 2.5]), fn: () => 1, nan: NaN, when: new Date('2026-11-13T00:00:00Z') };
  res.self = res;
  const before = JSON.stringify({ ...res, self: undefined }).length;
  const out = stripResult(res, { maxBytes: 2.5 * 1024 * 1024 });
  const size = JSON.stringify(out).length;
  ok(size <= 2.5 * 1024 * 1024, 'résultat ramené sous 2,5 Mo', `${(before / 1048576).toFixed(1)} Mo → ${(size / 1048576).toFixed(2)} Mo`);
  ok(out.framesDropped === true && out.frames === null && out.droppedPaths.includes('frames'), 'frames retirées et signalées (framesDropped)');
  ok(out.score === 72.12346 && out.metrics.kneeFlex === 41, 'scalaires gardés (7 chiffres significatifs)');
  ok(!('buf' in out) && out.droppedPaths.includes('buf') && JSON.stringify(out.small) === '[1.5,2.5]', 'long tableau typé retiré, court converti');
  ok(!('fn' in out) && out.nan === null && out.when === '2026-11-13T00:00:00.000Z' && !('self' in out), 'fonctions, NaN, dates, cycles gérés');
  const small = stripResult({ score: 1, frames: frames.slice(0, 20) });
  ok(Array.isArray(small.frames) && small.frames.length === 20 && !small.framesDropped, 'petit résultat : landmarks conservés');
  const nested = stripResult({ strokes: [{ res: { score: 1 }, frames }, { res: { score: 2 }, frames }] }, { maxBytes: 200 * 1024 });
  ok(nested.strokes.length === 2 && nested.strokes[1].res.score === 2 && nested.strokes[0].frames === null, 'imbriqué : on retire les frames, pas la liste des coups');
  ok(stripResult(null) === null, 'null → null');
  const { acc } = mk();
  await acc.signUp({ email: 'big@club.fr', password: 'motdepasse' });
  const id = await acc.saveSession({ stroke: 'serve', source: 'video', summary: { score: 1 }, result: res });
  const g = await acc.getSession(id);
  ok(g.result.framesDropped === true && JSON.stringify(g.result).length <= 2.5 * 1048576, 'saveSession applique la réduction');
}

section('6. Reprise de l’ancien historique (migrateLegacy)');
{
  const entry = (id, date, extra = {}) => ({ id, date, label: '', source: 'video', multi: false, count: 8, byType: { serve: { n: 5, m: { score: 70, racketKmh: 130 }, exercises: [] }, forehand: { n: 3, m: { score: 60 }, exercises: [] } }, fatigue: null, ...extra });
  const ls = fakeLs();
  ls.setItem(LEGACY_KEYS.history, JSON.stringify([entry('s1', '2026-10-01T10:00:00Z'), entry('s2', '2026-10-05T10:00:00Z', { multi: true }), entry('ex3', '2026-10-06T10:00:00Z', { source: 'exemple' })]));
  ls.setItem(LEGACY_KEYS.eleves, JSON.stringify({ students: [
    { id: 'st1', name: 'Tom', level: 'club', sessions: [{ id: 'a1', date: '2026-09-01T10:00:00Z', label: 'Séance 1', source: 'video', entry: { byType: { backhand: { n: 4, m: { score: 50 } } }, count: 4 }, corrections: [{ key: 'legs' }], notes: [] }] },
    { id: 'st2', name: 'Léa (exemple)', example: true, sessions: [{ id: 'z', date: '2026-09-01T10:00:00Z', entry: {} }] },
  ] }));
  ls.setItem(LEGACY_KEYS.profile, JSON.stringify({ height: 191, weight: 82, hand: 'left', level: 'club' }));
  ls.setItem(LEGACY_KEYS.mode, JSON.stringify('adv'));
  ls.setItem(LEGACY_KEYS.goals, JSON.stringify({ serve: { score: 85 } }));
  const imp = legacyToImport((k) => JSON.parse(ls.getItem(k)));
  ok(imp.sessions.length === 3, 'exemples ignorés : 2 séances + 1 séance d’élève');
  ok(imp.sessions[0].stroke === 'serve' && imp.sessions[0].summary.score === 66 && imp.sessions[1].source === '2cam', 'coup dominant, score moyen pondéré, multi → 2cam', `score ${imp.sessions[0].summary.score}`);
  ok(imp.sessions[2].summary.student?.name === 'Tom' && imp.sessions[2].result.corrections.length === 1, 'séance d’élève : élève et corrections gardés');
  ok(imp.profile.heightCm === 191 && imp.profile.hand === 'L' && imp.profile.level === 'amateur' && imp.profile.mode === 'expert' && imp.profile.goals.serve.score === 85, 'ancien profil converti');

  const db = memoryDb();
  const acc = createAccount({ config: LOCAL, kv: webKv(ls), openDb: async () => db, iterations: 2000 });
  await acc.signUp({ email: 'marceau@club.fr', password: 'motdepasse' });
  const r1 = await acc.migrateLegacy();
  ok(r1.imported === 3, 'premier passage : 3 séances importées', JSON.stringify(r1));
  const r2 = await acc.migrateLegacy();
  ok(r2.imported === 0 && r2.skipped === 3, 'deuxième passage : aucun doublon (idempotent)', JSON.stringify(r2));
  const list = await acc.listSessions({ limit: 50 });
  ok(list.length === 3 && list[0].createdAt === '2026-10-05T10:00:00.000Z', 'séances importées listées par date');
  const p = await acc.getProfile();
  ok(p.heightCm === 191 && p.hand === 'L' && p.mode === 'expert' && p.legacyImported === true && p.goals.serve.score === 85, 'profil repris (non encore renseigné)');
  ok(JSON.parse(ls.getItem(LEGACY_KEYS.history)).length === 3, 'anciennes clés laissées en place');
  await acc.signOut();
  await acc.signUp({ email: 'frere@club.fr', password: 'motdepasse' });
  const r3 = await acc.migrateLegacy();
  ok(r3.imported === 0 && r3.reason === 'already_claimed' && (await acc.listSessions()).length === 0, 'un 2e compte du même appareil ne récupère pas l’historique');
  // Profil déjà renseigné : l'ancien ne l'écrase pas
  const { acc: acc2, ls: ls2 } = mk();
  ls2.setItem(LEGACY_KEYS.profile, JSON.stringify({ height: 150, hand: 'left' }));
  await acc2.signUp({ email: 'x@club.fr', password: 'motdepasse' });
  await acc2.saveProfile({ heightCm: 175, onboarded: true });
  await acc2.migrateLegacy();
  const p2 = await acc2.getProfile();
  ok(p2.heightCm === 175 && p2.hand === 'R', 'profil déjà rempli par l’utilisateur : pas écrasé');
}

section('7. Supabase : correspondances (sans serveur)');
{
  const row = sessionToRow({ id: 'i1', userId: 'u1', stroke: 'serve', source: 'video', createdAt: '2026-11-13T09:00:00+01:00', summary: { score: 3 }, result: { a: 1 }, videoPath: videoPath('u1', 'i1'), thumbPath: thumbPath('u1', 'i1') });
  ok(row.user_id === 'u1' && row.created_at === '2026-11-13T08:00:00.000Z' && row.video_path === 'u1/i1.mp4' && row.thumb_path === 'u1/i1.jpg', 'séance → ligne (snake_case, chemins {user}/{id}.mp4|.jpg)');
  const it = rowToItem({ ...row, created_at: '2026-11-13T08:00:00+00:00' }, 'https://signed/t');
  ok(it.createdAt === '2026-11-13T08:00:00.000Z' && it.hasVideo && it.thumbUrl === 'https://signed/t' && !('result' in it), 'ligne → élément de liste');
  ok(mapAuthUser({ id: 'u', email: 'a@b.fr', user_metadata: { name: 'Al' } }).name === 'Al' && mapAuthUser({ id: 'u', email: 'zoe@b.fr', user_metadata: {} }).name === 'zoe' && mapAuthUser(null) === null, 'utilisateur Supabase → { id, email, name }');
  const cases = [
    [{ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }, 'invalid_credentials'],
    [{ code: 'user_already_exists', message: 'User already registered', status: 422 }, 'email_taken'],
    [{ code: 'email_not_confirmed', message: 'Email not confirmed' }, 'email_not_confirmed'],
    [{ code: 'weak_password', message: 'Password should be at least 6 characters' }, 'weak_password'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'rate_limited'],
    [{ statusCode: '413', message: 'The object exceeded the maximum allowed size' }, 'video_too_large'],
    [{ code: '42P01', message: 'relation "public.sessions" does not exist' }, 'setup_missing'],
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, 'network'],
    [new TypeError('Failed to fetch'), 'network'],
  ];
  for (const [e, code] of cases) { const m = mapSupabaseError(e); ok(m.code === code && m.message && !/[A-Z][a-z]+ [a-z]+ [a-z]+ credentials/.test(m.message), `erreur ${e.code || e.name || e.statusCode} → ${code}`, m.message); }
  const unk = mapSupabaseError({ message: 'boom' });
  ok(unk.code === 'unknown' && /boom/.test(unk.message), 'erreur inconnue : message générique + détail');
}

section('8. Envoi reprenable (TUS simulé)');
{
  const size = 15 * 1024 * 1024 + 123;
  const blob = new Blob([new Uint8Array(size)], { type: 'video/mp4' });
  let server = 0, failOnce = true;
  const calls = [];
  const H = (o) => ({ get: (k) => o[k] ?? o[k.toLowerCase()] ?? null });
  const fakeFetch = async (url, init) => {
    calls.push(`${init.method} ${init.headers['Upload-Offset'] ?? ''}`.trim());
    if (init.method === 'POST') {
      const meta = Object.fromEntries(init.headers['Upload-Metadata'].split(',').map((p) => { const [k, v] = p.split(' '); return [k, atob(v)]; }));
      if (meta.bucketName !== 'videos' || meta.objectName !== 'u1/i1.mp4' || init.headers.authorization !== 'Bearer tok' || +init.headers['Upload-Length'] !== size) return { ok: false, status: 400, headers: H({}), text: async () => 'bad' };
      return { ok: true, status: 201, headers: H({ Location: '/storage/v1/upload/resumable/abc' }) };
    }
    if (init.method === 'HEAD') return { ok: true, status: 200, headers: H({ 'Upload-Offset': String(server) }) };
    if (init.method === 'PATCH') {
      if (!url.endsWith('/storage/v1/upload/resumable/abc')) throw new Error('mauvaise URL ' + url);
      if (+init.headers['Upload-Offset'] !== server) return { ok: false, status: 409, headers: H({}), text: async () => 'offset' };
      if (server > 0 && failOnce) { failOnce = false; server += 1024 * 1024; throw new TypeError('Failed to fetch'); } // coupure en plein morceau
      server += init.body.size;
      return { ok: true, status: 204, headers: H({ 'Upload-Offset': String(server) }) };
    }
  };
  const prog = [];
  await tusUpload({ endpoint: 'https://x.supabase.co/storage/v1/upload/resumable', getToken: async () => 'tok', apikey: 'anon', bucket: 'videos', path: 'u1/i1.mp4', blob, contentType: 'video/mp4', onProgress: (r) => prog.push(r), fetch: fakeFetch, sleep: async () => {} });
  ok(server === size, 'fichier de 15 Mo envoyé en entier', `${calls.length} requêtes : ${calls.join(' · ')}`);
  ok(calls.includes('HEAD'), 'coupure réseau → reprise à l’offset du serveur (HEAD)');
  ok(prog[0] === 0 && prog.at(-1) === 1 && prog.every((v, i) => i === 0 || v >= prog[i - 1]), 'progression croissante de 0 à 1');
  const e413 = await rejects(tusUpload({ endpoint: 'https://x/storage/v1/upload/resumable', getToken: async () => 't', apikey: 'a', bucket: 'videos', path: 'p', blob, fetch: async () => ({ ok: false, status: 413, headers: H({}), text: async () => 'Payload too large' }), sleep: async () => {} }), 'video_too_large');
  ok(e413 && /50 Mo/.test(e413.message), 'refus 413 du serveur → video_too_large, message clair', e413?.message);
  let n = 0;
  const down = await rejects(tusUpload({ endpoint: 'https://x/storage/v1/upload/resumable', getToken: async () => 't', apikey: 'a', bucket: 'videos', path: 'p', blob, retries: 2, sleep: async () => {},
    fetch: async (u, i) => { n++; if (i.method === 'POST') return { ok: true, status: 201, headers: H({ Location: 'https://x/up/1' }) }; throw new TypeError('Failed to fetch'); } }), 'network');
  ok(down && n > 3, 'réseau coupé durablement : abandon après les essais, erreur network');
}

section('9. Choix du moteur');
{
  const cloudCfg = { url: 'https://demo.supabase.co', anonKey: 'anon' };
  const brokenClient = createAccount({ config: cloudCfg, kv: webKv(fakeLs()), openDb: async () => memoryDb(), loadClient: async () => { throw new Error('404'); } });
  await brokenClient.init();
  ok(brokenClient.backend === 'local', 'config remplie mais client introuvable → repli local');
  let created = null;
  const fake = {
    createClient: (url, key, o) => { created = { url, key, o }; return {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signUp: async () => ({ data: { user: { id: 'u', email: 'a@b.fr', identities: [{}] }, session: null }, error: null }),
        signInWithPassword: async () => ({ data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } }),
      },
    }; },
  };
  const cloud = createAccount({ config: cloudCfg, kv: webKv(fakeLs()), loadClient: async () => fake, redirectTo: () => 'https://app/' });
  ok((await cloud.init()) === null && cloud.backend === 'cloud' && created.url === 'https://demo.supabase.co' && created.o.auth.persistSession, 'config remplie + client chargé → cloud');
  const conf = await rejects(cloud.signUp({ email: 'a@b.fr', password: 'motdepasse' }), 'confirm_email');
  ok(conf && /confirmation/.test(conf.message), 'inscription avec confirmation email activée → confirm_email (message clair)');
  ok(await rejects(cloud.signIn({ email: 'a@b.fr', password: 'faux-mot' }), 'invalid_credentials'), 'erreur Supabase traduite (Email ou mot de passe incorrect.)');
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
