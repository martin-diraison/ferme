/* Tests des règles métier : node --test tests/ */
import test from "node:test";
import assert from "node:assert/strict";
import { lotTimeline, lotLocation, paddockStatus, restClass, pressureByPaddock, convertV8Movements, compForDate, ugbOf, padHistory, OUT, hayPeriods, hayRate } from "../js/domain.js";
import { fromV8 } from "../js/migrate.js";

const mv = (id, lotId, date, to, createdAt = 0) => ({ id, lotId, date, to, createdAt });

test("transfert : un seul déplacement ferme le séjour précédent", () => {
  const moves = [mv("a", "L", "2026-05-01", "P1", 1), mv("b", "L", "2026-05-10", "P2", 2)];
  const tl = lotTimeline(moves, "L");
  assert.equal(tl.stays.length, 2);
  assert.deepEqual([tl.stays[0].loc, tl.stays[0].start, tl.stays[0].end, tl.stays[0].endId], ["P1", "2026-05-01", "2026-05-10", "b"]);
  assert.equal(tl.stays[1].end, null);
  assert.equal(lotLocation(moves, "L", "2026-05-05").loc, "P1");
  assert.equal(lotLocation(moves, "L", "2026-05-10").loc, "P2");
  assert.equal(lotLocation(moves, "L", "2026-04-30"), null);
});

test("hors-paddock : période distincte et repos qui démarre", () => {
  const moves = [mv("a", "L", "2026-05-01", "P1", 1), mv("b", "L", "2026-05-10", OUT, 2), mv("c", "L", "2026-06-01", "P2", 3)];
  const tl = lotTimeline(moves, "L");
  assert.equal(tl.outs.length, 1);
  assert.deepEqual([tl.outs[0].start, tl.outs[0].end], ["2026-05-10", "2026-06-01"]);
  const st = paddockStatus({ moves }, ["P1", "P2", "P3"], "2026-05-20");
  assert.equal(st.P1.rest, 10);
  assert.equal(st.P1.lastEnd, "2026-05-10");
  assert.equal(st.P2.status, "never");
  assert.equal(restClass(st.P1, 45), "early");
});

test("saisie antérieure : insertion dans l'historique", () => {
  const moves = [mv("a", "L", "2026-11-01", "A", 1), mv("b", "L", "2026-11-10", "B", 2), mv("c", "L", "2026-11-05", "C", 3)];
  const tl = lotTimeline(moves, "L");
  assert.deepEqual(tl.stays.map((s) => [s.loc, s.start, s.end]), [["A", "2026-11-01", "2026-11-05"], ["C", "2026-11-05", "2026-11-10"], ["B", "2026-11-10", null]]);
});

test("déplacement redondant ignoré", () => {
  const moves = [mv("a", "L", "2026-05-01", "P1", 1), mv("b", "L", "2026-05-03", "P1", 2)];
  const tl = lotTimeline(moves, "L");
  assert.equal(tl.stays.length, 1);
  assert.deepEqual(tl.redundant, ["b"]);
});

test("occupation par plusieurs troupeaux", () => {
  const moves = [mv("a", "L1", "2026-05-01", "P1", 1), mv("b", "L2", "2026-05-02", "P1", 2)];
  const st = paddockStatus({ moves }, ["P1"], "2026-05-03");
  assert.deepEqual(st.P1.occupants.sort(), ["L1", "L2"]);
  assert.equal(restClass(st.P1, 45), "occ");
});

test("pression : jours comptés jusqu'à la date de référence, sans double compte", () => {
  const D = {
    moves: [mv("a", "L", "2026-11-01", "P1", 1), mv("b", "L", "2026-11-11", "P2", 2)],
    comps: [{ id: "c", lotId: "L", eff: "2026-01-01", items: { x: 10 } }],
    cats: [{ id: "x", ugb: 1 }]
  };
  const pads = [{ id: "P1", area: 1 }, { id: "P2", area: 1 }];
  const pr = pressureByPaddock(D, pads, "2026-11-22");
  assert.equal(pr.byPad.P1.ugbDays, 100); // 1er→10 nov = 10 jours × 10 UGB
  assert.equal(pr.byPad.P2.ugbDays, 120); // 11→22 nov inclus = 12 jours
});

test("composition en vigueur et UGB", () => {
  const comps = [{ id: "1", lotId: "L", eff: "2026-01-01", items: { a: 2 } }, { id: "2", lotId: "L", eff: "2026-06-01", items: { a: 3 } }];
  assert.equal(compForDate(comps, "L", "2026-05-31").id, "1");
  assert.equal(compForDate(comps, "L", "2026-06-01").id, "2");
  assert.equal(compForDate(comps, "L", "2025-12-31").id, "1"); // avant la 1re : la 1re
  assert.equal(ugbOf({ a: 3 }, [{ id: "a", ugb: 0.7 }]).toFixed(2), "2.10");
});

