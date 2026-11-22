/* Règles métier sans DOM (testées dans tests/domain.test.mjs).
   Points d'eau, échelles d'état, ordre de tournée, coloration des ruisseaux, pluie journalière. */

/* ---------- Échelles d'état ----------
   Ruisseaux et sources : les 5 modalités d'« En quête d'eau » (OFB), elles-mêmes issues du protocole ONDE.
   Mares et zones humides : pas de référentiel national de suivi du niveau ; échelle maison calquée sur la précédente. */
export const ETATS = [
  { v: 0, couleur: "#7a2e1c", texte: "#ffffff", motif: "uni" },
  { v: 1, couleur: "#d67f48", texte: "#2e1708", motif: "hachures" },
  { v: 2, couleur: "#6ba3c4", texte: "#10222e", motif: "rayures" },
  { v: 3, couleur: "#1d5b80", texte: "#ffffff", motif: "uni" },
  { v: 4, couleur: "#3b357e", texte: "#ffffff", motif: "points" },
];
export const IMPOSSIBLE = "imp"; // « Observation impossible » (modalité ONDE)

export const ECHELLES = {
  eau: {
    nom: "Écoulement",
    source: "Modalités d'« En quête d'eau » (OFB), issues du protocole ONDE",
    lib: ["Assec", "Écoulement non visible", "Écoulement visible faible", "Écoulement visible", "Débordement"],
    def: [
      "Plus d'eau : évaporée ou infiltrée sur plus de la moitié du tronçon observé",
      "De l'eau dans le lit, mais aucun courant",
      "Courant visible mais très faible, filet d'eau",
      "Courant continu, visible à l'œil nu",
      "L'eau sort du lit (crue)",
    ],
  },
  mare: {
    nom: "Niveau",
    source: "Échelle propre à la ferme, calquée sur En quête d'eau (pas de référentiel national pour les mares)",
    lib: ["À sec", "Flaques isolées", "Niveau bas", "Niveau normal", "Débordement"],
    def: [
      "Plus d'eau libre, fond sec ou craquelé",
      "L'eau ne subsiste qu'en flaques séparées",
      "Surface réduite, vase visible sur les bords",
      "Eau libre partout, berges en eau",
      "L'eau dépasse les berges",
    ],
  },
};

export const TYPES = {
  mare: { lib: "Mare", echelle: "mare" },
  zone_humide: { lib: "Zone humide", echelle: "mare" },
  source: { lib: "Source", echelle: "eau" },
  ruisseau: { lib: "Ruisseau", echelle: "eau" },
};
export function echelleOf(type) { return ECHELLES[(TYPES[type] || TYPES.mare).echelle]; }
export function libEtat(type, etat) {
  if (etat === IMPOSSIBLE) return "Observation impossible";
  if (etat === null || etat === undefined) return "Pas de relevé";
  return echelleOf(type).lib[etat];
}

/* ---------- Projection Lambert-93 (IGN, ellipsoïde GRS80) ---------- */
const A = 6378137, E = Math.sqrt(0.00669438002290), RD = Math.PI / 180;
const mF = (p) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const tF = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - E * Math.sin(p)) / (1 + E * Math.sin(p)), E / 2);
const P0 = 46.5 * RD, P1 = 44 * RD, P2 = 49 * RD, L0 = 3 * RD;
const N = Math.log(mF(P1) / mF(P2)) / Math.log(tF(P1) / tF(P2));
const F = mF(P1) / (N * Math.pow(tF(P1), N));
const R0 = A * F * Math.pow(tF(P0), N);
export function toL93(lng, lat) {
  const r = A * F * Math.pow(tF(lat * RD), N), th = N * (lng * RD - L0);
  return [700000 + r * Math.sin(th), 6600000 + R0 - r * Math.cos(th)];
}
export function fromL93(x, y) {
  const dx = x - 700000, dy = R0 - (y - 6600000);
  const r = Math.hypot(dx, dy), th = Math.atan2(dx, dy);
  const t = Math.pow(r / (A * F), 1 / N);
  let p = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 10; i++) {
    const es = E * Math.sin(p);
    p = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), E / 2));
  }
  return [(th / N + L0) / RD, p / RD];
}

