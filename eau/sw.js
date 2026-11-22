/* Service worker : l'appli s'ouvre sans réseau.
   - Fichiers de l'appli (SHELL) et bibliothèque de carte : copie locale de CETTE version.
     Changer CACHE à chaque nouvelle version : tout est retéléchargé d'un coup, puis la page se recharge.
   - Tuiles de la photo aérienne IGN et polices de la carte : gardées au fil des consultations
     (cache séparé, conservé d'une version à l'autre), pour revoir la carte hors réseau. */
const CACHE = "eau-ferme-0.3.0";
const TUILES = "eau-ferme-tuiles";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css", "icon-192.png", "icon-512.png",
  "data/mnt.json", "data/mares.json", "data/ruisseaux.json", "data/courbes.json",
  "js/app.js", "js/domain.js", "js/store.js", "js/util.js", "js/map.js", "js/icons.js", "js/sync.js",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("eau-ferme-") && k !== CACHE && k !== TUILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
  const tuile = url.hostname === "data.geopf.fr" || url.hostname === "demotiles.maplibre.org";
  const police = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (tuile) {
    e.respondWith((async () => {
      const c = await caches.open(TUILES), hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch (_) { return Response.error(); }
    })());
    return;
  }
  if (url.origin !== location.origin && !police && !SHELL_URLS.has(url.href)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const same = url.origin === location.origin;
    const hit = await cache.match(req, { ignoreSearch: same });
    const shellFile = req.mode !== "navigate" && SHELL_URLS.has(url.origin + url.pathname);
    if (hit && (police || shellFile)) return hit;
    try {
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
