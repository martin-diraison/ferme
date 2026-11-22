/* Service worker : l'appli s'ouvre sans réseau.
   - Fichiers de l'appli (liste SHELL) : servis depuis la copie locale de CETTE version, tous ensemble.
     Une nouvelle version (sw.js modifié) les retélécharge tous d'un coup à l'installation, puis la page
     se recharge : jamais de mélange d'anciens et de nouveaux fichiers, même avec un réseau faible.
   - Page d'accueil : réseau d'abord (3 s), copie locale sinon.
   Les échanges avec le script Google ne passent jamais par ici. */
const CACHE = "paturage-v9.2.3";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css", "data/carte.json", "Fond.png", "icon-192.png", "icon-512.png",
  "js/app.js", "js/util.js", "js/geo.js", "js/domain.js", "js/migrate.js", "js/store.js", "js/sync.js", "js/exports.js",
  "js/mapsvg.js", "js/mapgesture.js", "js/icons.js", "js/views.js", "js/demo.js"
];

self.addEventListener("install", (e) => {
  /* cache:"reload" : ne pas reprendre d'anciens fichiers dans le cache HTTP du navigateur */
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("paturage-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function fromNetwork(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req, { cache: "no-cache" }).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

const SHELL_URLS = new Set(SHELL.filter((u) => u !== "./").map((u) => new URL(u, self.registration.scope).href));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("google.com") || url.hostname.endsWith("googleusercontent.com")) return;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const same = url.origin === location.origin;
    const hit = await cache.match(req, { ignoreSearch: same });
    const shellFile = same && req.mode !== "navigate" && SHELL_URLS.has(url.origin + url.pathname);
    if (hit && (isFont || shellFile)) return hit; // fichiers de cette version : copie locale
    try {
      /* une requête de navigation ne peut pas être refaite telle quelle avec des options : on repart de son adresse */
      const netReq = req.mode === "navigate" ? new Request(req.url, { credentials: "same-origin" }) : req;
      const res = await fromNetwork(netReq, hit ? 3000 : 15000);
      if (res && (res.ok || res.type === "opaque") && !(req.mode === "navigate" && url.search)) cache.put(req, res.clone());
      return res;
    } catch (_) {
      if (hit) return hit;
      if (req.mode === "navigate") { const idx = await cache.match("index.html"); if (idx) return idx; }
      return Response.error();
    }
  })());
});
