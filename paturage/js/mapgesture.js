/* Gestes sur la carte : glisser (1 doigt / souris), pincer (2 doigts), molette.
   Pendant le geste, seule la vue (viewBox) du SVG change, sans redessiner la page ;
   à la fin, la vue est enregistrée et l'écran redessiné (numéros et étiquettes à la bonne taille).
   Un appui sans déplacement reste un « toucher » (sélection). */
import { fullView } from "./mapsvg.js";

export function attachMapGestures(root, { getView, setView }) {
  const pts = new Map();
  let g = null;           // geste en cours
  let suppressClick = 0;  // horodatage : ignorer le clic qui suit un glisser

  const vbOf = (svg) => svg.getAttribute("viewBox").split(/\s+/).map(Number);
  const apply = (svg, vb) => svg.setAttribute("viewBox", vb.map((v) => v.toFixed(2)).join(" "));
  const clampW = (w) => { const full = fullView()[2]; return Math.max(full / 40, Math.min(full * 1.2, w)); };

  function begin(svg) {
    const r = svg.getBoundingClientRect();
    const list = [...pts.values()];
    const mid = list.length >= 2 ? [(list[0].x + list[1].x) / 2, (list[0].y + list[1].y) / 2] : [list[0].x, list[0].y];
    const dist = list.length >= 2 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
    g = { svg, ctx: svg.dataset.map, rect: r, vb0: vbOf(svg), mid0: mid, dist0: dist, n: list.length, moved: g ? g.moved : false, vb: g ? g.vb : null };
  }
  /* l'écran a pu être redessiné pendant le geste (fin d'un message, synchro) : on reprend la nouvelle carte */
  function relink() {
    if (g.svg.isConnected) return;
    const svg = root.querySelector(`svg[data-map="${g.ctx}"]`);
    if (svg) { g.svg = svg; g.rect = svg.getBoundingClientRect(); if (g.vb) apply(svg, g.vb); }
  }
  function update() {
    if (!g) return;
    relink();
    const list = [...pts.values()], r = g.rect, [x0, y0, w0, h0] = g.vb0;
    const mid = list.length >= 2 ? [(list[0].x + list[1].x) / 2, (list[0].y + list[1].y) / 2] : [list[0].x, list[0].y];
    let w = w0;
    if (list.length >= 2 && g.dist0 > 0) w = clampW(w0 * g.dist0 / Math.max(1, Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y)));
    const h = h0 * w / w0;
    /* le point du terrain sous le milieu des doigts au départ reste sous le milieu des doigts */
    const wx = x0 + (g.mid0[0] - r.left) / r.width * w0, wy = y0 + (g.mid0[1] - r.top) / r.height * h0;
    const vb = [wx - (mid[0] - r.left) / r.width * w, wy - (mid[1] - r.top) / r.height * h, w, h];
    if (Math.abs(mid[0] - g.mid0[0]) + Math.abs(mid[1] - g.mid0[1]) > 8 || w !== w0) g.moved = true;
    if (g.moved) { g.vb = vb; apply(g.svg, vb); }
  }
  function finish() {
    if (!g) return;
    relink();
    if (g.moved) { suppressClick = Date.now(); setView(g.ctx, g.vb || vbOf(g.svg)); }
    g = null;
  }

  root.addEventListener("pointerdown", (e) => {
    const svg = e.target.closest && e.target.closest("svg[data-map]");
    if (!svg || (e.pointerType === "mouse" && e.button !== 0)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    begin(svg);
  });
  window.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    update();
  }, { passive: true });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) finish();
    else if (g) { const moved = g.moved; begin(g.svg); g.moved = moved; } // passage de 2 à 1 doigt
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);

  /* clic après un glisser : ignoré (sinon un paddock serait choisi en relâchant) */
  root.addEventListener("click", (e) => {
    if (Date.now() - suppressClick < 350 && e.target.closest && e.target.closest("svg[data-map]")) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  /* molette (PC) : zoom autour du curseur */
  let wheelTimer = null;
  root.addEventListener("wheel", (e) => {
    const svg = e.target.closest && e.target.closest("svg[data-map]");
    if (!svg) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect(), [x, y, w, h] = vbOf(svg);
    const nw = clampW(w * Math.pow(1.0015, e.deltaY)), nh = h * nw / w;
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    apply(svg, [x + fx * w - fx * nw, y + fy * h - fy * nh, nw, nh]);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => setView(svg.dataset.map, vbOf(svg)), 250);
  }, { passive: false });

  /* boutons + / − : zoom au centre */
  return {
    zoomBy(ctx, f) {
      const svg = root.querySelector(`svg[data-map="${ctx}"]`); if (!svg) return;
      const [x, y, w, h] = vbOf(svg), nw = clampW(w * f), nh = h * nw / w;
      setView(ctx, [x + (w - nw) / 2, y + (h - nh) / 2, nw, nh]);
    }
  };
}
