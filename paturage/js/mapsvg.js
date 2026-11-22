/* Carte SVG : fond satellite + paddocks colorés (transparents) + troupeaux.
   Zoom à deux doigts / molette, déplacement au doigt (voir mapgesture.js).
   Toucher un paddock assez grand à l'écran le choisit ; trop petit : zoom sur sa parcelle. */
import { GEO } from "./geo.js";
import { esc } from "./util.js";

export const MIN_TAP_PX = 22; // taille minimale à l'écran pour viser un paddock au doigt

export function mapWidth() { return Math.max(280, Math.min(window.innerWidth, 760) - 32); }

export function fullView() {
  const e = GEO.extent, w = e[2] - e[0], h = e[3] - e[1];
  return [e[0] - w * 0.02, e[1] - h * 0.02, w * 1.04, h * 1.04];
}
export function parcelView(parcelId) {
  const p = GEO.parcelById[parcelId]; if (!p) return fullView();
  const b = p.bbox, w = b[2] - b[0], h = b[3] - b[1];
  return [b[0] - w * 0.1, b[1] - h * 0.1, w * 1.2, h * 1.2];
}
/* Adapte une vue au format du cadre (pour que zoom et déplacement suivent exactement le doigt). */
export function fitView(vb, W, H) {
  let [x, y, w, h] = vb;
  const want = W / H;
  if (w / h < want) { const nw = h * want; x -= (nw - w) / 2; w = nw; } else { const nh = w / want; y -= (nh - h) / 2; h = nh; }
  return [x, y, w, h];
}
export function isZoomed(vb) { return !!vb && vb[2] < fullView()[2] * 0.95; }

export function mapHTML(o) {
  const { ctx, vb: vbIn, selId, look, markers = [], height = 360, showNames = true } = o;
  const W = mapWidth(), H = height;
  const vb = fitView(vbIn || fullView(), W, H);
  const sc = W / vb[2]; // pixels par mètre
  const fs = (px) => (px / sc).toFixed(2);
  const R = GEO.raster;
  let s = `<div class="map" style="height:${H}px"><svg data-map="${ctx}" viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carte des paddocks : pincer pour zoomer, glisser pour déplacer">`;
  s += `<image href="${esc(R.img)}" x="0" y="0" width="${R.w}" height="${R.h}" preserveAspectRatio="none"></image>`;
  for (const p of GEO.parcels) s += `<path class="parcel-hit" d="${p.path}" data-a="${ctx}-parcel" data-id="${esc(p.id)}"></path>`;
  let selPath = "";
  for (const p of GEO.pads) {
    const lk = look(p.id);
    const el = `<path class="pad c-${lk.cls}${p.id === selId ? " sel" : ""}"${lk.fill ? ` style="fill:${lk.fill}"` : ""} d="${p.path}" data-a="${ctx}-pad" data-id="${esc(p.id)}"><title>${esc(lk.title || p.id)}</title></path>`;
    if (p.id === selId) selPath = el; else s += el;
  }
  s += selPath;
  const zoomed = isZoomed(vbIn);
  for (const p of GEO.parcels) s += `<path class="parcel-line${zoomed ? " on" : ""}" d="${p.path}"></path>`;
  /* numéros des paddocks assez grands à l'écran ; noms des parcelles en vue d'ensemble */
  let nums = 0;
  for (const p of GEO.pads) {
    const size = Math.min(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]) * sc;
    if (size < 18 && p.id !== selId) continue;
    if (p.c[0] < vb[0] || p.c[0] > vb[0] + vb[2] || p.c[1] < vb[1] || p.c[1] > vb[1] + vb[3]) continue;
    nums++;
    s += `<text x="${p.c[0].toFixed(1)}" y="${p.c[1].toFixed(1)}" font-size="${fs(14)}" stroke-width="${fs(3)}" text-anchor="middle" dominant-baseline="central">${esc(p.num)}</text>`;
  }
  if (nums < 12) {
    for (const p of GEO.parcels) {
      const cx = (p.bbox[0] + p.bbox[2]) / 2, cy = (p.bbox[1] + p.bbox[3]) / 2;
      s += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-size="${fs(12)}" stroke-width="${fs(3)}" text-anchor="middle" dominant-baseline="central" opacity=".9">${esc(p.label)}</text>`;
    }
  }
  /* troupeaux : un point coloré (+ nom) sur leur paddock */
  const byPad = {};
  for (const m of markers) (byPad[m.padId] = byPad[m.padId] || []).push(m);
  for (const pid in byPad) {
    const p = GEO.byId[pid]; if (!p) continue;
    const list = byPad[pid], gap = 16 / sc, y = p.c[1] - (nums >= 12 ? 14 / sc : 0);
    list.forEach((m, i) => {
      const x = p.c[0] + (i - (list.length - 1) / 2) * gap;
      s += `<circle class="mk" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${fs(7)}" fill="${esc(m.color)}"></circle>`;
    });
    if (showNames) s += `<text x="${p.c[0].toFixed(1)}" y="${(y + 16 / sc).toFixed(1)}" font-size="${fs(12)}" stroke-width="${fs(3)}" text-anchor="middle" dominant-baseline="central">${esc(list.map((m) => m.name).join(" · "))}</text>`;
  }
  s += `</svg>`;
  s += `<div class="mapbtns"><button type="button" class="mapbtn" data-a="map-zoom" data-ctx="${ctx}" data-f="0.6" aria-label="Zoomer">+</button><button type="button" class="mapbtn" data-a="map-zoom" data-ctx="${ctx}" data-f="1.6" aria-label="Dézoomer">−</button></div>`;
  if (zoomed) s += `<button type="button" class="zoomout" data-a="map-full" data-ctx="${ctx}">‹ Toute la ferme</button>`;
  s += `</div>`;
  return s;
}

/* Taille à l'écran (px) du plus petit côté d'un paddock pour une vue donnée */
export function padScreenSize(padId, vbIn, height) {
  const p = GEO.byId[padId]; if (!p) return 0;
  const vb = fitView(vbIn || fullView(), mapWidth(), height);
  return Math.min(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]) * (mapWidth() / vb[2]);
}
