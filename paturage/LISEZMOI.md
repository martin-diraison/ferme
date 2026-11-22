# Suivi pâturage v9

Refonte de l'appli de suivi de pâturage (v8.33 → v9.0) : saisie par troupeau en 3 gestes, carte satellite, synchronisation fiable avec le Google Sheet, fonctionnement hors ligne.

## Contenu du dossier (tout est publiable, aucun secret dedans)

| Fichier | Rôle |
|---|---|
| `index.html`, `css/app.css` | page et style (thème clair, thème sombre en option) |
| `js/domain.js` | règles de pâturage (séjours, repos, pression, conversion v8) — testées |
| `js/store.js` | stockage sur l'appareil (IndexedDB) + boîte d'envoi |
| `js/sync.js` | synchronisation avec le script Apps Script v9 |
| `js/views.js`, `js/app.js` | écrans et actions |
| `js/geo.js`, `js/mapsvg.js`, `data/carte.json`, `Fond.png` | carte (8 parcelles, 132 paddocks) |
| `js/exports.js` | CSV, ZIP, sauvegarde JSON |
| `sw.js`, `manifest.webmanifest` | ouverture sans réseau, installation sur l'écran d'accueil |
| `tests/domain.test.mjs` | tests (`npm test`, Node 18+) |

Le script serveur est **hors de ce dossier** : `../paturage_v9_serveur/` (il contient l'identifiant du tableur, ne pas le publier).

## Mise en service

1. **Script Google** : suivre `../paturage_v9_serveur/LISEZMOI.md` (nouveau script, nouveaux onglets `v9_*`, la v8 continue de fonctionner).
2. **Publier ce dossier** sur GitHub Pages, à côté de la v8 (par exemple `…/paturage_v9/`). Même site que la v8 = même « origine » : l'appli v9 voit alors les données v8 du navigateur et propose de les importer.
3. **Sur l'appareil principal** (celui qui a les données v8 les plus complètes) :
   - ouvrir la v9 → bandeau « Données de l'ancienne version trouvées » → **Importer** ;
   - Plus → Synchronisation → coller l'adresse du script et le secret → **Enregistrer** : tout part dans le tableur.
   - (Sans bandeau : v8 → Admin → Sauvegarder (JSON), puis v9 → Plus → Exports et sauvegarde → Restaurer ce fichier.)
4. **Sur les autres appareils** : ouvrir la v9 → Plus → Synchronisation → même adresse et même secret → tout est récupéré. Ne pas importer la v8 sur ces appareils.
5. Sur téléphone : menu du navigateur → « Ajouter à l'écran d'accueil ».

## Ce qui change par rapport à la v8

- **Un déplacement = un seul enregistrement** (troupeau, date, destination). La sortie du paddock précédent est implicite : plus de « sortie auto » ni de sorties orphelines. Le jour du changement compte pour le nouveau lieu (plus de double comptage).
- **Hors-paddock** (piste, stabulation…) est une destination : il ferme le séjour et démarre le repos du paddock.
- **Synchronisation** : chaque modification (déplacement, correction, suppression, troupeau, composition, catégorie, foin) passe par une boîte d'envoi qui ne se vide qu'après confirmation du serveur. Hors réseau, les saisies attendent. Entre appareils, la modification la plus récente l'emporte.
- **Annuler** pendant quelques secondes après chaque saisie, correction ou suppression, au lieu des fenêtres de confirmation.

## Fonctions reprises de la v8

Saisie entrée/sortie/transfert · alertes repos insuffisant et paddock occupé · corrections rapides (« Dernières saisies ») · carte avec date de référence, objectif de repos, couche pression et maximum réglable, position des troupeaux · calendrier par troupeau et par année, foin, plein écran, correction des périodes, localisation sur la carte · troupeaux (créer, renommer, supprimer, et désormais archiver/couleur) · compositions datées, « reprendre la dernière », historique · catégories et coefficients UGB · foin (date, troupeau, type, année de fauche, liste et suppression) · journal filtrable (troupeau, dates) · exports CSV (séjours, calendrier journalier, déplacements, compositions, foin), ZIP, partage, sauvegarde et restauration JSON · état de la sauvegarde et stockage persistant · synchronisation (réglage, test, envoi, récupération complète, renvoi de tout) · import d'un nouveau découpage GeoJSON et d'un nouveau fond de carte · thème clair/sombre (`?theme=dark`) · démo · remise à zéro · bandeau d'erreur.

Non reprises : le bouton « Préparer un email » (code mort de la v8, adresse en dur).

## Mise à jour du code

Après toute modification, changer `CACHE` dans `sw.js` (ex. `paturage-v9.0.1`) pour que les appareils récupèrent la nouvelle version (elle s'applique à la 2e ouverture).
