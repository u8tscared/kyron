// KYRON · analyse de match (I01–I04), caméra fixe derrière la ligne de fond du joueur suivi (« proche »).
//
// Le module travaille sur des ÉVÈNEMENTS, produits par les autres modules :
//   - strokes  : frappes du joueur proche [{t, type, conf}] (session.analyzeSession → strokes, ou detectStrokes +
//                classifyStroke) ;
//   - bounces  : rebonds au sol [{t, x, y}] en mètres (repère court.js), p. ex. bouncesFromTrack(track, cal) ;
//   - ballSeen : instants où la balle est détectée (ball.js), pour repérer les temps morts ;
//   - positions: positions au sol du joueur [{t, x, y}] (footwork.js ou court.feetOnGround).
// Heuristiques (toutes approximatives, avec une confiance) :
//   1. points : coupure dès que rien ne se passe (ni frappe, ni balle, ni rebond) pendant ≥ pauseS (5 s) ;
//      un « point » réduit à un service suivi d'un nouveau service du même joueur en moins de 25 s = première
//      balle faute (fusionné avec le point suivant) ; un rebond de service hors du carré confirme la faute ;
//   2. frappes adverses : entre deux frappes du joueur proche dans un même échange, l'adversaire a frappé une
//      fois ; la direction de son coup = rebond sur la moitié proche qui précède la frappe suivante ;
//   3. issue d'un point : dernier rebond après la dernière frappe dehors → point perdu par le dernier frappeur ;
//      dedans et pas de retour → gagné par le dernier frappeur ; sans rebond observé → inconnue.
//
// Module pur, sans DOM.

import { toGround, COURT_ITF } from './court.js';

const C = COURT_ITF;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const inSingles = (b, margin = 0) => Math.abs(b.x) <= C.halfWidthSingles + margin && Math.abs(b.y) <= C.halfLength + margin;
// Carré de service visé par un serveur de la moitié `from` ('near' : y < 0), côté égalité/avantage selon x du serveur.
function inServiceBox(b, from, serverX, margin = 0.05) {
  const far = from === 'near';
  const dy = far ? b.y : -b.y;
  if (dy < -margin || dy > C.serviceLine + margin) return false;
  // Le service part en diagonale : serveur à droite du centre (x > 0) → carré de gauche (x < 0) en face, etc.
  const sx = Number.isFinite(serverX) && serverX !== 0 ? -Math.sign(serverX) : null;
  if (Math.abs(b.x) > C.halfWidthSingles + margin) return false;
  return sx == null || Math.sign(b.x) === sx || Math.abs(b.x) < margin;
}

