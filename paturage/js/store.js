/* Stockage local (IndexedDB) + boîte d'envoi pour la synchronisation.
   Chaque enregistrement porte updatedAt (ms) ; en cas de conflit, le plus récent gagne.
   Les suppressions sont « douces » (deleted:true) pour pouvoir être synchronisées. */

export const ENTITIES = ["lots", "cats", "comps", "moves", "foins"];
const DB_NAME = "paturage_v9";
let db = null;

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function tx(store, mode = "readonly") { return db.transaction(store, mode).objectStore(store); }
function done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }

export async function openDB() {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    d.createObjectStore("rec", { keyPath: "key" });
    d.createObjectStore("outbox", { keyPath: "key" });
    d.createObjectStore("meta", { keyPath: "k" });
  };
  db = await req(r);
}

/* ---------- données en mémoire ---------- */
export const DATA = { lots: [], cats: [], comps: [], moves: [], foins: [] };
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit(info) { listeners.forEach((fn) => { try { fn(info); } catch (e) { console.error(e); } }); }

export function live(entity) { return DATA[entity].filter((r) => !r.deleted); }
export function get(entity, id) { return DATA[entity].find((r) => r.id === id) || null; }
export function liveData() { const o = {}; for (const e of ENTITIES) o[e] = live(e); o.catsAll = DATA.cats.slice(); return o; }

export async function loadAll() {
  for (const e of ENTITIES) DATA[e] = [];
  const all = await req(tx("rec").getAll());
  for (const x of all) if (DATA[x.entity]) DATA[x.entity].push(x.rec);
}

/* ---------- méta (réglages de l'appareil, curseur de synchro, fichiers carte) ---------- */
export async function getMeta(k, dflt = null) { const r = await req(tx("meta").get(k)); return r ? r.v : dflt; }
export async function setMeta(k, v) { await req(tx("meta", "readwrite").put({ k, v })); }
export async function delMeta(k) { await req(tx("meta", "readwrite").delete(k)); }

let DEVICE = "dev";
export function setDevice(id) { DEVICE = id; }

/* Écriture locale : horodatée, mise en boîte d'envoi. */
export async function save(entity, rec, opts = {}) {
  rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1);
  rec.dev = DEVICE;
  if (rec.deleted === undefined) rec.deleted = false;
  upsertMem(entity, rec);
  const t = db.transaction(["rec", "outbox"], "readwrite");
  const key = entity + ":" + rec.id;
  t.objectStore("rec").put({ key, entity, rec });
  t.objectStore("outbox").put({ key, entity, rec });
  await done(t);
  emit({ local: true, entity, silent: !!opts.silent });
}
export async function saveMany(list) {
  const t = db.transaction(["rec", "outbox"], "readwrite");
  for (const { entity, rec } of list) {
    rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1);
    rec.dev = DEVICE;
    if (rec.deleted === undefined) rec.deleted = false;
    upsertMem(entity, rec);
    const key = entity + ":" + rec.id;
    t.objectStore("rec").put({ key, entity, rec });
    t.objectStore("outbox").put({ key, entity, rec });
  }
  await done(t);
  emit({ local: true });
}
export async function remove(entity, id) {
  const r = get(entity, id); if (!r) return;
  r.deleted = true; await save(entity, r);
}
function upsertMem(entity, rec) {
  const arr = DATA[entity], i = arr.findIndex((r) => r.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}

/* Enregistrements reçus du serveur : appliqués seulement s'ils sont plus récents. */
export async function applyRemote(list) {
  const t = db.transaction(["rec"], "readwrite");
  let n = 0;
  for (const { entity, rec } of list) {
    if (!DATA[entity] || !rec || !rec.id) continue;
    const cur = get(entity, rec.id);
    if (cur && (cur.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
    upsertMem(entity, rec);
    t.objectStore("rec").put({ key: entity + ":" + rec.id, entity, rec });
    n++;
  }
  await done(t);
  if (n) emit({ remote: true });
  return n;
}

export async function outboxAll() { return req(tx("outbox").getAll()); }
export async function outboxCount() { return req(tx("outbox").count()); }
export async function outboxAck(items) {
  const t = db.transaction(["outbox"], "readwrite"), s = t.objectStore("outbox");
  for (const it of items) {
    const cur = await req(s.get(it.key));
    if (cur && (cur.rec.updatedAt || 0) <= (it.rec.updatedAt || 0)) s.delete(it.key);
  }
  await done(t);
}
/* Remet toutes les données en boîte d'envoi (premier envoi vers un nouveau tableur). */
export async function queueEverything() {
  const t = db.transaction(["outbox"], "readwrite");
  for (const e of ENTITIES) for (const rec of DATA[e]) t.objectStore("outbox").put({ key: e + ":" + rec.id, entity: e, rec });
  await done(t);
}

/* Remplace toutes les données (restauration / import v8). */
export async function replaceAll(records, { queue = true } = {}) {
  const t = db.transaction(["rec", "outbox"], "readwrite");
  t.objectStore("rec").clear();
  t.objectStore("outbox").clear();
  for (const e of ENTITIES) {
    DATA[e] = [];
    for (const rec of records[e] || []) {
      DATA[e].push(rec);
      const key = e + ":" + rec.id;
      t.objectStore("rec").put({ key, entity: e, rec });
      if (queue) t.objectStore("outbox").put({ key, entity: e, rec });
    }
  }
  await done(t);
  emit({ local: true, all: true });
}
export async function wipeAll() {
  const t = db.transaction(["rec", "outbox"], "readwrite");
  t.objectStore("rec").clear(); t.objectStore("outbox").clear();
  await done(t);
  for (const e of ENTITIES) DATA[e] = [];
  emit({ local: true, all: true });
}
