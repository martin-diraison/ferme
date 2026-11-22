import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../js/domain.js";

const lire = (f) => JSON.parse(readFileSync(new URL("../data/" + f, import.meta.url)));
const mnt = lire("mnt.json"), mares = lire("mares.json"), ruisseaux = lire("ruisseaux.json");

test("Lambert-93 aller-retour", () => {
  const [x, y] = D.toL93(-3.045378, 47.730003);
  const [lng, lat] = D.fromL93(x, y);
  assert.ok(Math.abs(lng + 3.045378) < 1e-7 && Math.abs(lat - 47.730003) < 1e-7);
});

test("altitude : la ferme descend du nord vers le sud, forage vers 45 m", () => {
  const forage = D.altitude(mnt, -3.045378, 47.730003);
  assert.ok(forage > 40 && forage < 50, "forage " + forage);
  const nord = D.altitude(mnt, -3.047, 47.7335), sud = D.altitude(mnt, -3.047, 47.7240);
  assert.ok(nord > sud + 15, `nord ${nord} sud ${sud}`);
  assert.equal(D.altitude(mnt, -2.9, 47.73), null);
});

test("18 mares du SIG, avec altitude et types", () => {
  const pts = D.pointsDepuisMares(mares, mnt);
  assert.equal(pts.length, 18);
  assert.ok(pts.every((p) => p.alt > 20 && p.alt < 65));
  assert.equal(pts.find((p) => p.sig === "Ancien_meandre").type, "zone_humide");
  assert.equal(pts.find((p) => p.sig === "Ancien_meandre").nom, "Ancien meandre");
  assert.equal(pts.find((p) => p.sig === "Douet-1").type, "mare");
  assert.equal(new Set(pts.map((p) => p.id)).size, 18);
});

test("échelles : 5 niveaux, libellés selon le type", () => {
  assert.equal(D.libEtat("ruisseau", 0), "Assec");
  assert.equal(D.libEtat("source", 4), "Débordement");
  assert.equal(D.libEtat("mare", 1), "Flaques isolées");
  assert.equal(D.libEtat("mare", D.IMPOSSIBLE), "Observation impossible");
  assert.equal(D.ETATS.length, 5);
});

test("ordre de tournée et point suivant", () => {
  const pts = [{ id: "a", nom: "A", alt: 40 }, { id: "b", nom: "B", alt: 55 }, { id: "c", nom: "C", alt: 31 }, { id: "d", nom: "D", alt: 50, actif: false }];
  const o = D.ordreTournee(pts);
  assert.deepEqual(o.map((p) => p.id), ["b", "a", "c"]);
  assert.equal(D.pointSuivant(o, new Set(["b"]), "b").id, "a");
  assert.equal(D.pointSuivant(o, new Set(["b", "c"]), "a"), null);
  assert.equal(D.pointSuivant(o, new Set(["a"]), "c").id, "b"); // reprend au début
  assert.equal(D.pointSuivant(o, new Set(), null).id, "b");
});

test("obs de tournée : la correction remplace", () => {
  const obs = [{ pointId: "a", tourneeId: "T", t: 1, etat: 3 }, { pointId: "a", tourneeId: "T", t: 2, etat: 2 }, { pointId: "a", tourneeId: "U", t: 3, etat: 0 }];
  assert.equal(D.obsDeTournee(obs, "T").get("a").etat, 2);
  assert.equal(D.obsPrecedente(obs, "a", "U").etat, 2);
  assert.equal(D.derniersEtats(obs).get("a").etat, 0);
  assert.equal(D.derniersEtats(obs, 2).get("a").etat, 2);
});

test("débit au seau", () => {
  assert.equal(D.debitSeau(10, 30), 20);
  assert.equal(D.debitSeau(10, 0), null);
});

