// KYRON · export du rapport (capacité « downloads » de claude.ai) : rapport HTML autonome + données JSON
import { $, esc, f, fi, STROKE_FR, LEVEL_FR } from './util.js';
import { S } from './state.js';
import { downloadsP } from './caps.js';
import { sessionSummary } from './summary.js';

let dl = null;
export async function initReport() {
  dl = await downloadsP;
  const b = $('#exportBtn');
  if (!dl?.save) { b.hidden = true; return; }
  b.hidden = false;
  b.onclick = exportReport;
}

const LOGO = `<svg viewBox="0 0 100 100" width="34" height="34" style="--bgk:#000;color:#F4F4F2"><g stroke-linecap="round" fill="none"><g stroke-width="16" stroke="currentColor"><line x1="26" y1="14" x2="26" y2="86"/><line x1="26" y1="56" x2="74" y2="16"/><line x1="46" y1="40" x2="76" y2="86"/></g><g stroke-width="6" stroke="#000"><line x1="26" y1="14" x2="26" y2="86"/><line x1="26" y1="56" x2="74" y2="16"/><line x1="46" y1="40" x2="76" y2="86"/></g></g><g stroke-width="3.5" fill="#000" stroke="currentColor"><circle cx="26" cy="14" r="10"/><circle cx="26" cy="86" r="10"/><circle cx="74" cy="16" r="10"/><circle cx="76" cy="86" r="10"/><circle cx="46" cy="40" r="10"/></g><g fill="#FF4D1A"><circle cx="26" cy="14" r="4"/><circle cx="26" cy="86" r="4"/><circle cx="74" cy="16" r="4"/><circle cx="76" cy="86" r="4"/><circle cx="46" cy="40" r="4"/></g></svg>`;

