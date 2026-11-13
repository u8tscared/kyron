// KYRON · charge cumulée et prévention (vague 2).
//
// Entrée : historique de séances [{ date, strokes: [{ type, peakShoulderTorque? (N·m), racketKmh? }] }].
// Charge d'une frappe (unités arbitraires « UA », 1 UA ≈ un coup droit de référence) :
//   - si le moment d'épaule estimé est connu : (τ / τ_ref)², τ_ref = 40 N·m (le dommage tissulaire croît plus vite
//     que linéairement avec la charge — exposant 2 choisi par prudence, pas une loi établie) ;
//   - sinon, vitesse de raquette : (v / v_ref)², v_ref = 100 km/h (énergie cinétique de la raquette) ;
//   - sinon, forfait par type ;
//   le tout pondéré par le type (service ×1,6 : rotation interne et lombaires plus sollicitées, Kibler 2007).
// Charges aiguë (7 j) et chronique (28 j) par moyennes mobiles exponentielles (EWMA, Williams et al. 2017,
// λ = 2/(N+1)), ratio aiguë/chronique (ACWR, Gabbett 2016 : zone favorable 0,8–1,3, risque > 1,5).
// Honnêteté : l'ACWR est un indicateur de PILOTAGE discuté (Impellizzeri 2020 : couplage mathématique, causalité
// non démontrée). On l'utilise pour éviter les pics brusques, pas comme prédicteur de blessure.

const DAY = 86400000;
export const LOAD_REF = { torqueNm: 40, racketKmh: 100 };
export const TYPE_WEIGHT = { serve: 1.6, smash: 1.6, forehand: 1, backhand: 0.9, volley: 0.5 };
const TYPE_DEFAULT_UA = { serve: 1.6, smash: 1.6, forehand: 1, backhand: 0.9, volley: 0.4 };
export const ZONES = [
  { key: 'under', label: 'Sous-charge', lo: 0, hi: 0.8, detail: 'Charge récente faible par rapport à l’habitude : la reprise devra être progressive.' },
  { key: 'optimal', label: 'Zone favorable', lo: 0.8, hi: 1.3, detail: 'Charge récente cohérente avec ce à quoi le corps est habitué.' },
  { key: 'caution', label: 'Vigilance', lo: 1.3, hi: 1.5, detail: 'Hausse rapide : surveiller épaule, coude et dos.' },
  { key: 'danger', label: 'Pic de charge', lo: 1.5, hi: Infinity, detail: 'Charge récente nettement au-dessus de l’habitude : période associée à plus de blessures chez les sportifs.' },
];

