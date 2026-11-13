// KYRON · petits composants partagés : feuille en bas d'écran, toast, compteur animé, anneau de score, icônes, dessins.
import { esc, reduced } from './util.js';

// ---------- Feuille en bas d'écran (bottom sheet) ----------
let sh = null, lastFocus = null;
function mkSheet() {
  sh = document.createElement('div');
  sh.className = 'sheet'; sh.hidden = true;
  sh.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="shT"><span class="sheet-grip" aria-hidden="true"></span><div class="sheet-h"><h3 id="shT"></h3><button type="button" class="icon-btn" data-close aria-label="Fermer">${ICON.close}</button></div><div class="sheet-b"></div></div>`;
  document.body.appendChild(sh);
  sh.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) sheet.close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sh.hidden) { e.preventDefault(); sheet.close(); } });
  // glisser vers le bas pour fermer
  let y0 = null; const card = sh.querySelector('.sheet-card');
  card.addEventListener('touchstart', (e) => { if (card.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchmove', (e) => { if (y0 == null) return; const dy = Math.max(0, e.touches[0].clientY - y0); card.style.transform = `translateY(${dy}px)`; }, { passive: true });
  card.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; card.style.transform = ''; if (dy > 90) sheet.close(); });
}
export const sheet = {
  open({ title, html, onMount }) {
    if (!sh) mkSheet();
    lastFocus = document.activeElement;
    sh.querySelector('#shT').textContent = title || '';
    sh.querySelector('.sheet-b').innerHTML = html || '';
    sh.hidden = false;
    requestAnimationFrame(() => { sh.classList.add('on'); sh.querySelector('.sheet-h .icon-btn').focus({ preventScroll: true }); });
    onMount?.(sh.querySelector('.sheet-b'));
  },
  close() {
    if (!sh || sh.hidden) return;
    sh.classList.remove('on');
    setTimeout(() => { sh.hidden = true; lastFocus?.focus?.({ preventScroll: true }); }, reduced() ? 0 : 220);
  },
};

// ---------- Toast ----------
let toastEl = null, toastT = 0;
export function toast(msg, kind = '') {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.className = `toast on ${kind}`;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
}

// ---------- Compteur animé ----------
export function countUp(el, to, { dur = 900, dec = 0, fmt } = {}) {
  if (!el) return;
  const show = (v) => { el.textContent = fmt ? fmt(v) : (dec ? v.toFixed(dec).replace('.', ',') : Math.round(v).toLocaleString('fr-FR').replace(/\s/g, ' ')); };
  if (reduced() || !Number.isFinite(to)) { show(to); return; }
  const t0 = performance.now();
  const step = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3; show(to * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ---------- Anneau de score (SVG, graduations façon instrument) ----------
export function ringSvg(score, { size = 168, label = 'sur 100' } = {}) {
  const n = 60, R = 46, r0 = 40, out = [];
  for (let i = 0; i < n; i++) {
    const a = (-225 + (270 * i) / (n - 1)) * Math.PI / 180, on = i / (n - 1) <= score / 100, major = i % 6 === 0;
    const r1 = major ? r0 - 3 : r0;
    out.push(`<line x1="${50 + Math.cos(a) * R}" y1="${50 + Math.sin(a) * R}" x2="${50 + Math.cos(a) * r1}" y2="${50 + Math.sin(a) * r1}" class="${on ? 'on' : ''}" style="--d:${(i * 12)}ms"/>`);
  }
  return `<svg class="ring" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Score ${score} sur 100">${out.join('')}<text x="50" y="47" class="ring-n" data-score="${score}">${score}</text><text x="50" y="65" class="ring-l">${esc(label)}</text></svg>`;
}