test("conversion v8 : sortie = dernier jour au paddock ; transfert auto ; journée unique ; orpheline", () => {
  const ev = (id, dt, type, p) => ({ id, lotId: "L", dt, type, paddockId: p });
  const r = convertV8Movements([
    ev("i1", "2026-05-01", "IN", "P1"),
    ev("o1", "2026-05-10", "OUT", "P1"), ev("i2", "2026-05-10", "IN", "P2"), // transfert (sortie auto)
    ev("o2", "2026-05-20", "OUT", "P2"), ev("i3", "2026-05-21", "IN", "P3"), // sortie le 20, entrée le 21 = continu
    ev("o3", "2026-06-01", "OUT", "P3"),                                      // vraie sortie : hors-paddock dès le 2
    ev("i4", "2026-06-10", "IN", "P4"), ev("o4", "2026-06-10", "OUT", "P4"), // journée unique
    ev("o5", "2026-06-15", "OUT", "P9")                                       // orpheline
  ]);
  assert.deepEqual(r.moves.map((m) => [m.id, m.date, m.to]), [
    ["i1", "2026-05-01", "P1"], ["i2", "2026-05-10", "P2"], ["i3", "2026-05-21", "P3"], ["o3", "2026-06-02", OUT],
    ["i4", "2026-06-10", "P4"], ["o4", "2026-06-11", OUT]
  ]);
  assert.deepEqual(r.orphanOuts, ["o5"]);
  assert.deepEqual(r.absorbedOuts.sort(), ["o1", "o2"]);
  const tl = lotTimeline(r.moves.map((m) => Object.assign(m, { deleted: false })), "L");
  assert.equal(tl.outs.length, 2);
  assert.deepEqual([tl.outs[0].start, tl.outs[0].end], ["2026-06-02", "2026-06-10"]);
});

test("conversion v8 : alias d'identifiant de paddock", () => {
  const r = convertV8Movements([{ id: "i", lotId: "L", dt: "2026-05-01", type: "IN", paddockId: "COTEAU NORDCOTEAU NORD_6" }], { "COTEAU NORDCOTEAU NORD_6": "COTEAU NORD_6" });
  assert.equal(r.moves[0].to, "COTEAU NORD_6");
});

test("import v8 complet", () => {
  const v8 = {
    lots: [{ id: "L", name: "Juments" }], categories: [{ id: "adulte", name: "Adulte", ugb: 0.7 }],
    compositions: [{ id: "x", lotId: "L", eff: "2026-01-01", items: { adulte: 5 } }],
    movements: [{ id: "i", lotId: "L", dt: "2026-05-01", type: "IN", paddockId: "P1" }],
    foins: [{ id: "f", lotId: "L", dt: "2026-11-01", type: "enrubanne", year: 2026 }], ui: { restTarget: 50 }
  };
  const { records, report, settings } = fromV8(v8);
  assert.equal(report.moves, 1);
  assert.equal(records.comps[0].id, "L@2026-01-01");
  assert.equal(records.foins[0].type, "enrubanne");
  assert.equal(settings.restTarget, 50);
});

test("9.1.1 : une catégorie supprimée compte encore dans les compositions passées", () => {
  const cats = [{ id: "a", ugb: 1 }, { id: "b", ugb: 0.5, deleted: true }];
  assert.equal(ugbOf({ a: 2, b: 2 }, cats), 3);
});

test("9.1.1 : un passage de 0 jour ne rend pas le paddock « pâturé »", () => {
  const moves = [mv("a", "L", "2026-11-10", "P1", 1), mv("b", "L", "2026-11-16", "P2", 2), mv("c", "L", "2026-11-16", "P1", 3)];
  const st = paddockStatus({ moves }, ["P1", "P2"], "2026-11-22");
  assert.equal(st.P2.status, "never");
  assert.equal(st.P1.status, "occ");
});

test("9.2 : historique d'un paddock (ouverture, fermeture, tous troupeaux)", () => {
  const moves = [mv("a", "L", "2026-05-01", "P1", 1), mv("b", "L", "2026-05-10", "P2", 2), mv("c", "M", "2026-06-01", "P1", 3), mv("d", "M", "2026-06-01", "P3", 4), mv("e", "K", "2026-07-01", "P1", 5)];
  const h = padHistory({ moves }, "P1", "2026-07-05");
  assert.deepEqual(h.map((x) => [x.lotId, x.start, x.end]), [["K", "2026-07-01", null], ["L", "2026-05-01", "2026-05-10"]]);
});

test("foin : périodes séparées par 3 semaines sans apport, rythme hors pauses", () => {
  const fo = (date) => ({ lotId: "L", date });
  const foins = [fo("2026-07-01"), fo("2026-07-04"), fo("2026-07-04"), fo("2026-07-21"), /* 17 j : même période */
    fo("2026-08-11"), /* 21 j après : nouvelle période */ fo("2026-11-01"), fo("2026-11-08")];
  const eps = hayPeriods(foins, "2026-11-20");
  assert.equal(eps.length, 3);
  assert.deepEqual([eps[0].from, eps[0].to, eps[0].n, eps[0].live], ["2026-11-01", "2026-11-08", 2, true]);
  assert.deepEqual([eps[1].from, eps[1].to, eps[1].n, eps[1].live], ["2026-08-11", "2026-08-11", 1, false]);
  assert.deepEqual([eps[2].from, eps[2].to, eps[2].n], ["2026-07-01", "2026-07-21", 4]);
  assert.equal(hayPeriods(foins, "2026-11-29")[0].live, false);
  /* jours comptés : 21 (juillet) + 1 (août) + 20 (1er→20 nov., en cours) = 42 j = 6 semaines, 7 apports */
  assert.ok(Math.abs(hayRate(foins, "2026-11-20") - 7 / 6) < 1e-9);
  assert.equal(hayRate([], "2026-11-20"), null);
});
