// KYRON · état partagé entre les vues
import { store } from './util.js';

const prof = store.get('kyron-profile', null);
export const S = {
  mode: store.get('kyron-mode', 'simple') === 'adv' ? 'adv' : 'simple',
  profile: { height: 180, weight: 75, hand: 'right', level: 'competition', ...(prof || {}) },
  profileSet: !!prof,
  // Séance analysée : { source:'demo'|'video', strokes[], fatigue, summary, quality, videos, ballTrack, date }
  session: null,
  strokeIdx: 0,
  // Matériel et conditions partagés (Matériel, Balle, Optimiseur)
  equipment: { racket: 'ctrl98', spec: null, leads: { h12: 0, h10_2: 0, h9_3: 0, throat: 0, handle: 0 }, string: 'poly', tension: 24, gauge: 1.25, days: 5, hours: 6 },
  conditions: { alt: 0, temp: 20, wind: 0, surface: 'hard', hum: 0.5 },
  // Geste pour le banc matériel / balle (km/h, °, m, cm) — pré-rempli depuis la dernière analyse
  swing: null,
  swingFrom: null,
  opt: { status: 'idle', progress: null, result: null, error: null, budget: 'full', goal: 'balanced', startedAt: 0, trace: [] },
};

export const cur = () => S.session?.strokes?.[S.strokeIdx] || null;
export const curRes = () => cur()?.res || null;
