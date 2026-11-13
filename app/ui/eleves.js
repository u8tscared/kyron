// KYRON · onglet Coach élèves : espace coach multi-élèves, stocké sur cet appareil uniquement. Élèves, séances par
// élève, validation des corrections avant envoi (envoi = message à copier ou à enregistrer : pas de compte en
// ligne), comparaison entre élèves.
import { $, $$, f, fi, esc, store, STROKE_FR, LEVEL_FR, analyzable } from './util.js';
import { S } from './state.js';
import { entryOf } from './progression.js';
import { annotationsAll } from './adv.js';
import { downloadsP } from './caps.js';
import { account } from './acct.js';

const KEY = 'kyron-eleves';
let inited = false, mem = null, sel = null, selSess = null, cmpStroke = 'serve';
// Rangé par compte (un coach = ses élèves), avec reprise des données locales d'avant les comptes
const ukey = () => `${KEY}:${account.user()?.id || 'local'}`;
const load = () => { const d = store.get(ukey(), null) || store.get(KEY, null); return d && Array.isArray(d.students) ? d : mem || { students: [] }; };
const save = (d) => { if (!store.set(ukey(), d)) mem = d; };
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtD = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export function show() {
  if (!inited) { inited = true; bind(); }
  render();
}
function bind() {
  $('#eAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#eName').value.trim(); if (!name) return;
    const d = load(); const st = { id: uid(), name: name.slice(0, 60), level: $('#eLvl').value, sessions: [] };
    d.students.push(st); save(d); sel = st.id; selSess = null; $('#eName').value = ''; render();
  });
  $('#eList').addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) { sel = b.dataset.st; selSess = null; render(); } });
  $('#eMain').addEventListener('click', onMain);
  $('#eMain').addEventListener('input', (e) => {
    const t = e.target.closest('[data-ctext]'); if (!t) return;
    const d = load(), s = cs(d); if (!s) return; const c = s.corrections[+t.dataset.ctext]; if (c) { c.text = t.value.slice(0, 600); save(d); renderPreview(d); }
  });
  $('#eCmpSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { cmpStroke = b.dataset.s; renderCmp(load()); } });
}
const student = (d) => d.students.find((x) => x.id === sel) || null;
const cs = (d) => { const st = student(d); return st?.sessions.find((x) => x.id === selSess) || null; };

function exampleData() {
  const mk = (name, level, base, k) => {
    const sessions = [0, 1, 2].map((i) => {
      const p = i / 2, j = (a) => 1 + Math.sin(k * 3 + i * 2 + a) * 0.03;
      const by = {};
      for (const t of ['serve', 'forehand', 'backhand']) by[t] = { n: 6, m: { score: Math.round((base.score + p * 6) * j(1)), racketKmh: (base.kmh + p * 6) * j(2) * (t === 'serve' ? 1.2 : t === 'backhand' ? 0.92 : 1), kneeFlex: (base.knee + p * 6) * j(3), separation: (base.sep + p * 4) * j(4), elbowImpact: 150 + p * 6, inOrder: Math.min(1, 0.4 + p * 0.4 + k * 0.05) }, exercises: [] };
      return { id: uid(), date: new Date(Date.now() - (2 - i) * 9 * 86400e3).toISOString(), label: `Séance ${i + 1} (exemple)`, source: 'exemple', entry: { byType: by, count: 18 },
        corrections: i === 2 ? [{ key: 'legs', title: 'Fléchis davantage les genoux', detail: `Flexion mesurée ${fi(base.knee + 6)}°, cible ≥ 45°.`, sev: 2, status: 'draft', text: '' }, { key: 'sequence', title: 'Laisse le bassin partir avant les épaules', detail: 'Le buste démarre 20 ms trop tôt.', sev: 2, status: 'draft', text: '' }] : [], notes: [] };
    });
    return { id: uid(), name, level, example: true, sessions };
  };
  return [mk('Léa (exemple)', 'competition', { score: 74, kmh: 118, knee: 44, sep: 30 }, 1), mk('Hugo (exemple)', 'club', { score: 63, kmh: 104, knee: 31, sep: 19 }, 2), mk('Inès (exemple)', 'loisir', { score: 55, kmh: 92, knee: 26, sep: 14 }, 3)];
}

