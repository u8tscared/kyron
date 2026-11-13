// KYRON · Coach IA conversationnel (capacité « sample » de claude.ai), nourri uniquement des mesures de la séance
import { $, esc, on, STROKE_FR } from './util.js';
import { S, cur } from './state.js';
import { sampleP } from './caps.js';
import { sessionSummary } from './summary.js';

const turns = [];          // historique {role, content} affiché
let sample = undefined, ctl = null, inited = false;

const RULES = `Tu es le coach IA de KYRON, un instrument d'analyse du geste de tennis par caméra. Tu parles français et tu tutoies le joueur.
Règles strictes :
- Tu t'appuies UNIQUEMENT sur les mesures du bloc DONNÉES ci-dessous. Tu n'inventes jamais un chiffre, une mesure ou une vidéo que tu n'as pas.
- Quand tu affirmes quelque chose, cite la mesure exacte avec son unité (ex. « flexion du genou 38°, cible 55–80° »).
- Si une donnée manque pour répondre, dis-le clairement et indique quelle prise ou quelle analyse la fournirait.
- Distingue les valeurs mesurées des valeurs estimées (vitesse de balle « estimée » = modèle, pas radar).
- Si la source est la démo synthétique, rappelle que ce n'est pas le geste du joueur.
- Réponses courtes et concrètes : 3 à 8 phrases ou une courte liste, puis une action à faire à la prochaine séance. Pas de titres. Mets en **gras** au plus deux éléments clés.
- Tu ne donnes pas d'avis médical : en cas de douleur, conseille de consulter un professionnel.`;

const SUGS = ['Pourquoi mon service manque de vitesse ?', 'Quelle correction m\'apporte le plus ?', 'Ma chaîne cinétique est-elle bonne ?', 'Est-ce que je fatigue sur la séance ?', 'Que dit l\'optimiseur ?', 'Quel exercice faire cette semaine ?'];

export async function show() {
  if (!inited) init();
  renderCtx();
  if (sample === undefined) {
    status('Connexion au coach…');
    sample = await sampleP;
    renderAvail();
  }
}

function init() {
  inited = true;
  $('#sugs').innerHTML = SUGS.map((s) => `<button type="button">${esc(s)}</button>`).join('');
  $('#sugs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); });
  $('#compose').addEventListener('submit', (e) => { e.preventDefault(); ask($('#q').value); });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#q').value); } });
  $('#stop').onclick = () => ctl?.abort();
  on('session', () => { if (!$('#v-coach').hidden) renderCtx(); });
  on('stroke', () => { if (!$('#v-coach').hidden) renderCtx(); });
  on('opt', () => { if (!$('#v-coach').hidden && S.opt.status !== 'running') renderCtx(); });
  renderMsgs();
}

function status(t) { $('#ctxSimple').textContent = t; }

function renderAvail() {
  const ok = !!sample;
  $('#q').disabled = !ok; $('#send').disabled = !ok;
  $$sugs().forEach((b) => { b.disabled = !ok; });
  $('#sugs').hidden = !ok; $('#compose').hidden = !ok;
  if (!ok && !turns.length) {
    $('#msgs').innerHTML = `<div class="m a"><span class="who">Coach</span>Le coach IA n'est pas disponible ici : il fonctionne quand KYRON est ouvert dans claude.ai. Toutes les mesures, corrections et exercices restent dans l'onglet Séance.</div>`;
  }
  renderCtx();
}
const $$sugs = () => [...document.querySelectorAll('#sugs button')];

function renderCtx() {
  const sum = sessionSummary();
  $('#ctx').textContent = sum ? JSON.stringify(sum, null, 1) : 'Aucune séance.';
  const s = cur();
  status(s ? `${S.session.source === 'demo' ? 'Séance de démonstration' : 'Ta séance'} : ${S.session.strokes.length} frappes, frappe affichée n° ${S.strokeIdx + 1} (${STROKE_FR[s.type]}, score ${s.res.score}). Profil : ${S.profile.height} cm, ${S.profile.weight} kg, ${S.profile.hand === 'right' ? 'droitier' : 'gaucher'}.${S.opt.result ? ` Optimiseur : ${Math.round(S.opt.result.trials).toLocaleString('fr-FR')} essais.` : ''}${sample === null ? ' Coach indisponible hors de claude.ai.' : ''}` : 'Aucune séance chargée.');
}

function md(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^[-•] /gm, '· ');
}
function renderMsgs(streaming) {
  if (!turns.length && !streaming) {
    $('#msgs').innerHTML = `<div class="m a"><span class="who">Coach</span>Je connais les mesures de ta séance : scores, angles, timings de la chaîne cinétique, fatigue et résultats de l'optimiseur. Pose ta question, je réponds avec tes chiffres.</div>`;
    return;
  }
  $('#msgs').innerHTML = turns.map((t) => `<div class="m ${t.role === 'user' ? 'u' : 'a'}${t.err ? ' err' : ''}"><span class="who">${t.role === 'user' ? 'Toi' : 'Coach'}</span>${t.role === 'user' ? esc(t.content) : md(t.content)}</div>`).join('');
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
}

const ERR = {
  not_granted: "Tu n'as pas autorisé le coach à utiliser Claude. Recharge la page pour qu'on te le redemande.",
  rate_limited: 'Trop de questions à la suite : attends quelques secondes.',
  prompt_too_large: 'La séance est trop volumineuse pour le coach : sélectionne une seule frappe.',
  refused: 'Le coach ne peut pas répondre à cette question.',
  sampling_disabled: "Le coach IA est désactivé pour ce compte.",
  capability_disabled: "Le coach IA est désactivé ici.",
  session_expired: 'Ta session claude.ai a expiré : recharge la page.',
};

async function ask(q) {
  q = (q || '').trim();
  if (!q || !sample || ctl) return;
  $('#q').value = '';
  turns.push({ role: 'user', content: q });
  const ans = { role: 'assistant', content: 'Analyse de tes mesures…' };
  turns.push(ans); renderMsgs(true);
  ctl = new AbortController();
  $('#stop').hidden = false; $('#send').disabled = true;
  const data = JSON.stringify(sessionSummary());
  const history = turns.slice(0, -1).filter((t) => !t.err && !t.pending).slice(-10).map((t) => ({ role: t.role, content: t.content }));
  const messages = [{ role: 'user', content: `${RULES}\n\nDONNÉES (JSON, mesures de la séance) :\n${data}\n\nRéponds d'abord « Compris. » puis attends ma question.` }, { role: 'assistant', content: 'Compris.' }, ...history];
  let first = true;
  try {
    const { text, truncated } = await sample(messages, {
      cache: false, signal: ctl.signal,
      onText: ({ text }) => { if (first) first = false; ans.content = text; renderMsgs(true); },
    });
    ans.content = (text || ans.content) + (truncated ? '\n\n(Réponse coupée : pose une question plus précise.)' : '');
  } catch (e) {
    const code = e?.code;
    if (code === 'cancelled') ans.content = e.text || 'Réponse interrompue.';
    else { ans.content = (e?.text ? e.text + '\n\n' : '') + (ERR[code] || 'Le coach n\'a pas pu répondre. Réessaie dans un instant.'); ans.err = true; }
    if (code === 'not_granted' || code === 'sampling_disabled' || code === 'capability_disabled' || code === 'capability_removed') { sample = null; renderAvail(); }
  } finally {
    ctl = null; $('#stop').hidden = true; $('#send').disabled = !sample;
    renderMsgs();
  }
}
