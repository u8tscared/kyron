// KYRON · utilitaires communs à toutes les vues
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

// Nombres à la française
export const f = (v, d = 0) => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(d).replace('.', ',').replace('-', '−');
export const fi = (v) => (v == null || !Number.isFinite(+v)) ? '—' : Math.round(v).toLocaleString('fr-FR').replace(/\s/g, '\u00a0');
export const big = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${f(n / 1e6, n >= 1e7 ? 1 : 2)} M`;
  if (n >= 1e3) return `${f(n / 1e3, 0)} k`;
  return fi(n);
};
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const STROKE_FR = { serve: 'Service', forehand: 'Coup droit', backhand: 'Revers', volley: 'Volée', smash: 'Smash' };
export const LEVEL_FR = { loisir: 'Loisir', club: 'Club', competition: 'Compétition', pro: 'Pro / espoir' };
// Dispersion naturelle selon le niveau (angle °, vitesse, effet)
export const DISP = {
  loisir: { angle: 1.4, speed: 0.06, spin: 0.2 },
  club: { angle: 1.0, speed: 0.045, spin: 0.15 },
  competition: { angle: 0.7, speed: 0.03, spin: 0.12 },
  pro: { angle: 0.5, speed: 0.022, spin: 0.09 },
};
// analyze() ne connaît que service / coup droit / revers
export const analyzable = (t) => (t === 'smash' ? 'serve' : t === 'volley' ? 'forehand' : (t === 'serve' || t === 'forehand' || t === 'backhand') ? t : 'serve');

// Stockage local optionnel
export const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* rien */ } },
};

// Bus d'évènements minimal
const subs = {};
export const on = (ev, fn) => { (subs[ev] ||= []).push(fn); };
export const emit = (ev, data) => { for (const fn of subs[ev] || []) { try { fn(data); } catch (e) { console.warn(`[kyron] ${ev}`, e); } } };

// Canvas net à la densité de l'écran ; renvoie un contexte en px CSS
export function fit(c, maxDpr = 2) {
  const r = c.getBoundingClientRect(), dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  return { g, w: r.width, h: r.height, dpr };
}

export const C = {
  bg: '#000', ink: '#F4F4F2', ink2: '#C9C9C6', mute: '#8B8B8F', dim: '#4A4A4E', acc: '#FF4D1A',
  s1: '#F4F4F2', s2: '#B4B4B0', s3: '#7A7A7E', s4: '#4F4F53',
  rule: 'rgba(255,255,255,.12)', rule2: 'rgba(255,255,255,.22)',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace', disp: '"Michroma", "Arial", sans-serif', body: '"IBM Plex Sans", system-ui, sans-serif',
};

// Régression linéaire simple
export function linreg(ys) {
  const n = ys.length; if (n < 2) return { slope: 0, icpt: ys[0] ?? 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  ys.forEach((y, x) => { sx += x; sy += y; sxx += x * x; sxy += x * y; });
  const slope = (n * sxy - sx * sy) / ((n * sxx - sx * sx) || 1);
  return { slope, icpt: (sy - slope * sx) / n };
}

export const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
