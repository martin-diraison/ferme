# Eau de la ferme — v0.2.1

Suivi de l'eau de la ferme : tournées des points d'eau (mares, sources, ruisseaux), arrêts de l'écoulement,
relevés du pluviomètre. Même base technique que l'appli pâturage v9 : modules JS sans compilation,
données sur l'appareil (IndexedDB), ouverture sans réseau (service worker), publiable sur GitHub Pages.

## Contenu (tout est publiable, aucun secret)

| Fichier | Rôle |
|---|---|
| `index.html`, `css/app.css` | page et style (clair / sombre / auto) |
| `js/domain.js` | règles : échelles d'état, Lambert-93, altitude par le modèle de terrain, ordre de tournée, coloration des ruisseaux, pluie journalière (testées) |
| `js/store.js`, `js/util.js` | stockage sur l'appareil (repris de l'appli pâturage ; boîte d'envoi prête pour une future synchro) |
| `js/map.js`, `js/icons.js` | carte MapLibre : photo aérienne IGN ou relief ombré (calculé depuis `data/mnt.json`), courbes, mares, ruisseaux |
| `js/app.js` | écrans et actions |
| `data/` | couches SIG en WGS 84 (18 mares, ruisseaux, courbes 0,5 m) et modèle de terrain (grille L93, en dm) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | hors ligne, installation sur l'écran d'accueil |
| `tests/domain.test.mjs` | `npm test` (Node 18+) |

## Règles retenues

- **Échelles d'état (0 à 4)**. Ruisseaux et sources : modalités d'« En quête d'eau » (OFB, issues d'ONDE) :
  Assec · Écoulement non visible · Écoulement visible faible · Écoulement visible · Débordement, plus « Observation impossible ».
  Mares et zones humides : échelle maison calquée dessus (À sec · Flaques isolées · Niveau bas · Niveau normal · Débordement).
- **Tournée** : irrégulière, sans rappel ; ordre proposé du plus haut au plus bas, ordre libre ; vue liste ou carte ;
  une correction remplace le relevé précédent du même point dans la tournée.
- **Ruisseaux colorés** : chaque morceau de 10 m du tracé SIG prend l'état du point ruisseau/source le plus proche (≤ 50 m).
- **L'écoulement s'arrête ici** : position GPS si elle est précise (≤ 30 m, de moins d'une minute), sinon placement à la main sur la carte.
- **Pluie** : un relevé couvre la période depuis le précédent ; lu le matin = compté pour la veille ; plusieurs jours =
  réparti également ; pluviomètre non vidé = on retire l'ancienne lecture.

## Essayer sur l'ordinateur

`python3 -m http.server 8000` dans ce dossier, puis http://localhost:8000. Le GPS du téléphone exige une adresse
https : il faut publier (GitHub Pages) pour l'utiliser au champ.

## Mise à jour du code

À chaque version publiée, changer `CACHE` dans `sw.js` et `VERSION` dans `js/app.js`.
