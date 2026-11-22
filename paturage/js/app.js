/* Suivi pâturage v9 — état de l'interface, actions, rendu. */
import { todayISO, addDays, uid, fmtShort, clone, toNum, normText } from "./util.js";
import { GEO, buildGeo, padLabel, parcelsFromGeoJSON, paddocksFromGeoJSON, parseWorldFile } from "./geo.js";
import { OUT, lotLocation, paddockStatus, pressureByPaddock, compForDate } from "./domain.js";
import * as store from "./store.js";
import { SYNC, initSync, scheduleSync, syncNow, setSyncConfig, testSync, onSync, configured } from "./sync.js";
import { fromV8, isV8, readV8FromThisBrowser, LOT_COLORS } from "./migrate.js";
import * as X from "./exports.js";
import { viewHome, viewMove, viewCarte, viewCal, viewPlus, viewNav, viewSheet, viewToast, moveMapH, carteMapH } from "./views.js";
import { parcelView, padScreenSize, MIN_TAP_PX } from "./mapsvg.js";
import { attachMapGestures } from "./mapgesture.js";

const VERSION = "9.2.2";
const app = document.getElementById("app");
let BASE_CARTE = null;
const SET = { restTarget: 45, pressureMax: 2, longStay: 10, theme: "light" };
const S = {
  screen: "home", sub: null,
  move: null,
  carte: { vb: null, pad: null, layer: "rest", ref: null, optsOpen: false },
  cal: { lotId: null, year: null, sel: null, fs: false },
  lotEdit: null, newCat: { name: "", ugb: "" },
  journal: { kind: "moves", lotId: "", from: "", to: "", limit: 100 },
  syncForm: { url: "", secret: "" }, syncMsg: "", restoreMsg: "", mapMsg: "", exYear: new Date().getFullYear(),
  files: {}, sheet: null, sheetBack: null, toast: null
};
let C = null;
let v8Available = false, lastBackup = 0, persist = "—";

/* ---------------- données calculées pour l'affichage ---------------- */
function computeC() {
  const D = store.liveData();
  const today = todayISO();
  const ids = GEO.pads.map((p) => p.id);
  const sc = {}, pc = {};
  C = {
    D, today, settings: SET, sync: SYNC, v8Available, lastBackup, persist,
    statusAt: (d) => sc[d] || (sc[d] = paddockStatus(D, ids, d)),
    pressureAt: (d) => pc[d] || (pc[d] = pressureByPaddock(D, GEO.pads, d)),
    markersAt: (d) => D.lots.filter((l) => !l.archived).map((l) => { const x = lotLocation(D.moves, l.id, d); return x && x.loc !== OUT ? { padId: x.loc, color: l.color, name: l.name } : null; }).filter(Boolean)
  };
  C.status = C.statusAt(today);
  const stale = !lastBackup || Date.now() - lastBackup > 7 * 864e5;
  C.backupHint = SYNC.state === "off" && D.moves.length && stale ? "Synchronisation non réglée et pas de sauvegarde récente : pensez à « Plus → Exports et sauvegarde »." : "";
}

/* ---------------- rendu ---------------- */
function render() {
  computeC();
  const ae = document.activeElement;
  let focus = null;
  if (ae && ae.dataset && ae.dataset.in && app.contains(ae)) {
    focus = { key: ae.dataset.in, sub: ae.dataset.cat || ae.dataset.id || ae.dataset.lot || "", s: ae.selectionStart, e: ae.selectionEnd };
  }
  let main;
  if (S.screen === "move" && S.move) main = viewMove(S, C);
  else if (S.screen === "carte") main = viewCarte(S, C);
  else if (S.screen === "cal") main = viewCal(S, C);
  else if (S.screen === "plus") main = viewPlus(S, C);
  else main = viewHome(S, C);
  const nav = S.screen === "move" || (S.screen === "cal" && S.cal.fs) ? "" : viewNav(S);
  /* zones à défilement horizontal : on garde leur position d'un affichage à l'autre */
  const hs = {};
  app.querySelectorAll("[data-hscroll]").forEach((el) => { hs[el.dataset.hscroll] = el.scrollLeft; });
  app.innerHTML = main + nav + viewSheet(S, C) + viewToast(S);
  app.querySelectorAll("[data-hscroll]").forEach((el) => {
    if (hs[el.dataset.hscroll] !== undefined) el.scrollLeft = hs[el.dataset.hscroll];
    const on = el.querySelector(".chip.on");
    if (on) { /* élément choisi toujours visible, sans faire défiler la page */
      const l = on.offsetLeft - el.offsetLeft, r = l + on.offsetWidth;
      if (l < el.scrollLeft || r > el.scrollLeft + el.clientWidth) el.scrollLeft = l - (el.clientWidth - on.offsetWidth) / 2;
    }
  });
  if (focus) {
    const el = [...app.querySelectorAll(`[data-in="${focus.key}"]`)].find((x) => (x.dataset.cat || x.dataset.id || x.dataset.lot || "") === focus.sub);
    if (el) { el.focus(); try { if (focus.s !== null && focus.s !== undefined) el.setSelectionRange(focus.s, focus.e); } catch (_) {} }
  }
}
function go(screen, sub = null) {
  S.screen = screen; S.sub = sub;
  render(); window.scrollTo(0, 0);
}

/* ---------------- toast avec « Annuler » ---------------- */
let toastTimer = null;
function toast(msg, undo, ms = 6000, edit = null) {
  clearTimeout(toastTimer);
  S.toast = { msg, undo: undo || null, edit };
  toastTimer = setTimeout(() => { S.toast = null; render(); }, ms);
  render();
}

/* ---------------- réglages ---------------- */
async function saveSettings() { await store.setMeta("settings", Object.assign({}, SET)); }
function applyTheme() {
  document.documentElement.dataset.theme = SET.theme === "dark" ? "dark" : "light";
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = SET.theme === "dark" ? "#12160F" : "#F5F3EC";
}

