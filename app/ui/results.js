// KYRON · résultats en mode simple : score + verdict, ce qui marche, 3 priorités (valeur vs plage des pros),
// un exercice, accès au geste idéal. L'analyse complète (panneaux existants) se déplie en dessous.
import { $, f, fi, esc, on, STROKE_FR, analyzable } from './util.js';
import { S, cur } from './state.js';
import { hooks, show as seanceShow } from './seance.js';
import { GLOSS, help } from './glossary.js';
import { ringSvg, countUp, ICON, fmtDate, reveal } from './kit.js';
import { spinEstimate } from './physics-ui.js';

let open = null, lastKey = '';

export function init() {
  hooks.render.push(render);
  on('session', () => { lastKey = ''; render(); });
  on('mode', () => { syncOpen(); render(true); });
  on('opt', () => paintGeste());
  $('#rxMore').addEventListener('click', () => { open = !isOpen(); syncOpen(); if (isOpen()) { requestAnimationFrame(() => { seanceShow(); import('./util.js').then((u) => u.emit('route', 'resultats')); }); } });
  syncOpen();
}
const isOpen = () => (open == null ? S.mode === 'adv' : open);
function syncOpen() {
  const o = isOpen();
  $('#rxFull').classList.toggle('open', o);
  $('#rxMore').setAttribute('aria-expanded', String(o));
  $('#rxMore span').textContent = o ? 'Masquer l’analyse complète' : 'Voir l’analyse complète';
}

// ---------- Textes ----------
function verdict(r) {
  const top = r.findings.find((x) => x.sev > 0);
  const t = top ? top.title.charAt(0).toLowerCase() + top.title.slice(1) : '';
  if (r.score >= 85) return top ? `Geste de haut niveau. Dernier détail à régler : ${t}.` : 'Geste de haut niveau, dans les standards pro sur toutes les mesures.';
  if (r.score >= 72) return `Base solide. Corrige d’abord ceci : ${t}.`;
  if (r.score >= 58) return `Tu as de la vitesse en réserve. Priorité : ${t}.`;
  return 'Ton corps ne travaille pas encore ensemble : on reprend le geste étape par étape.';
}
const GOOD = {
  sequence: () => 'Ton corps accélère dans le bon ordre : bassin, buste, puis bras.',
  kneeFlex: (v) => `Belle charge dans les jambes (${fi(v)}°).`,
  separation: (v) => `Bonne torsion entre hanches et épaules (${fi(v)}°).`,
  elbowImpact: (v, st) => (st === 'serve' ? `Bras bien allongé à l’impact (${fi(v)}°).` : `Bon espace entre le corps et la balle (coude à ${fi(v)}°).`),
  contactRatio: (v) => `Tu frappes haut (${f(v, 2)} × ta taille).`,
  shoulderTurn: (v) => `Bonne rotation des épaules (${fi(v)}°).`,
  headDrift: () => 'Tête stable au moment de l’impact.',
  comShift: () => 'Ton poids passe bien vers l’avant.',
  balance: () => 'Bien équilibré au moment de frapper.',
  shoulderElev: () => 'Coude à la bonne hauteur à l’armé.',
  shoulderRotExt: () => 'Bel armé de l’épaule : la raquette descend bien dans le dos.',
  shoulderAbdH: () => 'Coude bien aligné avec les épaules à l’armé.',
  tossDrop: () => 'Lancer à la bonne hauteur.',
  tossForward: () => 'Lancer bien placé devant toi.',
  shoulderIRVel: () => 'Ton bras fouette vite vers la balle.',
};
const ORDER = ['sequence', 'kneeFlex', 'separation', 'elbowImpact', 'contactRatio', 'shoulderRotExt', 'shoulderTurn', 'comShift', 'balance', 'headDrift', 'shoulderElev', 'shoulderAbdH', 'tossForward', 'tossDrop', 'shoulderIRVel'];
function goods(r) {
  const bad = new Set(r.findings.filter((x) => x.sev > 0).map((x) => x.key));
  const items = r.items.filter((it) => !bad.has(it.key) && GOOD[it.key]);
  items.sort((a, b) => (b.score - a.score) || (ORDER.indexOf(a.key) - ORDER.indexOf(b.key)));
  return items.filter((it) => it.score >= 80).slice(0, 2);
}