/* ---------- Modèle de terrain (grille L93, altitudes en décimètres) ---------- */
export function altitude(mnt, lng, lat) {
  if (!mnt) return null;
  const [x, y] = toL93(lng, lat);
  const fx = (x - mnt.x0) / mnt.dx, fy = (y - mnt.y0) / mnt.dy;
  if (!(fx >= 0 && fy >= 0 && fx <= mnt.nx - 1 && fy <= mnt.ny - 1)) return null;
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const i1 = Math.min(mnt.nx - 1, i0 + 1), j1 = Math.min(mnt.ny - 1, j0 + 1);
  const u = fx - i0, v = fy - j0, Z = mnt.z, nx = mnt.nx;
  const z = Z[j0 * nx + i0] * (1 - u) * (1 - v) + Z[j0 * nx + i1] * u * (1 - v) + Z[j1 * nx + i0] * (1 - u) * v + Z[j1 * nx + i1] * u * v;
  return Math.round(z) / 10;
}
/* Coins de la grille en WGS 84 (pour poser l'ombrage du relief sur la carte) : HG, HD, BD, BG. */
export function mntCorners(mnt) {
  const x1 = mnt.x0 + (mnt.nx - 1) * mnt.dx, y1 = mnt.y0 + (mnt.ny - 1) * mnt.dy;
  return [fromL93(mnt.x0, y1), fromL93(x1, y1), fromL93(x1, mnt.y0), fromL93(mnt.x0, mnt.y0)];
}

/* ---------- Géométrie ---------- */
export function distanceM(a, b) {
  const R = 6371000, la1 = a[1] * RD, la2 = b[1] * RD, dla = la2 - la1, dlo = (b[0] - a[0]) * RD;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/* Centre d'un (Multi)Polygone : barycentre du plus grand anneau extérieur. */
export function centre(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const ring = p[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = a ? [cx / (3 * a), cy / (3 * a)] : ring[0]; }
  }
  return best;
}
export function fmtDistance(m) {
  if (m === null || m === undefined || !isFinite(m)) return "";
  return m < 1000 ? Math.round(m / 5) * 5 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km";
}

/* ---------- Points de départ : les mares du SIG ---------- */
const TYPE_SIG = { Ancien_meandre: "zone_humide", Etrepage: "zone_humide" };
export function pointsDepuisMares(mares, mnt) {
  return mares.features.map((f) => {
    const nomSig = f.properties.nom;
    const [lng, lat] = centre(f.geometry);
    return {
      id: "sig_" + nomSig.replace(/[^\w-]/g, "_"),
      nom: nomSig.replace(/_/g, " "),
      type: TYPE_SIG[nomSig] || "mare",
      lng: +lng.toFixed(6), lat: +lat.toFixed(6),
      alt: altitude(mnt, lng, lat), altAuto: true,
      mesures: [], seauL: 10, actif: true, sig: nomSig,
    };
  });
}

/* ---------- Tournée ---------- */
/* Ordre de passage par défaut : du haut vers le bas de la ferme. */
export function ordreTournee(points) {
  return points.filter((p) => p.actif !== false)
    .sort((a, b) => (b.alt ?? -1e9) - (a.alt ?? -1e9) || a.nom.localeCompare(b.nom, "fr"));
}
/* Dernière observation de la tournée pour chaque point (une correction remplace la précédente). */
export function obsDeTournee(obs, tourneeId) {
  const m = new Map();
  for (const o of obs) if (o.tourneeId === tourneeId) {
    const cur = m.get(o.pointId);
    if (!cur || o.t >= cur.t) m.set(o.pointId, o);
  }
  return m;
}
/* Point suivant : le premier non relevé après le point courant dans l'ordre, sinon le premier non relevé. */
export function pointSuivant(ordre, faits, courantId) {
  const i = ordre.findIndex((p) => p.id === courantId);
  const apres = ordre.slice(i + 1).concat(ordre.slice(0, Math.max(i, 0)));
  return apres.find((p) => !faits.has(p.id) && p.id !== courantId) || null;
}
/* Dernier état connu de chaque point, à la date limite (ms) ou à la fin d'une tournée donnée. */
export function derniersEtats(obs, limiteT = Infinity) {
  const m = new Map();
  for (const o of obs) {
    if (o.t > limiteT || o.etat === null || o.etat === undefined) continue;
    const cur = m.get(o.pointId);
    if (!cur || o.t > cur.t) m.set(o.pointId, o);
  }
  return m;
}
/* Observation précédente d'un point (avant l'instant t, hors tournée en cours). */
export function obsPrecedente(obs, pointId, tourneeId) {
  let best = null;
  for (const o of obs) if (o.pointId === pointId && o.tourneeId !== tourneeId && o.etat !== null && o.etat !== undefined) {
    if (!best || o.t > best.t) best = o;
  }
  return best;
}
export function comptesParEtat(obsMap) {
  const c = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, imp: 0 };
  for (const o of obsMap.values()) if (o.etat in c) c[o.etat]++;
  return c;
}

