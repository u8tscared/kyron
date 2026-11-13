// KYRON · tests du plan de compression vidéo (app/ui/compress.js).  Exécution : node tests/compress.test.mjs
// Seules les parties pures sont testées ici (dimensions, débit, second essai). L'encodage lui-même (WebCodecs)
// se vérifie dans un navigateur (Playwright Chromium), pas ici.

import { planCompression, fitDims, retryBitrate, calibrateBitrate, adjustDims, nextPass, normFps, prepareVideo, COMPRESS, MB } from '../app/ui/compress.js';

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

section('1. Dimensions de sortie');
{
  ok(JSON.stringify(fitDims(1920, 1080)) === '{"width":1280,"height":720}', '1080p paysage → 1280×720');
  ok(JSON.stringify(fitDims(1080, 1920)) === '{"width":720,"height":1280}', '1080p portrait → 720×1280');
  ok(JSON.stringify(fitDims(3840, 2160)) === '{"width":1280,"height":720}', '4K → 1280×720');
  ok(JSON.stringify(fitDims(1280, 720)) === '{"width":1280,"height":720}', 'déjà 720p : inchangé');
  ok(JSON.stringify(fitDims(640, 360)) === '{"width":640,"height":360}', 'jamais agrandi');
  const d = fitDims(1440, 1080);
  ok(d.width === 1280 && d.height === 960, '4:3 → 1280×960', `${d.width}×${d.height}`);
  const o = fitDims(1001, 563);
  ok(o.width % 2 === 0 && o.height % 2 === 0, 'nombres pairs (exigés par H.264)', `${o.width}×${o.height}`);
  ok(fitDims(0, 100) === null && fitDims(NaN, 1) === null, 'dimensions invalides → null');
  const s = fitDims(1920, 1080, 854);
  ok(s.width === 854 && s.height === 480, 'palier 480p', `${s.width}×${s.height}`);
}

section('2. Seuil');
{
  ok(planCompression({ size: 30 * MB, duration: 10, width: 1920, height: 1080 }).needed === false, '30 Mo : pas de compression');
  ok(planCompression({ size: 45 * MB, duration: 10, width: 1920, height: 1080 }).needed === false, '45 Mo pile : pas de compression');
  ok(planCompression({ size: 46 * MB, duration: 10, width: 1920, height: 1080 }).needed === true, '46 Mo : compression');
  ok(planCompression({ size: 200 * MB, duration: 0, width: 1920, height: 1080 }).ok === false, 'durée inconnue → refus');
}

section('3. Débit choisi d’après la durée');
{
  // Ralenti iPhone typique : 1080p 240 i/s, 20 s, 250 Mo, son AAC 160 kb/s
  const p = planCompression({ size: 250 * MB, duration: 20, width: 1920, height: 1080, audioBps: 160_000 });
  ok(p.ok && p.width === 1280 && p.height === 720, '20 s : 720p', `${p.width}×${p.height}`);
  ok(p.videoBps === COMPRESS.maxVideoBps, '20 s : débit plafonné à 8 Mb/s', `${p.videoBps}`);
  ok(p.keepAudio && p.audioBps === 160_000, 'son gardé');
  ok(p.estBytes <= COMPRESS.target, 'estimation ≤ 40 Mo', `${(p.estBytes / MB).toFixed(1)} Mo`);

  const q = planCompression({ size: 300 * MB, duration: 90, width: 1920, height: 1080, audioBps: 128_000 });
  const total = ((q.videoBps + q.audioBps) * 90) / 8;
  ok(q.ok && total <= COMPRESS.target * 0.97, '90 s : vidéo + son tiennent dans 40 Mo (marge conteneur)', `${(total / MB).toFixed(1)} Mo, ${q.videoBps} b/s`);
  ok(q.videoBps > 3_000_000 && q.width === 1280, '90 s : encore en 720p, ~3,5 Mb/s');

  const r = planCompression({ size: 300 * MB, duration: 400, width: 1920, height: 1080, audioBps: 128_000 });
  ok(r.ok && r.width === 854 && r.height === 480, '400 s : on descend en 480p', `${r.width}×${r.height} à ${r.videoBps} b/s`);
  ok(!r.keepAudio || r.audioBps * 400 <= COMPRESS.target * 8 * 0.15, 'son retiré s’il mange trop de budget');

  const t = planCompression({ size: 900 * MB, duration: 1200, width: 1920, height: 1080 });
  ok(t.ok && t.width === 640, '20 min : 640 px', `${t.width}×${t.height} à ${t.videoBps} b/s`);
  const u = planCompression({ size: 2000 * MB, duration: 3600, width: 1920, height: 1080 });
  ok(u.ok === false && u.reason === 'too_long', '1 h : trop long pour 40 Mo → refus (on enverra l’original)');

  const big = planCompression({ size: 300 * MB, duration: 60, width: 1920, height: 1080, audioBps: 2_000_000 });
  ok(big.ok && !big.keepAudio && big.audioBps === 0, 'son PCM énorme → retiré');

  const port = planCompression({ size: 120 * MB, duration: 15, width: 1080, height: 1920 });
  ok(port.width === 720 && port.height === 1280, 'portrait conservé', `${port.width}×${port.height}`);

  const custom = planCompression({ size: 20 * MB, duration: 10, width: 1920, height: 1080 }, { threshold: 10 * MB, target: 8 * MB });
  ok(custom.needed && custom.videoBps * 10 / 8 <= 8 * MB, 'seuil et cible réglables');
}