// Valeur affichée selon l'unité du moteur
function fmtV(v, unit) {
  if (!Number.isFinite(v)) return '—';
  if (unit === 'm') return `${fi(v * 100)} cm`;
  if (unit === '× taille') return `${f(v, 2)} ×`;
  if (unit === '°/s') return `${fi(v)} °/s`;
  if (unit === '°') return `${fi(v)}°`;
  if (unit === '0–1') return f(v, 2);
  return `${f(v, 1)} ${unit || ''}`;
}
function rangeTxt(it) {
  if (it.unit === 'm') return it.lo === 0 ? `moins de ${fi(it.hi * 100)} cm` : `${fi(it.lo * 100)} à ${fi(it.hi * 100)} cm`;
  if (it.unit === '× taille') return `${f(it.lo, 2)} à ${f(it.hi, 2)} ×`;
  if (it.unit === '0–1') return `${f(it.lo, 1)} ou plus`;
  return `${fi(it.lo)} à ${fi(it.hi)}${it.unit === '°' ? '°' : ` ${it.unit}`}`;
}
function bar(it) {
  if (it.key === 'sequence' || !Number.isFinite(it.value)) return '';
  const span = it.hi - it.lo || 1;
  const lo = Math.min(it.lo, it.value) - span * 0.35, hi = Math.max(it.hi, it.value) + span * 0.35;
  const X = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return `<div class="rbar" role="img" aria-label="Toi ${esc(fmtV(it.value, it.unit))}, plage des pros ${esc(rangeTxt(it))}">
    <span class="band" style="left:${X(it.lo)}%;width:${X(it.hi) - X(it.lo)}%"></span>
    <span class="mk" style="left:${X(it.value)}%"></span></div>
    <div class="rbar-l"><span>Toi <b class="mono">${esc(fmtV(it.value, it.unit))}</b></span><span>Pros <b class="mono">${esc(rangeTxt(it))}</b></span></div>`;
}

