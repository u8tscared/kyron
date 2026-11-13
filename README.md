# KYRON

Analyse du geste de tennis par caméra, sans capteur. Application web statique (modules ES, sans build) : `app/`.

- `app/index.html` : l'application
- `app/core/` : moteurs (analyse vidéo, physique, optimisation)
- `docs/architecture.md` : architecture et plan
- `docs/CONTRACTS.md` : contrats entre modules

Lancer en local : `cd app && python3 -m http.server 8000` puis ouvrir http://localhost:8000.
Tests : `node tests/run.mjs`.
