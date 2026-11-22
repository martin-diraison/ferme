/* Carte : parcelles, paddocks, fond raster. Coordonnées sources en Lambert-93 (EPSG:2154),
   converties en repère local (mètres, origine = coin haut-gauche du fond, y vers le bas). */

export const GEO = { raster: null, parcels: [], pads: [], byId: {}, parcelById: {}, aliases: {}, extent: null, custom: false, customRaster: false };

function mp(geom) { return typeof geom[0][0][0] === "number" ? [geom] : geom; }

export function buildGeo(carte, rasterOverride) {
  const R = Object.assign({}, carte.raster, rasterOverride || {});
  const loc = (pt) => [pt[0] - R.left, R.top - pt[1]];
  const toPath = (geom) => mp(geom).map((poly) => poly.map((ring) =>
    "M" + ring.map((pt) => { const p = loc(pt); return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("L") + "Z").join("")).join("");
  const bboxOf = (geom) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of mp(geom)) for (const ring of poly) for (const pt of ring) {
      const p = loc(pt); if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  };
  const centroid = (geom) => {
    let best = null, bestA = -1;
    for (const poly of mp(geom)) {
      const ring = poly[0].map(loc); let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) { const c = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; A += c; cx += (ring[i][0] + ring[i + 1][0]) * c; cy += (ring[i][1] + ring[i + 1][1]) * c; }
      if (Math.abs(A) > bestA) { bestA = Math.abs(A); best = A ? [cx / (3 * A), cy / (3 * A)] : ring[0]; }
    }
    return best || [0, 0];
  };
  GEO.raster = { img: R.img, w: R.right - R.left, h: R.top - R.bottom };
  GEO.aliases = carte.idAliases || {};
  GEO.parcels = carte.parcels.map((p) => ({ id: p.id, label: p.label || titleCase(p.id), path: toPath(p.geom), bbox: bboxOf(p.geom) }));
  GEO.parcelById = {}; GEO.parcels.forEach((p) => { GEO.parcelById[p.id] = p; });
  GEO.pads = carte.paddocks.map((p) => ({
    id: p.id, parcel: p.parcel, num: p.num || String(p.id).split("_").pop(), area: Number(p.area_ha) || 0,
    path: toPath(p.geom), bbox: bboxOf(p.geom), c: centroid(p.geom)
  }));
  GEO.byId = {}; GEO.pads.forEach((p) => { GEO.byId[p.id] = p; });
  let e = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of GEO.parcels.concat(GEO.pads)) { e = [Math.min(e[0], p.bbox[0]), Math.min(e[1], p.bbox[1]), Math.max(e[2], p.bbox[2]), Math.max(e[3], p.bbox[3])]; }
  GEO.extent = e;
  return GEO;
}

export function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}
export function parcelLabel(id) { const p = GEO.parcelById[id]; return p ? p.label : titleCase(id); }
export function padLabel(id) {
  if (id === "OUT") return "Hors-paddock";
  const p = GEO.byId[id];
  return p ? parcelLabel(p.parcel) + " · n°" + p.num : String(id || "?");
}
export function padArea(id) { const p = GEO.byId[id]; return p ? p.area : 0; }

/* ---------- Import d'un nouveau découpage (GeoJSON) ---------- */

function lonLatToLambert93(lonDeg, latDeg) {
  const a = 6378137.0, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f);
  const rad = Math.PI / 180, phi1 = 44 * rad, phi2 = 49 * rad, phi0 = 46.5 * rad, lam0 = 3 * rad;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p) => { const s = Math.sin(p); return Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * s) / (1 + e * s), e / 2); };
  const n = Math.log(m(phi1) / m(phi2)) / Math.log(t(phi1) / t(phi2));
  const F = m(phi1) / (n * Math.pow(t(phi1), n)), rho0 = a * F * Math.pow(t(phi0), n);
  const rho = a * F * Math.pow(t(latDeg * rad), n), th = n * (lonDeg * rad - lam0);
  return [700000 + rho * Math.sin(th), 6600000 + rho0 - rho * Math.cos(th)];
}
function getProp(props, keys) {
  for (const k of keys) {
    for (const kk in props || {}) if (kk.toLowerCase() === k.toLowerCase() && props[kk] !== null && props[kk] !== undefined && props[kk] !== "") return props[kk];
  }
  return "";
}
const normLabel = (s) => String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
function geomOf(f) {
  if (!f || !f.geometry || !/^(Multi)?Polygon$/.test(f.geometry.type)) return null;
  let g = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let first = g[0][0][0];
  if (Math.abs(first[0]) <= 180 && Math.abs(first[1]) <= 90) g = g.map((poly) => poly.map((ring) => ring.map((pt) => lonLatToLambert93(pt[0], pt[1]))));
  return g;
}
export function parcelsFromGeoJSON(gj) {
  return (gj.features || []).map((f, i) => {
    const g = geomOf(f); if (!g) return null;
    const name = normLabel(getProp(f.properties, ["Parcelle", "Parcelles", "NAME", "Nom"]) || "PARCELLE_" + (i + 1));
    return { id: name, label: titleCase(name), geom: g };
  }).filter(Boolean);
}
export function paddocksFromGeoJSON(gj) {
  return (gj.features || []).map((f, i) => {
    const g = geomOf(f); if (!g) return null;
    const id = String(getProp(f.properties, ["Paddock", "ID", "Identifiant"]) || "Paddock_" + (i + 1)).trim();
    let area = Number(String(getProp(f.properties, ["Surface", "area", "area_ha"]) || 0).replace(",", ".")) || 0;
    if (area > 50) area = area / 10000;
    return { id, parcel: normLabel(getProp(f.properties, ["Parcelle", "Groupe", "group"])), num: id.split("_").pop(), area_ha: area, geom: g };
  }).filter(Boolean);
}
export function parseWorldFile(text, imgW, imgH) {
  const v = String(text).trim().split(/\r?\n/).map((s) => Number(s.trim()));
  if (v.length < 6 || v.some((x) => !isFinite(x))) throw new Error("Fichier world invalide (6 nombres attendus).");
  const [A, , , E, C, F] = v;
  const left = C - A / 2, top = F - E / 2;
  return { left, top, right: left + A * imgW, bottom: top + E * imgH, width: imgW, height: imgH };
}