function html() {
  const sess = S.session, p = S.profile, o = S.opt.result;
  const d = new Date(sess.date || Date.now());
  const rows = sess.strokes.map((s, i) => { const m = s.res.metrics; return `<tr${i === S.strokeIdx ? ' class="cur"' : ''}><td>${String(i + 1).padStart(2, '0')}</td><td>${esc(STROKE_FR[s.type])}</td><td class="n">${s.res.score}</td><td class="n">${fi(m.racketSpeed * 3.6)}</td><td class="n">${fi(s.ball?.speedKmh ?? m.ballSpeedKmh)}${s.ball?.speedKmh ? ' (m)' : ' (e)'}</td><td class="n">${fi(m.kneeFlex)}°</td><td class="n">${fi(m.separation)}°</td><td class="n">${fi(m.elbowImpact)}°</td><td class="n">${s.res.inOrder ? 'oui' : '<b class="a">non</b>'}</td></tr>`; }).join('');
  const s = sess.strokes[S.strokeIdx], r = s.res;
  const fixes = r.findings.slice(0, 5).map((x, i) => `<li><b>${String(i + 1).padStart(2, '0')} · ${esc(x.title)}</b><br>${esc(x.detail)}</li>`).join('');
  const exs = r.exercises.map((e) => `<li><b>${esc(e.name)}</b> · ${esc(e.dose)}<br>${esc(e.goal)} <i>Validé si : ${esc(e.check)}</i></li>`).join('');
  const chain = r.sequence.map((q) => `<td class="n">${q.ms} ms</td>`).join('');
  const sens = o?.sensitivity?.slice(0, 5).map((x) => `<tr><td>${esc(x.label)}</td><td class="n">+${f(x.gainPct, 1)} %</td></tr>`).join('') || '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapport KYRON · ${d.toLocaleDateString('fr-FR')}</title>
<style>:root{color-scheme:dark}body{margin:0;background:#000;color:#F4F4F2;font:15px/1.55 "IBM Plex Sans",system-ui,sans-serif}main{max-width:920px;margin:0 auto;padding:32px 20px 60px}
h1{font:400 26px/1.2 "Michroma","Eurostile",Arial,sans-serif;letter-spacing:.04em;margin:18px 0 6px}h2{font:400 11px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#8B8B8F;margin:34px 0 10px;border-top:1px solid rgba(255,255,255,.12);padding-top:14px}
.top{display:flex;align-items:center;gap:12px;font:400 14px "Michroma",Arial,sans-serif;letter-spacing:.14em}.meta{font:11px ui-monospace,monospace;color:#8B8B8F;letter-spacing:.08em;text-transform:uppercase}
.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));border-left:1px solid rgba(255,255,255,.12);border-top:1px solid rgba(255,255,255,.12)}.k div{padding:12px 14px;border-right:1px solid rgba(255,255,255,.12);border-bottom:1px solid rgba(255,255,255,.12)}.k small{display:block;font:10px ui-monospace,monospace;letter-spacing:.12em;color:#8B8B8F;text-transform:uppercase}.k b{font:400 22px "Michroma",Arial,sans-serif}
table{width:100%;border-collapse:collapse;font-size:13px}th{font:10px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8B8B8F;text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.22)}td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);color:#C9C9C6}td.n{text-align:right;font-family:ui-monospace,monospace;color:#fff}tr.cur td{background:rgba(255,255,255,.05)}
ul{list-style:none;padding:0;margin:0;display:grid;gap:12px}li{border-left:2px solid #fff;padding-left:12px;color:#C9C9C6}li b{color:#fff;font-weight:500}.a{color:#FF4D1A;font-weight:400}i{color:#8B8B8F}p.n{color:#8B8B8F;font-size:12.5px}</style></head><body><main>
<div class="top">${LOGO}KYRON</div>
<h1>Rapport de séance</h1>
<div class="meta">${d.toLocaleString('fr-FR')} · ${sess.source === 'demo' ? 'démo synthétique' : sess.multi ? '2 caméras' : '1 caméra'} · ${p.height} cm · ${p.weight} kg · ${p.hand === 'right' ? 'droitier' : 'gaucher'} · ${LEVEL_FR[p.level]}</div>
<h2>Synthèse</h2><div class="k"><div><small>Frappes</small><b>${sess.strokes.length}</b></div><div><small>Score moyen</small><b>${sess.summary?.meanScore ?? '—'}</b></div><div><small>Qualité de prise</small><b>${sess.quality?.score ?? '—'}</b></div><div><small>Fatigue</small><b>${sess.fatigue ? `${sess.fatigue.slopePct >= 0 ? '+' : '−'}${f(Math.abs(sess.fatigue.slopePct), 1)} %` : '—'}</b></div></div>
${sess.fatigue?.detail ? `<p class="n">${esc(sess.fatigue.detail)}</p>` : ''}
<h2>Frappes</h2><table><thead><tr><th>#</th><th>Type</th><th>Score</th><th>Raquette km/h</th><th>Balle km/h</th><th>Genou</th><th>Séparation</th><th>Coude</th><th>Chaîne</th></tr></thead><tbody>${rows}</tbody></table>
<p class="n">(m) vitesse mesurée par suivi de balle · (e) estimée par le modèle.</p>
<h2>Frappe ${S.strokeIdx + 1} · ${esc(STROKE_FR[s.type])} · score ${r.score}</h2>
<table><thead><tr><th></th>${r.sequence.map((q) => `<th>${esc(q.label)}</th>`).join('')}</tr></thead><tbody><tr><td>Pic avant impact</td>${chain}</tr></tbody></table>
<h2>Corrections prioritaires</h2><ul>${fixes}</ul>
<h2>Exercices</h2><ul>${exs || '<li>Aucun exercice prioritaire.</li>'}</ul>
${o ? `<h2>Optimiseur · ${fi(o.trials)} essais</h2><div class="k"><div><small>Balle actuelle</small><b>${fi(o.current?.ballKmh)}</b></div><div><small>Balle optimale</small><b>${fi(o.best?.ballKmh)}</b></div><div><small>Gain</small><b>+${f(o.best?.gainPct, 1)} %</b></div></div><table style="margin-top:12px"><tbody>${sens}</tbody></table>` : ''}
<p class="n" style="margin-top:40px">Mesures sans capteur, par vision sur l'appareil. Les vitesses de raquette sont estimées depuis le bras ; valide les ordres de grandeur au radar avant toute conclusion fine.</p>
</main></body></html>`;
}

function json() {
  const sess = S.session;
  return JSON.stringify({
    format: 'kyron-seance-v1', exporte: new Date().toISOString(), resume: sessionSummary({ full: true }),
    frappes: sess.strokes.map((s) => ({ type: s.type, t: s.t, score: s.res.score, metrics: s.res.metrics, phases: s.res.phases, sequence: s.res.sequence, gaps: s.res.gaps, findings: s.res.findings, ball: s.ball || null,
      frames: s.frames.map((fr) => ({ t: +fr.t.toFixed(4), world: fr.world.map((q) => [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4)]) })) })),
    optimiseur: S.opt.result ? { ...S.opt.result, cloud: undefined } : null,
  });
}

async function exportReport() {
  const b = $('#exportBtn');
  if (!dl || !S.session) return;
  b.disabled = true;
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await dl.save({ filename: `kyron-rapport-${stamp}.html`, data: html() });
    b.textContent = 'Rapport enregistré';
    try { await dl.save({ filename: `kyron-donnees-${stamp}.json`, data: json() }); b.textContent = 'Rapport et données enregistrés'; } catch (e) { /* refus du second fichier : le rapport reste */ }
  } catch (e) {
    if (['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e?.code)) b.hidden = true;
    else b.textContent = e?.code === 'declined' ? 'Export annulé' : 'Export impossible';
  } finally {
    b.disabled = false;
    setTimeout(() => { b.textContent = 'Exporter le rapport'; }, 2600);
  }
}