test("ruisseaux : un point colore environ 25 m de tracé (12,5 m de part et d'autre)", () => {
  const morceaux = D.decouperLignes(ruisseaux, 5);
  assert.ok(morceaux.length > 900);
  // un point au milieu d'un long tronçon, décalé de ~8 m du tracé : il s'accroche au tracé
  const m = morceaux[400].m, decale = [m[0] + 0.0001, m[1]];
  const fc = D.colorerRuisseaux(morceaux, [{ lng: decale[0], lat: decale[1], etat: 1 }]);
  const long = fc.features.reduce((s, f) => s + D.distanceM(f.geometry.coordinates[0], f.geometry.coordinates[1]), 0);
  assert.ok(long >= 20 && long <= 32, "longueur colorée " + long);
  assert.ok(fc.features.every((f) => f.properties.etat === 1));
  // trop loin du tracé (> 30 m) : rien n'est coloré
  assert.equal(D.colorerRuisseaux(morceaux, [{ lng: m[0] + 0.002, lat: m[1] + 0.002, etat: 1 }]).features.length, 0);
  assert.equal(D.colorerRuisseaux(morceaux, []).features.length, 0);
});

test("forage : volume, repos de 24 h", () => {
  assert.equal(D.volumeForage(1234.5, 1236.75), 2.25);
  assert.equal(D.volumeForage(10, 9), null);
  assert.equal(D.volumeForage(null, 9), null);
  const h = 36e5;
  const r = D.testsCalcules([
    { id: "b", t: 30 * h, indexDebut: 105, indexFin: 107.5 },
    { id: "a", t: 0, indexDebut: 100, indexFin: 103 },
    { id: "c", t: 48 * h, indexDebut: 110, indexFin: 111 },
    { id: "x", t: 50 * h, indexDebut: 1, indexFin: 2, deleted: true },
  ]);
  assert.deepEqual(r.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(r[0].reposH, null);
  assert.equal(r[1].reposH, 30); assert.equal(r[1].reposCourt, false);
  assert.equal(r[2].reposH, 18); assert.equal(r[2].reposCourt, true);
  assert.equal(r[1].volume, 2.5);
});

test("forage : indice des eaux de surface avant le test", () => {
  const j = 864e5, T = 100 * j;
  const pts = [{ id: "m1", type: "mare" }, { id: "m2", type: "zone_humide" }, { id: "r1", type: "ruisseau" }, { id: "m3", type: "mare", actif: false }];
  const obs = [
    { pointId: "m1", t: T - 2 * j, etat: 3 }, { pointId: "m1", t: T - 1 * j, etat: 2 },
    { pointId: "m2", t: T - 5 * j, etat: 1 },
    { pointId: "m3", t: T - 1 * j, etat: 4 },        // point non suivi : ignoré
    { pointId: "r1", t: T - 40 * j, etat: 4 },       // trop ancien
    { pointId: "m2", t: T + 1 * j, etat: 4 },        // après le test
    { pointId: "m1", t: T - 1 * j + 1, etat: "imp" },
  ];
  assert.deepEqual(D.indiceSurface(pts, obs, T, "mare"), { moy: 1.5, n: 2 });
  assert.deepEqual(D.indiceSurface(pts, obs, T, "eau"), { moy: null, n: 0 });
});

test("pluie : veille, répartition, pluviomètre non vidé", () => {
  const t = (s) => new Date(s).getTime();
  const pluies = [
    { id: 1, t: t("2026-11-01T08:00"), lecture: 5, vide: true },
    { id: 2, t: t("2026-11-02T08:00"), lecture: 3, vide: false },
    { id: 3, t: t("2026-11-05T08:00"), lecture: 12, vide: true }, // 12 - 3 = 9 mm sur 3 jours
  ];
  const r = D.relevesCalcules(pluies);
  assert.deepEqual(r[0].jours, ["2026-10-31"]);
  assert.equal(r[1].mm, 3);
  assert.deepEqual(r[1].jours, ["2026-11-01"]);
  assert.equal(r[2].mm, 9);
  assert.deepEqual(r[2].jours, ["2026-11-02", "2026-11-03", "2026-11-04"]);
  const j = D.pluieJournaliere(pluies);
  assert.equal(j.get("2026-11-03").mm, 3);
  assert.equal(j.get("2026-11-03").origine, "repartie");
  assert.equal(j.get("2026-11-01").origine, "mesuree");
  assert.equal(D.cumul(j, "2026-11-01", "2026-11-30"), 12);
});
