// KYRON · résumé compact des mesures (coach IA, rapport exporté)
import { S } from './state.js';
import { STROKE_FR } from './util.js';

const r1 = (v, d = 1) => (Number.isFinite(v) ? +v.toFixed(d) : null);

export function strokeSummary(s, i) {
  const r = s.res, m = r.metrics;
  const out = {
    n: i + 1, type: STROKE_FR[s.type] || s.type, score: r.score,
    vitesse_balle_kmh: r1(s.ball?.speedKmh ?? m.ballSpeedKmh, 0), vitesse_balle_source: s.ball?.speedKmh ? 'mesurée (suivi de balle)' : 'estimée (modèle)',
    vitesse_raquette_kmh: r1(m.racketSpeed * 3.6, 0), vitesse_poignet_ms: r1(m.wristSpeed),
    flexion_genou_deg: r1(m.kneeFlex, 0), separation_hanches_epaules_deg: r1(m.separation, 0), coude_impact_deg: r1(m.elbowImpact, 0),
    rotation_epaules_deg: r1(m.shoulderTurn, 0), tete_deplacement_cm: r1(m.headDrift * 100, 0),
    chaine: { ordre_respecte: r.inOrder, ecarts_ms: r.gaps, pics_ms_avant_impact: Object.fromEntries(r.sequence.map((q) => [q.label, q.ms])) },
    constats: r.findings.map((x) => ({ titre: x.title, gravite: x.sev, detail: x.detail, gain_vitesse_pct: x.gain || 0 })),
    exercices: r.exercises.map((e) => ({ nom: e.name, dose: e.dose, critere: e.check })),
  };
  if (Number.isFinite(m.contactRatio)) out.hauteur_contact_x_taille = r1(m.contactRatio, 2);
  for (const [k, lab, d] of [['shoulderElev', 'elevation_epaule_deg', 0], ['shoulderRotExt', 'rotation_externe_deg', 0], ['shoulderIRVel', 'rotation_interne_pic_deg_s', 0], ['comShift', 'transfert_cdm_m', 2], ['balance', 'equilibre_0_1', 2], ['tossApex', 'lancer_sommet_m', 2], ['tossDrop', 'lancer_au_dessus_contact_m', 2], ['tossForward', 'lancer_devant_m', 2]]) if (Number.isFinite(m[k])) out[lab] = r1(m[k], d);
  if (Number.isFinite(r.confidence)) out.confiance_mesure = r1(r.confidence, 2);
  return out;
}

export function sessionSummary({ full = false } = {}) {
  const sess = S.session; if (!sess) return null;
  const o = S.opt.result;
  return {
    joueur: { taille_cm: S.profile.height, poids_kg: S.profile.weight, main: S.profile.hand === 'right' ? 'droitier' : 'gaucher', niveau: S.profile.level },
    seance: {
      source: sess.source === 'demo' ? 'démo synthétique (pas le joueur)' : sess.multi ? 'vidéo 2 caméras fusionnées' : 'vidéo 1 caméra',
      date: sess.date, nb_frappes: sess.strokes.length,
      par_type: Object.fromEntries(Object.entries(sess.summary?.byType || {}).map(([k, v]) => [STROKE_FR[k] || k, v])),
      score_moyen: sess.summary?.meanScore,
      qualite_prise: sess.quality ? { score: sess.quality.score, i_s: Math.round(sess.quality.fps || 0), problemes: (sess.quality.issues || []).map((x) => x.label) } : null,
      fatigue: sess.fatigue ? { derive_vitesse_pct: r1(sess.fatigue.slopePct), alerte: !!sess.fatigue.alert, detail: sess.fatigue.detail } : null,
    },
    frappe_affichee: S.strokeIdx + 1,
    frappes: full ? sess.strokes.map(strokeSummary) : [strokeSummary(sess.strokes[S.strokeIdx], S.strokeIdx), ...sess.strokes.filter((_, i) => i !== S.strokeIdx).map((s, i) => ({ n: sess.strokes.indexOf(s) + 1, type: STROKE_FR[s.type], score: s.res.score, vitesse_raquette_kmh: r1(s.res.metrics.racketSpeed * 3.6, 0) }))],
    optimiseur: o ? {
      essais: o.trials, duree_s: r1(o.ms / 1000), coeurs: o.workers,
      actuel: { balle_kmh: r1(o.current?.ballKmh, 0), effet_tr_min: r1(o.current?.spinRpm, 0), balles_bonnes_pct: r1((o.current?.successRate ?? NaN) * 100, 0) },
      optimum: { balle_kmh: r1(o.best?.ballKmh, 0), gain_pct: r1(o.best?.gainPct), balles_bonnes_pct: r1((o.best?.successRate ?? NaN) * 100, 0), parametres: o.best?.params },
      sensibilite: (o.sensitivity || []).slice(0, 5).map((x) => ({ reglage: x.label, gain_pct: r1(x.gainPct), de: x.from, a: x.to, unite: x.unit })),
      materiel: o.equipment?.best ? { ...o.equipment.best, gain_pct: r1(o.equipment.gainPct) } : null,
    } : (S.opt.status === 'running' ? 'en cours' : null),
    materiel: { raquette: S.equipment.spec?.name || S.equipment.racket, cordage: S.equipment.string, tension_pose_kg: S.equipment.tension, jauge_mm: S.equipment.gauge, jours_depuis_pose: S.equipment.days, heures_jouees: S.equipment.hours, plombs_g: S.equipment.leads },
  };
}