const dayKey = (d) => { const x = new Date(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };

// Charge d'une frappe (UA)
export function strokeLoad(s) {
  const w = TYPE_WEIGHT[s.type] ?? 1;
  if (Number.isFinite(s.peakShoulderTorque) && s.peakShoulderTorque > 0) return w * (s.peakShoulderTorque / LOAD_REF.torqueNm) ** 2;
  if (Number.isFinite(s.racketKmh) && s.racketKmh > 0) return w * (s.racketKmh / LOAD_REF.racketKmh) ** 2;
  return TYPE_DEFAULT_UA[s.type] ?? 1;
}

/**
 * computeLoad(history, { today?, acuteDays = 7, chronicDays = 28 })
 * → { daily: [{ date (ISO jj), load, strokes, serves }], acute, chronic, acwr, zone: {key,label,detail},
 *     weekLoad, prevWeekLoad, weekChangePct, monotony, strain, alerts: [{key,label,detail,severity}],
 *     advice: { targetWeekLoad:[lo,hi], loadPerStroke, strokesPerWeek:[lo,hi], servesPerSession, text },
 *     confidence (0–1 : quantité d'historique) }
 * acute / chronic sont des charges JOURNALIÈRES moyennes (UA/jour).
 */
export function computeLoad(history = [], { today = null, acuteDays = 7, chronicDays = 28 } = {}) {
  const sessions = (history || []).filter((s) => s && s.date != null && Array.isArray(s.strokes));
  const byDay = new Map();
  for (const s of sessions) {
    const k = dayKey(s.date);
    const d = byDay.get(k) || { load: 0, strokes: 0, serves: 0, sessions: 0 };
    for (const st of s.strokes) { d.load += strokeLoad(st); d.strokes++; if (st.type === 'serve') d.serves++; }
    d.sessions++;
    byDay.set(k, d);
  }
  const end = dayKey(today ?? (byDay.size ? Math.max(...byDay.keys()) : Date.now()));
  const start = byDay.size ? Math.min(...byDay.keys(), end) : end;
  const la = 2 / (acuteDays + 1), lc = 2 / (chronicDays + 1);
  const daily = [];
  // Amorçage : la chronique démarre à la moyenne des 7 premiers jours disponibles (évite un ACWR artificiel ≫ 1)
  let first7 = 0; for (let d = start; d < start + 7 * DAY; d += DAY) first7 += byDay.get(d)?.load || 0;
  let acute = first7 / 7, chronic = first7 / 7;
  for (let d = start; d <= end; d += DAY) {
    const x = byDay.get(d) || { load: 0, strokes: 0, serves: 0 };
    acute = la * x.load + (1 - la) * acute;
    chronic = lc * x.load + (1 - lc) * chronic;
    daily.push({ date: new Date(d).toISOString().slice(0, 10), load: x.load, strokes: x.strokes, serves: x.serves, acute, chronic });
  }
  const acwr = chronic > 1e-9 ? acute / chronic : (acute > 0 ? Infinity : null);
  const zone = acwr == null ? null : ZONES.find((z) => acwr >= z.lo && acwr < z.hi);
  const last = (k) => daily.slice(-k);
  const sum = (a) => a.reduce((s, x) => s + x.load, 0);
  const weekLoad = sum(last(7)), prevWeekLoad = sum(daily.slice(-14, -7));
  const weekChangePct = prevWeekLoad > 0 ? (weekLoad / prevWeekLoad - 1) * 100 : null;
  // Monotonie de Foster (moyenne / écart-type de la charge journalière sur 7 j) et contrainte = charge × monotonie
  const w7 = last(7).map((x) => x.load);
  const mean = w7.reduce((a, b) => a + b, 0) / Math.max(1, w7.length);
  const sd = Math.sqrt(w7.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, w7.length));
  const monotony = sd > 1e-9 ? mean / sd : null;
  const strain = monotony != null ? weekLoad * monotony : null;

  const alerts = [];
  const f = (v, d = 1) => v.toFixed(d).replace('.', ',');
  if (zone?.key === 'danger') alerts.push({ key: 'acwr', label: 'Pic de charge', severity: 3, detail: `Ratio aiguë / chronique ${f(acwr, 2)} (> 1,5). Réduire le volume des prochains jours, en priorité les services.` });
  else if (zone?.key === 'caution') alerts.push({ key: 'acwr', label: 'Charge en hausse rapide', severity: 2, detail: `Ratio aiguë / chronique ${f(acwr, 2)} (zone favorable 0,8–1,3).` });
  // Gabbett 2016 : au-delà d'environ +10–15 % d'une semaine à l'autre, le risque augmente
  if (weekChangePct != null && weekChangePct > 15 && prevWeekLoad > 0) alerts.push({ key: 'weekJump', label: 'Hausse hebdomadaire forte', severity: weekChangePct > 40 ? 3 : 2, detail: `+${f(weekChangePct, 0)} % de charge par rapport à la semaine précédente (repère : ≤ 10–15 %).` });
  if (monotony != null && monotony > 2) alerts.push({ key: 'monotony', label: 'Entraînement monotone', severity: 1, detail: `Monotonie ${f(monotony, 1)} (> 2, Foster 1998) : alterner jours chargés et jours légers.` });
  const lastDay = daily[daily.length - 1];
  const servesDay = Math.max(0, ...last(7).map((x) => x.serves));
  if (servesDay > 120) alerts.push({ key: 'serves', label: 'Beaucoup de services sur une journée', severity: 2, detail: `${servesDay} services sur une journée récente : l'épaule récupère mieux avec des blocs plus courts.` });
  if (zone?.key === 'under' && chronic > 0) alerts.push({ key: 'under', label: 'Charge en baisse', severity: 1, detail: 'Après une coupure, remonter progressivement (≈ +10 % par semaine).' });

  // Conseil de volume : charge hebdomadaire qui maintiendrait l'ACWR dans 0,8–1,3 (approximation : aiguë ≈
  // charge moyenne de la semaine, chronique quasi constante sur 7 jours)
  const loadPerStroke = (() => { let l = 0, c = 0; for (const x of last(28)) { l += x.load; c += x.strokes; } return c ? l / c : 1; })();
  const target = chronic > 1e-9 ? [0.8 * chronic * 7, 1.3 * chronic * 7] : [0, 0];
  const strokesPerWeek = target.map((x) => Math.round(x / Math.max(1e-6, loadPerStroke)));
  const servesShare = (() => { let s = 0, c = 0; for (const x of last(28)) { s += x.serves; c += x.strokes; } return c ? s / c : 0.3; })();
  const sessionsPerWeek = Math.max(1, Math.round(sessions.filter((s) => dayKey(s.date) > end - 28 * DAY).length / 4));
  const servesPerSession = Math.round(strokesPerWeek[1] * servesShare / sessionsPerWeek);
  const text = chronic <= 1e-9
    ? 'Pas encore assez d’historique : commence par des séances modérées et régulières.'
    : zone?.key === 'danger' || zone?.key === 'caution'
      ? `Cette semaine, vise au plus ${strokesPerWeek[1]} frappes (≈ ${servesPerSession} services par séance), puis remonte progressivement.`
      : zone?.key === 'under'
        ? `Tu peux remonter vers ${strokesPerWeek[0]}–${strokesPerWeek[1]} frappes cette semaine, sans dépasser +15 % par semaine ensuite.`
        : `Volume adapté : ${strokesPerWeek[0]}–${strokesPerWeek[1]} frappes sur la semaine (≈ ${servesPerSession} services par séance).`;
  const days = daily.length;
  return {
    daily, acute, chronic, acwr, zone, weekLoad, prevWeekLoad, weekChangePct, monotony, strain,
    alerts: alerts.sort((a, b) => b.severity - a.severity),
    advice: { targetWeekLoad: target, loadPerStroke, strokesPerWeek, servesPerSession, text },
    lastDay, confidence: Math.min(1, days / 28),
    units: { load: 'UA (≈ un coup droit de référence)', acute: 'UA/jour', chronic: 'UA/jour' },
  };
}