/* ---------- Mesures ---------- */
export function debitSeau(volumeL, secondes) {
  if (!(volumeL > 0) || !(secondes > 0)) return null;
  return Math.round((volumeL / secondes) * 60 * 10) / 10;
}

/* ---------- Ruisseaux colorés (option C) ----------
   Les tracés du SIG sont découpés en morceaux d'environ `pas` mètres ; chaque morceau prend
   l'état du point de ruisseau/source le plus proche (à moins de `portee` m, 50 m par défaut). Au-delà : pas coloré. */
function interp(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
export function decouperLignes(lignes, pas = 10) {
  const out = [];
  for (const f of lignes.features) {
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const c of lines) for (let i = 0; i < c.length - 1; i++) {
      const d = distanceM(c[i], c[i + 1]), n = Math.max(1, Math.ceil(d / pas));
      for (let k = 0; k < n; k++) {
        const a = interp(c[i], c[i + 1], k / n), b = interp(c[i], c[i + 1], (k + 1) / n);
        out.push({ a, b, m: interp(a, b, 0.5), type: f.properties.type });
      }
    }
  }
  return out;
}
export function colorerRuisseaux(morceaux, pointsEtat, portee = 50) {
  const feats = [];
  if (!pointsEtat.length) return { type: "FeatureCollection", features: feats };
  for (const s of morceaux) {
    let best = null, bd = portee;
    for (const p of pointsEtat) {
      const d = distanceM(s.m, [p.lng, p.lat]);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) feats.push({ type: "Feature", properties: { etat: best.etat }, geometry: { type: "LineString", coordinates: [s.a, s.b] } });
  }
  return { type: "FeatureCollection", features: feats };
}

/* ---------- Pluie ----------
   Un relevé couvre la période depuis le relevé précédent. La pluie lue un matin est comptée pour
   la veille ; un relevé couvrant plusieurs jours est réparti également sur ces jours (« répartie »).
   Si le pluviomètre n'a pas été vidé au relevé précédent, on retire l'ancienne lecture. */
const pad2 = (n) => String(n).padStart(2, "0");
export function jourISO(t) { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function jourPlus(iso, n) { const [y, m, d] = iso.split("-").map(Number); const x = new Date(y, m - 1, d + n); return jourISO(x.getTime()); }
function ecartJours(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
export function relevesCalcules(pluies) {
  const tri = pluies.filter((p) => !p.deleted).slice().sort((a, b) => a.t - b.t);
  let prec = null;
  return tri.map((r) => {
    const base = prec && !prec.vide ? prec.lecture : 0;
    const mm = Math.max(0, Math.round((r.lecture - base) * 10) / 10);
    const jour = jourISO(r.t);
    let jours;
    if (!prec) jours = [jourPlus(jour, -1)];
    else {
      const jp = jourISO(prec.t), n = ecartJours(jp, jour);
      if (n <= 0) jours = [jour];
      else jours = Array.from({ length: n }, (_, k) => jourPlus(jp, k));
    }
    const out = { ...r, mm, jours, premier: !prec, depuisPrec: prec ? r.t - prec.t : null };
    prec = r;
    return out;
  });
}
export function pluieJournaliere(pluies) {
  const m = new Map();
  for (const r of relevesCalcules(pluies)) {
    const part = r.mm / r.jours.length, origine = r.jours.length > 1 ? "repartie" : "mesuree";
    for (const j of r.jours) {
      const cur = m.get(j) || { mm: 0, origine };
      cur.mm = Math.round((cur.mm + part) * 10) / 10;
      if (origine === "repartie") cur.origine = "repartie";
      m.set(j, cur);
    }
  }
  return m;
}
export function cumul(journal, depuisISO, jusquISO) {
  let s = 0;
  for (const [j, v] of journal) if (j >= depuisISO && j <= jusquISO) s += v.mm;
  return Math.round(s * 10) / 10;
}
export { jourPlus, ecartJours };