section('4. Second essai');
{
  ok(retryBitrate(4_000_000, 48 * MB, 40 * MB) === Math.floor(4_000_000 * (40 / 48) * 0.9), 'débit réduit au prorata, 10 % de marge');
  ok(retryBitrate(4_000_000, 0) === 4_000_000, 'taille inconnue : inchangé');
  ok(retryBitrate(150_000, 400 * MB, 40 * MB) === 100_000, 'plancher 100 kb/s');
}

section('4 ter. Étalonnage et essais suivants');
{
  ok(calibrateBitrate(4_000_000, 4_100_000) === 4_000_000, 'encodeur fidèle (≤ 5 % de plus) : débit gardé');
  ok(calibrateBitrate(4_000_000, 2_000_000) === 4_000_000, 'encodeur sous la cible : on ne monte pas');
  ok(calibrateBitrate(4_000_000, 16_000_000) === 900_000, 'encodeur ×4 : débit demandé ÷4, marge 10 %');
  ok(calibrateBitrate(4_000_000, 0) === 4_000_000, 'mesure vide : inchangé');
  let d = adjustDims({ width: 1280, height: 720 }, 3_000_000);
  ok(d.width === 1280, 'débit suffisant : 720p gardé');
  d = adjustDims({ width: 1280, height: 720 }, 900_000);
  ok(d.width === 854 && d.height === 480, 'débit sous le palier 720p : 480p', `${d.width}×${d.height}`);
  d = adjustDims({ width: 720, height: 1280 }, 300_000);
  ok(d.width === 360 && d.height === 640, 'portrait, débit faible : 360×640', `${d.width}×${d.height}`);
  d = adjustDims({ width: 854, height: 480 }, 8_000_000);
  ok(d.width === 854, 'jamais de remontée de définition');
  d = adjustDims({ width: 1280, height: 720 }, 3_000_000, { forceDown: true });
  ok(d.width === 854, 'forceDown : un palier plus bas');
  const n1 = nextPass({ width: 1280, height: 720, videoBps: 4_000_000 }, 60 * MB, 1);
  ok(n1.width === 1280 && n1.videoBps === retryBitrate(4_000_000, 60 * MB), '2ᵉ essai : même définition, débit corrigé');
  const n2 = nextPass({ width: 1280, height: 720, videoBps: 2_400_000 }, 50 * MB, 2);
  ok(n2.width === 854 && n2.videoBps < 2_400_000, '3ᵉ essai : définition réduite', `${n2.width}×${n2.height} ${n2.videoBps}`);
}

section('4 bis. Cadence d’encodage');
{
  ok(normFps(240) === 240 && normFps(239.98) === 240 && normFps(120.01) === 120, 'ralenti : 240 / 120 i/s entiers');
  ok(normFps(29.97) === 29.97 && normFps(59.9401) === 59.94, '29,97 et 59,94 gardés');
  ok(normFps(0) === null && normFps(NaN) === null && normFps(undefined) === null, 'cadence inconnue → null (horodatages d’origine)');
}

section('5. prepareVideo sous node (pas d’encodeur)');
{
  const small = new Blob([new Uint8Array(1000)]);
  const a = await prepareVideo(small);
  ok(a.video === small && a.info === null, 'petit fichier : rendu tel quel, sans info');
  const fake = { size: 100 * MB, type: 'video/mp4' };
  const b = await prepareVideo(fake);
  ok(b.video === fake && b.info?.compressed === false && b.info.reason, 'aucun encodeur : original rendu, raison notée', b.info?.reason);
  const n = await prepareVideo(null);
  ok(n.video === null && n.info === null, 'pas de vidéo : rien');
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
