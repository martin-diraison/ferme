/* Import des données de la v8 (sauvegarde JSON, ou stockage local du navigateur). */
import { convertV8Movements } from "./domain.js";

/* 16 couleurs bien distinctes (les 8 premières : celles des versions précédentes) ; une couleur libre reste possible */
export const LOT_COLORS = ["#6D4AB0", "#0E7C86", "#B83280", "#A35A00", "#2B6CB0", "#5A6473", "#2F7D32", "#9C2F2F",
  "#D1495B", "#E07A1F", "#B8860B", "#6B8E23", "#00897B", "#1E88E5", "#3949AB", "#8E24AA"];

export function isV8(obj) {
  return !!(obj && Array.isArray(obj.movements) && Array.isArray(obj.lots) && !obj.format);
}

/* Renvoie { records: {lots,cats,comps,moves,foins}, report } */
export function fromV8(v8, aliases = {}) {
  const now = Date.now();
  const stamp = (r) => Object.assign(r, { updatedAt: now, deleted: false });
  const lots = (v8.lots || []).map((l, i) => stamp({ id: String(l.id), name: String(l.name || l.id), color: LOT_COLORS[i % LOT_COLORS.length], archived: false }));
  const cats = (v8.categories || []).map((c) => stamp({ id: String(c.id), name: String(c.name || c.id), ugb: Number(c.ugb) || 0 }));
  const seen = {};
  const comps = [];
  const lotIds = new Set(lots.map((l) => l.id));
  let badComps = 0;
  for (const c of v8.compositions || []) {
    if (!c || !c.lotId || !c.eff) continue;
    /* compositions abîmées (identifiant de troupeau tronqué, effectifs vides) : écartées */
    if (!lotIds.has(c.lotId) || !Object.values(c.items || {}).some((n) => Number(n) > 0)) { badComps++; continue; }
    const id = c.lotId + "@" + String(c.eff).slice(0, 10);
    if (seen[id]) continue; seen[id] = 1;
    comps.push(stamp({ id, lotId: c.lotId, eff: String(c.eff).slice(0, 10), items: Object.assign({}, c.items || {}) }));
  }
  const conv = convertV8Movements(v8.movements || [], aliases);
  const moves = conv.moves.map((m) => stamp(m));
  const foins = (v8.foins || []).filter((f) => f && f.lotId && f.dt).map((f) => stamp({
    id: String(f.id), lotId: f.lotId, date: f.dt, type: f.type === "enrubanne" ? "enrubanne" : "foin", year: Number(f.year) || Number(String(f.dt).slice(0, 4)), createdAt: 0
  }));
  /* Troupeaux supprimés en v8 dont l'historique est resté : gardés, mais archivés (masqués) */
  const have = new Set(lots.map((l) => l.id));
  let ghosts = 0;
  for (const m of moves) if (!have.has(m.lotId)) { have.add(m.lotId); ghosts++; lots.push(stamp({ id: m.lotId, name: "Troupeau supprimé (v8) " + ghosts, color: "#8C9389", archived: true })); }
  return {
    records: { lots, cats, comps, moves, foins },
    report: { lots: lots.length - ghosts, ghostLots: ghosts, cats: cats.length, comps: comps.length, badComps, moves: moves.length, foins: foins.length, v8events: (v8.movements || []).length, orphanOuts: conv.orphanOuts.length, redundantIns: conv.redundantIns.length, absorbedOuts: conv.absorbedOuts.length },
    settings: { restTarget: v8.ui && Number(v8.ui.restTarget) > 0 ? Number(v8.ui.restTarget) : null }
  };
}

export function readV8FromThisBrowser() {
  try {
    const raw = localStorage.getItem("paturage.simple.v1");
    if (!raw) return null;
    const d = JSON.parse(raw);
    return isV8(d) && (d.movements.length || d.lots.length) ? d : null;
  } catch (_) { return null; }
}