/* ---------------- carte : chargement + personnalisation ---------------- */
let rasterUrl = null;
async function loadGeo() {
  if (!BASE_CARTE) BASE_CARTE = await (await fetch("data/carte.json")).json();
  const custom = await store.getMeta("customMap");
  const cr = await store.getMeta("customRaster");
  const carte = custom ? Object.assign({}, BASE_CARTE, { parcels: custom.parcels, paddocks: custom.paddocks }) : BASE_CARTE;
  let override = null;
  if (cr && cr.blob) {
    if (rasterUrl) URL.revokeObjectURL(rasterUrl);
    rasterUrl = URL.createObjectURL(cr.blob);
    override = Object.assign({ img: rasterUrl }, cr.bounds);
  }
  buildGeo(carte, override);
  GEO.custom = !!custom; GEO.customRaster = !!cr;
}
function readText(file) { return file.text(); }

/* ---------------- actions (clics) ---------------- */
const lotById = (id) => store.get("lots", id);
const A = {
  nav: (d) => { if (d.v === "plus") S.sub = null; if (d.v === "carte") S.carte.pad = null; go(d.v, d.v === "plus" ? null : S.sub); },
  "go-carte": () => go("carte"),
  "go-sync": () => { openSync(); },
  "plus-back": () => go("plus", null),
  "sub-lots": () => go("plus", "lots"),
  "sub-journal": () => go("plus", "journal"),
  "sub-sync": () => openSync(),
  "sub-exports": () => go("plus", "exports"),
  "sub-settings": () => go("plus", "settings"),
  "sub-mapcfg": () => go("plus", "mapcfg"),

  /* --- Déplacer --- */
  "move-start": (d) => {
    S.move = { lotId: d.lot, view: "map", date: C.today, q: "", showAll: false, vb: null };
    go("move");
  },
  "move-cancel": () => { S.move = null; go("home"); },
  "move-view": (d) => { S.move.view = d.v; render(); },
  "move-pick": (d) => { openMoveConfirm(S.move.lotId, d.id, "move"); },
  "mv-parcel": (d) => { S.move.vb = parcelView(d.id); render(); },
  "mv-pad": (d) => {
    const p = GEO.byId[d.id]; if (!p) return;
    /* paddock trop petit à l'écran pour être visé sans erreur : on zoome d'abord sur sa parcelle */
    if (padScreenSize(p.id, S.move.vb, moveMapH()) < MIN_TAP_PX) { S.move.vb = parcelView(p.parcel); render(); return; }
    openMoveConfirm(S.move.lotId, p.id, "move");
  },
  "move-all": () => { S.move.showAll = true; render(); },

  /* --- Panneau de validation d'un déplacement --- */
  "mc-open": (d) => { openMoveConfirm(d.lot, d.pad, "carte"); },
  "mc-day": (d) => { S.sheet.date = d.d; render(); },
  "mc-cal": () => { S.sheetBack = S.sheet; const t = S.sheet.date; S.sheet = { type: "date", target: "mc", y: +t.slice(0, 4), m: +t.slice(5, 7) - 1 }; render(); },
  "mc-confirm": async () => {
    const sh = S.sheet; if (!sh || sh.type !== "moveConfirm") return;
    const lot = lotById(sh.lotId);
    if (!lot || lot.deleted) { S.sheet = null; toast("Ce troupeau n’existe plus."); return; }
    const cur = lotLocation(C.D.moves, sh.lotId, sh.date);
    if (cur && cur.loc === sh.to) { toast("Le troupeau est déjà à cet endroit à cette date."); return; }
    const rec = { id: uid("mv"), lotId: sh.lotId, date: sh.date, to: sh.to, createdAt: Date.now() };
    await store.save("moves", rec);
    S.sheet = null;
    if (sh.from === "move") { S.move = null; S.screen = "home"; window.scrollTo(0, 0); }
    else S.carte.pad = rec.to === OUT ? S.carte.pad : rec.to;
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
    toast(lot.name + " → " + padLabel(rec.to) + (rec.date !== C.today ? " (" + fmtShort(rec.date) + ")" : ""), async () => { await store.remove("moves", rec.id); toast("Déplacement annulé"); });
  },

  /* --- Carte --- */
  "carte-layer": (d) => { S.carte.layer = d.v; render(); },
  "ct-parcel": (d) => { S.carte.vb = parcelView(d.id); S.carte.pad = null; render(); },
  "ct-lot": (d) => { const p = GEO.byId[d.pad]; if (!p) return; S.carte.pad = p.id; S.carte.vb = parcelView(p.parcel); render(); showPadCard(); },
  "ct-pad": (d) => {
    const p = GEO.byId[d.id]; if (!p) return;
    if (padScreenSize(p.id, S.carte.vb, carteMapH()) < MIN_TAP_PX) { S.carte.vb = parcelView(p.parcel); S.carte.pad = null; }
    else S.carte.pad = p.id;
    render(); if (S.carte.pad) showPadCard();
  },
  "map-full": (d) => { if (d.ctx === "mv" && S.move) S.move.vb = null; else { S.carte.vb = null; S.carte.pad = null; } render(); },
  "map-zoom": (d) => { gestures.zoomBy(d.ctx, Number(d.f)); },
  "carte-ref-today": () => { S.carte.ref = null; render(); },

  /* --- Calendrier --- */
  "cal-fs": () => { S.cal.fs = !S.cal.fs; render(); window.scrollTo(0, 0); },
  "cal-lot": (d) => { S.cal.lotId = d.lot; S.cal.sel = null; S.cal.year = null; render(); },
  "cal-sel": (d) => { S.cal.sel = { kind: d.kind, id: d.id }; render(); },
  "cal-locate": (d) => { const p = GEO.byId[d.id]; if (!p) return; S.cal.fs = false; S.carte.vb = parcelView(p.parcel); S.carte.pad = p.id; go("carte"); },

  /* --- Foin --- */
  "foin-open": (d) => { const p = lastFoin(d.lot); S.sheet = { type: "foin", lotId: d.lot, ftype: p ? p.type : null, year: p ? p.year : new Date().getFullYear(), date: C.today }; render(); },
  "foin-quick": async (d) => {
    const lot = lotById(d.lot); if (!lot) return;
    const p = lastFoin(lot.id);
    const rec = { id: uid("fo"), lotId: lot.id, date: C.today, type: p ? p.type : "foin", year: p ? p.year : new Date().getFullYear(), createdAt: Date.now() };
    await store.save("foins", rec);
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
    const n = store.live("foins").filter((f) => f.lotId === lot.id && f.date === C.today).length;
    toast((rec.type === "enrubanne" ? "Enrubanné " : "Foin ") + rec.year + " · " + lot.name + (n > 1 ? " (" + n + " aujourd’hui)" : ""),
      async () => { await store.remove("foins", rec.id); toast("Saisie de foin annulée"); }, 7000, { a: "edit-foin", id: rec.id });
  },
  "foin-type": (d) => { S.sheet.ftype = d.v; render(); },
  "foin-year": (d) => { S.sheet.year = +d.v; render(); },
  "foin-day": (d) => { S.sheet.date = d.d; render(); },
  "foin-cal": () => { S.sheetBack = S.sheet; const t = S.sheet.date; S.sheet = { type: "date", target: "foin", y: +t.slice(0, 4), m: +t.slice(5, 7) - 1 }; render(); },
  "foin-save": async () => {
    const sh = S.sheet; if (!sh || !sh.ftype) return;
    const rec = { id: uid("fo"), lotId: sh.lotId, date: sh.date, type: sh.ftype, year: sh.year, createdAt: Date.now() };
    await store.save("foins", rec);
    S.sheet = null;
    const lot = lotById(rec.lotId);
    toast((rec.type === "enrubanne" ? "Enrubanné " : "Foin ") + rec.year + " · " + (lot ? lot.name : ""), async () => { await store.remove("foins", rec.id); toast("Saisie de foin annulée"); });
  },

  /* --- Calendrier de date (feuille) --- */
  "date-month": (d) => { let m = S.sheet.m + Number(d.v), y = S.sheet.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.sheet.m = m; S.sheet.y = y; render(); },
  "date-pick": (d) => {
    if (S.sheetBack) { S.sheetBack.date = d.d; S.sheet = S.sheetBack; S.sheetBack = null; } else S.sheet = null;
    render();
  },
  "sheet-close": () => {
    if (S.sheet && S.sheet.type === "date" && S.sheetBack) { S.sheet = S.sheetBack; S.sheetBack = null; }
    else S.sheet = null;
    render();
  },

  /* --- Corrections --- */
  "edit-move": (d) => { const m = store.get("moves", d.id); if (!m) return; S.sheet = { type: "editMove", id: m.id, lotId: m.lotId, date: m.date, to: m.to }; render(); },
  "em-save": async () => {
    const sh = S.sheet, m = store.get("moves", sh.id); if (!m) return;
    const prev = { lotId: m.lotId, date: m.date, to: m.to };
    Object.assign(m, { lotId: sh.lotId, date: sh.date, to: sh.to });
    await store.save("moves", m); S.sheet = null;
    toast("Déplacement corrigé", async () => { Object.assign(m, prev); await store.save("moves", m); toast("Correction annulée"); });
  },
  "em-del": async () => {
    const m = store.get("moves", S.sheet.id); if (!m) return;
    await store.remove("moves", m.id); S.sheet = null; S.cal.sel = null;
    toast("Déplacement supprimé", async () => { m.deleted = false; await store.save("moves", m); toast("Suppression annulée"); }, 8000);
  },
  "edit-foin": (d) => { const f = store.get("foins", d.id); if (!f) return; S.toast = null; clearTimeout(toastTimer); S.sheet = { type: "editFoin", id: f.id, lotId: f.lotId, date: f.date, ftype: f.type, year: f.year }; render(); },
  "ef-type": (d) => { S.sheet.ftype = d.v; render(); },
  "ef-save": async () => {
    const sh = S.sheet, f = store.get("foins", sh.id); if (!f) return;
    const prev = { lotId: f.lotId, date: f.date, type: f.type, year: f.year };
    Object.assign(f, { lotId: sh.lotId, date: sh.date, type: sh.ftype, year: Number(sh.year) || f.year });
    await store.save("foins", f); S.sheet = null;
    toast("Foin corrigé", async () => { Object.assign(f, prev); await store.save("foins", f); toast("Correction annulée"); });
  },
  "ef-del": async () => {
    const f = store.get("foins", S.sheet.id); if (!f) return;
    await store.remove("foins", f.id); S.sheet = null;
    toast("Saisie de foin supprimée", async () => { f.deleted = false; await store.save("foins", f); toast("Suppression annulée"); }, 8000);
  },
  undo: async () => { const u = S.toast && S.toast.undo; S.toast = null; clearTimeout(toastTimer); if (u) await u(); else render(); },

  /* --- Troupeaux et compositions --- */
  "lot-new": () => { S.sheet = { type: "newLot", name: "" }; render(); setTimeout(() => { const el = document.getElementById("newLotName"); if (el) el.focus(); }, 30); },
  "lot-create": async () => {
    const name = S.sheet.name.trim(); if (!name) return;
    const used = new Set(C.D.lots.map((l) => l.color));
    const color = LOT_COLORS.find((c) => !used.has(c)) || LOT_COLORS[C.D.lots.length % LOT_COLORS.length];
    const rec = { id: uid("lot"), name, color, archived: false };
    await store.save("lots", rec); S.sheet = null;
    toast("Troupeau « " + name + " » créé");
  },
  "lot-open": (d) => { openLot(d.lot, C.today); S.lotBack = d.back || "lots"; go("plus", "lot"); },
  "lot-back": () => { if (S.lotBack === "home") go("home"); else go("plus", "lots"); },
  "lot-color": async (d) => { const l = lotById(d.lot); l.color = d.c; await store.save("lots", l); },
  "lot-archive": async (d) => {
    const l = lotById(d.lot); if (!l) return;
    if (l.archived) { l.archived = false; await store.save("lots", l); toast("Troupeau réactivé"); return; }
    const loc = lotLocation(C.D.moves, l.id, C.today);
    if (!loc || loc.loc === OUT) { l.archived = true; await store.save("lots", l); toast("Troupeau archivé", async () => { l.archived = false; await store.save("lots", l); toast("Archivage annulé"); }); return; }
    /* troupeau encore dans un paddock : on le sort aujourd'hui, sinon le paddock resterait « occupé » pour toujours */
    S.sheet = { type: "confirm", title: "Archiver « " + l.name + " » ?", text: "Ce troupeau est encore au paddock " + padLabel(loc.loc) + ". Il sera passé hors-paddock aujourd’hui, pour que le paddock soit libéré, puis archivé.", ok: "Sortir et archiver", run: async () => {
      const out = { id: uid("mv"), lotId: l.id, date: C.today, to: OUT, createdAt: Date.now() };
      l.archived = true;
      await store.saveMany([{ entity: "moves", rec: out }, { entity: "lots", rec: l }]);
      toast("Troupeau sorti et archivé", async () => { out.deleted = true; l.archived = false; await store.saveMany([{ entity: "moves", rec: out }, { entity: "lots", rec: l }]); toast("Archivage annulé"); }, 8000);
    } };
    render();
  },
  "lot-delete": (d) => {
    const l = lotById(d.lot);
    const n = C.D.moves.filter((m) => m.lotId === l.id).length;
    S.sheet = { type: "confirm", title: "Supprimer « " + l.name + " » ?", text: "Son historique sera aussi supprimé (" + n + " déplacement(s), compositions, foin), sur cet appareil et dans le tableur. Pour garder l’historique, préférez « Archiver ».", ok: "Supprimer définitivement", danger: true, run: async () => {
      const list = [{ entity: "lots", rec: l }];
      for (const e of ["moves", "comps", "foins"]) for (const r of store.DATA[e]) if (r.lotId === l.id && !r.deleted) list.push({ entity: e, rec: r });
      list.forEach((x) => { x.rec.deleted = true; });
      await store.saveMany(list);
      go("plus", "lots");
      toast("Troupeau supprimé", async () => { list.forEach((x) => { x.rec.deleted = false; }); await store.saveMany(list); toast("Suppression annulée"); }, 10000);
    } };
    render();
  },
  "comp-save": async () => {
    const E = S.lotEdit, items = {};
    for (const k in E.draft) if (toNum(E.draft[k]) > 0) items[k] = toNum(E.draft[k]);
    const id = E.lotId + "@" + E.eff;
    const rec = store.get("comps", id) || { id, lotId: E.lotId, eff: E.eff };
    rec.items = items; rec.deleted = false;
    await store.save("comps", rec);
    toast("Composition du " + fmtShort(E.eff, true) + " enregistrée");
  },
  "comp-dup": () => {
    const last = C.D.comps.filter((c) => c.lotId === S.lotEdit.lotId).sort((a, b) => (a.eff < b.eff ? 1 : -1))[0];
    if (last) { S.lotEdit.draft = clone(last.items || {}); render(); }
  },
  "comp-load": (d) => { const c = store.get("comps", d.id); if (c) { S.lotEdit.eff = c.eff; S.lotEdit.draft = clone(c.items || {}); render(); } },
  "comp-del": async (d) => {
    const c = store.get("comps", d.id); if (!c) return;
    await store.remove("comps", c.id);
    toast("Composition supprimée", async () => { c.deleted = false; await store.save("comps", c); toast("Suppression annulée"); });
  },
  "cat-add": async () => {
    const name = S.newCat.name.trim(); if (!name) return;
    let base = normText(name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "cat", id = base, k = 2;
    while (store.get("cats", id)) id = base + "_" + k++; // jamais l'identifiant d'une catégorie supprimée (ses anciens effectifs reviendraient)
    await store.save("cats", { id, name, ugb: toNum(S.newCat.ugb) });
    S.newCat = { name: "", ugb: "" }; render();
  },
  "cat-del": async (d) => {
    const c = store.get("cats", d.id); if (!c) return;
    await store.remove("cats", c.id);
    toast("Catégorie « " + c.name + " » supprimée", async () => { c.deleted = false; await store.save("cats", c); toast("Suppression annulée"); });
  },

  /* --- Journal --- */
  "jr-kind": (d) => { S.journal.kind = d.v; S.journal.limit = 100; render(); },
  "jr-more": () => { S.journal.limit += 200; render(); },

  /* --- Synchronisation --- */
  "sync-save": async () => { await setSyncConfig(S.syncForm.url, S.syncForm.secret); S.syncMsg = "Réglage enregistré."; render(); const r = await syncNow(); S.syncMsg = r.ok ? "Réglage enregistré, synchronisation réussie." : "Réglage enregistré. " + (r.reason === "off" ? "" : "Synchro : " + r.reason); render(); },
  "sync-test": async () => { S.syncMsg = "Test en cours…"; render(); await setSyncConfig(S.syncForm.url, S.syncForm.secret); S.syncMsg = await testSync(); render(); },
  "sync-now": async () => { const r = await syncNow(); S.syncMsg = r.ok ? "Synchronisation réussie" + (r.received ? " · " + r.received + " modification(s) reçue(s)" : "") : "Échec : " + r.reason; render(); },
  "sync-full": async () => { const r = await syncNow({ full: true }); S.syncMsg = r.ok ? "Tableur relu entièrement · " + r.received + " enregistrement(s) mis à jour" : "Échec : " + r.reason; render(); },
  "sync-pushall": async () => { await store.queueEverything(); const r = await syncNow(); S.syncMsg = r.ok ? "Toutes les données ont été envoyées." : "Échec : " + r.reason; render(); },

  /* --- Exports --- */
  "ex-zip": async () => { const z = X.allExportsZip(S.exYear, SET); X.downloadBlob(z.name, z.blob); await markBackup(); toast("ZIP téléchargé : " + z.name); },
  "ex-share": async () => {
    const z = X.allExportsZip(S.exYear, SET);
    try { if (await X.shareBlob(z.name, z.blob)) { await markBackup(); toast("ZIP partagé"); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    X.downloadBlob(z.name, z.blob); await markBackup(); toast("Partage indisponible : ZIP téléchargé");
  },
  "ex-csv": (d) => {
    const y = S.exYear;
    const f = { sejours: () => X.csvSejours(y), journalier: () => X.csvJournalier(y), deplacements: () => X.csvDeplacements(y), compositions: () => X.csvCompositions(), foin: () => X.csvFoin(y) }[d.k];
    X.downloadText(d.k + (d.k === "compositions" ? "" : "_" + y) + ".csv", f(), "text/csv;charset=utf-8");
  },
  "ex-json": async () => {
    X.downloadText("sauvegarde_paturage_" + X.localStamp() + ".json", JSON.stringify(X.backupObject(SET), null, 1), "application/json");
    await markBackup();
  },
  "import-v8-local": () => {
    const v8 = readV8FromThisBrowser(); if (!v8) return;
    askImportV8(v8, "les données v8 de ce navigateur");
  },

  /* --- Réglages --- */
  "set-theme": async (d) => { SET.theme = d.v; applyTheme(); await saveSettings(); render(); },
  "reset-all": async () => {
    const warn = await pendingWarning();
    S.sheet = { type: "confirm", title: "Effacer les données de cet appareil ?", text: "Troupeaux, déplacements, compositions et foin seront effacés de cet appareil. Le tableur n’est pas modifié : les données déjà envoyées se récupèrent par la synchronisation." + warn, ok: "Tout effacer", danger: true, run: async () => {
      if (!(await flushBeforeReplace())) return;
      await store.wipeAll(); await store.setMeta("sync.cursor", 0); go("home"); toast("Données de l’appareil effacées");
    } };
    render();
  },
  "load-demo": async () => {
    if (configured()) { S.sheet = { type: "confirm", title: "Démo indisponible", text: "La synchronisation est réglée sur cet appareil : la démo se mélangerait aux vraies données du tableur. Utilisez la démo sur un appareil sans synchronisation.", ok: "Compris" }; render(); return; }
    const warn = await pendingWarning();
    S.sheet = { type: "confirm", title: "Charger la démo ?", text: "Quatre troupeaux d’exemple et une saison de déplacements remplaceront les données de cet appareil." + warn, ok: "Charger la démo", danger: true, run: async () => {
      const { demoRecords } = await import("./demo.js");
      await store.replaceAll(demoRecords(), { queue: false }); go("home"); toast("Démo chargée");
    } };
    render();
  },
  "pick-file": (d) => { pickFile(d.k); },
  "confirm-ok": async () => { const sh = S.sheet; S.sheet = null; if (sh && sh.run) await sh.run(); else render(); },

  /* --- Carte : import --- */
  "map-import": async () => {
    try {
      const fp = S.files.parcels, fd = S.files.paddocks;
      if (!fp && !fd) { S.mapMsg = "Choisissez au moins un fichier."; render(); return; }
      const cur = (await store.getMeta("customMap")) || { parcels: BASE_CARTE.parcels, paddocks: BASE_CARTE.paddocks };
      const parcels = fp ? parcelsFromGeoJSON(JSON.parse(await readText(fp))) : cur.parcels;
      const paddocks = fd ? paddocksFromGeoJSON(JSON.parse(await readText(fd))) : cur.paddocks;
      if (!parcels.length || !paddocks.length) throw new Error("Fichier vide ou sans polygones.");
      await store.setMeta("customMap", { parcels, paddocks });
      await loadGeo(); S.mapMsg = "Découpage importé : " + parcels.length + " parcelles, " + paddocks.length + " paddocks."; S.files = {};
    } catch (e) { S.mapMsg = "Erreur : " + (e.message || e); }
    render();
  },
  "map-reset": async () => { await store.delMeta("customMap"); await loadGeo(); S.mapMsg = "Carte d’origine rétablie."; render(); },
  "raster-import": async () => {
    try {
      const fi = S.files.raster, fw = S.files.world;
      if (!fi || !fw) { S.mapMsg = "Choisissez l’image et son fichier world."; render(); return; }
      const bmp = await createImageBitmap(fi);
      const b = parseWorldFile(await readText(fw), bmp.width, bmp.height);
      await store.setMeta("customRaster", { blob: fi, bounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height } });
      await loadGeo(); S.mapMsg = "Fond de carte importé."; S.files = {};
    } catch (e) { S.mapMsg = "Erreur : " + (e.message || e); }
    render();
  },
  "raster-reset": async () => { await store.delMeta("customRaster"); await loadGeo(); S.mapMsg = "Fond d’origine rétabli."; render(); }
};

/* ---------------- saisies (champs) ---------------- */
const LIVE_INPUTS = new Set(["move-q", "newlot-name", "comp-n", "newcat-name", "newcat-ugb", "sync-url", "sync-secret"]);
const RERENDER_ON_INPUT = new Set(["move-q", "newlot-name", "comp-n"]);
const I = {
  "move-q": (v) => { S.move.q = v; },
  "newlot-name": (v) => { S.sheet.name = v; },
  "comp-n": (v, el) => { S.lotEdit.draft[el.dataset.cat] = v; },
  "newcat-name": (v) => { S.newCat.name = v; },
  "newcat-ugb": (v) => { S.newCat.ugb = v; },
  "sync-url": (v) => { S.syncForm.url = v; },
  "sync-secret": (v) => { S.syncForm.secret = v; },
  "carte-ref": (v) => { S.carte.ref = v && v < C.today ? v : null; },
  "set-restTarget": async (v) => { SET.restTarget = Math.max(1, Math.min(365, Math.round(toNum(v)) || 45)); await saveSettings(); },
  "set-pressureMax": async (v) => { SET.pressureMax = Math.max(0.1, toNum(v) || 2); await saveSettings(); },
  "set-longStay": async (v) => { SET.longStay = Math.max(1, Math.round(toNum(v)) || 10); await saveSettings(); },
  "cal-year": (v) => { S.cal.year = +v; S.cal.sel = null; },
  "lot-name": async (v, el) => { const l = lotById(el.dataset.lot); if (l && v.trim()) { l.name = v.trim(); await store.save("lots", l, { silent: true }); } },
  "comp-eff": (v) => { if (!v) return; openLot(S.lotEdit.lotId, v); },
  "jr-lot": (v) => { S.journal.lotId = v; },
  "jr-from": (v) => { S.journal.from = v; },
  "jr-to": (v) => { S.journal.to = v; },
  "ex-year": (v) => { S.exYear = +v; },
  "lot-color-custom": async (v, el) => { const l = lotById(el.dataset.lot); if (l && /^#[0-9a-f]{6}$/i.test(v)) { l.color = v; await store.save("lots", l); } },
  "cat-name": async (v, el) => { const c = store.get("cats", el.dataset.id); if (c && v.trim()) { c.name = v.trim(); await store.save("cats", c, { silent: true }); } },
  "cat-ugb": async (v, el) => { const c = store.get("cats", el.dataset.id); if (c) { c.ugb = toNum(v); await store.save("cats", c, { silent: true }); } },
  "em-lot": (v) => { S.sheet.lotId = v; }, "em-date": (v) => { if (v) S.sheet.date = v; }, "em-to": (v) => { S.sheet.to = v; },
  "ef-lot": (v) => { S.sheet.lotId = v; }, "ef-date": (v) => { if (v) S.sheet.date = v; }, "ef-year": (v) => { S.sheet.year = v; },
};

/* Sélecteur de fichiers persistant, hors de la zone redessinée : sur téléphone, ouvrir le
   sélecteur met l'appli en arrière-plan ; au retour elle se resynchronise et se redessine,
   ce qui faisait perdre le fichier choisi avec un champ <input> intégré à l'écran. */
const filePicker = document.createElement("input");
filePicker.type = "file";
filePicker.style.display = "none";
document.body.appendChild(filePicker);
const PICK_ACCEPT = { restore: "", parcels: "", paddocks: "", raster: "image/png,image/jpeg", world: "" };
function pickFile(kind) {
  filePicker.accept = PICK_ACCEPT[kind] || "";
  filePicker.value = "";
  filePicker.onchange = async () => {
    const f = filePicker.files && filePicker.files[0];
    if (!f) return;
    try {
      if (kind === "restore") await restoreFile(f);
      else { S.files[kind] = f; render(); }
    } catch (e) { showError(e); }
  };
  filePicker.click();
}
const NO_RENDER_ON_CHANGE = new Set(["lot-name", "cat-name", "sync-url", "sync-secret", "newcat-name", "newcat-ugb"]);

/* ---------------- fonctions annexes ---------------- */
function openLot(lotId, eff) {
  const c = compForDate(store.live("comps"), lotId, eff);
  S.lotEdit = { lotId, eff, draft: c ? clone(c.items || {}) : {} };
}
/* dernière saisie de foin d'un troupeau (pour reprendre son type et son année de fauche) */
function lastFoin(lotId) {
  return store.live("foins").filter((f) => f.lotId === lotId).sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.createdAt || 0) - (a.createdAt || 0)))[0] || null;
}
/* fiche du paddock choisi : la faire apparaître à l'écran (elle est sous la carte) */
function showPadCard() {
  const el = document.getElementById("padcard"); if (!el) return;
  const r = el.getBoundingClientRect();
  const bottom = window.innerHeight - 84; // au-dessus de la barre d'onglets
  if (r.bottom > bottom) window.scrollBy({ top: Math.min(r.bottom - bottom, r.top - 70), behavior: "smooth" });
}
function openMoveConfirm(lotId, to, from) {
  const date = from === "move" && S.move && S.move.date ? S.move.date : C.today;
  S.sheet = { type: "moveConfirm", lotId, to, date, from };
  render();
}
const gestures = attachMapGestures(app, {
  setView: (ctx, vb) => { if (ctx === "mv" && S.move) S.move.vb = vb; else if (ctx === "ct") S.carte.vb = vb; render(); }
});
/* Avertissement : saisies pas encore envoyées au tableur, perdues si on remplace les données */
async function pendingWarning() {
  const n = await store.outboxCount();
  if (!n) return "";
  return configured() ? " " + n + " modification(s) pas encore envoyée(s) : un envoi sera tenté avant ; si le réseau manque, l’opération sera annulée." : " Attention : " + n + " modification(s) n’ont jamais été envoyées au tableur (synchronisation non réglée) et seront perdues.";
}
/* Avant d'effacer ou de remplacer : envoyer ce qui attend. Renvoie false si des envois restent bloqués. */
async function flushBeforeReplace() {
  if (!configured() || !(await store.outboxCount())) return true;
  toast("Envoi des dernières saisies…");
  await syncNow();
  const left = await store.outboxCount();
  if (left) { toast(left + " modification(s) n’ont pas pu partir (réseau ?) : opération annulée, rien n’a été effacé.", null, 9000); return false; }
  return true;
}
function openSync() { S.syncForm = { url: SYNC.url, secret: SYNC.secret }; S.syncMsg = ""; go("plus", "sync"); }
async function markBackup() { lastBackup = Date.now(); await store.setMeta("lastBackup", lastBackup); }

/* Réimport v8 sur un appareil qui a déjà des données : les enregistrements issus de la v8
   (identifiants « id_… ») sont remplacés par la nouvelle conversion, ceux qui n'existent plus
   sont marqués supprimés (pour que la suppression parte aussi au tableur), et tout ce qui a été
   saisi dans la v9 est conservé. */
async function mergeV8(records) {
  const list = [];
  for (const e of store.ENTITIES) {
    const fresh = new Set((records[e] || []).map((r) => r.id));
    if (e === "moves" || e === "foins" || e === "lots") {
      for (const r of store.DATA[e]) if (!r.deleted && String(r.id).startsWith("id_") && !fresh.has(r.id)) { r.deleted = true; list.push({ entity: e, rec: r }); }
    }
    if (e === "comps") {
      /* compositions abîmées d'un import précédent : troupeau inconnu ou effectifs vides */
      const lotIds = new Set((records.lots || []).map((l) => l.id).concat(store.DATA.lots.filter((l) => !l.deleted).map((l) => l.id)));
      for (const r of store.DATA.comps) {
        if (r.deleted || fresh.has(r.id)) continue;
        if (!lotIds.has(r.lotId) || !Object.values(r.items || {}).some((n) => Number(n) > 0)) { r.deleted = true; list.push({ entity: e, rec: r }); }
      }
    }
    for (const r of records[e] || []) {
      const cur = store.get(e, r.id);
      if (e === "lots" && cur) { r.color = cur.color; r.archived = cur.archived || r.archived; r.name = cur.name; }
      list.push({ entity: e, rec: r });
    }
  }
  await store.saveMany(list);
}

function askImportV8(v8, label) {
  const conv = fromV8(v8, GEO.aliases);
  const r = conv.report;
  const merging = C.D.moves.length > 0 || C.D.lots.length > 0;
  /* appareil vide mais synchronisé : ses données viennent du tableur. Un import v8 ici (souvent ancien)
     passerait pour la version la plus récente et écraserait les corrections faites depuis. */
  if (!merging && configured()) {
    S.sheet = { type: "confirm", title: "Import v8 inutile ici", text: "La synchronisation est réglée : les données arrivent du tableur (Plus → Synchronisation → « Tout récupérer depuis le tableur »). Importer les données v8 de cet appareil risquerait d’écraser des corrections plus récentes.", ok: "Compris" };
    render(); return;
  }
  const v8Last = (v8.movements || []).reduce((m, x) => (x && x.dt > m ? x.dt : m), "");
  const v9Last = C.D.moves.reduce((m, x) => (x.date > m ? x.date : m), "");
  const stale = merging && v8Last && v9Last && v8Last < v9Last;
  S.sheet = { type: "confirm", danger: stale, title: (stale ? "⚠️ Données v8 plus anciennes — " : "") + (merging ? "Réimporter " : "Importer ") + label + " ?",
    text: (v8Last ? "Dernier mouvement v8 trouvé : " + fmtShort(v8Last, true) + "." + (stale ? " La v9 contient des déplacements jusqu’au " + fmtShort(v9Last, true) + " : ces données v8 sont probablement anciennes (autre navigateur ?). Ne réimportez pas, sauf si vous êtes sûr. " : " ") : "") + r.lots + " troupeau(x), " + r.comps + " composition(s), " + r.v8events + " mouvement(s) v8 → " + r.moves + " déplacement(s), " + r.foins + " foin." +
      (r.orphanOuts ? " " + r.orphanOuts + " sortie(s) sans entrée ignorée(s)." : "") + (r.badComps ? " " + r.badComps + " composition(s) vide(s) ou abîmée(s) écartée(s)." : "") + (r.ghostLots ? " " + r.ghostLots + " troupeau(x) supprimé(s) en v8 archivé(s)." : "") +
      (merging ? " Les données issues de la v8 seront remplacées ; vos saisies faites dans la v9 sont conservées." : ""),
    ok: stale ? "Réimporter quand même" : merging ? "Réimporter" : "Importer", run: async () => {
      if (merging) await mergeV8(conv.records); else await store.replaceAll(conv.records);
      if (conv.settings.restTarget) { SET.restTarget = conv.settings.restTarget; await saveSettings(); }
      S.restoreMsg = "Import v8 terminé : " + r.moves + " déplacements.";
      go("home");
      toast("Données v8 importées" + (SYNC.url ? " — envoi au tableur en cours" : ""));
    } };
  render();
}
async function restoreFile(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (_) { S.restoreMsg = "Fichier illisible (JSON attendu)."; render(); return; }
  if (isV8(obj)) { askImportV8(obj, "la sauvegarde v8 « " + file.name + " »"); return; }
  if (obj && obj.format === "paturage-v9-ajout" && obj.records) {
    /* fichier de réparation : ajoute / met à jour des enregistrements, ne supprime rien */
    const list = [];
    for (const e of store.ENTITIES) for (const r of obj.records[e] || []) if (r && r.id) list.push({ entity: e, rec: r });
    const parts = store.ENTITIES.filter((e) => (obj.records[e] || []).length).map((e) => obj.records[e].filter((r) => !r.deleted).length + " " + ({ lots: "troupeau(x)", cats: "catégorie(s)", comps: "composition(s)", moves: "déplacement(s)", foins: "foin" })[e]);
    const dels = list.filter((x) => x.rec.deleted).map((x) => x.rec.name || (x.entity === "moves" ? "1 déplacement" : x.rec.id));
    S.sheet = { type: "confirm", title: "Ajouter « " + file.name + " » ?", text: (obj.description ? obj.description + " " : "") + "Contenu : " + parts.join(", ") + "." + (dels.length ? " Supprime aussi : " + dels.join(", ") + "." : " Rien n’est supprimé.") + " Les éléments de même identifiant sont mis à jour.", ok: "Ajouter", run: async () => {
      await store.saveMany(list);
      S.restoreMsg = "Ajout terminé : " + parts.join(", ") + "."; render(); toast("Fichier ajouté");
    } };
    render(); return;
  }
  if (!obj || obj.format !== "paturage-v9" || !obj.records) { S.restoreMsg = "Ce fichier n’est pas une sauvegarde de l’appli."; render(); return; }
  const n = (obj.records.moves || []).filter((m) => !m.deleted).length;
  const warn = await pendingWarning();
  S.sheet = { type: "confirm", title: "Restaurer « " + file.name + " » ?", text: "Sauvegarde du " + String(obj.exportedAt || "").slice(0, 10) + " : " + n + " déplacement(s). Les données de cet appareil seront remplacées et la sauvegarde sera envoyée au tableur." + (configured() ? " Ce qui a été saisi sur d’autres appareils après la sauvegarde sera ensuite récupéré par la synchronisation." : "") + warn, ok: "Restaurer", danger: true, run: async () => {
    if (!(await flushBeforeReplace())) return;
    const recs = obj.records;
    const now = Date.now();
    for (const e of store.ENTITIES) for (const r of recs[e] || []) r.updatedAt = now; // la restauration devient la version la plus récente
    await store.replaceAll(recs);
    await store.setMeta("sync.cursor", 0); // relire tout le tableur : récupérer ce qui n'est pas dans la sauvegarde
    if (obj.settings) { Object.assign(SET, obj.settings); applyTheme(); await saveSettings(); }
    S.restoreMsg = "Restauration terminée."; go("home"); toast("Sauvegarde restaurée");
  } };
  render();
}

/* ---------------- événements ---------------- */
app.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-a]");
  if (!el || !app.contains(el)) return;
  const fn = A[el.dataset.a];
  if (!fn) return;
  ev.preventDefault();
  try { await fn(el.dataset, el, ev); } catch (e) { showError(e); }
});
app.addEventListener("input", async (ev) => {
  const el = ev.target; const k = el.dataset && el.dataset.in;
  if (!k || !LIVE_INPUTS.has(k) || !I[k]) return;
  await I[k](el.value, el);
  if (RERENDER_ON_INPUT.has(k)) render();
});
app.addEventListener("change", async (ev) => {
  const el = ev.target; const k = el.dataset && el.dataset.in;
  if (!k || !I[k]) return;
  try {
    if (!LIVE_INPUTS.has(k) || NO_RENDER_ON_CHANGE.has(k)) await I[k](el.value, el);
    if (!NO_RENDER_ON_CHANGE.has(k)) render();
  } catch (e) { showError(e); }
});
app.addEventListener("toggle", (ev) => { if (ev.target.matches && ev.target.matches("details.opts")) S.carte.optsOpen = ev.target.open; }, true);
app.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.dataset && ev.target.dataset.in === "newlot-name") { ev.preventDefault(); A["lot-create"](); }
  if (ev.key === "Escape" && S.sheet) A["sheet-close"]();
});
window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(render, 200); });

