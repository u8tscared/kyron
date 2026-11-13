// KYRON · glossaire : chaque mesure expliquée en français simple. Utilisé partout via help(key) → bouton « ? »
// qui ouvre une feuille en bas de l'écran. Clés = clés des mesures du moteur (engine.REFS) + notions de l'app.
import { esc } from './util.js';
import { sheet } from './kit.js';

export const GLOSS = {
  score: { t: 'Score du geste', d: 'Une note sur 100 qui résume toutes les mesures de ta frappe, comparées aux plages observées chez les joueurs de haut niveau.', why: 'Il sert à suivre ta progression d’une séance à l’autre. Au-dessus de 85, ton geste est dans les standards pro.' },
  kneeFlex: { t: 'Flexion des genoux', d: 'De combien tu plies les genoux avant de pousser vers la balle (en degrés : 0° = jambe tendue).', why: 'Les jambes sont le moteur du geste : plus de charge, plus de poussée, donc plus de vitesse sans forcer avec le bras.' },
  separation: { t: 'Séparation hanches / épaules', d: 'L’écart d’angle entre la ligne des hanches et la ligne des épaules pendant la préparation. C’est la « torsion » du tronc.', why: 'Comme un élastique qu’on tord : cette torsion stocke de l’énergie qui se libère au moment de frapper.' },
  elbowImpact: { t: 'Coude à l’impact', d: 'L’angle du coude quand la raquette touche la balle (180° = bras complètement tendu).', why: 'Un bras plus long frappe plus haut et avec plus de levier. Au service, on vise un bras presque tendu.' },
  contactRatio: { t: 'Hauteur de contact', d: 'La hauteur de ton poignet au moment de l’impact, rapportée à ta taille (1,25 × = 25 % au-dessus de ta taille).', why: 'Frapper plus haut ouvre l’angle pour faire passer le service au-dessus du filet et retomber dans le carré.' },
  headDrift: { t: 'Stabilité de la tête', d: 'De combien ta tête bouge autour du moment de l’impact (en centimètres).', why: 'Une tête stable, c’est un regard stable : le contact avec la balle est plus propre et plus régulier.' },
  shoulderTurn: { t: 'Rotation des épaules', d: 'L’amplitude de rotation de tes épaules pendant le geste (en degrés).', why: 'Plus tu tournes tôt et loin, plus tu as de distance pour accélérer la raquette.' },
  sequence: { t: 'Chaîne cinétique', d: 'L’ordre dans lequel ton corps accélère : bassin, puis buste, puis coude, puis poignet. Chaque segment doit atteindre sa vitesse maximale juste après le précédent (15 à 90 ms d’écart).', why: 'C’est l’effet fouet : quand l’ordre est respecté, la vitesse s’additionne d’un segment à l’autre. Quand il est rompu, le bras compense et fatigue.' },
  chain: { t: 'Chaîne cinétique', d: 'L’ordre dans lequel ton corps accélère : bassin, puis buste, puis coude, puis poignet.', why: 'Quand l’ordre est respecté, la vitesse s’additionne comme dans un fouet.' },
  shoulderElev: { t: 'Hauteur du coude à l’armé', d: 'L’angle entre ton bras et ton buste quand la raquette est armée derrière toi (≈ 100° chez les meilleurs serveurs).', why: 'Coude trop bas : moins de levier et plus de contrainte sur l’épaule. Trop haut : l’épaule travaille en butée.' },
  shoulderAbdH: { t: 'Coude derrière le buste', d: 'De combien ton coude passe derrière la ligne de tes épaules à l’armé.', why: 'Trop en arrière, l’avant de l’épaule s’étire à chaque service : c’est d’abord une question de santé.' },
  shoulderRotExt: { t: 'Armé de l’épaule', d: 'De combien ton avant-bras bascule vers l’arrière quand la raquette descend dans ton dos (rotation externe).', why: 'Plus la raquette descend, plus elle a de chemin pour accélérer : c’est le premier moteur de la vitesse au service.' },
  shoulderIRVel: { t: 'Vitesse de rotation de l’épaule', d: 'La vitesse maximale à laquelle ton bras « fouette » vers l’avant (degrés par seconde).', why: 'C’est la plus grosse contribution à la vitesse de raquette au service. À comparer d’une séance à l’autre.' },
  comShift: { t: 'Transfert du poids', d: 'De combien ton centre de gravité avance entre la charge et l’impact (en centimètres).', why: 'Quand le corps « tombe » dans la frappe, la vitesse vient de tout le corps et pas seulement du bras.' },
  balance: { t: 'Équilibre à l’impact', d: 'Un indice de 0 à 1 qui dit si ton centre de gravité reste bien au-dessus de tes appuis au moment de frapper.', why: 'Équilibré, le contact est plus régulier et tu te replaces plus vite.' },
  tossDrop: { t: 'Hauteur du lancer', d: 'De combien la balle monte au-dessus du point où tu la frappes.', why: 'Trop haut, la balle redescend vite et le timing devient difficile. Trop bas, tu dois te précipiter.' },
  tossForward: { t: 'Lancer devant toi', d: 'De combien la balle est lancée devant ton pied avant.', why: 'Un lancer devant toi permet de frapper en avançant et de faire passer ton poids dans le terrain.' },
  ballKmh: { t: 'Vitesse de balle', d: 'La vitesse de la balle juste après l’impact. « Mesurée » quand KYRON suit la balle dans ta vidéo, « estimée » quand elle est calculée à partir de ta vitesse de raquette.', why: 'C’est le résultat final de tout le geste.' },
  racketKmh: { t: 'Vitesse de raquette', d: 'La vitesse de la tête de raquette au moment de l’impact, calculée à partir de ton bras et de ta taille.', why: 'Elle détermine la vitesse de balle et la quantité d’effet que tu peux donner.' },
  spin: { t: 'Effet (tours par minute)', d: 'Combien de fois la balle tourne sur elle-même en une minute. Lift = elle tourne vers l’avant, slice = vers l’arrière.', why: 'Plus d’effet, c’est une balle qui plonge et rebondit plus haut : tu peux frapper fort en gardant la balle dans le court.' },
  successRate: { t: 'Balles dans le court', d: 'Sur des centaines de frappes simulées avec ta régularité, le pourcentage qui passe le filet et retombe dans le court.', why: 'C’est ta marge de sécurité : frapper plus vite ne sert à rien si la balle sort.' },
  confidence: { t: 'Confiance de la mesure', d: 'À quel point KYRON est sûr de ce qu’il a vu : bras visible, cadence de la vidéo, joueur entier dans le cadre.', why: 'Sous 60 %, refilme en suivant le guide : les chiffres seront plus fiables.' },
  quality: { t: 'Qualité de la prise', d: 'Une note sur 100 de ta vidéo : cadrage, cadence (images par seconde), lumière, visibilité du corps.', why: 'Une bonne vidéo, ce sont des mesures fiables. Le ralenti (120 ou 240 images/s) fait la plus grosse différence.' },
  fps: { t: 'Images par seconde', d: 'Combien d’images ta vidéo contient par seconde. Le mode ralenti de ton téléphone filme à 120 ou 240 images/s.', why: 'À 30 images/s, le bras est flou à l’impact. À 240, KYRON voit chaque détail du geste.' },
  fatigue: { t: 'Fatigue sur la séance', d: 'L’évolution de ta vitesse de raquette de la première à la dernière frappe.', why: 'Une baisse de plus de 6 % est un signe de fatigue : c’est le moment de faire une pause.' },
  jointLoad: { t: 'Charges articulaires', d: 'Les efforts estimés sur ton épaule, ton coude, ton dos et tes genoux, calculés à partir de ton geste, de ta taille et de ton poids.', why: 'Ils aident à repérer un geste qui sollicite trop une articulation. Ce sont des estimations, pas un diagnostic médical.' },
  grf: { t: 'Force au sol', d: 'La poussée de tes jambes contre le sol, exprimée en multiple de ton poids.', why: 'Plus tu pousses fort et au bon moment, plus l’énergie remonte jusqu’à la raquette.' },
  trials: { t: 'Variantes testées', d: 'Chaque variante est un geste complet rejoué dans le simulateur : impact raquette-balle, vol dans l’air, rebond, et contrôle des contraintes sur ton corps.', why: 'Plus il y en a, plus KYRON est sûr d’avoir trouvé le meilleur réglage pour toi.' },
  frontier: { t: 'Frontière vitesse / sécurité', d: 'La ligne des meilleurs compromis : pour chaque vitesse de balle, la variante qui met le plus de balles dans le court.', why: 'Elle montre ce que tu gagnes en vitesse et ce que tu perds en régularité.' },
  sensitivity: { t: 'Ce qui rapporte le plus', d: 'Le gain obtenu en changeant un seul réglage à la fois, tout le reste identique.', why: 'Ça te dit sur quoi travailler en premier.' },
  safety: { t: 'Marge de sécurité', d: 'KYRON écarte toute variante qui dépasserait les repères de contrainte pour l’épaule, le coude, le dos ou les genoux.', why: 'Le geste proposé est plus efficace sans être plus risqué pour ton corps.' },
  swingweight: { t: 'Poids de swing', d: 'La difficulté à faire tourner la raquette (en kg·cm²). Plus il est élevé, plus la raquette est stable mais lente à manier.', why: 'C’est le chiffre qui change le plus la sensation de jeu, bien plus que la masse.' },
  tension: { t: 'Tension du cordage', d: 'La tension (en kg) à laquelle ton cordage a été posé. Elle baisse avec le temps et le jeu.', why: 'Plus basse = plus de puissance et de confort ; plus haute = plus de contrôle. Recorde quand elle a perdu 20 %.' },
  style: { t: 'Profil de style', d: 'Une comparaison de ton geste à des styles types de joueurs de haut niveau, construits à partir de mesures publiées. Aucun joueur réel n’est imité.', why: 'Pour voir de quel style tu es le plus proche et où tu t’en écartes, phase par phase.' },
  footwork: { t: 'Jeu de jambes', d: 'Tes appuis, ton pas d’allègement et tes déplacements avant la frappe.', why: 'Être bien placé, c’est la moitié du geste.' },
  load: { t: 'Charge d’entraînement', d: 'Le volume et l’intensité de tes frappes sur 7 jours, comparés à ta moyenne sur 28 jours.', why: 'Augmenter trop vite (plus de 30 %) est la première cause de blessure. KYRON t’alerte avant.' },
};

let bound = false;
export function help(key, label) {
  const g = GLOSS[key]; if (!g) return '';
  if (!bound) bind();
  return `<button type="button" class="q" data-gl="${esc(key)}" aria-label="${esc(`C'est quoi : ${label || g.t} ?`)}">?</button>`;
}
export function explain(key) {
  const g = GLOSS[key]; if (!g) return;
  sheet.open({ title: g.t, html: `<p class="sh-lead">${esc(g.d)}</p>${g.why ? `<div class="sh-why"><span>Pourquoi c’est important</span><p>${esc(g.why)}</p></div>` : ''}` });
}
function bind() {
  bound = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest("[data-gl]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    explain(b.dataset.gl);
  });
}
bind();
