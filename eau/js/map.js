/* Carte MapLibre unique, déplacée d'un écran à l'autre (carte d'accueil, tournée, placement d'un point).
   Fonds : photo aérienne IGN, ou relief (ombrage calculé depuis le modèle de terrain local).
   Couches : courbes de niveau (maîtresses tous les 5 m, étiquetées), mares et ruisseaux du SIG,
   ruisseaux colorés selon l'état, points d'eau, arrêts d'écoulement, position GPS. */
import { mntCorners } from "./domain.js";
import { ETATS } from "./domain.js";
import { esc } from "./util.js";
import { pictoSVG } from "./icons.js";

export const EMPRISE = [[-3.05592, 47.72278], [-3.03819, 47.73438]];
const IGN_ORTHO = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg";
const VIDE = { type: "FeatureCollection", features: [] };

let map = null, box = null, ready = false, fond = "photo";
let markers = [], arretMarkers = [], gpsMarker = null, tempMarker = null;
let onClickMap = null;
const pending = [];
function whenReady(fn) { if (ready) fn(); else pending.push(fn); }

export function mapAvailable() { return typeof window !== "undefined" && !!window.maplibregl; }

/* Ombrage du relief (azimut 315°, hauteur 45°, relief exagéré ×4 : la ferme n'a que 30 m de dénivelé). */
function ombrage(mnt) {
  const { nx, ny, dx, dy, z } = mnt, c = document.createElement("canvas");
  c.width = nx; c.height = ny;
  const ctx = c.getContext("2d"), img = ctx.createImageData(nx, ny);
  const azM = 135 * Math.PI / 180, zen = 45 * Math.PI / 180, ex = 4; // azimut 315° (nord-ouest) en convention mathématique
  const Z = (i, j) => z[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))] / 10;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const gx = (Z(i + 1, j) - Z(i - 1, j)) / (2 * dx) * ex, gy = (Z(i, j + 1) - Z(i, j - 1)) / (2 * dy) * ex;
    const slope = Math.atan(Math.hypot(gx, gy)), aspect = Math.atan2(-gy, -gx);
    let v = Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(azM - aspect);
    v = Math.max(0, Math.min(1, v));
    const row = ny - 1 - j, k = (row * nx + i) * 4, h = (Z(i, j) - 22) / 40; // teinte légère selon l'altitude
    img.data[k] = 120 + 120 * v + 10 * h; img.data[k + 1] = 110 + 115 * v + 6 * h; img.data[k + 2] = 90 + 100 * v;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function ensureMap(mnt, cadre) {
  if (map || !mapAvailable()) return map;
  box = document.createElement("div");
  box.className = "mapbox";
  const ml = window.maplibregl;
  map = new ml.Map({
    container: box,
    bounds: cadre || EMPRISE, fitBoundsOptions: { padding: 30 },
    maxBounds: [[EMPRISE[0][0] - 0.02, EMPRISE[0][1] - 0.012], [EMPRISE[1][0] + 0.02, EMPRISE[1][1] + 0.012]],
    maxZoom: 20, minZoom: 13, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        ortho: { type: "raster", tiles: [IGN_ORTHO], tileSize: 256, maxzoom: 19, attribution: "© IGN — BD ORTHO®" },
        relief: { type: "image", url: ombrage(mnt), coordinates: mntCorners(mnt) },
        courbes: { type: "geojson", data: "data/courbes.json" },
        mares: { type: "geojson", data: "data/mares.json" },
        ruisseaux: { type: "geojson", data: "data/ruisseaux.json" },
        couleurs: { type: "geojson", data: VIDE },
      },
      layers: [
        { id: "fond", type: "background", paint: { "background-color": "#e9e0cf" } },
        { id: "relief", type: "raster", source: "relief", layout: { visibility: "none" }, paint: { "raster-opacity": 1, "raster-fade-duration": 0 } },
        { id: "ortho", type: "raster", source: "ortho", paint: { "raster-fade-duration": 0 } },
        { id: "mares-fond", type: "fill", source: "mares", paint: { "fill-color": "#2f7fa8", "fill-opacity": 0.35 } },
        { id: "mares-bord", type: "line", source: "mares", paint: { "line-color": "#9ec9de", "line-width": 1.5 } },
        { id: "courbes", type: "line", source: "courbes", filter: ["==", ["get", "m"], 0],
          paint: { "line-color": "#ffd9a8", "line-opacity": 0.45, "line-width": 0.7 }, minzoom: 15 },
        { id: "courbes-m", type: "line", source: "courbes", filter: ["==", ["get", "m"], 1],
          paint: { "line-color": "#ffd9a8", "line-opacity": 0.9, "line-width": 1.6 } },
        { id: "ruisseaux", type: "line", source: "ruisseaux", filter: ["==", ["get", "type"], "Cours d'eau"], paint: { "line-color": "#4aa3d4", "line-width": 2.5 } },
        { id: "fosses", type: "line", source: "ruisseaux", filter: ["==", ["get", "type"], "Fossé"], paint: { "line-color": "#9ec9de", "line-width": 1.8, "line-dasharray": [3, 2] } },
        { id: "ruissellement", type: "line", source: "ruisseaux", filter: ["==", ["get", "type"], "Ruissellement"], paint: { "line-color": "#c9d6a8", "line-width": 1.8, "line-dasharray": [1, 2] } },
        { id: "couleurs-bord", type: "line", source: "couleurs", layout: { "line-cap": "round" }, paint: { "line-color": "#f9f4ed", "line-width": 8 } },
        { id: "couleurs", type: "line", source: "couleurs", layout: { "line-cap": "round" },
          paint: { "line-color": ["match", ["get", "etat"], ...ETATS.flatMap((e) => [e.v, e.couleur]), "#888"], "line-width": 5 } },
        { id: "courbes-lab", type: "symbol", source: "courbes", filter: ["==", ["get", "m"], 1], minzoom: 15.5,
          layout: { "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "lev"]], " m"], "text-font": ["Open Sans Semibold"], "text-size": 12, "symbol-spacing": 280 },
          paint: { "text-color": "#402310", "text-halo-color": "#ffd9a8", "text-halo-width": 2.5 } },
      ],
    },
  });
  map.on("load", () => { ready = true; setFond(fond); pending.splice(0).forEach((fn) => fn()); });
  map.on("click", (e) => { if (onClickMap) onClickMap([e.lngLat.lng, e.lngLat.lat]); });
  return map;
}