function showError(e) {
  console.error(e);
  let bar = document.getElementById("errbar");
  if (!bar) { bar = document.createElement("div"); bar.id = "errbar"; bar.className = "errbar"; document.body.appendChild(bar); }
  bar.innerHTML = "";
  const t = document.createElement("span"); t.textContent = "Erreur : " + ((e && e.message) || e);
  const b = document.createElement("button"); b.textContent = "Fermer"; b.onclick = () => bar.remove();
  bar.append(t, b);
}
window.addEventListener("error", (ev) => showError(ev.error || ev.message));
window.addEventListener("unhandledrejection", (ev) => showError(ev.reason));

/* ---------------- démarrage ---------------- */
async function init() {
  const q = new URLSearchParams(location.search);
  await store.openDB();
  Object.assign(SET, (await store.getMeta("settings")) || {});
  if (q.get("theme") === "dark" || q.get("theme") === "light") { SET.theme = q.get("theme"); await saveSettings(); }
  applyTheme();
  let dev = await store.getMeta("deviceId");
  if (!dev) { dev = "dev_" + Math.random().toString(36).slice(2, 10); await store.setMeta("deviceId", dev); }
  store.setDevice(dev);
  await loadGeo();
  await store.loadAll();
  lastBackup = await store.getMeta("lastBackup", 0);
  v8Available = !!readV8FromThisBrowser();
  store.onChange((info) => { if (info.local) scheduleSync({ quiet: info.silent }); if (!info.silent) render(); });
  onSync(() => { if (C) render(); });
  await initSync();
  if (navigator.storage && navigator.storage.persist) {
    try { persist = (await navigator.storage.persisted()) || (await navigator.storage.persist()) ? "oui" : "non"; } catch (_) { persist = "—"; }
  }
  render();
  syncNow();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    /* nouvelle version installée pendant l'ouverture : on recharge une fois pour l'utiliser tout de suite */
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || sessionStorage.getItem("swReloaded")) return;
      if (S.sheet || S.screen === "move") return; // ne pas interrompre une saisie
      sessionStorage.setItem("swReloaded", "1"); location.reload();
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  }
  console.log("Suivi pâturage v" + VERSION);
}
init().catch(showError);
