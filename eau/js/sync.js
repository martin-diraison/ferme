/* Synchronisation avec le tableur Google (script Apps Script attaché au tableur, voir ../serveur/).
   Repris de l'appli pâturage v9 :
   - envoi : la boîte d'envoi n'est vidée qu'après accusé de réception du script ;
   - réception : enregistrements modifiés depuis le dernier passage (le plus récent l'emporte) ;
   - le secret voyage dans le corps de la requête (POST), jamais dans l'adresse.
   En plus : l'onglet « Pluie_journaliere » est réécrit en entier quand la pluie change ;
   les photos en attente partent une par une vers Google Drive (action « photo » du script). */
import { outboxAll, outboxAck, outboxCount, applyRemote, getMeta, setMeta, queueEverything, DATA, photosAEnvoyer, putPhoto, delPhoto, save } from "./store.js";
import * as D from "./domain.js";

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
  window.addEventListener("offline", () => refreshCount());
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") syncNow();
    else if (configured() && SYNC.pending) { clearTimeout(timer); syncNow(); }
  });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 5 * 60 * 1000);
  if (configured()) syncNow();
}
export async function setSyncConfig(url, secret) {
  const u = String(url || "").trim();
  if (u !== SYNC.url) { await setMeta("sync.cursor", 0); await setMeta("sync.journal", ""); }
  SYNC.url = u; SYNC.secret = String(secret || "").trim();
  await setMeta("sync.url", SYNC.url); await setMeta("sync.secret", SYNC.secret);
  SYNC.state = "pending"; SYNC.lastErr = "";
  await refreshCount();
}
export function configured() { return !!(SYNC.url && SYNC.secret); }

async function refreshCount() {
  SYNC.pending = (await outboxCount()) + (await nbPhotosEnAttente());
  if (!configured()) SYNC.state = "off";
  else if (!navigator.onLine) SYNC.state = "offline";
  else if (SYNC.state !== "error") SYNC.state = SYNC.pending ? "pending" : "ok";
  emit();
}

let timer = null, again = false;
export function scheduleSync() {
  refreshCount();
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), 1500);
}

const MAJ_SCRIPT = "Le script du tableur doit être mis à jour (version eau-0.3) : voir serveur/LISEZMOI.md.";
async function call(payload, url = SYNC.url, secret = SYNC.secret, delai = 25000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), delai);
  try {
    const r = await fetch(url, { method: "POST", body: JSON.stringify(Object.assign({ secret }, payload)), signal: ctrl.signal, redirect: "follow" });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (_) { throw new Error("Réponse illisible du script (vérifiez l'adresse /exec et le déploiement « Tout le monde »)."); }
    if (!j.ok) throw new Error(j.error === "forbidden" ? "Secret refusé par le script." : j.error === "action inconnue" ? MAJ_SCRIPT : (j.error || "Erreur du script."));
    return j;
  } finally { clearTimeout(to); }
}