// ---------------------------------------------------------------------------------------------- rebonds
// Rebonds dans une piste de balle (ball.js : [{t, x, y, id?}] normalisés), caméra derrière le court : un rebond
// est une cassure brutale de la vitesse verticale image (la balle descend puis remonte vers le haut de l'image).
// cal : calibration court.js (sinon les rebonds restent en coordonnées image). Renvoie [{t, x, y, img, conf}].
export function bouncesFromTrack(track, { cal = null, minKink = 0.25, maxGap = 0.1 } = {}) {
  const P = (track || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 2; i < P.length - 2; i++) {
    const a = P[i - 2], b = P[i], c = P[i + 2];
    if (b.t - a.t > maxGap || c.t - b.t > maxGap) continue;
    const v1 = (b.y - a.y) / (b.t - a.t), v2 = (c.y - b.y) / (c.t - b.t); // unités image / s (y vers le bas)
    // descente (v1 > 0) puis montée (v2 < 0), cassure nette ; minimum local de hauteur (maximum de y image)
    if (!(v1 > 0 && v2 < 0 && v1 - v2 > minKink && b.y >= P[i - 1].y && b.y >= P[i + 1].y)) continue;
    if (out.length && b.t - out[out.length - 1].t < 0.15) continue;
    const g = cal ? toGround(cal, b) : { x: NaN, y: NaN };
    out.push({ t: b.t, x: g.x, y: g.y, img: { x: b.x, y: b.y }, conf: +clamp((v1 - v2) / (3 * minKink), 0.3, 0.9).toFixed(2) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- points
export function segmentPoints({ strokes = [], bounces = [], ballSeen = [] } = {}, { pauseS = 5, refaultS = 25 } = {}) {
  const ev = [
    ...strokes.map((s) => ({ t: s.t, kind: 'stroke', s })),
    ...bounces.map((b) => ({ t: b.t, kind: 'bounce', b })),
    ...ballSeen.map((t) => ({ t: typeof t === 'number' ? t : t.t, kind: 'ball' })),
  ].filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  const segs = [];
  let cur = null;
  for (const e of ev) {
    if (!cur || e.t - cur.t1 >= pauseS || (e.kind === 'stroke' && e.s.type === 'serve' && cur.strokes.some((s) => s.type !== 'serve'))) {
      cur = { t0: e.t, t1: e.t, strokes: [], bounces: [] }; segs.push(cur);
    }
    cur.t1 = e.t;
    if (e.kind === 'stroke') cur.strokes.push(e.s);
    if (e.kind === 'bounce') cur.bounces.push(e.b);
  }
  // Fusion « première balle faute » : segment = un seul service, suivi d'un segment qui commence par un service
  const points = [];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k], nx = segs[k + 1];
    const onlyServe = s.strokes.length === 1 && s.strokes[0].type === 'serve';
    if (onlyServe && nx && nx.strokes[0]?.type === 'serve' && nx.t0 - s.t1 < refaultS) {
      points.push({ ...nx, t0: s.t0, fault1: { t: s.strokes[0].t, bounces: s.bounces }, strokes: nx.strokes, bounces: nx.bounces });
      k++;
    } else points.push({ ...s });
  }
  // Deux services consécutifs dans un même segment (pause < pauseS) = première faute aussi
  for (const p of points) {
    if (!p.fault1 && p.strokes.length >= 2 && p.strokes[0].type === 'serve' && p.strokes[1].type === 'serve') {
      p.fault1 = { t: p.strokes[0].t, bounces: p.bounces.filter((b) => b.t < p.strokes[1].t) };
      p.strokes = p.strokes.slice(1);
      p.bounces = p.bounces.filter((b) => b.t >= p.strokes[0].t);
    }
  }
  return points;
}

// ---------------------------------------------------------------------------------------------- analyse
const TYPES = ['serve', 'forehand', 'backhand', 'volley', 'smash'];
const LABEL = { serve: 'service', forehand: 'coup droit', backhand: 'revers', volley: 'volée', smash: 'smash' };

export function analyzeMatch({ strokes = [], bounces = [], ballSeen = [], positions = [], ballTrack = null, cal = null, serverX = null } = {}, opts = {}) {
  const { pauseS = 5, heatCell = 1 } = opts;
  let B = bounces;
  if ((!B || !B.length) && ballTrack) B = bouncesFromTrack(ballTrack, { cal });
  B = (B || []).filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  const seen = ballSeen.length ? ballSeen : (ballTrack || []).map((p) => p.t);
  const S = [...strokes].filter((s) => Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
  const points = segmentPoints({ strokes: S, bounces: B, ballSeen: seen }, { pauseS });

  // --- Points : service, issue, échange
  let served = 0, firstIn = 0, doubleFaults = 0, won = 0, lost = 0, unknown = 0, outcomeConf = 0;
  for (const p of points) {
    const st = p.strokes;
    p.server = st[0]?.type === 'serve' ? 'near' : (p.bounces[0] && p.bounces[0].y < 0 && p.bounces[0].t < (st[0]?.t ?? Infinity) ? 'far' : null);
    if (p.server === 'near') {
      served++;
      // Première balle faute confirmée (ou contredite) par son rebond
      if (p.fault1) {
        const fb = p.fault1.bounces.find((b) => b.y > 0);
        p.fault1.confirmed = fb ? !inServiceBox(fb, 'near', serverX) : null;
      } else firstIn++;
      const sb = p.bounces.find((b) => b.t > st[0].t && b.y > 0);
      if (sb && !inServiceBox(sb, 'near', serverX) && st.length === 1 && p.fault1) { p.doubleFault = true; doubleFaults++; }
    }
    // Issue : rebonds après la dernière frappe du joueur proche
    const last = st[st.length - 1];
    const after = last ? p.bounces.filter((b) => b.t > last.t) : p.bounces;
    let outcome = null, conf = 0;
    if (p.doubleFault) { outcome = 'perdu'; conf = 0.7; }
    else if (last && after.length) {
      const b1 = after[0];
      if (b1.y > 0) {
        // la balle du joueur proche rebondit chez l'adversaire
        if (!inSingles(b1)) { outcome = 'perdu'; conf = 0.6; }
        else if (!after.some((b) => b.y < 0)) { outcome = 'gagné'; conf = 0.5; } // pas de retour observé
        else { // l'adversaire a renvoyé : son rebond chez nous décide
          const nb = after.find((b) => b.y < 0);
          outcome = inSingles(nb) ? 'perdu' : 'gagné'; conf = 0.4;
        }
      } else { outcome = inSingles(b1) ? 'perdu' : 'gagné'; conf = 0.4; }
    }
    p.outcome = outcome; p.outcomeConf = conf;
    if (outcome === 'gagné') won++; else if (outcome === 'perdu') lost++; else unknown++;
    outcomeConf += conf;
    p.rally = st.length * 2 - (p.server === 'near' ? 1 : 0); // frappes des deux joueurs (estimation)
  }

  // --- Frappes par type
  const byType = Object.fromEntries(TYPES.map((k) => [k, 0]));
  for (const s of S) if (byType[s.type] != null) byType[s.type]++;

  // --- Carte de chaleur des positions (moitié proche + 3 m derrière la ligne de fond)
  let heatmap = null;
  const pos = positions.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pos.length) {
    const x0 = -C.halfWidthDoubles - 1, x1 = C.halfWidthDoubles + 1, y0 = -C.halfLength - 4, y1 = 0;
    const cols = Math.ceil((x1 - x0) / heatCell), rows = Math.ceil((y1 - y0) / heatCell);
    const grid = new Array(cols * rows).fill(0);
    for (let k = 0; k < pos.length; k++) {
      const p = pos[k];
      const c = Math.floor((p.x - x0) / heatCell), r = Math.floor((p.y - y0) / heatCell);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const dt = k ? clamp(p.t - pos[k - 1].t, 0, 0.5) : 0;
      grid[r * cols + c] += dt || 1 / 30;
    }
    const tot = grid.reduce((a, v) => a + v, 0) || 1;
    let best = 0; grid.forEach((v, i) => { if (v > grid[best]) best = i; });
    heatmap = { x0, y0, cell: heatCell, cols, rows, share: grid.map((v) => +(v / tot).toFixed(4)), seconds: +tot.toFixed(1),
      peak: { x: x0 + (best % cols + 0.5) * heatCell, y: y0 + (Math.floor(best / cols) + 0.5) * heatCell },
      behindBaselinePct: Math.round((pos.filter((p) => p.y < -C.halfLength).length / pos.length) * 100) };
  }

  // --- Séquences fréquentes (2 et 3 coups du joueur proche dans un même point) et taux de réussite
  const seqs = new Map();
  for (const p of points) {
    const ty = p.strokes.map((s) => s.type);
    const seen2 = new Set();
    for (const L of [2, 3]) for (let i = 0; i + L <= ty.length; i++) seen2.add(ty.slice(i, i + L).join('>'));
    for (const key of seen2) {
      const e = seqs.get(key) || { key, label: key.split('>').map((k) => LABEL[k] || k).join(' → '), count: 0, won: 0, lost: 0 };
      e.count++; if (p.outcome === 'gagné') e.won++; if (p.outcome === 'perdu') e.lost++;
      seqs.set(key, e);
    }
  }
  const sequences = [...seqs.values()].map((e) => ({ ...e, successPct: e.won + e.lost ? Math.round((100 * e.won) / (e.won + e.lost)) : null }))
    .sort((a, b) => b.count - a.count || (b.key.split('>').length - a.key.split('>').length)).slice(0, 12);

  // --- Profil adverse : rebonds sur la moitié proche (coups de l'adversaire), direction vue par le joueur proche
  const opp = B.filter((b) => b.y < 0 && inSingles(b, 0.3));
  const hw = C.halfWidthSingles;
  const dir = { gauche: 0, centre: 0, droite: 0 }, depth = { court: 0, milieu: 0, profond: 0 };
  for (const b of opp) {
    dir[b.x < -hw / 3 ? 'gauche' : b.x > hw / 3 ? 'droite' : 'centre']++;
    const d = -b.y;
    depth[d < C.serviceLine ? 'court' : d < (C.serviceLine + C.halfLength) / 2 ? 'milieu' : 'profond']++;
  }
  // Services adverses : premier rebond d'un point servi par l'adversaire, dans un carré proche → large / corps / T
  const oppServe = { large: 0, corps: 0, T: 0 };
  for (const p of points) {
    if (p.server !== 'far') continue;
    const b = p.bounces[0];
    if (!b || b.y > 0 || -b.y > C.serviceLine + 0.1) continue;
    const ax = Math.abs(b.x);
    oppServe[ax > (2 * hw) / 3 ? 'large' : ax < hw / 3 ? 'T' : 'corps']++;
  }
  const pct = (o) => { const n = Object.values(o).reduce((a, v) => a + v, 0); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, n ? Math.round((100 * v) / n) : 0])); };
  const favDir = opp.length ? Object.entries(dir).sort((a, b) => b[1] - a[1])[0][0] : null;

  const conf = clamp((S.length ? 0.4 : 0) + (B.length ? 0.3 : 0) + (pos.length ? 0.1 : 0) + (cal ? 0.1 : 0), 0, 0.9) * (points.length ? 1 : 0);
  return {
    points: points.map((p) => ({ t0: p.t0, t1: p.t1, server: p.server, firstServeFault: !!p.fault1, doubleFault: !!p.doubleFault,
      strokes: p.strokes.map((s) => s.type), rally: p.rally, outcome: p.outcome, outcomeConf: p.outcomeConf })),
    summary: {
      points: points.length, strokes: S.length, byType, won, lost, unknown,
      servePoints: served, firstServePct: served ? Math.round((100 * firstIn) / served) : null, doubleFaults,
      meanRally: points.length ? +(points.reduce((a, p) => a + p.rally, 0) / points.length).toFixed(1) : 0,
      outcomeConf: points.length ? +(outcomeConf / points.length).toFixed(2) : 0,
    },
    heatmap, sequences,
    opponent: { shots: opp.length, direction: pct(dir), depth: pct(depth), favourite: favDir, serve: pct(oppServe), serves: Object.values(oppServe).reduce((a, v) => a + v, 0) },
    conf: +conf.toFixed(2),
    notes: [
      'Issue des points estimée par le dernier rebond observé : à confirmer (balle hors champ, let, faute de pied non vus).',
      'Frappes de l\'adversaire déduites des rebonds sur la moitié proche ; volées adverses (sans rebond) non comptées.',
    ],
  };
}
