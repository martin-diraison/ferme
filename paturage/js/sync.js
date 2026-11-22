/* Synchronisation avec le Google Sheet via le script Apps Script v9.
   - Envoi : la boîte d'envoi n'est vidée qu'après accusé de réception du serveur.
   - Réception : on récupère les enregistrements modifiés depuis le dernier passage.
   Le secret voyage dans le corps de la requête (POST), pas dans l'adresse. */

import { outboxAll, outboxAck, outboxCount, applyRemote, getMeta, setMeta, DATA } from "./store.js";
import { padLabel, parcelLabel, GEO } from "./geo.js";
import { ugbOf } from "./domain.js";

export const SYNC = { url: "", secret: "", state: "off", pending: 0, lastOk: 0, lastErr: "", busy: false };
const subs = new Set();
export function onSync(fn) { subs.add(fn); }
function emit() { subs.forEach((f) => { try { f(SYNC); } catch (_) {} }); }

export async function initSync() {
  SYNC.url = await getMeta("sync.url", "");
  SYNC.secret = await getMeta("sync.secret", "");
  SYNC.lastOk = await getMeta("sync.lastOk", 0);
  await refreshCount();
  window.addEventListener("online", () => syncNow());
  /* au retour dans l'appli : envoi + réception ; en quittant l'appli : on tente d'envoyer ce qui attend */
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") syncNow();
    else if (configured() && (await outboxCount())) { clearTimeout(timer); syncNow(); }
  });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 5 * 60 * 1000);
}
export async function setSyncConfig(url, secret) {
  const newUrl = String(url || "").trim();
  /* autre script (donc peut-être autre tableur) : on relira tout depuis le début */
  if (newUrl !== SYNC.url) await setMeta("sync.cursor", 0);
  SYNC.url = newUrl; SYNC.secret = String(secret || "").trim();
  await setMeta("sync.url", SYNC.url); await setMeta("sync.secret", SYNC.secret);
  await refreshCount();
}
export function configured() { return !!(SYNC.url && SYNC.secret); }

async function refreshCount() {
  SYNC.pending = await outboxCount();
  if (!configured()) SYNC.state = "off";
  else if (!navigator.onLine) SYNC.state = "offline";
  else if (SYNC.state !== "error") SYNC.state = SYNC.pending ? "pending" : "ok";
  emit();
}

let timer = null, again = false;
/* quiet : ne met pas à jour le compteur tout de suite (évite un réaffichage pendant une saisie) */
export function scheduleSync({ quiet = false } = {}) {
  if (!quiet) refreshCount();
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), 1200);
}

async function call(payload) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(SYNC.url, { method: "POST", body: JSON.stringify(Object.assign({ secret: SYNC.secret }, payload)), signal: ctrl.signal, redirect: "follow" });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (_) { throw new Error("Réponse illisible du script (vérifiez l'adresse et le déploiement)."); }
    if (!j.ok) throw new Error(j.error === "forbidden" ? "Secret refusé par le script." : (j.error || "Erreur du script."));
    return j;
  } finally { clearTimeout(to); }
}

/* Champs lisibles écrits dans le tableur (colonnes d'analyse) ; la vérité reste la colonne json. */
export function viewOf(entity, r) {
  const lotName = (id) => { const l = DATA.lots.find((x) => x.id === id); return l ? l.name : id; };
  if (entity === "lots") return { nom: r.name, couleur: r.color, archive: r.archived ? "oui" : "" };
  if (entity === "cats") return { nom: r.name, ugb: r.ugb };
  if (entity === "comps") return { troupeau: lotName(r.lotId), date_effet: r.eff, ugb_total: Math.round(ugbOf(r.items, DATA.cats) * 100) / 100, detail: JSON.stringify(r.items || {}) };
  if (entity === "moves") {
    const p = GEO.byId[r.to];
    return { troupeau: lotName(r.lotId), date: r.date, destination: padLabel(r.to), parcelle: p ? parcelLabel(p.parcel) : "", surface_ha: p ? Math.round(p.area * 10000) / 10000 : "" };
  }
  if (entity === "foins") return { troupeau: lotName(r.lotId), date: r.date, type: r.type === "enrubanne" ? "Enrubanné" : "Foin", annee_fauche: r.year };
  return {};
}

export async function syncNow({ full = false } = {}) {
  if (!configured()) { await refreshCount(); return { ok: false, reason: "off" }; }
  if (!navigator.onLine) { SYNC.state = "offline"; emit(); return { ok: false, reason: "offline" }; }
  /* synchro déjà en cours : on en relancera une à la fin, pour envoyer ce qui vient d'être saisi */
  if (SYNC.busy) { again = true; return { ok: false, reason: "busy" }; }
  SYNC.busy = true; emit();
  try {
    /* 1. envoi, par paquets */
    let items = await outboxAll();
    while (items.length) {
      const batch = items.slice(0, 150);
      const res = await call({ action: "push", ops: batch.map((it) => ({ entity: it.entity, rec: it.rec, view: viewOf(it.entity, it.rec) })) });
      const acked = new Set(res.acked || []);
      await outboxAck(batch.filter((it) => acked.has(it.key)));
      if (acked.size < batch.length) throw new Error("Le serveur n'a pas confirmé tous les envois.");
      items = items.slice(150);
    }
    /* 2. réception */
    const since = full ? 0 : await getMeta("sync.cursor", 0);
    const res = await call({ action: "pull", since });
    const n = await applyRemote(res.records || []);
    await setMeta("sync.cursor", res.serverTs || 0);
    SYNC.lastOk = Date.now(); await setMeta("sync.lastOk", SYNC.lastOk);
    SYNC.lastErr = ""; SYNC.state = "ok";
    return { ok: true, received: n };
  } catch (e) {
    SYNC.lastErr = e.name === "AbortError" ? "Délai dépassé (réseau trop faible ?)" : (e.message || String(e));
    /* coupure réseau (fréquente au pré) : simple attente, pas une « erreur » */
    const network = e.name === "AbortError" || e instanceof TypeError;
    SYNC.state = !navigator.onLine || network ? "offline" : "error";
    if (network && navigator.onLine) SYNC.lastErr = "Réseau indisponible : les saisies partiront à la prochaine connexion.";
    return { ok: false, reason: SYNC.lastErr };
  } finally {
    SYNC.busy = false;
    await refreshCount();
    if (again) { again = false; if (SYNC.pending && SYNC.state === "pending") { clearTimeout(timer); timer = setTimeout(() => syncNow(), 300); } }
  }
}

export async function testSync() {
  try { const r = await call({ action: "ping" }); return "Connexion OK — script " + (r.version || "?"); }
  catch (e) { return "Échec : " + (e.message || e); }
}