/* ---------- colonnes lisibles du tableur (la colonne json reste la référence pour l'appli) ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
function dh(t) { if (!t) return ""; const d = new Date(t); return D.jourISO(t) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
const live = (e) => DATA[e].filter((r) => !r.deleted);
const byId = (e, id) => DATA[e].find((r) => r.id === id);
export function viewOf(entity, r) {
  if (entity === "points") return { nom: r.nom, type: (D.TYPES[r.type] || {}).lib || r.type, altitude_m: r.alt, lng: r.lng, lat: r.lat, suivi: r.actif === false ? "non" : "oui", mesures: (r.mesures || []).join(" "), nom_sig: r.sig || "" };
  if (entity === "tournees") return { debut: dh(r.debut), fin: dh(r.fin), terminee: r.terminee ? "oui" : "non" };
  if (entity === "obs") {
    const p = byId("points", r.pointId) || {}, t = byId("tournees", r.tourneeId);
    return { tournee: t ? dh(t.debut) : "", date_heure: dh(r.t), point: p.nom || r.pointId, type: (D.TYPES[p.type] || {}).lib || "", altitude_m: p.alt ?? "",
      etat: r.etat === D.IMPOSSIBLE ? "" : r.etat, libelle: D.libEtat(p.type, r.etat), hauteur_cm: r.hauteurCm ?? "", debit_L_min: r.debitLmin ?? "", commentaire: r.commentaire || "",
      photos: (r.photos || []).map((ph) => ph.url || "(en attente d'envoi)").join(" ") };
  }
  if (entity === "arrets") {
    const t = byId("tournees", r.tourneeId);
    return { tournee: t ? dh(t.debut) : "", date_heure: dh(r.t), altitude_m: r.alt ?? "", lng: r.lng, lat: r.lat, precision_m: r.precision ?? "placé sur la carte" };
  }
  if (entity === "pluies") return { date_heure: dh(r.t), lecture_mm: r.lecture, vide_apres: r.vide ? "oui" : "non" };
  if (entity === "forages") {
    const c = D.testsCalcules(live("forages").filter((x) => x.id !== r.id).concat([r])).find((x) => x.id === r.id) || {};
    return { date_heure: dh(r.t), index_debut_m3: r.indexDebut ?? "", index_fin_m3: r.indexFin ?? "", volume_m3: c.volume ?? "", repos_h: c.reposH ?? "", commentaire: r.commentaire || "" };
  }
  return {};
}
function journalLignes() {
  return [...D.pluieJournaliere(live("pluies"))].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([j, v]) => [j, v.mm, v.origine === "repartie" ? "répartie" : "mesurée"]);
}

export async function syncNow({ full = false } = {}) {
  if (!configured()) { await refreshCount(); return { ok: false, reason: "off" }; }
  if (!navigator.onLine) { SYNC.state = "offline"; emit(); return { ok: false, reason: "offline" }; }
  if (SYNC.busy) { again = true; return { ok: false, reason: "busy" }; }
  SYNC.busy = true; emit();
  try {
    /* 0. photos en attente → Google Drive ; l'observation reçoit le lien (et repart dans la boîte d'envoi) */
    await envoyerPhotos();
    /* 1. envoi, par paquets */
    let items = await outboxAll();
    while (items.length) {
      const batch = items.slice(0, 150);
      const res = await call({ action: "push", ops: batch.map((it) => ({ entity: it.entity, rec: it.rec, view: viewOf(it.entity, it.rec) })) });
      const acked = new Set(res.acked || []);
      await outboxAck(batch.filter((it) => acked.has(it.key)));
      if (acked.size < batch.length) throw new Error(batch.some((it) => it.entity === "forages") ? MAJ_SCRIPT : "Le script n'a pas confirmé tous les envois.");
      items = items.slice(150);
    }
    /* 2. réception */
    const since = full ? 0 : await getMeta("sync.cursor", 0);
    const res = await call({ action: "pull", since });
    const n = await applyRemote(res.records || []);
    await setMeta("sync.cursor", res.serverTs || 0);
    /* 3. pluie journalière : réécrite seulement si elle a changé */
    const lignes = journalLignes(), cle = JSON.stringify(lignes);
    if (cle !== (await getMeta("sync.journal", ""))) { await call({ action: "journal", rows: lignes }); await setMeta("sync.journal", cle); }
    SYNC.lastOk = Date.now(); await setMeta("sync.lastOk", SYNC.lastOk);
    SYNC.lastErr = ""; SYNC.state = "ok";
    return { ok: true, received: n };
  } catch (e) {
    SYNC.lastErr = e.name === "AbortError" ? "Délai dépassé (réseau trop faible ?)" : (e.message || String(e));
    const reseau = e.name === "AbortError" || e instanceof TypeError;
    SYNC.state = !navigator.onLine || reseau ? "offline" : "error";
    if (reseau && navigator.onLine) SYNC.lastErr = "Réseau indisponible : les saisies partiront à la prochaine connexion.";
    return { ok: false, reason: SYNC.lastErr };
  } finally {
    SYNC.busy = false;
    await refreshCount();
    if (again) { again = false; if (SYNC.pending && SYNC.state === "pending") { clearTimeout(timer); timer = setTimeout(() => syncNow(), 300); } }
  }
}
export async function testSync(url, secret) {
  try { const r = await call({ action: "ping" }, url, secret); return { ok: true, msg: "Connexion OK — script " + (r.version || "?") + (r.tableur ? " · tableur « " + r.tableur + " »" : "") }; }
  catch (e) { return { ok: false, msg: "Échec : " + (e.name === "AbortError" ? "délai dépassé" : e instanceof TypeError ? "adresse injoignable" : e.message || e) }; }
}
/* Tout renvoyer (nouveau tableur, ou onglets effacés par erreur). */
export async function toutRenvoyer() { await queueEverything(); await setMeta("sync.journal", ""); await refreshCount(); return syncNow({ full: true }); }

/* ---------- photos ---------- */
function enBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function envoyerPhotos() {
  for (const ph of await photosAEnvoyer()) {
    const o = DATA.obs.find((x) => x.id === ph.obsId && !x.deleted);
    const lien = o && (o.photos || []).find((x) => x.id === ph.id);
    if (!lien) { if (!ph.brouillon) await delPhoto(ph.id); continue; }   // photo retirée de son observation
    const p = DATA.points.find((x) => x.id === o.pointId) || {};
    const res = await call({ action: "photo", id: ph.id, nom: ph.nom, mime: ph.blob.type || "image/jpeg", data: await enBase64(ph.blob),
      description: (p.nom || "") + " · " + dh(o.t) + " · " + D.libEtat(p.type, o.etat) }, SYNC.url, SYNC.secret, 90000);
    await putPhoto({ ...ph, envoye: true, driveId: res.fileId, url: res.url });
    const cur = DATA.obs.find((x) => x.id === o.id);
    await save("obs", { ...cur, photos: (cur.photos || []).map((x) => x.id === ph.id ? { ...x, driveId: res.fileId, url: res.url } : x) }, { silent: true });
  }
}
export async function nbPhotosEnAttente() { return (await photosAEnvoyer()).filter((p) => !p.brouillon).length; }
