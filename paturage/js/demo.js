/* Données de démonstration (bouton Réglages → Charger une démo), comme dans la v8. */
import { addDays, todayISO } from "./util.js";
import { OUT } from "./domain.js";

export function demoRecords() {
  const t = todayISO(), now = Date.now();
  const st = (r) => Object.assign(r, { updatedAt: now, deleted: false });
  const cats = [["adulte", "Adulte", 0.7], ["jument_suitee", "Jument suitée", 1.2], ["demi_trait", "Demi-trait", 0.8], ["trait", "Trait", 1.0], ["jeune", "Jeune", 0.9]]
    .map(([id, name, ugb]) => st({ id, name, ugb }));
  const lots = [["demo_jum", "Juments", "#6D4AB0"], ["demo_tra", "Traits", "#0E7C86"], ["demo_jeu", "Jeunes", "#B83280"], ["demo_pon", "Poneys", "#5A6473"]]
    .map(([id, name, color]) => st({ id, name, color, archived: false }));
  const y0 = addDays(t, -205);
  const comps = [
    st({ id: "demo_jum@" + y0, lotId: "demo_jum", eff: y0, items: { jument_suitee: 4, adulte: 5 } }),
    st({ id: "demo_tra@" + y0, lotId: "demo_tra", eff: y0, items: { trait: 6 } }),
    st({ id: "demo_jeu@" + y0, lotId: "demo_jeu", eff: y0, items: { jeune: 5 } }),
    st({ id: "demo_pon@" + y0, lotId: "demo_pon", eff: y0, items: { adulte: 4 } })
  ];
  const plan = {
    demo_jum: [["COTEAU NORD_3", 0], ["COTEAU NORD_12", 14], ["CLOS DU JONC_60", 31], ["LANDE_52", 52], ["SAULAIE_103", 80], ["NORD_128", 101], ["QG_95", 130], ["COTEAU NORD_3", 158], ["PYLONE_72", 178], ["COTEAU NORD_7", 200]],
    demo_tra: [["SAULAIE_32", 10], ["KERVITO_80", 40], ["LANDE_55", 75], ["QG_92", 110], ["SAULAIE_45", 150], ["SAULAIE_41", 193]],
    demo_jeu: [["KERVITO_78", 20], ["PYLONE_74", 60], ["NORD_131", 95], ["CLOS DU JONC_65", 140], ["KERVITO_86", 172], ["KERVITO_83", 203]],
    demo_pon: [["LANDE_50", 0], ["QG_99", 60], ["NORD_134", 120], [OUT, 196]]
  };
  const moves = [];
  let seq = 1;
  for (const lotId in plan) for (const [to, d] of plan[lotId]) moves.push(st({ id: "demo_mv" + seq, lotId, date: addDays(y0, d), to, createdAt: seq++ }));
  const foins = [];
  [["demo_jum", [176, 183, 190, 197, 204]], ["demo_tra", [168, 175, 182, 189, 196, 203]], ["demo_pon", [198, 200, 202, 204]]].forEach(([lotId, ds]) =>
    ds.forEach((d, i) => foins.push(st({ id: "demo_fo_" + lotId + i, lotId, date: addDays(y0, d), type: i % 3 === 2 ? "enrubanne" : "foin", year: +t.slice(0, 4), createdAt: seq++ }))));
  return { lots, cats, comps, moves, foins };
}
