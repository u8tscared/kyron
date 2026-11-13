# KYRON — Architecture technique et plan V1

*13 novembre 2026*

## 1. Ce que la V1 doit prouver

Une seule promesse, tenue sans capteur : **filmer un geste (service, coup droit, revers) avec un iPhone ou une tablette et recevoir en moins d'une minute une analyse chiffrée de la chaîne cinétique, avec 3 corrections prioritaires et les exercices associés.**

La V1 ne cherche pas encore à tout mesurer. Elle doit prouver trois choses :

1. **La mesure est fiable et répétable** sur le corps (angles, timings, vitesses segmentaires), même avec une seule caméra.
2. **Les corrections sont justes et actionnables** (validées par un coach sur les vidéos du frère de Marceau).
3. **L'expérience est fluide** : filmer, analyser, comprendre, recommencer, sans friction.

Tout le reste (balle, spin, multi-caméras, simulation massive) se branche sur ce socle.

## 2. Pipeline d'analyse

```
Capture → Détection du geste → Pose 2D → Pose 3D → Raquette + balle → Phases → Métriques → Comparaison → Coaching
```

| Étape | V1 | Plus tard |
|---|---|---|
| **Capture** | 60 à 240 i/s (ralenti iPhone), guide de cadrage en direct (hauteur, distance, angle) | Multi-appareils synchronisés |
| **Détection du geste** | Pic de vitesse du poignet → découpe automatique de chaque frappe dans une séance | Classification service / CD / revers par modèle |
| **Pose 2D** | MediaPipe Pose / RTMPose (33 points), sur l'appareil | Modèle affiné sur des joueurs de tennis (flou de mouvement du bras) |
| **Pose 3D** | Coordonnées « world » du modèle + lissage temporel | Triangulation multi-vues, reconstruction type SMPL (corps complet maillé) |
| **Raquette** | Proxy : prolongement avant-bras/main | Détecteur de raquette dédié (tête, angle de face, point d'impact) |
| **Balle** | Non en V1 sauf essai | Détecteur type TrackNet + fit balistique (vitesse, hauteur de passage, rebond) |
| **Phases** | Préparation, armé, accélération, impact, accompagnement, détectées automatiquement | Sous-phases propres à chaque coup (trophy position, racket drop au service…) |
| **Métriques** | Angles clés (genoux, hanches, épaules, coude), séparation hanches/épaules, séquence de pics de vitesse (hanche → épaule → coude → poignet), vitesse du poignet, stabilité de la tête | Vitesse de tête de raquette, angle de face, spin estimé, puissance transmise |

**Vitesse et spin de balle sans capteur** : c'est faisable mais c'est le point le plus dur. À 240 i/s, une balle de service à 200 km/h parcourt environ 23 cm par image : on peut la suivre et en déduire la vitesse. Le spin, lui, se déduit surtout de la trajectoire (effet Magnus : courbure, hauteur de rebond) plutôt que de la rotation visible du feutre. Prévu en phase 3, avec la vitesse de balle d'abord.

## 3. Multi-caméras

- **Synchronisation** : un « clap » sonore ou un flash affiché sur un écran au début de la séance, puis alignement fin par corrélation des trajectoires du poignet entre les vues.
- **Calibration** : les lignes du court (dimensions connues : 23,77 m × 8,23 m en simple) servent de mire. Pas de damier à imprimer.
- **Triangulation** : chaque appareil calcule sa pose 2D, le serveur triangule en 3D. Deux vues (profil + arrière) suffisent à supprimer l'essentiel de l'ambiguïté de profondeur.
- **Demande de nouvelles prises** : l'app connaît les points mal vus (par ex. coude masqué par le corps en vue de face) et demande explicitement « refais 3 services filmés de dos, à 4 m, hauteur de hanche ».

## 4. Moteur de coaching

**Référence pro.** On construit une base de « signatures » de gestes de joueurs de haut niveau à partir de vidéos publiques (ralentis d'entraînement), passées dans le même pipeline. On compare la courbe du joueur à la courbe de référence après alignement temporel (Dynamic Time Warping), phase par phase. Attention aux droits : on stocke les métriques extraites, pas les vidéos.

**Simulation et optimisation (les « millions d'essais »).** Modèle biomécanique simplifié du corps et de la raquette (chaîne de segments avec masses et longueurs standard ajustées à la taille du joueur). On fait varier les paramètres du geste (flexion des genoux, timing de rotation des hanches, hauteur de lancer…) dans des millions de simulations pour chercher la combinaison qui maximise la vitesse de raquette à l'impact, sous contraintes de sécurité articulaire (épaule, coude, lombaires). Résultat : « gagner 8 % de vitesse en déclenchant la rotation des épaules 40 ms plus tard ». Ce moteur tourne côté serveur (GPU), c'est la phase 4.

**Corrections et exercices.** Chaque écart mesuré pointe vers une règle (ex. séparation hanches/épaules < 30° au service → manque de torsion) qui pointe vers une bibliothèque d'exercices (vidéo démo, séries, critère de réussite mesuré par l'app à la séance suivante). Au départ, règles écrites avec un coach ; ensuite, un modèle de langage formule le retour en langage naturel à partir des métriques.

## 5. Mode simple et mode avancé

- **Mode simple** : un score par geste, 3 points forts, les 3 corrections prioritaires en phrases claires, la vidéo avec squelette en surimpression, un exercice à faire.
- **Mode avancé** : toutes les courbes (angles, vitesses), la séquence de la chaîne cinétique en ms, la comparaison image par image avec le pro, l'export des données, la vue 3D orbitable.

Même pipeline, même données, seul l'affichage change.

## 6. Stack technique

- **App iPhone / iPad** : Swift natif pour la capture haute cadence (AVFoundation, 240 i/s) et la pose sur l'appareil (Core ML). Le natif est indispensable pour la qualité de capture.
- **Desktop / web coach** : application web (React + WebGL/Three.js pour la 3D). Le prototype actuel est déjà en web.
- **Serveur** : Python (FastAPI), workers GPU pour la pose 3D lourde, la triangulation multi-vues, le suivi de balle et les simulations. File de tâches (Redis / Celery).
- **Données** : PostgreSQL (joueurs, séances, métriques), stockage objet pour les vidéos (S3 compatible).
- **Hybride** : un premier résultat instantané calculé sur l'appareil, puis une analyse fine qui arrive du serveur quelques dizaines de secondes plus tard.

## 7. Plan par phases

| Phase | Durée indicative | Contenu | Critère de sortie |
|---|---|---|---|
| **0. Prototype web** (fait) | — | Import vidéo, pose dans le navigateur, phases, métriques, mode simple/avancé | Tourne sur une vraie vidéo du frère |
| **1. Socle fiable** | 4 à 6 sem. | Guide de cadrage, découpe auto des frappes, métriques validées contre un coach, 20 règles de correction, 30 exercices | Un coach valide 80 % des corrections |
| **2. App iPhone** | 6 à 8 sem. | Capture 240 i/s native, analyse instantanée, historique de progression | Le frère l'utilise seul à chaque séance |
| **3. Balle et raquette** | 8 sem. | Vitesse de balle, hauteur de passage, angle de face estimé, spin par trajectoire | Écart < 10 % vs radar sur 50 frappes |
| **4. Multi-caméras + 3D** | 8 sem. | Synchro, calibration par le court, triangulation, vue 3D | Erreur articulaire < 3 cm vs référence |
| **5. Moteur d'optimisation** | continu | Base pro, simulations massives, recommandations chiffrées | Gain de vitesse mesuré chez les joueurs suivis |

## 8. Limites à connaître

- **Une seule caméra** : la profondeur est estimée, pas mesurée. Les angles dans le plan de la caméra sont fiables, ceux hors plan beaucoup moins. D'où l'intérêt de demander des angles précis.
- **Flou de mouvement** : à 30 i/s, le bras et la raquette au moment de l'impact sont illisibles. 120 à 240 i/s est la vraie condition de qualité.
- **Précision « au millimètre »** : réaliste pour la balle en multi-caméras haute cadence, pas pour le corps avec un téléphone (plutôt quelques centimètres). Les systèmes pro du type Hawk-Eye utilisent une dizaine de caméras dédiées.
- **Validation** : pour être crédible auprès des pros, il faudra comparer nos mesures à un radar et, idéalement, à un système de capture de mouvement en laboratoire.