function onMain(e) {
  const d = load(), st = student(d);
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'eDemo') { d.students.push(...exampleData()); save(d); sel = d.students[0].id; render(); return; }
  if (!st) return;
  if (b.id === 'eAttach') {
    const sess = S.session; if (!sess) return;
    const fx = new Map();
    for (const s of sess.strokes) for (const x of s.res.findings || []) if (x.sev > 0 && !fx.has(x.key)) fx.set(x.key, { key: x.key, title: x.title, detail: x.detail, sev: x.sev, stroke: s.type, status: 'draft', text: '' });
    const A = annotationsAll(), notes = Object.entries(A).filter(([k]) => k.startsWith(`${sess.id || 'demo'}#`)).flatMap(([k, v]) => (v.notes || []).map((n) => ({ stroke: +k.split('#')[1] + 1, t: n.t, text: n.text })));
    const it = { id: uid(), date: new Date().toISOString(), label: sess.source === 'demo' ? 'Séance de démonstration' : (sess.label || 'Vidéo'), source: sess.source, entry: entryOf(sess), corrections: [...fx.values()].sort((a, c) => c.sev - a.sev).slice(0, 6), notes };
    st.sessions.push(it); save(d); selSess = it.id; render(); return;
  }
  if (b.dataset.sess) { selSess = b.dataset.sess; render(); return; }
  if (b.id === 'eDel') {
    if (b.dataset.arm) { d.students = d.students.filter((x) => x.id !== st.id); save(d); sel = d.students[0]?.id || null; selSess = null; render(); }
    else { b.dataset.arm = '1'; b.textContent = 'Confirmer la suppression'; setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = 'Supprimer l\'élève'; } }, 3000); }
    return;
  }
  const s = cs(d); if (!s) return;
  if (b.dataset.cv != null) { const c = s.corrections[+b.dataset.cv]; c.status = c.status === 'ok' ? 'draft' : 'ok'; save(d); render(); return; }
  if (b.dataset.cx != null) { const c = s.corrections[+b.dataset.cx]; c.status = c.status === 'rejected' ? 'draft' : 'rejected'; save(d); render(); return; }
  if (b.id === 'eCopy') {
    const txt = message(st, s);
    const done = () => { s.sentAt = new Date().toISOString(); save(d); render(); $('#eSendMsg').textContent = 'Message copié : colle-le dans ta messagerie habituelle.'; };
    try { navigator.clipboard.writeText(txt).then(done, () => { selectPreview(); $('#eSendMsg').textContent = 'Copie bloquée ici : le texte est sélectionné, copie-le à la main.'; }); }
    catch (err) { selectPreview(); $('#eSendMsg').textContent = 'Copie bloquée ici : le texte est sélectionné, copie-le à la main.'; }
    return;
  }
  if (b.id === 'eSave') {
    downloadsP.then(async (dl) => {
      if (!dl) return;
      try { await dl.save({ filename: `kyron-${st.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${s.date.slice(0, 10)}.txt`, data: message(st, s) }); s.sentAt = new Date().toISOString(); save(d); render(); $('#eSendMsg').textContent = 'Message enregistré.'; }
      catch (err) { $('#eSendMsg').textContent = 'Enregistrement refusé ou annulé.'; }
    });
  }
}
function selectPreview() { const p = $('#ePrev'); if (!p) return; const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function message(st, s) {
  const ok = s.corrections.filter((c) => c.status === 'ok');
  const lines = [`Bonjour ${st.name.replace(/ \(exemple\)$/, '')},`, '', `Retour sur ta séance du ${fmtD(s.date)} :`, ''];
  ok.forEach((c, i) => { lines.push(`${i + 1}. ${c.title}`); lines.push(`   ${c.text || c.detail}`); });
  if (s.notes?.length) { lines.push('', 'Notes sur la vidéo :'); s.notes.forEach((n) => lines.push(`- frappe ${n.stroke}, ${f(n.t, 2)} s : ${n.text}`)); }
  lines.push('', 'À la prochaine séance !');
  return lines.join('\n');
}

function render() {
  const d = load();
  if (!sel || !student(d)) sel = d.students[0]?.id || null;
  $('#eList').innerHTML = d.students.length ? d.students.map((x) => `<button class="st-it" data-st="${x.id}" aria-pressed="${x.id === sel}"><b>${esc(x.name)}</b><span>${esc(LEVEL_FR[x.level] || '')} · ${x.sessions.length} séance${x.sessions.length > 1 ? 's' : ''}</span></button>`).join('') : '<p class="note" style="padding:12px 16px">Aucun élève pour l\'instant.</p>';
  const st = student(d);
  if (!st) {
    $('#eMain').innerHTML = `<div class="pb"><p class="note">Ajoute un élève à gauche, ou charge trois élèves d'exemple pour voir l'espace coach.</p><button class="btn sm" id="eDemo" style="margin-top:12px">Créer 3 élèves d'exemple</button></div>`;
    renderCmp(d); return;
  }
  if (!selSess || !st.sessions.some((x) => x.id === selSess)) selSess = st.sessions[st.sessions.length - 1]?.id || null;
  const s = cs(d);
  const sesBtns = st.sessions.map((x) => `<button class="chip" data-sess="${x.id}" aria-pressed="${x.id === selSess}"><b>${fmtD(x.date)}</b><span>${esc(x.label.slice(0, 32))}${x.sentAt ? ' · envoyé' : ''}</span></button>`).join('');
  const cor = s ? (s.corrections.length ? s.corrections.map((c, i) => `<div class="corr ${c.status}"><div class="top"><b>${esc(c.title)}</b><span class="lbl">${c.status === 'ok' ? 'validée' : c.status === 'rejected' ? 'écartée' : 'à valider'}</span></div><p class="note">${esc(c.detail)}</p>
      <textarea data-ctext="${i}" rows="2" placeholder="Ta formulation pour l'élève (sinon le constat ci-dessus)" aria-label="Formulation de la correction">${esc(c.text || '')}</textarea>
      <div class="acts"><button class="btn sm ${c.status === 'ok' ? 'solid' : ''}" data-cv="${i}">${c.status === 'ok' ? 'Validée' : 'Valider'}</button><button class="btn sm" data-cx="${i}">${c.status === 'rejected' ? 'Rétablir' : 'Écarter'}</button></div></div>`).join('') : '<p class="note">Aucune correction prioritaire sur cette séance.</p>') : '';
  $('#eMain').innerHTML = `<div class="ph"><h2><i>02</i>${esc(st.name)}</h2><div class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm solid" id="eAttach">Ajouter la séance affichée</button><button class="btn sm" id="eDel">Supprimer l'élève</button></div></div>
    <div class="pb"><div class="hscroll">${sesBtns || '<p class="note">Pas encore de séance : analyse une vidéo de l\'élève dans Séance, puis « Ajouter la séance affichée ».</p>'}</div></div>
    ${s ? `<div class="ph" style="border-top:1px solid var(--rule)"><h2><i>03</i>Corrections à valider avant envoi</h2><span class="lbl">${s.corrections.filter((c) => c.status === 'ok').length} / ${s.corrections.length} validées</span></div><div class="pb corrs">${cor}</div>
    <div class="ph" style="border-top:1px solid var(--rule)"><h2><i>04</i>Message à l'élève</h2><span class="lbl">${s.sentAt ? `envoyé le ${fmtD(s.sentAt)}` : 'brouillon'}</span></div>
    <div class="pb"><pre class="ctx" id="ePrev"></pre><div class="acts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn sm solid" id="eCopy">Copier le message</button><button class="btn sm" id="eSave" hidden>Enregistrer en .txt</button></div><p class="note" id="eSendMsg" style="margin-top:8px">Seules les corrections validées partent. Pas de compte en ligne : le message se copie ou s'enregistre, tu l'envoies avec ta messagerie.</p></div>` : ''}`;
  if (s) renderPreview(d);
  downloadsP.then((dl) => { const b = $('#eSave'); if (b) b.hidden = !dl; });
  renderCmp(d);
}
function renderPreview(d) { const st = student(d), s = cs(d), p = $('#ePrev'); if (p && st && s) p.textContent = message(st, s); }

function renderCmp(d) {
  $$('#eCmpSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === cmpStroke)));
  const rows = d.students.map((x) => { const last = [...x.sessions].reverse().find((s) => s.entry?.byType?.[cmpStroke]); return { x, m: last?.entry.byType[cmpStroke].m, first: x.sessions.find((s) => s.entry?.byType?.[cmpStroke])?.entry.byType[cmpStroke].m }; }).filter((r) => r.m);
  const cols = [['score', 'Score', 0, ''], ['racketKmh', 'Raquette', 0, 'km/h'], ['kneeFlex', 'Genoux', 0, '°'], ['separation', 'Séparation', 0, '°'], ['inOrder', 'Chaîne en ordre', 0, '%', 100]];
  const best = Object.fromEntries(cols.map(([k, , , , sc]) => [k, Math.max(...rows.map((r) => (r.m[k] ?? -Infinity) * (sc || 1)))]));
  $('#eCmp thead').innerHTML = `<tr><th>Élève</th>${cols.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th class="n">Progrès score</th></tr>`;
  $('#eCmp tbody').innerHTML = rows.length ? rows.map(({ x, m, first }) => `<tr><td>${esc(x.name)}<br><small class="note">${esc(LEVEL_FR[x.level] || '')}</small></td>${cols.map(([k, , dd, u, sc]) => { const v = m[k] != null ? m[k] * (sc || 1) : null; return `<td class="n">${v == null ? '—' : `${v === best[k] && rows.length > 1 ? '<span class="acc">●</span> ' : ''}${f(v, dd)} <small class="note">${u}</small>`}</td>`; }).join('')}<td class="n">${first && first.score != null && m.score != null ? `${m.score - first.score >= 0 ? '+' : '−'}${fi(Math.abs(m.score - first.score))}` : '—'}</td></tr>`).join('')
    : `<tr><td colspan="7" class="note">Aucune séance de ${esc((STROKE_FR[cmpStroke] || '').toLowerCase())} enregistrée pour tes élèves.</td></tr>`;
}
export { analyzable };
