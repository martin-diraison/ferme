/* Exports CSV / ZIP / sauvegarde JSON */
import { DATA, live } from "./store.js";
import { GEO, padLabel, parcelLabel } from "./geo.js";
import { lotTimeline, forEachGrazingDay, lotUGB, ugbOf, OUT } from "./domain.js";
import { todayISO, daysBetween, fmtNum } from "./util.js";

function csvCell(v) {
  v = v === null || v === undefined ? "" : String(v);
  return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(headers, rows) {
  return "﻿" + [headers.join(";")].concat(rows.map((r) => headers.map((h) => csvCell(r[h])).join(";"))).join("\n") + "\n";
}
const lotName = (id) => { const l = DATA.lots.find((x) => x.id === id); return l ? l.name : id; };
const padInfo = (id) => { const p = GEO.byId[id]; return p ? { parcelle: parcelLabel(p.parcel), surface_ha: fmtNum(p.area, 4) } : { parcelle: "", surface_ha: "" }; };

export function csvSejours(year) {
  const D = { moves: live("moves") }, today = todayISO(), y0 = year + "-01-01", y1 = year + "-12-31";
  const rows = [];
  for (const lot of DATA.lots) {
    const tl = lotTimeline(D.moves, lot.id);
    for (const s of tl.stays.concat(tl.outs)) {
      const end = s.end || today;
      if (end < y0 || s.start > y1) continue;
      rows.push(Object.assign({ troupeau: lot.name, lieu: padLabel(s.loc), entree: s.start, sortie: s.end || "", en_cours: s.end ? "" : "oui", jours: daysBetween(s.start, end), ugb_a_l_entree: fmtNum(lotUGB(liveD(), lot.id, s.start), 2) }, s.loc === OUT ? { parcelle: "", surface_ha: "" } : padInfo(s.loc)));
    }
  }
  rows.sort((a, b) => (a.entree < b.entree ? -1 : 1));
  return toCSV(["troupeau", "lieu", "parcelle", "surface_ha", "entree", "sortie", "en_cours", "jours", "ugb_a_l_entree"], rows);
}
function liveD() { return { moves: live("moves"), comps: live("comps"), cats: live("cats"), catsAll: DATA.cats }; }

export function csvJournalier(year) {
  const D = liveD(), rows = [], cache = {};
  forEachGrazingDay(D, year + "-01-01", year + "-12-31", todayISO(), (lotId, padId, d) => {
    const k = lotId + d; if (cache[k] === undefined) cache[k] = lotUGB(D, lotId, d);
    const a = GEO.byId[padId] ? GEO.byId[padId].area : 0;
    rows.push(Object.assign({ date: d, troupeau: lotName(lotId), paddock: padLabel(padId), ugb: fmtNum(cache[k], 2), ugb_par_ha: a > 0 ? fmtNum(cache[k] / a, 2) : "" }, padInfo(padId)));
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return toCSV(["date", "troupeau", "paddock", "parcelle", "surface_ha", "ugb", "ugb_par_ha"], rows);
}
export function csvDeplacements(year) {
  const rows = live("moves").filter((m) => !year || m.date.slice(0, 4) === String(year)).sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((m) => Object.assign({ id: m.id, date: m.date, troupeau: lotName(m.lotId), destination: padLabel(m.to) }, m.to === OUT ? { parcelle: "", surface_ha: "" } : padInfo(m.to)));
  return toCSV(["id", "date", "troupeau", "destination", "parcelle", "surface_ha"], rows);
}
export function csvCompositions() {
  const comps = live("comps");
  const cats = DATA.cats.filter((k) => !k.deleted || comps.some((c) => (c.items || {})[k.id]));
  const rows = comps.sort((a, b) => (a.eff < b.eff ? -1 : 1)).map((c) => {
    const r = { troupeau: lotName(c.lotId), date_effet: c.eff, ugb_total: fmtNum(ugbOf(c.items, cats), 2) };
    for (const k of cats) r[k.name + (k.deleted ? " (supprimée)" : "")] = (c.items || {})[k.id] || "";
    return r;
  });
  return toCSV(["troupeau", "date_effet", "ugb_total"].concat(cats.map((k) => k.name + (k.deleted ? " (supprimée)" : ""))), rows);
}
export function csvFoin(year) {
  const rows = live("foins").filter((f) => !year || f.date.slice(0, 4) === String(year)).sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((f) => ({ date: f.date, troupeau: lotName(f.lotId), type: f.type === "enrubanne" ? "Enrubanné" : "Foin", annee_fauche: f.year }));
  return toCSV(["date", "troupeau", "type", "annee_fauche"], rows);
}
export function backupObject(settings) {
  return { format: "paturage-v9", exportedAt: new Date().toISOString(), settings: settings || {}, records: JSON.parse(JSON.stringify(DATA)) };
}

/* ---------- ZIP sans compression ---------- */
function crc32(buf) {
  let t = crc32.t;
  if (!t) { t = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  let crc = 0xffffffff; for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const d = new Date(), dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.content === "string" ? enc.encode(f.content) : f.content, crc = crc32(data);
    const head = new Uint8Array([].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
    parts.push(head, name, data);
    central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
    off += head.length + name.length + data.length;
  }
  const cSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cSize), u32(off), u16(0)));
  return new Blob(parts.concat(central, [end]), { type: "application/zip" });
}

export function allExportsZip(year, settings) {
  const stamp = localStamp();
  const name = "paturage_" + year + "_" + stamp + ".zip";
  const blob = makeZip([
    { name: "sejours_" + year + ".csv", content: csvSejours(year) },
    { name: "calendrier_journalier_" + year + ".csv", content: csvJournalier(year) },
    { name: "deplacements_" + year + ".csv", content: csvDeplacements(year) },
    { name: "compositions.csv", content: csvCompositions() },
    { name: "foin_" + year + ".csv", content: csvFoin(year) },
    { name: "sauvegarde_paturage.json", content: JSON.stringify(backupObject(settings), null, 1) }
  ]);
  return { name, blob };
}

/* horodatage local (pas UTC) pour les noms de fichiers : 20261122_1430 */
export function localStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
}
export function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export function downloadText(name, text, mime) { downloadBlob(name, new Blob([text], { type: mime || "text/plain" })); }
export async function shareBlob(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) { await navigator.share({ title: name, files: [file] }); return true; }
  return false;
}