// ---------- Icônes (traits fins) ----------
const sv = (d, vb = 24) => `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  home: sv('<path d="M3.5 10.5 12 4l8.5 6.5V20h-6v-5.5h-5V20h-6z"/>'),
  scan: sv('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3.2"/>'),
  chart: sv('<path d="M4 19h16"/><path d="M5 15l4.5-4.5 3.5 3 6-6.5"/><circle cx="19" cy="7" r="1.3"/>'),
  user: sv('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6"/>'),
  lab: sv('<path d="M9.5 3.5h5M10.5 3.5v5.2L5 18.3A1.5 1.5 0 0 0 6.3 20.5h11.4a1.5 1.5 0 0 0 1.3-2.2l-5.5-9.6V3.5"/><path d="M7.5 14.5h9"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  next: sv('<path d="M9 5l7 7-7 7"/>'),
  close: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
  camera: sv('<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.5l1.5-2h6l1.5 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="13" r="3.5"/>'),
  upload: sv('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 14.5v4A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-4"/>'),
  check: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  bolt: sv('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'),
  racket: sv('<ellipse cx="14.5" cy="9" rx="5.5" ry="6"/><path d="M10.6 13.3 4 20.5"/><path d="M11 6h7M10 9.5h9M11 12.5h7"/>'),
  ball: sv('<path d="M3 17c4-12 10-12 18 0" stroke-dasharray="2 2.5"/><circle cx="19" cy="16" r="2"/><path d="M3 20h18"/>'),
  court: sv('<rect x="5" y="3" width="14" height="18"/><path d="M5 12h14M8.5 3v18M15.5 3v18M8.5 7.5h7M8.5 16.5h7"/>'),
  chat: sv('<path d="M4 5h16v11H11l-5 4v-4H4z"/>'),
  team: sv('<circle cx="8.5" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3 19c.7-3.4 2.8-5.2 5.5-5.2S13.3 15.6 14 19M14.5 14.3c2.6-.7 5.3.7 6.3 4.2"/>'),
  ghost: sv('<path d="M12 3.5a2 2 0 1 1 0 .01M12 7.5v6l-3 6.5M12 13.5l3 6.5M8 10.5l4-2 4 2"/><path d="M5 5.5l2 1M19 5.5l-2 1" stroke-dasharray="1.5 2"/>'),
  doc: sv('<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>'),
  info: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  spark: sv('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  shield: sv('<path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
  trash: sv('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
  logout: sv('<path d="M14 4.5H6.5v15H14M10.5 12H20M16.5 8.5 20 12l-3.5 3.5"/>'),
};

// ---------- Silhouettes des coups (traits fins, articulations orange) ----------
const J = (pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" class="j"/>`).join('');
const L = (d) => `<path d="${d}" class="b"/>`;
export const STROKE_ART = {
  serve: `<svg viewBox="0 0 120 120" class="art" aria-hidden="true">${L('M58 44 L58 74 M58 50 L46 40 L42 26 M58 50 L68 36 L72 22 M58 74 L50 94 L48 114 M58 74 L66 94 L70 114')}<path d="M72 22 L80 12" class="rk"/><ellipse cx="85" cy="7" rx="6" ry="8" class="rk" transform="rotate(35 85 7)"/><circle cx="57" cy="36" r="5.5" class="b"/><circle cx="40" cy="12" r="3" class="ball"/>${J([[58, 50], [46, 40], [68, 36], [72, 22], [58, 74], [50, 94], [66, 94]])}</svg>`,
  forehand: `<svg viewBox="0 0 120 120" class="art" aria-hidden="true">${L('M56 34 L58 64 M56 40 L44 52 L38 60 M56 40 L70 50 L86 50 M58 64 L46 86 L40 106 M58 64 L70 84 L78 106')}<path d="M86 50 L96 44" class="rk"/><ellipse cx="103" cy="40" rx="7" ry="9" class="rk" transform="rotate(60 103 40)"/><circle cx="55" cy="26" r="6" class="b"/><circle cx="112" cy="40" r="3" class="ball"/>${J([[56, 40], [44, 52], [70, 50], [86, 50], [58, 64], [46, 86], [70, 84]])}</svg>`,
  backhand: `<svg viewBox="0 0 120 120" class="art" aria-hidden="true">${L('M62 34 L60 64 M62 40 L48 50 L32 52 M62 40 L52 54 L34 54 M60 64 L48 86 L42 106 M60 64 L74 84 L80 106')}<path d="M33 53 L22 46" class="rk"/><ellipse cx="15" cy="41" rx="7" ry="9" class="rk" transform="rotate(-60 15 41)"/><circle cx="63" cy="26" r="6" class="b"/><circle cx="6" cy="40" r="3" class="ball"/>${J([[62, 40], [48, 50], [52, 54], [33, 53], [60, 64], [48, 86], [74, 84]])}</svg>`,
};

export const fmtDate = (d) => { try { const x = new Date(d), now = new Date(); const days = Math.floor((now - x) / 864e5); if (days === 0 && x.getDate() === now.getDate()) return `Aujourd’hui, ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`; if (days <= 1) return 'Hier'; if (days < 7) return x.toLocaleDateString('fr-FR', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase()); return x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: x.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }); } catch (e) { return ''; } };

// Révélation échelonnée des enfants marqués .rv
export function reveal(root) {
  if (!root) return;
  [...root.querySelectorAll('.rv')].forEach((el, i) => { el.style.setProperty('--i', i); el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); });
}
