// KYRON · profil du compte ↔ état de l'app (S.profile, S.mode, matériel) + mode Simple / Expert
import { $$, emit, store } from './util.js';
import { S } from './state.js';
import { account } from './acct.js';

export const LEVELS = [
  { k: 'amateur', t: 'Amateur', d: 'Je joue pour le plaisir ou en club.' },
  { k: 'competition', t: 'Compétition', d: 'Je fais des tournois, je suis classé.' },
  { k: 'pro', t: 'Pro', d: 'Joueur professionnel ou espoir.' },
  { k: 'coach', t: 'Coach', d: 'J’entraîne des joueurs.' },
];
// Niveau du compte → niveau de dispersion du moteur (util.DISP)
const ENGINE_LEVEL = { amateur: 'club', competition: 'competition', pro: 'pro', coach: 'competition' };
export let profile = null;

export function applyProfile(p, { silent = false } = {}) {
  profile = p ? { ...p } : null;
  if (!p) return;
  const prev = { ...S.profile };
  S.profile = {
    height: Number.isFinite(+p.heightCm) && +p.heightCm > 0 ? +p.heightCm : prev.height || 180,
    weight: Number.isFinite(+p.massKg) && +p.massKg > 0 ? +p.massKg : prev.weight || 75,
    hand: p.hand === 'L' ? 'left' : 'right',
    level: ENGINE_LEVEL[p.level] || 'competition',
  };
  S.profileSet = !!(p.heightCm && p.massKg);
  if (p.racket) { S.equipment.racket = p.racket; S.equipment.spec = null; }
  // cordage : clé de physics.STRINGS ; tension posée à part (stringTension, kg)
  if (typeof p.strings === 'string' && p.strings) S.equipment.string = p.strings;
  if (Number.isFinite(+p.stringTension) && +p.stringTension > 0) S.equipment.tension = +p.stringTension;
  setMode(p.mode === 'expert' ? 'adv' : 'simple', { persist: false });
  if (!silent && (prev.height !== S.profile.height || prev.hand !== S.profile.hand || prev.weight !== S.profile.weight || prev.level !== S.profile.level)) emit('profile', { prev, next: S.profile });
}

export async function saveProfile(patch) {
  const p = await account.saveProfile(patch);
  applyProfile(p || { ...profile, ...patch });
  emit('account-profile', profile);
  return profile;
}

export function setMode(m, { persist = true } = {}) {
  const next = m === 'adv' || m === 'expert' ? 'adv' : 'simple';
  const changed = next !== S.mode;
  S.mode = next;
  document.body.classList.toggle('adv', S.mode === 'adv');
  $$('.mode-tog').forEach((b) => b.setAttribute('aria-checked', String(S.mode === 'adv')));
  store.set('kyron-mode', S.mode);
  if (persist && account.user()) account.saveProfile({ mode: S.mode === 'adv' ? 'expert' : 'simple' }).then((p) => { if (p) profile = { ...p }; }).catch((e) => console.warn('[kyron] mode', e));
  if (changed) emit('mode', S.mode);
}

export const firstName = () => (profile?.name || account.user()?.name || '').trim().split(/\s+/)[0] || '';