/* Place la carte dans l'emplacement prévu de l'écran affiché (déplacement du même élément). */
export function attach(slot) {
  if (!map || !slot) return false;
  if (box.parentNode !== slot) slot.appendChild(box);
  requestAnimationFrame(() => map.resize());
  return true;
}

export function getFond() { return fond; }
export function setFond(f) {
  fond = f;
  whenReady(() => {
    const photo = f === "photo";
    map.setLayoutProperty("ortho", "visibility", photo ? "visible" : "none");
    map.setLayoutProperty("relief", "visibility", photo ? "none" : "visible");
    map.setPaintProperty("courbes", "line-color", photo ? "#ffd9a8" : "#8c491a");
    map.setPaintProperty("courbes", "line-opacity", photo ? 0.45 : 0.35);
    map.setPaintProperty("courbes-m", "line-color", photo ? "#ffd9a8" : "#8c491a");
    map.setPaintProperty("courbes-m", "line-opacity", photo ? 0.9 : 0.7);
  });
}

export function setCouleurs(fc) { whenReady(() => map.getSource("couleurs").setData(fc || VIDE)); }

/* Marqueur d'un point d'eau : rond couleur d'état + motif + chiffre ; « à faire » = blanc avec numéro d'ordre. */
export function markerHTML(p) {
  const e = typeof p.etat === "number" ? ETATS[p.etat] : null;
  const cls = ["mk"];
  if (e) cls.push("e" + e.v); else if (p.etat === "imp") cls.push("eimp"); else cls.push("enone");
  if (p.perime) cls.push("perime");
  if (p.courant) cls.push("courant");
  if (p.afaire) cls.push("afaire");
  const centre = p.afaire ? `<b class="mk-num">${p.num}</b>` : pictoSVG(p.type, 16);
  const badge = e ? `<i class="mk-badge">${e.v}</i>` : p.etat === "imp" ? `<i class="mk-badge">?</i>` : "";
  return `<div class="${cls.join(" ")}" title="${esc(p.nom)}">${centre}${badge}</div>`;
}
export function setPoints(list, onTap) {
  whenReady(() => {
    markers.forEach((m) => m.remove()); markers = [];
    for (const p of list) {
      const el = document.createElement("button");
      el.className = "mk-wrap"; el.type = "button";
      el.setAttribute("aria-label", p.nom);
      el.innerHTML = markerHTML(p) + (p.label ? `<span class="mk-lab">${esc(p.label)}</span>` : "");
      el.addEventListener("click", (ev) => { ev.stopPropagation(); onTap && onTap(p.id); });
      markers.push(new window.maplibregl.Marker({ element: el, anchor: "top" , offset: [0, -17] }).setLngLat([p.lng, p.lat]).addTo(map));
    }
  });
}
export function setArrets(list, onTap) {
  whenReady(() => {
    arretMarkers.forEach((m) => m.remove()); arretMarkers = [];
    for (const a of list) {
      const el = document.createElement("button");
      el.className = "arret-mk"; el.type = "button";
      el.setAttribute("aria-label", "Arrêt de l'écoulement " + (a.label || ""));
      el.innerHTML = `<span class="arret-x"></span>` + (a.label ? `<span class="mk-lab">${esc(a.label)}</span>` : "");
      el.addEventListener("click", (ev) => { ev.stopPropagation(); onTap && onTap(a.id); });
      arretMarkers.push(new window.maplibregl.Marker({ element: el, anchor: "top", offset: [0, -9] }).setLngLat([a.lng, a.lat]).addTo(map));
    }
  });
}
export function setGPS(pos) {
  whenReady(() => {
    if (!pos) { if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; } return; }
    if (!gpsMarker) {
      const el = document.createElement("div"); el.className = "gps-dot";
      gpsMarker = new window.maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map);
    } else gpsMarker.setLngLat(pos);
  });
}
export function setTemp(pos) {
  whenReady(() => {
    if (!pos) { if (tempMarker) { tempMarker.remove(); tempMarker = null; } return; }
    if (!tempMarker) {
      const el = document.createElement("div"); el.className = "temp-mk";
      tempMarker = new window.maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(pos).addTo(map);
    } else tempMarker.setLngLat(pos);
  });
}
export function onMapClick(fn) { onClickMap = fn; }
export function centrer(pos, zoom = 17.5) { whenReady(() => map.easeTo({ center: pos, zoom: Math.max(map.getZoom(), zoom), duration: 600 })); }
export function toutVoir(cadre) { whenReady(() => map.fitBounds(cadre || EMPRISE, { padding: 30, duration: 600 })); }
