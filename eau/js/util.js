/* Utilitaires sans dépendance au DOM (sauf $ / downloads) */

export function esc(s) {
  s = (s === null || s === undefined) ? "" : String(s);
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function uid(prefix = "id") {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
const pad2 = (n) => String(n).padStart(2, "0");
export function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
export function todayISO() { return isoOf(new Date()); }
export function parseISO(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); }
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export function fmtShort(s, withYear) {
  if (!s) return "—";
  const d = parseISO(s);
  return d.getDate() + " " + MOIS_COURT[d.getMonth()] + (withYear ? " " + d.getFullYear() : "");
}
export function fmtLong(s) { const d = parseISO(s); return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()]; }
export function fmtNum(n, dec = 2) { const x = Number(n); return isFinite(x) ? x.toFixed(dec).replace(".", ",") : ""; }
export function toNum(x) { const n = Number(String(x ?? "").replace(",", ".")); return isFinite(n) ? n : 0; }
export function plural(n, one, many) { return n + " " + (Math.abs(n) > 1 ? many : one); }
export function normText(s) { return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
export function clone(o) { return JSON.parse(JSON.stringify(o)); }
