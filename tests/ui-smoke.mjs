// KYRON · test de fumée de l'interface (navigateur réel). Pas lancé par tests/run.mjs (il faut Playwright + Chromium).
// Usage : node tests/ui-smoke.mjs            (sert le dépôt sur un port libre, iPhone 13 puis bureau 1440 px)
//         SHOTS=/chemin node tests/ui-smoke.mjs   (enregistre aussi des captures)
// Parcours : bienvenue → création de compte (local) → profil → accueil → analyser → exemple → résultats
//            → geste idéal → labo, progrès, profil (bascule simple / expert) → outils du labo ; anciennes adresses.
// Les comptes sont créés en mode local (config.js remplacé à la volée) : rien n'est envoyé au serveur Supabase.
// Échoue en cas d'erreur console, de débordement horizontal ou d'écran manquant.
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch (e) {
  try { const { execSync } = await import('node:child_process'); pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { console.error('Playwright introuvable : npm i -g playwright && npx playwright install chromium'); process.exit(2); }
}
const { chromium, devices } = pw;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = join(ROOT, p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/app/`;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) await mkdir(SHOTS, { recursive: true });

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) failed++; };

async function run(label, ctxOpts) {
  console.log(`\n${label}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(ctxOpts);
  // les polices Google ne sont pas nécessaires au test
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Comptes en mode local (jamais de compte de test créé sur le serveur réel), sauf CLOUD=1
  if (!process.env.CLOUD) await ctx.route('**/app/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const SUPABASE = { url: '', anonKey: '' };" }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const nav = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(600); };
  const check = async (name, sel) => {
    let vis = true;
    try { await page.waitForSelector(sel, { state: 'visible', timeout: 15000 }); } catch (e) { vis = false; }
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(vis && ov <= 0, `${name}${vis ? '' : ' (introuvable)'}${ov > 0 ? ` (débordement ${ov} px)` : ''}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label.split(' ')[0]}-${name.replace(/\W+/g, '-')}.png`) });
  };
  try {
    await page.goto(BASE);
    await page.waitForSelector('#boot', { state: 'detached', timeout: 30000 });
    await check('bienvenue', '#onbNext');
    await page.click('#onbNext'); await page.click('#onbNext');
    await page.click('a[href="#bienvenue/compte"]');
    await check('compte', '#authF');
    await page.fill('input[name=name]', 'Test');
    await page.fill('input[name=email]', `t${Date.now()}@exemple.fr`);
    await page.fill('input[name=password]', 'motdepasse123');
    await page.click('#authGo');
    await check('profil étape 1', '#pfName');
    await page.click('.lvls button[data-l="amateur"]'); await page.click('#pNext');
    await page.fill('#pfH', '180'); await page.fill('#pfW', '75'); await page.click('#pNext');
    await page.click('#pNext');
    await check('accueil', '.hero-cta');
    ok(!(await page.evaluate(() => document.body.classList.contains('adv'))), 'amateur → mode simple');
    await page.click('.hero-cta');
    await check('analyser · choix du coup', '.stroke-cards');
    await page.click('.sc[data-k="forehand"]');
    await check('analyser · guide', '.film');
    await nav('#analyser'); await page.click('#anaDemo');
    await check('analyse en cours', '.ana-stage');
    await page.waitForFunction(() => location.hash === '#resultats', null, { timeout: 20000 });
    await check('résultats', '#rxSum .rx-score');
    ok(await page.isVisible('#rxDemo'), 'exemple signalé comme exemple');
    await page.click('#rxMore'); await check('analyse complète', '#rxFull.open');
    await page.click('#rxSum .q'); await check('glossaire (feuille)', '.sheet.on .sh-lead');
    await page.keyboard.press('Escape');
    await nav('#geste'); await check('geste idéal', '#gHow');
    await page.waitForSelector('#gResult .ba', { timeout: 120000 }).catch(() => {});
    ok(await page.isVisible('#gResult .ba'), 'geste idéal : avant / après');
    await nav('#labo'); await check('labo', '.tools');
    await nav('#progres'); await check('progrès', '#pSess');
    await nav('#profil'); await check('profil', '.modes');
    await page.click('.modes button[data-m="adv"]');
    ok(await page.evaluate(() => document.body.classList.contains('adv')), 'bascule en mode expert');
    for (const r of ['materiel', 'balle', 'match', 'eleves', 'coach', 'apropos']) { await nav(`#${r}`); await check(r, `main[data-view="${r}"]`); }
    await nav('#seance'); ok(await page.evaluate(() => location.hash) === '#resultats', 'ancienne adresse #seance → #resultats');
    await nav('#optimiseur'); ok(await page.evaluate(() => location.hash) === '#geste', 'ancienne adresse #optimiseur → #geste');
  } catch (e) { ok(false, `parcours interrompu : ${e.message.split('\n')[0]}`); }
  ok(!errs.length, `aucune erreur console${errs.length ? ` : ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

await run('mobile (iPhone 13)', { ...devices['iPhone 13'] });
await run('bureau (1440 px)', { viewport: { width: 1440, height: 900 } });
server.close();
console.log(failed ? `\n${failed} échec(s)` : '\nTout est bon');
process.exit(failed ? 1 : 0);