// ---------- Rendu ----------
function render(force) {
  const s = cur(), sess = S.session; if (!s?.res || !sess) return;
  const r = s.res, m = r.metrics, st = analyzable(s.type);
  const key = `${sess.id}:${S.strokeIdx}:${r.score}:${S.mode}`;
  $('#rxDemo').hidden = sess.source !== 'demo';
  $('#rxTitle').textContent = STROKE_FR[s.type] || 'Ton analyse';
  const srcTxt = sess.source === 'demo' ? 'Exemple' : sess.multi ? '2 caméras' : 'Ta vidéo';
  $('#rxMeta').textContent = `${srcTxt} · ${sess.source === 'demo' ? 'données de synthèse' : fmtDate(sess.date)}${sess.strokes.length > 1 ? ` · frappe ${S.strokeIdx + 1} sur ${sess.strokes.length}` : ''}`;
  if (key === lastKey && !force) { paintGeste(); return; }
  const anim = key.split(':').slice(0, 2).join(':') !== lastKey.split(':').slice(0, 2).join(':');
  lastKey = key;

  const meas = s.ball && Number.isFinite(s.ball.speedKmh);
  const ballKmh = meas ? s.ball.speedKmh : m.ballSpeedKmh;
  const spin = spinEstimate(s.type, m.racketSpeed);
  const fixes = r.findings.filter((x) => x.sev > 0).slice(0, 3);
  const good = goods(r);
  const ex = r.exercises[0];
  const itemOf = (k) => r.items.find((it) => it.key === k);
  const conf = Number.isFinite(r.confidence) ? Math.round(r.confidence * 100) : null;

  $('#rxSum').innerHTML = `
    <div class="rx-score rv">${ringSvg(r.score, { label: 'sur 100' })}
      <div class="rx-v"><div class="eyebrow">Score du geste ${help('score')}</div><p class="verdict">${esc(verdict(r))}</p>
      ${conf != null && conf < 60 ? `<p class="warn-l">Mesure peu sûre (${conf} %) : refilme en suivant le guide.${help('confidence')}</p>` : ''}</div></div>
    <div class="quick rv">
      <div><span class="lbl">Vitesse de balle ${help('ballKmh')}</span><b class="mono" data-cu="${ballKmh}">${fi(ballKmh)}</b><small>km/h · ${meas ? 'mesurée' : 'estimée'}</small></div>
      <div><span class="lbl">Raquette ${help('racketKmh')}</span><b class="mono" data-cu="${m.racketSpeed * 3.6}">${fi(m.racketSpeed * 3.6)}</b><small>km/h</small></div>
      <div><span class="lbl">Effet ${help('spin')}</span><b class="mono" data-cu="${spin?.rpm}">${spin ? fi(spin.rpm) : '—'}</b><small>tr/min</small></div>
    </div>
    ${good.length ? `<section class="rx-sec rv"><h3>Ce qui marche</h3><ul class="goods">${good.map((it) => `<li><i>${ICON.check}</i><span>${esc(GOOD[it.key](it.value, st))}</span>${help(it.key)}</li>`).join('')}</ul></section>` : ''}
    <section class="rx-sec rv"><h3>${fixes.length ? 'À corriger en priorité' : 'À corriger'}</h3>
      ${fixes.length ? `<ol class="fixlist">${fixes.map((x, i) => {
        const it = itemOf(x.key), g = GLOSS[x.key];
        return `<li class="fx ${i === 0 ? 'top' : ''}"><div class="fx-h"><i class="mono">${i + 1}</i><b>${esc(x.title)}</b>${help(x.key)}</div>
          <p>${esc(g?.why || x.detail)}</p>
          ${it ? bar(it) : ''}${x.key === 'sequence' ? `<p class="fx-d">Écarts mesurés : <span class="mono">${r.gaps.join(' · ')} ms</span> (idéal 15 à 90 ms entre chaque segment).</p>` : ''}
          ${x.gain ? `<span class="gain">Gain estimé : <b class="mono">+${x.gain} %</b> de vitesse</span>` : ''}</li>`;
      }).join('')}</ol>` : '<p class="muted">Rien d’important à corriger sur cette frappe : garde ce geste et augmente la vitesse progressivement.</p>'}
    </section>
    ${ex ? `<section class="rx-sec rv"><h3>Ton exercice</h3><div class="excard"><span class="ex-ic">${ICON.bolt}</span><div><b>${esc(ex.name)}</b><p>${esc(ex.goal)}</p>
      <div class="ex-m"><span><small>Dose</small>${esc(ex.dose)}</span><span><small>Réussi quand</small>${esc(ex.check)}</span></div></div></div></section>` : ''}
    <a class="geste-teaser rv" href="#geste" id="rxGeste"></a>`;
  paintGeste();
  if (anim) { reveal($('#rxSum')); $('#rxSum').querySelectorAll('[data-cu]').forEach((el) => countUp(el, +el.dataset.cu, { dur: 800 })); const n = $('#rxSum .ring-n'); if (n) countUp(n, r.score, { dur: 900 }); $('#rxSum .ring')?.classList.add('anim'); }
}

let lastG = 0;
function paintGeste() {
  const a = $('#rxGeste'); if (!a) return;
  const now = performance.now(); if (S.opt.status === 'running' && now - lastG < 250) return; lastG = now;
  const o = S.opt, res = o.result;
  const mine = o.forIdx === S.strokeIdx;
  let main, sub;
  if (o.status === 'done' && mine && Number.isFinite(res?.best?.ballKmh) && Number.isFinite(res?.current?.ballKmh)) {
    const d = res.best.ballKmh - res.current.ballKmh;
    main = d > 0.5 ? `<b class="mono">+${fi(d)} km/h</b> possibles sans risque` : 'Ton geste est déjà proche de l’optimum';
    sub = `Trouvé en testant ${fiBig(res.trials)} variantes de ton geste`;
  } else if (o.status === 'running' && mine) {
    main = 'Je cherche ton geste idéal…';
    sub = `<span class="mono">${fiBig(o.progress?.trials || 0)}</span> variantes testées`;
  } else { main = 'Ton geste idéal'; sub = 'La version de ton geste qui va le plus vite, sans risque'; }
  a.innerHTML = `<span class="gt-ic">${ICON.ghost}</span><span class="gt-t"><span class="eyebrow">Simulateur</span><span class="gt-m">${main}</span><small>${sub}</small></span><span class="gt-go">${ICON.next}</span>`;
  a.classList.toggle('live', o.status === 'running' && mine);
}
const fiBig = (n) => (n >= 1e6 ? `${f(n / 1e6, 1)} million${n >= 2e6 ? 's' : ''} de` : fi(n));
