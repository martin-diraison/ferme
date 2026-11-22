/* Eau de la ferme — écrans et actions.
   Onglets : Carte · Tournée · Pluie · Forage · Plus. Sous-écrans : saisie d'un point, fiche/édition d'un point,
   récapitulatif de tournée, placement sur la carte. Rendu par chaînes HTML + délégation d'événements. */
import * as S from "./store.js";
import * as D from "./domain.js";
import * as M from "./map.js";
import { esc, uid } from "./util.js";
import { picto } from "./icons.js";
import * as Y from "./sync.js";

export const VERSION = "0.3.1";
const app = document.getElementById("app");
let GEO = null, MORCEAUX = [];

/* ---------- état de l'interface ---------- */
const ui = {
  tab: "carte",
  vue: null,          // {k:"saisie", pointId, tourneeId} | {k:"point", id, draft} | {k:"recap", tourneeId} | {k:"placement", but, pos, retour}
  tvue: "liste",      // tournée : "liste" | "carte"
  fiche: null,        // id du point ouvert sur la carte d'accueil
  carteIdx: null,     // tournée affichée sur la carte d'accueil (index, null = état actuel)
  legende: false,
  draft: null,        // saisie d'un point en cours
  kp: null,           // pavé numérique actif : "pluie" | "hauteur"
  pluie: null,        // {lecture, quand, vide, editId}
  forage: null,       // {quand, debut, fin, commentaire, editId}
  gps: null, gpsAcc: null, gpsT: 0, gpsErr: null, gpsWatch: null,
  confirm: null,      // clé d'un bouton « Confirmer » en attente
  theme: "auto",
};

/* ---------- formats ---------- */
const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_L = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const pad2 = (n) => String(n).padStart(2, "0");
function fJour(t, an) { const d = new Date(t); return d.getDate() + " " + MOIS_C[d.getMonth()] + (an || d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""); }
function fJourLong(t) { const d = new Date(t); return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS_L[d.getMonth()]; }
function fHeure(t) { const d = new Date(t); return d.getHours() + " h " + pad2(d.getMinutes()); }
function fISO(iso) { const [y, m, d] = iso.split("-").map(Number); return d + " " + MOIS_C[m - 1]; }
function ilYa(t) {
  const n = D.ecartJours(D.jourISO(t), D.jourISO(Date.now()));
  return n <= 0 ? "aujourd'hui" : n === 1 ? "hier" : "il y a " + n + " j";
}
function fNum(x, dec = 1) { return x === null || x === undefined || !isFinite(x) ? "—" : (Math.round(x * 10 ** dec) / 10 ** dec).toString().replace(".", ","); }
function toLocalInput(t) { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function numDe(s) { const n = Number(String(s ?? "").replace(",", ".")); return s === "" || s === null || s === undefined || !isFinite(n) ? null : n; }

/* ---------- accès aux données ---------- */
const points = () => S.live("points");
const pointsActifs = () => points().filter((p) => p.actif !== false);
const point = (id) => S.get("points", id);
const tournees = () => S.live("tournees").sort((a, b) => a.debut - b.debut);
const tourneeOuverte = () => tournees().find((t) => !t.terminee) || null;
const obs = () => S.live("obs");
const arrets = () => S.live("arrets");
function finTournee(t) {
  let m = t.fin || t.debut;
  for (const o of obs()) if (o.tourneeId === t.id && o.t > m) m = o.t;
  return m;
}
function typeLib(p) { return (D.TYPES[p.type] || D.TYPES.mare).lib; }
function altLib(p) { return p.alt === null || p.alt === undefined ? "altitude ?" : fNum(p.alt) + " m"; }
function distanceA(p) { return ui.gps ? D.distanceM(ui.gps, [p.lng, p.lat]) : null; }

/* ---------- voyant d'enregistrement (3 états : téléphone / en attente / synchronisé) ---------- */
function voyantInfo() {
  const s = Y.SYNC;
  if (s.state === "off") return ["v-local", "Sur le téléphone"];
  if (s.busy) return ["v-attente", "Envoi en cours…"];
  if (s.state === "ok") return ["v-ok", "Synchronisé"];
  if (s.state === "error") return ["v-err", "Synchro en erreur"];
  if (s.state === "offline") return ["v-attente", "Hors réseau" + (s.pending ? " · " + s.pending + " en attente" : "")];
  return ["v-attente", "Envoi en attente" + (s.pending ? " · " + s.pending : "")];
}
function voyant() { const [c, l] = voyantInfo(); return `<span class="voyant ${c}" data-voyant><i></i>${l}</span>`; }
function majVoyants() {
  const [c, l] = voyantInfo();
  for (const el of app.querySelectorAll("[data-voyant]")) { el.className = "voyant " + c; el.innerHTML = "<i></i>" + l; }
  const info = app.querySelector("[data-sync-info]"); if (info) info.innerHTML = syncInfo();
}
function syncInfo() {
  const s = Y.SYNC;
  if (!Y.configured()) return "Pas encore réglée : les données restent sur ce téléphone.";
  return (s.lastOk ? "Dernière synchro réussie : " + fJour(s.lastOk) + " à " + fHeure(s.lastOk) + "." : "Jamais synchronisé.")
    + (s.pending ? ` ${s.pending} enregistrement${s.pending > 1 ? "s" : ""} en attente d'envoi.` : "")
    + (s.lastErr ? `<br><b>${esc(s.lastErr)}</b>` : "");
}

/* ---------- petits composants ---------- */
function pastille(etat, size = 26) {
  if (etat === D.IMPOSSIBLE) return `<span class="pas eimp" style="--s:${size}px">?</span>`;
  if (typeof etat !== "number") return `<span class="pas enone" style="--s:${size}px"></span>`;
  return `<span class="pas e${etat}" style="--s:${size}px">${etat}</span>`;
}
function btn(a, label, cls = "", extra = "") { return `<button type="button" class="btn ${cls}" data-a="${a}" ${extra}>${label}</button>`; }
function confirmBtn(key, a, label, labelConfirm, extra = "") {
  return ui.confirm === key ? btn(a, labelConfirm, "danger-plein", extra) : btn("ask-confirm", label, "danger", `data-k="${key}"`);
}
function clavier(cible) {
  const k = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];
  return `<div class="kp" data-kp="${cible}">${k.map((c) => `<button type="button" class="kp-b" data-a="kp" data-k="${c}" aria-label="${c === "⌫" ? "Effacer" : c}">${c}</button>`).join("")}</div>`;
}
function onglets() {
  const t = tourneeOuverte();
  const it = [["carte", "Carte", "carte"], ["tournee", "Tournée", "tournee"], ["pluie", "Pluie", "pluie"], ["forage", "Forage", "forage"], ["plus", "Plus", "plus_menu"]];
  return `<nav class="tabs">${it.map(([k, l, ic]) => `<button type="button" class="tab ${ui.tab === k && !ui.vue ? "on" : ""}" data-a="tab" data-k="${k}">${picto(ic, 24)}<span>${l}</span>${k === "tournee" && t ? `<i class="tab-dot" aria-label="tournée en cours"></i>` : ""}</button>`).join("")}</nav>`;
}

/* ---------- rendu ---------- */
function render() {
  let html;
  if (ui.vue?.k === "saisie") html = vueSaisie();
  else if (ui.vue?.k === "point") html = vuePoint();
  else if (ui.vue?.k === "recap") html = vueRecap() + onglets();
  else if (ui.vue?.k === "placement") html = vuePlacement();
  else if (ui.tab === "carte") html = vueCarte() + onglets();
  else if (ui.tab === "tournee") html = vueTournee() + onglets();
  else if (ui.tab === "pluie") html = vuePluie() + onglets();
  else if (ui.tab === "forage") html = vueForage() + onglets();
  else html = vuePlus() + onglets();
  const scroll = window.scrollY;
  app.innerHTML = html;
  if (ui.keepScroll) window.scrollTo(0, scroll);
  ui.keepScroll = false;
  chargerVignettes();
  const slot = app.querySelector("[data-map-slot]");
  if (slot) {
    if (M.mapAvailable()) { M.ensureMap(GEO.mnt, cadrage()); M.attach(slot); majCarte(); }
    else slot.innerHTML = `<div class="map-off">La carte a besoin d'une connexion au premier lancement.</div>`;
  }
}
function rerender() { ui.keepScroll = true; render(); }

/* ---------- carte : contenu selon l'écran ---------- */
function majCarte() {
  const ctx = ui.vue?.k === "placement" ? "placement" : ui.tab === "tournee" ? "tournee" : "carte";
  M.onMapClick(null);
  M.setTemp(null);
  M.setGPS(ui.gps);
  if (ctx === "tournee") {
    const t = tourneeOuverte(); if (!t) return;
    const faits = D.obsDeTournee(obs(), t.id), ordre = D.ordreTournee(points());
    const prochain = prochainPoint(t);
    M.setPoints(ordre.map((p, i) => {
      const o = faits.get(p.id);
      return { id: p.id, nom: p.nom, type: p.type, lng: p.lng, lat: p.lat, num: i + 1,
        etat: o ? o.etat : null, afaire: !o, courant: prochain && prochain.id === p.id, label: prochain && prochain.id === p.id ? p.nom : "" };
    }), (id) => ouvrirSaisie(id, t.id));
    M.setCouleurs(couleursPour(faits));
    M.setArrets(arrets().filter((a) => a.tourneeId === t.id).map((a) => ({ ...a, label: fHeure(a.t) })), (id) => toast("Arrêt de l'écoulement relevé à " + fHeure(S.get("arrets", id).t)));
    return;
  }
  const { etats, tournee } = etatsAffiches();
  M.setPoints(pointsActifs().map((p) => ({ id: p.id, nom: p.nom, type: p.type, lng: p.lng, lat: p.lat,
    etat: etats.get(p.id)?.etat ?? null, courant: ui.fiche === p.id, label: ctx === "carte" && ui.fiche === p.id ? p.nom : "" })),
  ctx === "carte" ? (id) => { ui.fiche = id; rerender(); } : null);
  M.setCouleurs(couleursPour(etats));
  const tA = tournee || tournees().slice(-1)[0];
  M.setArrets(tA ? arrets().filter((a) => a.tourneeId === tA.id).map((a) => ({ ...a, label: "" })) : [], null);
  if (ctx === "placement") {
    M.setTemp(ui.vue.pos);
    M.onMapClick((pos) => { ui.vue.pos = pos; rerender(); });
  } else if (ctx === "carte") {
    M.onMapClick(() => { if (ui.fiche) { ui.fiche = null; rerender(); } });
  }
}
/* Emprise des points suivis (avec une marge), pour cadrer la carte. */
function cadrage() {
  const pts = pointsActifs(); if (!pts.length) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of pts) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  const mx = Math.max(0.0015, (e - w) * 0.15), my = Math.max(0.001, (n - s) * 0.15);
  return [[w - mx, s - my], [e + mx, n + my]];
}
function couleursPour(etatsMap) {
  const pe = [];
  for (const p of pointsActifs()) {
    if (D.TYPES[p.type]?.echelle !== "eau") continue;
    const o = etatsMap.get(p.id);
    if (o && typeof o.etat === "number") pe.push({ lng: p.lng, lat: p.lat, etat: o.etat });
  }
  return D.colorerRuisseaux(MORCEAUX, pe);
}
function etatsAffiches() {
  const ts = tournees();
  if (ui.carteIdx === null || !ts[ui.carteIdx]) return { etats: D.derniersEtats(obs()), tournee: null };
  const t = ts[ui.carteIdx];
  return { etats: D.derniersEtats(obs(), finTournee(t)), tournee: t };
}

/* ---------- écran Carte ---------- */
function vueCarte() {
  const ts = tournees(), derniere = ts.slice(-1)[0];
  const journal = D.pluieJournaliere(S.live("pluies"));
  const hier = D.jourPlus(D.jourISO(Date.now()), -1);
  const p30 = D.cumul(journal, D.jourPlus(hier, -29), hier);
  const { tournee } = etatsAffiches();
  const titreT = tournee ? "Tournée du " + fJour(tournee.debut) : "Dernier état connu";
  let fiche = "";
  if (ui.fiche && point(ui.fiche)) fiche = ficheSheet(point(ui.fiche));
  return `<main class="carte-ecran">
    <div class="map-slot full" data-map-slot></div>
    <div class="map-top">
      <div class="synth">
        <div><span class="synth-l">Dernière tournée</span><b>${derniere ? fJour(derniere.debut) : "—"}</b>${derniere ? `<span class="synth-s">${ilYa(derniere.debut)}</span>` : ""}</div>
        <div><span class="synth-l">Pluie 30 j</span><b>${S.live("pluies").length ? fNum(p30) + " mm" : "—"}</b></div>
      </div>
    </div>
    <div class="map-fabs">
      <button type="button" class="fab" data-a="fond" aria-label="Changer de fond">${picto("calques")}<span>${M.getFond() === "photo" ? "Relief" : "Photo"}</span></button>
      <button type="button" class="fab" data-a="gps-centrer" aria-label="Ma position">${picto("gps")}</button>
      <button type="button" class="fab" data-a="tout-voir" aria-label="Toute la ferme">${picto("tout")}</button>
      <button type="button" class="fab acc" data-a="nouveau-point" aria-label="Ajouter un point d'eau">${picto("ajout")}</button>
    </div>
    ${fiche || `<div class="map-bottom">
      ${ts.length ? `<div class="frise-t">
        <button type="button" class="ronde" data-a="carte-prec" aria-label="Tournée précédente" ${ui.carteIdx === 0 ? "disabled" : ""}>‹</button>
        <div class="frise-c"><b>${titreT}</b><span>${ui.carteIdx === null ? "tous relevés confondus" : (ui.carteIdx + 1) + " / " + ts.length}</span></div>
        <button type="button" class="ronde" data-a="carte-suiv" aria-label="Tournée suivante" ${ui.carteIdx === null ? "disabled" : ""}>›</button>
      </div>` : ""}
      <button type="button" class="leg-btn" data-a="legende" aria-expanded="${ui.legende}">Légende ${ui.legende ? "▾" : "▸"}</button>
      ${ui.legende ? legende() : ""}
    </div>`}
  </main>`;
}
function legende() {
  return `<div class="leg">
    <table><tr><th></th><th>Ruisseau, source</th><th>Mare, zone humide</th></tr>
    ${[4, 3, 2, 1, 0].map((v) => `<tr><td>${pastille(v, 24)}</td><td>${D.ECHELLES.eau.lib[v]}</td><td>${D.ECHELLES.mare.lib[v]}</td></tr>`).join("")}
    <tr><td>${pastille(null, 24)}</td><td colspan="2">Pas encore relevé</td></tr></table>
    <div class="leg-l"><i class="l-ce"></i>Cours d'eau <i class="l-fo"></i>Fossé <i class="l-ru"></i>Ruissellement</div>
    <div class="leg-l"><span class="arret-x petit"></span>L'écoulement s'arrête ici <i class="l-cm"></i>Courbe tous les 5 m</div>
  </div>`;
}
function ficheSheet(p) {
  const hist = obs().filter((o) => o.pointId === p.id && o.etat !== null && o.etat !== undefined).sort((a, b) => a.t - b.t);
  const dern = hist.slice(-1)[0];
  const t = tourneeOuverte();
  return `<div class="sheet">
    <div class="sheet-h">
      <span class="sheet-ic">${picto(p.type, 22)}</span>
      <div class="grow"><h2>${esc(p.nom)}</h2><div class="sub">${typeLib(p)} · ${altLib(p)}${ui.gps ? " · " + D.fmtDistance(distanceA(p)) : ""}</div></div>
      <button type="button" class="ronde" data-a="fermer-fiche" aria-label="Fermer">✕</button>
    </div>
    <div class="row">${pastille(dern?.etat, 30)}<div><b>${dern ? D.libEtat(p.type, dern.etat) : "Pas encore relevé"}</b>${dern ? `<div class="sub">${fJour(dern.t)} · ${ilYa(dern.t)}</div>` : ""}</div></div>
    ${hist.length ? `<div class="histo">${hist.slice(-24).map((o) => `<div class="histo-c">${pastille(o.etat, 30)}<span>${fJour(o.t).replace(/ \d{4}$/, "")}</span></div>`).join("")}</div>` : ""}
    ${mesuresResume(hist)}
    ${vignettes(hist.flatMap((o) => o.photos || []).slice(-8), false)}
    <div class="row2">
      ${btn("editer-point", "Modifier", "", `data-id="${p.id}"`)}
      ${t ? btn("saisir-depuis-fiche", "Relever ce point", "primary", `data-id="${p.id}"`) : ""}
    </div>
  </div>`;
}
function mesuresResume(hist) {
  const h = hist.filter((o) => o.hauteurCm !== null && o.hauteurCm !== undefined).slice(-6);
  const q = hist.filter((o) => o.debitLmin).slice(-6);
  let s = "";
  if (h.length) s += `<div class="sub">Hauteur d'eau : ${h.map((o) => `${fNum(o.hauteurCm, 0)} cm (${fJour(o.t)})`).join(" · ")}</div>`;
  if (q.length) s += `<div class="sub">Débit au seau : ${q.map((o) => `${fNum(o.debitLmin)} L/min (${fJour(o.t)})`).join(" · ")}</div>`;
  return s;
}

/* ---------- écran Tournée ---------- */
function prochainPoint(t) {
  const faits = D.obsDeTournee(obs(), t.id), ordre = D.ordreTournee(points());
  const dernier = [...faits.values()].sort((a, b) => b.t - a.t)[0];
  return D.pointSuivant(ordre, new Set(faits.keys()), dernier ? dernier.pointId : null);
}
function vueTournee() {
  const t = tourneeOuverte();
  if (!t) return vueTourneeAccueil();
  const ordre = D.ordreTournee(points()), faits = D.obsDeTournee(obs(), t.id);
  const n = ordre.filter((p) => faits.has(p.id)).length;
  const prochain = prochainPoint(t);
  const nArrets = arrets().filter((a) => a.tourneeId === t.id).length;
  const entete = `<div class="t-head">
      <div class="spread"><div><div class="sur">Tournée en cours</div><h1>${fJourLong(t.debut)}</h1>${voyant()}</div>
        <div class="t-compte"><b>${n}</b><span>/ ${ordre.length}</span></div></div>
      <div class="barre"><i style="width:${ordre.length ? (100 * n / ordre.length) : 0}%"></i></div>
      <div class="seg" role="tablist">
        <button type="button" class="${ui.tvue === "liste" ? "on" : ""}" data-a="tvue" data-k="liste">${picto("liste", 20)} Liste</button>
        <button type="button" class="${ui.tvue === "carte" ? "on" : ""}" data-a="tvue" data-k="carte">${picto("carte", 20)} Carte</button>
      </div>
    </div>`;
  const arretBtn = `<button type="button" class="btn arret-btn block" data-a="arret">${picto("arret", 22)} L'écoulement s'arrête ici</button>`;
  if (ui.tvue === "carte") {
    return `<main class="tournee-carte">${entete}
      <div class="map-slot tc" data-map-slot></div>
      <div class="map-fabs bas"><button type="button" class="fab" data-a="gps-centrer" aria-label="Ma position">${picto("gps")}</button>
      <button type="button" class="fab" data-a="tout-voir" aria-label="Toute la ferme">${picto("tout")}</button></div>
      <div class="tc-bas">
        ${prochain ? `<button type="button" class="btn primary big block" data-a="saisir" data-id="${prochain.id}">Relever : ${esc(prochain.nom)} ${picto("fleche", 20)}</button>` : ""}
        <div class="row2">${arretBtn}${btn("finir-tournee", "Terminer", "")}</div>
      </div></main>`;
  }
  return `<main class="screen">${entete}
    ${prochain ? `<button type="button" class="btn primary big block" data-a="saisir" data-id="${prochain.id}">Relever : ${esc(prochain.nom)} ${picto("fleche", 20)}</button>`
      : `<div class="card ok">Tous les points sont relevés.</div>`}
    <ol class="liste">${ordre.map((p, i) => {
      const o = faits.get(p.id), d = distanceA(p);
      return `<li><button type="button" class="ligne ${o ? "fait" : ""} ${prochain && prochain.id === p.id ? "prochain" : ""}" data-a="saisir" data-id="${p.id}">
        <span class="num">${i + 1}</span>
        <span class="l-ic">${picto(p.type, 20)}</span>
        <span class="grow"><b>${esc(p.nom)}</b><span class="sub">${typeLib(p)} · ${altLib(p)}<span data-dist="${p.id}" data-pre=" · ">${d !== null ? " · " + D.fmtDistance(d) : ""}</span></span></span>
        ${o ? `<span class="l-etat">${pastille(o.etat, 30)}</span>` : `<span class="l-afaire">à relever</span>`}
      </button></li>`;
    }).join("")}</ol>
    <h2>Arrêts de l'écoulement ${nArrets ? `<span class="badge">${nArrets}</span>` : ""}</h2>
    <p class="sub">Sur un ruisseau, à l'endroit précis où l'eau cesse de couler : la position GPS est enregistrée.</p>
    ${arretBtn}
    ${listeArrets(t.id)}
    <div class="espace"></div>
    ${btn("finir-tournee", "Terminer la tournée", "block big")}
  </main>`;
}
function listeArrets(tid) {
  const l = arrets().filter((a) => a.tourneeId === tid).sort((a, b) => a.t - b.t);
  if (!l.length) return "";
  return `<ul class="arrets">${l.map((a) => `<li><span class="arret-x petit"></span><span class="grow">${fHeure(a.t)} · ${a.alt !== null && a.alt !== undefined ? fNum(a.alt) + " m" : ""}${a.precision ? ` · ± ${Math.round(a.precision)} m` : " · placé sur la carte"}</span>
    ${confirmBtn("arret:" + a.id, "suppr-arret", "Supprimer", "Confirmer", `data-id="${a.id}"`)}</li>`).join("")}</ul>`;
}
function vueTourneeAccueil() {
  const ordre = D.ordreTournee(points()), ts = tournees().slice().reverse();
  const haut = ordre[0], bas = ordre[ordre.length - 1];
  return `<main class="screen">
    <h1>Tournée</h1>
    <p class="sub">${ordre.length} points actifs${haut ? `, du plus haut (${altLib(haut)}) au plus bas (${altLib(bas)})` : ""}. L'ordre est libre sur le terrain.</p>
    <button type="button" class="btn primary big block" data-a="demarrer">${picto("tournee", 24)} Démarrer une tournée</button>
    <h2>Tournées passées</h2>
    ${ts.length ? `<ul class="tlist">${ts.map((t) => {
      const c = D.comptesParEtat(D.obsDeTournee(obs(), t.id)), tot = Object.values(c).reduce((a, b) => a + b, 0);
      return `<li><button type="button" class="ligne" data-a="recap" data-id="${t.id}">
        <span class="grow"><b>${fJourLong(t.debut)} ${new Date(t.debut).getFullYear()}</b><span class="sub">${tot} relevé${tot > 1 ? "s" : ""}</span></span>
        <span class="mini-barre">${[4, 3, 2, 1, 0].map((v) => c[v] ? `<i class="e${v}" style="flex:${c[v]}" title="${c[v]}"></i>` : "").join("")}${c.imp ? `<i class="eimp" style="flex:${c.imp}"></i>` : ""}</span>
        ${picto("fleche", 18)}</button></li>`;
    }).join("")}</ul>` : `<p class="sub">Aucune tournée enregistrée.</p>`}
  </main>`;
}

/* ---------- saisie d'un point ---------- */
function ouvrirSaisie(pointId, tourneeId) {
  const p = point(pointId); if (!p) return;
  const o = D.obsDeTournee(obs(), tourneeId).get(pointId);
  ui.draft = o ? { etat: o.etat, hauteur: o.hauteurCm !== null && o.hauteurCm !== undefined ? String(o.hauteurCm).replace(".", ",") : "", seauL: o.seauL || p.seauL || 10,
    chronoS: o.chronoS || null, commentaire: o.commentaire || "", obsId: o.id, t: o.t, photos: (o.photos || []).slice(), ajoutees: [] }
    : { etat: null, hauteur: "", seauL: p.seauL || 10, chronoS: null, commentaire: "", obsId: null, nouvelId: uid("o"), photos: [], ajoutees: [] };
  ui.kp = null; ui.chronoDebut = null;
  ui.vue = { k: "saisie", pointId, tourneeId };
  window.scrollTo(0, 0);
  render();
  suivreGPS();
}
function vueSaisie() {
  const { pointId, tourneeId } = ui.vue, p = point(pointId), dr = ui.draft;
  const t = S.get("tournees", tourneeId);
  const ech = D.echelleOf(p.type), eau = D.TYPES[p.type].echelle === "eau";
  const ordre = D.ordreTournee(points()), idx = ordre.findIndex((x) => x.id === p.id);
  const prec = D.obsPrecedente(obs(), p.id, tourneeId);
  const d = distanceA(p);
  const mesH = p.mesures?.includes("hauteur"), mesQ = p.mesures?.includes("debit_seau");
  const chrono = ui.chronoDebut ? (Date.now() - ui.chronoDebut) / 1000 : dr.chronoS;
  const debit = D.debitSeau(dr.seauL, dr.chronoS);
  return `<main class="screen saisie">
    <div class="s-head">
      <button type="button" class="ronde" data-a="quitter-saisie" aria-label="Retour à la liste">${picto("retour", 22)}</button>
      <div class="grow"><h1 class="s-nom">${esc(p.nom)}</h1><div class="sub">${typeLib(p)} · ${altLib(p)} · <span data-dist="${p.id}">${d !== null ? D.fmtDistance(d) : ui.gpsErr ? "GPS indisponible" : "GPS…"}</span></div></div>
      ${idx >= 0 ? `<span class="s-pos">${idx + 1} / ${ordre.length}</span>` : ""}
    </div>
    ${t && t.terminee ? `<div class="card info">Correction d'une tournée terminée (${fJour(t.debut)}).</div>` : ""}
    <div class="ech-t"><b>${ech.nom}</b><span>${esc(ech.source)}</span></div>
    <div class="etats">${[4, 3, 2, 1, 0].map((v) => `<button type="button" class="etat-b ${dr.etat === v ? "on" : ""}" data-a="etat" data-k="${v}" aria-pressed="${dr.etat === v}">
      ${pastille(v, 44)}<span class="grow"><b>${ech.lib[v]}</b><span>${ech.def[v]}</span></span>${dr.etat === v ? `<span class="coche">✓</span>` : ""}</button>`).join("")}
      <button type="button" class="etat-imp ${dr.etat === D.IMPOSSIBLE ? "on" : ""}" data-a="etat" data-k="imp">Observation impossible</button>
    </div>
    <p class="prec">${prec ? `Relevé précédent, ${fJour(prec.t)} : ${pastille(prec.etat, 22)} <b>${D.libEtat(p.type, prec.etat)}</b>` : "Premier relevé de ce point."}</p>
    ${mesH ? `<div class="mesure"><div class="spread"><b>Hauteur d'eau à la règle</b><span class="facult">facultatif</span></div>
      <button type="button" class="m-val ${ui.kp === "hauteur" ? "on" : ""}" data-a="kp-ouvrir" data-k="hauteur">${dr.hauteur || "—"} <small>cm</small></button>
      ${ui.kp === "hauteur" ? clavier("hauteur") : ""}</div>` : ""}
    ${mesQ ? `<div class="mesure"><div class="spread"><b>Débit au seau</b><span class="facult">facultatif</span></div>
      <div class="row"><span>Seau de</span><button type="button" class="ronde" data-a="seau" data-k="-1" aria-label="Seau plus petit">−</button><b class="seau">${dr.seauL} L</b><button type="button" class="ronde" data-a="seau" data-k="1" aria-label="Seau plus grand">+</button></div>
      <div class="chrono" data-chrono>${fChrono(chrono)}</div>
      <div class="row2">${ui.chronoDebut ? btn("chrono-stop", "Arrêter", "primary big") : btn("chrono-go", picto("chrono", 22) + (dr.chronoS ? " Recommencer" : " Démarrer"), "big")}
      ${dr.chronoS && !ui.chronoDebut ? btn("chrono-raz", "Effacer", "") : ""}</div>
      ${debit ? `<div class="resultat">Débit : <b>${fNum(debit)} L/min</b></div>` : ""}</div>` : ""}
    ${eau ? `<button type="button" class="btn arret-btn block" data-a="arret">${picto("arret", 22)} L'écoulement s'arrête ici</button>` : ""}
    <label class="champ"><span>Commentaire <span class="facult">facultatif</span></span>
      <textarea rows="2" data-in="commentaire" placeholder="Micro du clavier pour dicter">${esc(dr.commentaire)}</textarea></label>
    <div class="champ"><span>Photos <span class="facult">facultatif · envoyées dans Google Drive</span></span>
      ${vignettes(dr.photos, true)}
      <label class="btn block">${picto("photo", 22)} ${ui.photoEnCours ? "Préparation de la photo…" : "Prendre une photo"}<input type="file" accept="image/*" capture="environment" data-in="photo" hidden></label></div>
    <div class="espace-bas"></div>
    <div class="barre-bas">
      ${btn("passer", "Passer", "")}
      <button type="button" class="btn primary big grow" data-a="enregistrer-obs" ${dr.etat === null ? "disabled" : ""}>${dr.obsId ? "Enregistrer la correction" : "Enregistrer · suivant"}</button>
    </div>
  </main>`;
}
function fChrono(s) {
  if (!s) return "0:00,0";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1).replace(".", ",");
}
let chronoTimer = null;

/* ---------- récapitulatif d'une tournée ---------- */
function vueRecap() {
  const t = S.get("tournees", ui.vue.tourneeId); if (!t) { ui.vue = null; return vueTournee(); }
  const faits = D.obsDeTournee(obs(), t.id), c = D.comptesParEtat(faits), ordre = D.ordreTournee(points());
  const ts = tournees(), i = ts.findIndex((x) => x.id === t.id), prev = i > 0 ? ts[i - 1] : null;
  let plus = 0, moins = 0;
  if (prev) {
    const pf = D.obsDeTournee(obs(), prev.id);
    for (const [pid, o] of faits) {
      const a = pf.get(pid);
      if (a && typeof a.etat === "number" && typeof o.etat === "number") { if (o.etat > a.etat) plus++; else if (o.etat < a.etat) moins++; }
    }
  }
  const manquants = ordre.filter((p) => !faits.has(p.id));
  return `<main class="screen">
    <div class="s-head"><button type="button" class="ronde" data-a="retour-tournees" aria-label="Retour">${picto("retour", 22)}</button>
      <div class="grow"><div class="sur">${t.terminee ? "Tournée terminée" : "Fin de tournée"}</div><h1>${fJourLong(t.debut)}</h1><div class="sub">${faits.size} relevé${faits.size > 1 ? "s" : ""} sur ${ordre.length} points</div></div></div>
    <div class="tuiles5">${[4, 3, 2, 1, 0].map((v) => `<div class="tuile e${v}"><b>${c[v]}</b><span>${v}</span></div>`).join("")}</div>
    ${c.imp ? `<p class="sub">${c.imp} observation${c.imp > 1 ? "s" : ""} impossible${c.imp > 1 ? "s" : ""}.</p>` : ""}
    ${prev ? `<div class="card"><b>Par rapport au ${fJour(prev.debut)}</b><div class="sub">${moins} point${moins > 1 ? "s" : ""} en baisse · ${plus} en hausse</div></div>` : ""}
    ${manquants.length ? `<h2>Non relevés (${manquants.length})</h2><ul class="liste">${manquants.map((p) => `<li><button type="button" class="ligne" data-a="saisir-t" data-id="${p.id}" data-t="${t.id}"><span class="l-ic">${picto(p.type, 20)}</span><span class="grow"><b>${esc(p.nom)}</b><span class="sub">${altLib(p)}</span></span><span class="l-afaire">à relever</span></button></li>`).join("")}</ul>` : ""}
    <h2>Relevés</h2>
    <ul class="liste">${ordre.filter((p) => faits.has(p.id)).map((p) => { const o = faits.get(p.id); return `<li><button type="button" class="ligne fait" data-a="saisir-t" data-id="${p.id}" data-t="${t.id}">
      ${pastille(o.etat, 30)}<span class="grow"><b>${esc(p.nom)}</b><span class="sub">${D.libEtat(p.type, o.etat)}${o.hauteurCm !== null && o.hauteurCm !== undefined ? " · " + fNum(o.hauteurCm, 0) + " cm" : ""}${o.debitLmin ? " · " + fNum(o.debitLmin) + " L/min" : ""}${o.commentaire ? " · « " + esc(o.commentaire) + " »" : ""}${o.photos?.length ? " · " + o.photos.length + " photo" + (o.photos.length > 1 ? "s" : "") : ""}</span></span></button></li>`; }).join("")}</ul>
    <h2>Arrêts de l'écoulement</h2>
    ${listeArrets(t.id) || `<p class="sub">Aucun.</p>`}
    <div class="espace"></div>
    <div class="stack">
      ${t.terminee ? btn("rouvrir", "Rouvrir la tournée", "block", `data-id="${t.id}"`) : btn("terminer", "Terminer la tournée", "primary big block", `data-id="${t.id}"`) + btn("retour-tournee", "Continuer la tournée", "block")}
      ${confirmBtn("tournee:" + t.id, "suppr-tournee", "Supprimer cette tournée", "Confirmer : supprimer la tournée et ses relevés", `data-id="${t.id}"`)}
    </div>
  </main>`;
}

/* ---------- placement sur la carte ---------- */
function vuePlacement() {
  const v = ui.vue;
  const titre = v.but === "arret" ? "Où l'écoulement s'arrête-t-il ?" : "Emplacement du point";
  return `<main class="carte-ecran plein">
    <div class="map-slot full" data-map-slot></div>
    <div class="map-top"><div class="bandeau"><b>${titre}</b><span>Touchez la carte${v.but === "arret" ? " (GPS trop imprécis ou indisponible)" : ", ou utilisez votre position"}.</span></div></div>
    <div class="map-fabs"><button type="button" class="fab" data-a="gps-centrer" aria-label="Ma position">${picto("gps")}</button><button type="button" class="fab" data-a="fond" aria-label="Changer de fond">${picto("calques")}<span>${M.getFond() === "photo" ? "Relief" : "Photo"}</span></button></div>
    <div class="barre-bas carte">
      ${btn("placement-annuler", "Annuler")}
      ${ui.gps ? btn("placement-gps", picto("gps", 20) + " Ma position") : ""}
      <button type="button" class="btn primary grow" data-a="placement-ok" ${v.pos ? "" : "disabled"}>Valider</button>
    </div>
  </main>`;
}

/* ---------- fiche d'édition d'un point ---------- */
function vuePoint() {
  const v = ui.vue, dr = v.draft;
  const types = Object.entries(D.TYPES);
  const altCalc = dr.lng ? D.altitude(GEO.mnt, dr.lng, dr.lat) : null;
  return `<main class="screen">
    <div class="s-head"><button type="button" class="ronde" data-a="point-annuler" aria-label="Retour">${picto("retour", 22)}</button>
      <div class="grow"><h1>${v.id ? "Modifier le point" : "Nouveau point d'eau"}</h1></div></div>
    <label class="champ"><span>Nom</span><input type="text" data-in="p-nom" value="${esc(dr.nom)}" placeholder="Ex. Source du haut" autocomplete="off"></label>
    <div class="champ"><span>Type</span><div class="grille2">${types.map(([k, t]) => `<button type="button" class="choix ${dr.type === k ? "on" : ""}" data-a="p-type" data-k="${k}">${picto(k, 22)} ${t.lib}</button>`).join("")}</div>
      <div class="sub">Échelle utilisée : ${D.echelleOf(dr.type).lib.slice().reverse().join(" · ")}</div></div>
    <div class="champ"><span>Emplacement</span>
      <div class="sub">${dr.lng ? `${dr.lat.toFixed(5)}° N, ${Math.abs(dr.lng).toFixed(5)}° O` : "Pas encore placé"}</div>
      <div class="row2">${btn("p-gps", picto("gps", 20) + " Ma position", ui.gps ? "" : "", ui.gps ? "" : "disabled")}${btn("p-carte", picto("carte", 20) + " Sur la carte")}</div>
      ${!ui.gps ? `<div class="sub">${ui.gpsErr ? "GPS indisponible : " + esc(ui.gpsErr) : "Recherche de la position GPS…"}</div>` : ""}</div>
    <label class="champ"><span>Altitude (m)</span><input type="text" inputmode="decimal" data-in="p-alt" value="${dr.alt === null || dr.alt === undefined ? "" : String(dr.alt).replace(".", ",")}">
      <span class="sub">${altCalc !== null ? `Modèle de terrain : ${fNum(altCalc)} m ${!dr.altAuto ? `· <button type="button" class="lien" data-a="p-alt-auto">reprendre cette valeur</button>` : "(valeur reprise)"}` : "Hors du modèle de terrain : à saisir."}</span></label>
    <div class="champ"><span>Mesures facultatives proposées en tournée</span>
      <button type="button" class="choix large ${dr.mesures.includes("hauteur") ? "on" : ""}" data-a="p-mes" data-k="hauteur">${dr.mesures.includes("hauteur") ? "☑" : "☐"} Hauteur d'eau à la règle (cm)</button>
      <button type="button" class="choix large ${dr.mesures.includes("debit_seau") ? "on" : ""}" data-a="p-mes" data-k="debit_seau">${dr.mesures.includes("debit_seau") ? "☑" : "☐"} Débit au seau (chronomètre)</button>
    </div>
    ${v.id ? `<div class="champ"><span>Suivi</span><button type="button" class="choix large ${dr.actif ? "on" : ""}" data-a="p-actif">${dr.actif ? "☑ Point suivi (dans les tournées)" : "☐ Point désactivé (gardé avec son historique)"}</button></div>` : ""}
    ${v.id && !obs().some((o) => o.pointId === v.id) ? confirmBtn("point:" + v.id, "p-suppr", "Supprimer ce point", "Confirmer la suppression", "") : ""}
    <div class="espace-bas"></div>
    <div class="barre-bas">${btn("point-annuler", "Annuler")}<button type="button" class="btn primary big grow" data-a="point-ok" ${dr.nom.trim() && dr.lng ? "" : "disabled"}>${v.id ? "Enregistrer" : "Créer le point"}</button></div>
  </main>`;
}
function ouvrirPoint(id, pos) {
  const p = id ? point(id) : null;
  const draft = p ? { nom: p.nom, type: p.type, lng: p.lng, lat: p.lat, alt: p.alt, altAuto: p.altAuto !== false, mesures: (p.mesures || []).slice(), actif: p.actif !== false }
    : { nom: "", type: "source", lng: pos ? pos[0] : null, lat: pos ? pos[1] : null, alt: pos ? D.altitude(GEO.mnt, pos[0], pos[1]) : null, altAuto: true, mesures: [], actif: true };
  ui.vue = { k: "point", id: id || null, draft, retour: ui.vue };
  ui.confirm = null;
  window.scrollTo(0, 0);
  render();
  suivreGPS();
}

/* ---------- écran Pluie ---------- */
function nouvellePluie() { ui.pluie = { lecture: "", quand: toLocalInput(Date.now()), vide: true, editId: null }; }
function vuePluie() {
  if (!ui.pluie) nouvellePluie();
  const pl = ui.pluie, calc = D.relevesCalcules(S.live("pluies"));
  const tQuand = new Date(pl.quand).getTime();
  const precs = calc.filter((r) => r.id !== pl.editId && r.t < tQuand), prec = precs.slice(-1)[0];
  const journal = D.pluieJournaliere(S.live("pluies"));
  const aujour = D.jourISO(Date.now()), hier = D.jourPlus(aujour, -1);
  const lect = numDe(pl.lecture);
  const retenue = lect !== null && prec && !prec.vide ? Math.max(0, lect - prec.lecture) : lect;
  const nJ = prec ? D.ecartJours(D.jourISO(prec.t), D.jourISO(tQuand)) : null;
  const dejaAujourdhui = calc.some((r) => D.jourISO(r.t) === aujour) && !pl.editId;
  return `<main class="screen">
    <h1>${pl.editId ? "Corriger un relevé" : "Relevé du pluviomètre"}</h1>${voyant()}
    ${dejaAujourdhui ? `<p class="sub ok-t">Un relevé a déjà été fait aujourd'hui.</p>` : ""}
    <div class="pl-aff"><span>Lecture</span><b>${pl.lecture || "0"}</b><small>mm</small></div>
    ${clavier("pluie")}
    <label class="champ"><span>Date et heure du relevé</span><input type="datetime-local" data-in="pl-quand" value="${pl.quand}"></label>
    <p class="sub">${prec ? `Relevé précédent : ${fJour(prec.t)} à ${fHeure(prec.t)}${nJ > 1 ? ` — <b>${nJ} jours</b> : la pluie sera répartie également sur ces jours.` : nJ === 1 ? " — la pluie lue est comptée pour la veille." : " — même jour."}` : "Premier relevé : la pluie lue est comptée pour la veille."}</p>
    ${prec && !prec.vide ? `<div class="card info">Le pluviomètre n'avait pas été vidé au relevé précédent (${fNum(prec.lecture)} mm). Pluie retenue : <b>${retenue === null ? "—" : fNum(retenue) + " mm"}</b>.</div>` : ""}
    <button type="button" class="choix large ${pl.vide ? "on" : ""}" data-a="pl-vide">${pl.vide ? "☑" : "☐"} Pluviomètre vidé après lecture</button>
    <div class="row2">
      ${pl.editId ? btn("pl-annuler", "Annuler") : ""}
      <button type="button" class="btn primary big grow" data-a="pl-ok" ${lect === null ? "disabled" : ""}>Enregistrer</button>
    </div>
    ${pl.editId ? confirmBtn("pluie:" + pl.editId, "pl-suppr", "Supprimer ce relevé", "Confirmer la suppression", "") : ""}
    <h2>Cumuls</h2>
    <div class="tuiles3">
      <div class="tuile"><span>7 jours</span><b>${fNum(D.cumul(journal, D.jourPlus(hier, -6), hier))}</b><small>mm</small></div>
      <div class="tuile"><span>30 jours</span><b>${fNum(D.cumul(journal, D.jourPlus(hier, -29), hier))}</b><small>mm</small></div>
      <div class="tuile"><span>Depuis le 1ᵉʳ janv.</span><b>${fNum(D.cumul(journal, aujour.slice(0, 4) + "-01-01", aujour))}</b><small>mm</small></div>
    </div>
    <h2>60 derniers jours</h2>
    ${graphe60(journal, aujour)}
    <div class="leg-l"><i class="b-mes"></i>Mesurée <i class="b-rep"></i>Répartie sur plusieurs jours <i class="b-non"></i>Pas de relevé</div>
    <h2>Mois de ${aujour.slice(0, 4)}</h2>
    ${grapheMois(journal, aujour)}
    <h2>Relevés</h2>
    ${calc.length ? `<ul class="liste">${calc.slice().reverse().slice(0, 40).map((r) => `<li><button type="button" class="ligne" data-a="pl-edit" data-id="${r.id}">
      <span class="grow"><b>${fJour(r.t)} · ${fHeure(r.t)}</b><span class="sub">Lecture ${fNum(r.lecture)} mm${r.vide ? "" : " (non vidé)"}${r.jours.length > 1 ? ` · réparti sur ${r.jours.length} j` : ""}</span></span>
      <b class="mm">${fNum(r.mm)} mm</b></button></li>`).join("")}</ul>` : `<p class="sub">Aucun relevé.</p>`}
  </main>`;
}
function graphe60(journal, aujour) {
  const W = 360, H = 120, n = 60, bw = W / n;
  let max = 5;
  const jours = Array.from({ length: n }, (_, k) => D.jourPlus(aujour, k - n));
  for (const j of jours) max = Math.max(max, journal.get(j)?.mm || 0);
  let s = `<svg class="graphe" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Pluie journalière des 60 derniers jours">`;
  s += `<defs><pattern id="hach" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--b-non)"/></pattern></defs>`;
  jours.forEach((j, k) => {
    const v = journal.get(j), x = k * bw + 0.6;
    if (!v) { s += `<rect x="${x}" y="${H - 3}" width="${bw - 1.2}" height="3" class="b-non"/>`; return; }
    const h = Math.max(1.5, (v.mm / max) * (H - 14));
    s += `<rect x="${x}" y="${H - h}" width="${bw - 1.2}" height="${h}" class="${v.origine === "repartie" ? "b-rep" : "b-mes"}"><title>${fISO(j)} : ${fNum(v.mm)} mm${v.origine === "repartie" ? " (réparti)" : ""}</title></rect>`;
    if (j.endsWith("-01")) s += `<text x="${x}" y="${H + 14}" class="g-t">${fISO(j)}</text>`;
  });
  s += `<text x="${W}" y="10" text-anchor="end" class="g-t">max ${fNum(max)} mm</text></svg>`;
  return s;
}
function grapheMois(journal, aujour) {
  const an = aujour.slice(0, 4), vals = Array(12).fill(0);
  for (const [j, v] of journal) if (j.startsWith(an)) vals[+j.slice(5, 7) - 1] += v.mm;
  const max = Math.max(10, ...vals), W = 360, H = 110, bw = W / 12;
  let s = `<svg class="graphe" viewBox="0 0 ${W} ${H + 30}" role="img" aria-label="Cumuls mensuels">`;
  vals.forEach((v, i) => {
    const h = v ? Math.max(2, (v / max) * (H - 16)) : 0, x = i * bw + 3;
    if (h) s += `<rect x="${x}" y="${H - h}" width="${bw - 6}" height="${h}" class="b-mes"/><text x="${x + (bw - 6) / 2}" y="${H - h - 3}" text-anchor="middle" class="g-t">${Math.round(v)}</text>`;
    s += `<text x="${x + (bw - 6) / 2}" y="${H + 14}" text-anchor="middle" class="g-t">${["J","F","M","A","M","J","J","A","S","O","N","D"][i]}</text>`;
  });
  return s + `</svg>`;
}

/* ---------- écran Plus ---------- */
function vuePlus() {
  const pts = points().slice().sort((a, b) => (b.alt ?? 0) - (a.alt ?? 0));
  return `<main class="screen">
    <h1>Plus</h1>
    <h2>Synchronisation avec le tableur ${voyant()}</h2>
    ${vueSync()}
    <h2>Points d'eau (${pts.filter((p) => p.actif !== false).length} suivis)</h2>
    ${btn("nouveau-point", picto("ajout", 20) + " Ajouter un point", "block")}
    <ul class="liste">${pts.map((p) => `<li><button type="button" class="ligne ${p.actif === false ? "inactif" : ""}" data-a="editer-point" data-id="${p.id}">
      <span class="l-ic">${picto(p.type, 20)}</span><span class="grow"><b>${esc(p.nom)}</b><span class="sub">${typeLib(p)} · ${altLib(p)}${p.actif === false ? " · désactivé" : ""}${p.mesures?.length ? " · mesures : " + p.mesures.map((m) => m === "hauteur" ? "hauteur" : "débit").join(", ") : ""}</span></span>${picto("fleche", 18)}</button></li>`).join("")}</ul>
    <h2>Sauvegarde</h2>
    <div class="card">
      <p>Copie complète des données dans un fichier, en plus du tableur.</p>
      <p class="sub" data-sauv>Dernière sauvegarde : …</p>
      <div class="stack">
        ${btn("sauver", "Exporter une sauvegarde (JSON)", "primary block")}
        <label class="btn block">Restaurer une sauvegarde<input type="file" accept=".json,application/json" data-in="restaurer" hidden></label>
      </div>
    </div>
    <h2>Exports CSV (tableur)</h2>
    <div class="stack">
      ${btn("csv", "Observations des tournées", "block", `data-k="obs"`)}
      ${btn("csv", "Relevés du pluviomètre", "block", `data-k="releves"`)}
      ${btn("csv", "Pluie journalière retenue", "block", `data-k="journal"`)}
      ${btn("csv", "Arrêts de l'écoulement", "block", `data-k="arrets"`)}
      ${btn("csv", "Tests du forage (avec eaux de surface et pluie)", "block", `data-k="forage"`)}
      ${btn("csv", "Points d'eau", "block", `data-k="points"`)}
    </div>
    <h2>Échelles d'état</h2>
    ${["eau", "mare"].map((k) => { const e = D.ECHELLES[k]; return `<div class="card"><b>${k === "eau" ? "Ruisseaux et sources" : "Mares et zones humides"}</b><div class="sub">${esc(e.source)}</div>
      <ul class="ech">${[4, 3, 2, 1, 0].map((v) => `<li>${pastille(v, 26)}<span><b>${e.lib[v]}</b> — ${e.def[v]}</span></li>`).join("")}</ul></div>`; }).join("")}
    <p class="sub">Référence : protocole ONDE et programme « En quête d'eau » de l'Office français de la biodiversité.</p>
    <h2>Affichage</h2>
    <div class="seg">${[["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]].map(([k, l]) => `<button type="button" class="${ui.theme === k ? "on" : ""}" data-a="theme" data-k="${k}">${l}</button>`).join("")}</div>
    <p class="sub centre">Eau de la ferme · version ${VERSION}</p>
  </main>`;
}

function vueSync() {
  if (!ui.syncForm) ui.syncForm = { url: Y.SYNC.url, secret: Y.SYNC.secret, msg: "", ok: null, ouvert: !Y.configured() };
  const f = ui.syncForm;
  return `<div class="card">
    <p class="sub" data-sync-info>${syncInfo()}</p>
    ${Y.configured() ? `<div class="row2">${btn("sync-go", "Synchroniser maintenant", "primary")}</div>` : ""}
    ${f.ouvert ? `<label class="champ"><span>Adresse du script (se termine par /exec)</span><input type="url" data-in="sync-url" value="${esc(f.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="champ"><span>Secret</span><input type="text" data-in="sync-secret" value="${esc(f.secret)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      ${f.msg ? `<p class="${f.ok ? "ok-t" : "err-t"}">${esc(f.msg)}</p>` : ""}
      <div class="row2">${btn("sync-test", "Tester")}${btn("sync-ok", "Enregistrer", "primary")}</div>
      ${Y.configured() ? btn("sync-fermer", "Fermer", "ghost block") : `<p class="sub">Installation du script : voir le fichier serveur/LISEZMOI.md.</p>`}`
    : `<div class="row2">${btn("sync-ouvrir", "Changer le réglage")}</div>
      ${confirmBtn("renvoyer", "sync-renvoyer", "Tout renvoyer au tableur", "Confirmer : tout renvoyer", "")}`}
  </div>`;
}

/* ---------- GPS ---------- */
function suivreGPS() {
  if (ui.gpsWatch !== null || !navigator.geolocation) { if (!navigator.geolocation) ui.gpsErr = "non pris en charge"; return; }
  ui.gpsWatch = navigator.geolocation.watchPosition((p) => {
    const premier = !ui.gps;
    ui.gps = [p.coords.longitude, p.coords.latitude]; ui.gpsAcc = p.coords.accuracy; ui.gpsT = Date.now(); ui.gpsErr = null;
    M.setGPS(ui.gps);
    for (const el of app.querySelectorAll("[data-dist]")) { const pt = point(el.dataset.dist); if (pt) el.textContent = (el.dataset.pre || "") + D.fmtDistance(distanceA(pt)); }
    if (premier && (ui.vue?.k === "point" || ui.vue?.k === "placement")) rerender();
  }, (err) => {
    ui.gpsErr = err.code === 1 ? "autorisation refusée" : "position introuvable";
    for (const el of app.querySelectorAll("[data-dist]")) el.textContent = (el.dataset.pre || "") + "GPS indisponible";
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

/* ---------- toasts ---------- */
let toastTimer = null;
function toast(msg, annuler) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${annuler ? `<button type="button" id="toast-undo">Annuler</button>` : ""}`;
  el.className = "show";
  if (annuler) el.querySelector("#toast-undo").onclick = () => { el.className = ""; annuler(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, annuler ? 6000 : 3000);
}

/* ---------- arrêt de l'écoulement ---------- */
async function enregistrerArret(pos, precision) {
  const t = ui.vue?.k === "saisie" ? S.get("tournees", ui.vue.tourneeId) : tourneeOuverte();
  if (!t) { toast("Démarrez d'abord une tournée."); return; }
  const rec = { id: uid("ar"), tourneeId: t.id, t: Date.now(), lng: +pos[0].toFixed(6), lat: +pos[1].toFixed(6), alt: D.altitude(GEO.mnt, pos[0], pos[1]), precision: precision || null };
  await S.save("arrets", rec);
  toast(`Arrêt de l'écoulement enregistré${rec.alt !== null ? " (" + fNum(rec.alt) + " m)" : ""}`, async () => { await S.remove("arrets", rec.id); });
}

/* ---------- sauvegarde / CSV ---------- */
function telecharger(nom, contenu, type) {
  const blob = new Blob([contenu], { type }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function csv(entetes, lignes) {
  const c = (v) => { if (v === null || v === undefined) return ""; const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [entetes.join(";")].concat(lignes.map((l) => l.map(c).join(";"))).join("\r\n");
}
const dec = (x) => x === null || x === undefined ? "" : String(x).replace(".", ",");
function dateHeure(t) { const d = new Date(t); return D.jourISO(t) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function exportCSV(k) {
  const jour = D.jourISO(Date.now());
  if (k === "obs") {
    const ts = new Map(tournees().map((t) => [t.id, t]));
    const l = obs().slice().sort((a, b) => a.t - b.t).map((o) => { const p = point(o.pointId) || {}; const t = ts.get(o.tourneeId);
      return [t ? dateHeure(t.debut) : "", dateHeure(o.t), p.nom, p.type, dec(p.alt), o.etat === D.IMPOSSIBLE ? "" : o.etat, D.libEtat(p.type, o.etat), dec(o.hauteurCm), dec(o.seauL), dec(o.chronoS), dec(o.debitLmin), o.commentaire, o.lng ? dec(o.lng) : "", o.lat ? dec(o.lat) : "", (o.photos || []).map((x) => x.url || "").filter(Boolean).join(" ")]; });
    telecharger(`observations_${jour}.csv`, csv(["tournee", "date_heure", "point", "type", "altitude_m", "etat", "libelle", "hauteur_cm", "seau_L", "chrono_s", "debit_L_min", "commentaire", "gps_lng", "gps_lat", "photos"], l), "text/csv");
  } else if (k === "releves") {
    const l = D.relevesCalcules(S.live("pluies")).map((r) => [dateHeure(r.t), dec(r.lecture), r.vide ? "oui" : "non", dec(r.mm), r.jours.length, r.jours[0], r.jours[r.jours.length - 1]]);
    telecharger(`releves_pluie_${jour}.csv`, csv(["date_heure", "lecture_mm", "vide_apres", "pluie_retenue_mm", "nb_jours", "du", "au"], l), "text/csv");
  } else if (k === "journal") {
    const l = [...D.pluieJournaliere(S.live("pluies"))].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([j, v]) => [j, dec(v.mm), v.origine === "repartie" ? "répartie" : "mesurée"]);
    telecharger(`pluie_journaliere_${jour}.csv`, csv(["jour", "pluie_mm", "origine"], l), "text/csv");
  } else if (k === "arrets") {
    const ts = new Map(tournees().map((t) => [t.id, t]));
    const l = arrets().slice().sort((a, b) => a.t - b.t).map((a) => [ts.get(a.tourneeId) ? dateHeure(ts.get(a.tourneeId).debut) : "", dateHeure(a.t), dec(a.lng), dec(a.lat), dec(a.alt), dec(a.precision)]);
    telecharger(`arrets_ecoulement_${jour}.csv`, csv(["tournee", "date_heure", "lng", "lat", "altitude_m", "precision_m"], l), "text/csv");
  } else if (k === "forage") {
    const l = lignesForage().map((c) => [dateHeure(c.t), dec(c.indexDebut), dec(c.indexFin), dec(c.volume), dec(c.reposH), dec(c.mares.moy), c.mares.n, dec(c.ruisseaux.moy), c.ruisseaux.n, dec(c.pluie30), c.commentaire || ""]);
    telecharger(`forage_tests_${jour}.csv`, csv(["date_heure", "index_debut_m3", "index_fin_m3", "volume_m3", "repos_h", "indice_mares_0_4", "nb_mares", "indice_ruisseaux_0_4", "nb_points_ruisseaux", "pluie_30j_mm", "commentaire"], l), "text/csv");
  } else if (k === "points") {
    const l = points().map((p) => [p.nom, p.type, dec(p.lng), dec(p.lat), dec(p.alt), p.actif === false ? "non" : "oui", (p.mesures || []).join(" "), p.sig || ""]);
    telecharger(`points_eau_${jour}.csv`, csv(["nom", "type", "lng", "lat", "altitude_m", "suivi", "mesures", "nom_sig"], l), "text/csv");
  }
}

/* ---------- actions ---------- */
const A = {
  tab(el) { ui.tab = el.dataset.k; ui.vue = null; ui.fiche = null; ui.confirm = null; window.scrollTo(0, 0); render(); if (ui.tab === "tournee" && tourneeOuverte()) suivreGPS(); },
  "ask-confirm"(el) { ui.confirm = el.dataset.k; rerender(); },
  fond() { M.setFond(M.getFond() === "photo" ? "relief" : "photo"); rerender(); },
  "gps-centrer"() { suivreGPS(); if (ui.gps) M.centrer(ui.gps); else toast(ui.gpsErr ? "GPS indisponible : " + ui.gpsErr : "Recherche de la position…"); },
  "tout-voir"() { M.toutVoir(cadrage()); },
  legende() { ui.legende = !ui.legende; rerender(); },
  "carte-prec"() { const n = tournees().length; ui.carteIdx = ui.carteIdx === null ? n - 1 : Math.max(0, ui.carteIdx - 1); ui.fiche = null; rerender(); },
  "carte-suiv"() { const n = tournees().length; ui.carteIdx = ui.carteIdx === null || ui.carteIdx >= n - 1 ? null : ui.carteIdx + 1; ui.fiche = null; rerender(); },
  "fermer-fiche"() { ui.fiche = null; rerender(); },
  "editer-point"(el) { ouvrirPoint(el.dataset.id); },
  "saisir-depuis-fiche"(el) { const t = tourneeOuverte(); if (t) { ui.tab = "tournee"; ouvrirSaisie(el.dataset.id, t.id); } },
  "nouveau-point"() { suivreGPS(); ui.vue = { k: "placement", but: "point", pos: null, retour: null }; ui.fiche = null; render(); },
  "placement-annuler"() { const r = ui.vue.retour; ui.vue = r || null; render(); },
  "placement-gps"() { if (ui.gps) { ui.vue.pos = ui.gps.slice(); M.centrer(ui.gps); rerender(); } },
  async "placement-ok"() {
    const v = ui.vue; if (!v.pos) return;
    if (v.but === "arret") { ui.vue = v.retour; render(); await enregistrerArret(v.pos, null); }
    else if (v.but === "deplacer") { const r = v.retour; r.draft.lng = +v.pos[0].toFixed(6); r.draft.lat = +v.pos[1].toFixed(6); if (r.draft.altAuto) r.draft.alt = D.altitude(GEO.mnt, v.pos[0], v.pos[1]); ui.vue = r; render(); }
    else { ui.vue = null; ouvrirPoint(null, v.pos); }
  },
  tvue(el) { ui.tvue = el.dataset.k; render(); },
  async demarrer() {
    const t = { id: uid("t"), debut: Date.now(), terminee: false };
    await S.save("tournees", t);
    ui.tvue = "liste"; suivreGPS(); render();
  },
  saisir(el) { const t = tourneeOuverte(); if (t) ouvrirSaisie(el.dataset.id, t.id); },
  "saisir-t"(el) { ouvrirSaisie(el.dataset.id, el.dataset.t); },
  "quitter-saisie"() { arreterChrono(); oublierBrouillons(); const t = S.get("tournees", ui.vue.tourneeId); ui.vue = t && t.terminee ? { k: "recap", tourneeId: t.id } : null; ui.draft = null; render(); },
  etat(el) { ui.draft.etat = el.dataset.k === "imp" ? D.IMPOSSIBLE : Number(el.dataset.k); rerender(); },
  "kp-ouvrir"(el) { ui.kp = ui.kp === el.dataset.k ? null : el.dataset.k; rerender(); },
  kp(el) {
    const cible = el.closest("[data-kp]").dataset.kp, k = el.dataset.k;
    const get = () => cible === "pluie" ? ui.pluie.lecture : ui.draft.hauteur;
    const set = (v) => { if (cible === "pluie") ui.pluie.lecture = v; else ui.draft.hauteur = v; };
    let v = get();
    if (k === "⌫") v = v.slice(0, -1);
    else if (k === ",") { if (!v.includes(",")) v = (v || "0") + ","; }
    else if (v.length < 6 && !(v.includes(",") && v.split(",")[1].length >= 1)) v = v === "0" ? k : v + k;
    set(v); rerender();
  },
  seau(el) { ui.draft.seauL = Math.max(1, Math.min(100, ui.draft.seauL + Number(el.dataset.k))); rerender(); },
  "chrono-go"() {
    ui.chronoDebut = Date.now(); ui.draft.chronoS = null; rerender();
    chronoTimer = setInterval(() => { const e = app.querySelector("[data-chrono]"); if (e) e.textContent = fChrono((Date.now() - ui.chronoDebut) / 1000); }, 100);
  },
  "chrono-stop"() { ui.draft.chronoS = Math.round((Date.now() - ui.chronoDebut) / 100) / 10; arreterChrono(); rerender(); },
  "chrono-raz"() { ui.draft.chronoS = null; rerender(); },
  passer() { arreterChrono(); oublierBrouillons(); allerSuivant(); },
  async "enregistrer-obs"() {
    arreterChrono();
    const { pointId, tourneeId } = ui.vue, dr = ui.draft, p = point(pointId);
    const debit = D.debitSeau(dr.seauL, dr.chronoS);
    const rec = { id: dr.obsId || dr.nouvelId, tourneeId, pointId, t: dr.t || Date.now(), etat: dr.etat, photos: dr.photos.slice(),
      hauteurCm: numDe(dr.hauteur), seauL: dr.chronoS ? dr.seauL : null, chronoS: dr.chronoS || null, debitLmin: debit,
      commentaire: dr.commentaire.trim() || null, lng: ui.gps ? +ui.gps[0].toFixed(6) : null, lat: ui.gps ? +ui.gps[1].toFixed(6) : null, gpsAcc: ui.gps ? Math.round(ui.gpsAcc) : null };
    if (dr.obsId) { const old = S.get("obs", dr.obsId); if (old) rec.updatedAt = old.updatedAt; }
    for (const id of dr.ajoutees) { const ph = await S.getPhoto(id); if (ph && rec.photos.some((x) => x.id === id)) await S.putPhoto({ ...ph, brouillon: false }); }
    await S.save("obs", rec, { silent: true });
    if (debit && p.seauL !== dr.seauL) await S.save("points", { ...p, seauL: dr.seauL }, { silent: true });
    toast(`${p.nom} : ${D.libEtat(p.type, rec.etat)}`);
    const t = S.get("tournees", tourneeId);
    if (dr.obsId || (t && t.terminee)) { ui.vue = t && t.terminee ? { k: "recap", tourneeId } : null; ui.draft = null; render(); return; }
    allerSuivant();
  },
  async arret() {
    suivreGPS();
    const frais = ui.gps && Date.now() - ui.gpsT < 60000 && ui.gpsAcc <= 30;
    if (frais) { await enregistrerArret(ui.gps, ui.gpsAcc); rerender(); return; }
    ui.vue = { k: "placement", but: "arret", pos: ui.gps ? ui.gps.slice() : null, retour: ui.vue };
    render();
  },
  async "suppr-arret"(el) { const id = el.dataset.id; ui.confirm = null; await S.remove("arrets", id); toast("Arrêt supprimé"); },
  "finir-tournee"() { const t = tourneeOuverte(); if (t) { ui.vue = { k: "recap", tourneeId: t.id }; window.scrollTo(0, 0); render(); } },
  async terminer(el) { const t = S.get("tournees", el.dataset.id); await S.save("tournees", { ...t, terminee: true, fin: Date.now() }); toast("Tournée terminée"); },
  async rouvrir(el) {
    if (tourneeOuverte()) { toast("Une autre tournée est déjà en cours."); return; }
    const t = S.get("tournees", el.dataset.id); await S.save("tournees", { ...t, terminee: false }); ui.vue = null; ui.tab = "tournee"; render();
  },
  "retour-tournee"() { ui.vue = null; ui.tab = "tournee"; render(); },
  "retour-tournees"() { ui.vue = null; ui.confirm = null; ui.tab = "tournee"; render(); },
  recap(el) { ui.vue = { k: "recap", tourneeId: el.dataset.id }; ui.confirm = null; window.scrollTo(0, 0); render(); },
  async "suppr-tournee"(el) {
    const id = el.dataset.id; ui.confirm = null;
    const lst = [{ entity: "tournees", rec: { ...S.get("tournees", id), deleted: true } }];
    for (const o of obs()) if (o.tourneeId === id) lst.push({ entity: "obs", rec: { ...o, deleted: true } });
    for (const a of arrets()) if (a.tourneeId === id) lst.push({ entity: "arrets", rec: { ...a, deleted: true } });
    ui.vue = null; ui.tab = "tournee";
    await S.saveMany(lst);
    toast("Tournée supprimée");
  },
  /* fiche point */
  "point-annuler"() { const r = ui.vue.retour; ui.vue = r && r.k !== "placement" ? r : null; ui.confirm = null; render(); },
  "p-type"(el) { ui.vue.draft.type = el.dataset.k; rerender(); },
  "p-gps"() { if (!ui.gps) return; const d = ui.vue.draft; d.lng = +ui.gps[0].toFixed(6); d.lat = +ui.gps[1].toFixed(6); if (d.altAuto) d.alt = D.altitude(GEO.mnt, d.lng, d.lat); rerender(); },
  "p-carte"() { const d = ui.vue.draft; ui.vue = { k: "placement", but: "deplacer", pos: d.lng ? [d.lng, d.lat] : null, retour: ui.vue }; render(); if (d.lng) M.centrer([d.lng, d.lat]); },
  "p-alt-auto"() { const d = ui.vue.draft; d.altAuto = true; d.alt = D.altitude(GEO.mnt, d.lng, d.lat); rerender(); },
  "p-mes"(el) { const m = ui.vue.draft.mesures, k = el.dataset.k, i = m.indexOf(k); if (i >= 0) m.splice(i, 1); else m.push(k); rerender(); },
  "p-actif"() { ui.vue.draft.actif = !ui.vue.draft.actif; rerender(); },
  async "point-ok"() {
    const v = ui.vue, d = v.draft;
    const base = v.id ? point(v.id) : { id: uid("p"), seauL: 10 };
    const rec = { ...base, nom: d.nom.trim(), type: d.type, lng: d.lng, lat: d.lat, alt: d.alt, altAuto: d.altAuto, mesures: d.mesures, actif: d.actif };
    const r = v.retour;
    ui.vue = r && r.k !== "placement" && r.k !== "point" ? r : null;
    if (!ui.vue && ui.tab === "carte") ui.fiche = rec.id;
    await S.save("points", rec);
    toast(v.id ? "Point enregistré" : "Point créé : " + rec.nom);
  },
  async "p-suppr"() { const id = ui.vue.id; ui.vue = null; ui.confirm = null; ui.fiche = null; await S.remove("points", id); toast("Point supprimé"); },
  /* pluie */
  "pl-vide"() { ui.pluie.vide = !ui.pluie.vide; rerender(); },
  async "pl-ok"() {
    const pl = ui.pluie, lect = numDe(pl.lecture); if (lect === null) return;
    const t = new Date(pl.quand).getTime() || Date.now();
    const base = pl.editId ? S.get("pluies", pl.editId) : { id: uid("pl") };
    const rec = { ...base, t, lecture: lect, vide: pl.vide };
    nouvellePluie();
    await S.save("pluies", rec);
    toast(`Relevé enregistré : ${fNum(lect)} mm`);
  },
  "pl-edit"(el) { const r = S.get("pluies", el.dataset.id); ui.pluie = { lecture: String(r.lecture).replace(".", ","), quand: toLocalInput(r.t), vide: r.vide, editId: r.id }; ui.confirm = null; window.scrollTo(0, 0); render(); },
  "pl-annuler"() { nouvellePluie(); ui.confirm = null; render(); },
  async "pl-suppr"() { const id = ui.pluie.editId; nouvellePluie(); ui.confirm = null; await S.remove("pluies", id); toast("Relevé supprimé"); },
  /* forage */
  async "fo-ok"() {
    const f = ui.forage, deb = numDe(f.debut), fin = numDe(f.fin);
    if (D.volumeForage(deb, fin) === null) return;
    const t = new Date(f.quand).getTime() || Date.now();
    const base = f.editId ? S.get("forages", f.editId) : { id: uid("fo") };
    const rec = { ...base, t, indexDebut: deb, indexFin: fin, commentaire: f.commentaire.trim() || null };
    nouveauForage();
    await S.save("forages", rec);
    toast(`Test enregistré : ${fVol(D.volumeForage(deb, fin))}`);
  },
  "fo-edit"(el) { const r = S.get("forages", el.dataset.id); ui.forage = { quand: toLocalInput(r.t), debut: dec(r.indexDebut), fin: dec(r.indexFin), commentaire: r.commentaire || "", editId: r.id }; ui.confirm = null; window.scrollTo(0, 0); render(); },
  "fo-annuler"() { nouveauForage(); ui.confirm = null; render(); },
  async "fo-suppr"() { const id = ui.forage.editId; nouveauForage(); ui.confirm = null; await S.remove("forages", id); toast("Test supprimé"); },
  /* photos */
  "photo-voir"(el) { voirPhoto(el.dataset.id); },
  "photo-suppr"(el) {
    const id = el.dataset.id, dr = ui.draft;
    dr.photos = dr.photos.filter((x) => x.id !== id);
    if (dr.ajoutees.includes(id)) { dr.ajoutees = dr.ajoutees.filter((x) => x !== id); S.delPhoto(id); }
    rerender();
  },
  /* plus */
  async sauver() {
    const data = {}; for (const e of S.ENTITIES) data[e] = S.DATA[e];
    telecharger(`eau-de-la-ferme_sauvegarde_${D.jourISO(Date.now())}.json`, JSON.stringify({ app: "eau-de-la-ferme", version: VERSION, exporte: new Date().toISOString(), data }), "application/json");
    await S.setMeta("derniereSauvegarde", Date.now()); majSauvegarde();
  },
  csv(el) { exportCSV(el.dataset.k); },
  "sync-ouvrir"() { ui.syncForm = null; rerender(); ui.syncForm.ouvert = true; rerender(); },
  "sync-fermer"() { ui.syncForm = null; rerender(); },
  async "sync-test"() {
    const f = ui.syncForm; f.msg = "Test en cours…"; f.ok = null; rerender();
    const r = await Y.testSync(f.url.trim(), f.secret.trim()); f.msg = r.msg; f.ok = r.ok; rerender();
  },
  async "sync-ok"() {
    const f = ui.syncForm;
    if (!f.url.trim() || !f.secret.trim()) { f.msg = "Adresse et secret sont nécessaires."; f.ok = false; rerender(); return; }
    await Y.setSyncConfig(f.url, f.secret);
    ui.syncForm = null; rerender();
    const r = await Y.syncNow({ full: true });
    toast(r.ok ? "Synchronisation réussie" : "Synchronisation : " + r.reason);
  },
  async "sync-go"() { const r = await Y.syncNow(); toast(r.ok ? "Synchronisé" + (r.received ? " · " + r.received + " reçu" + (r.received > 1 ? "s" : "") : "") : r.reason === "busy" ? "Synchro déjà en cours" : "Échec : " + r.reason); },
  async "sync-renvoyer"() { ui.confirm = null; rerender(); const r = await Y.toutRenvoyer(); toast(r.ok ? "Tout a été renvoyé au tableur" : "Échec : " + r.reason); },
  async theme(el) { ui.theme = el.dataset.k; await S.setMeta("theme", ui.theme); appliquerTheme(); rerender(); },
};
function arreterChrono() { if (chronoTimer) { clearInterval(chronoTimer); chronoTimer = null; } ui.chronoDebut = null; }
function allerSuivant() {
  const { tourneeId, pointId } = ui.vue;
  const ordre = D.ordreTournee(points()), faits = D.obsDeTournee(obs(), tourneeId);
  const suiv = D.pointSuivant(ordre, new Set(faits.keys()), pointId);
  if (suiv) ouvrirSaisie(suiv.id, tourneeId);
  else { ui.vue = { k: "recap", tourneeId }; ui.draft = null; window.scrollTo(0, 0); render(); }
}
async function majSauvegarde() {
  const el = app.querySelector("[data-sauv]"); if (!el) return;
  const t = await S.getMeta("derniereSauvegarde");
  el.textContent = "Dernière sauvegarde exportée : " + (t ? fJour(t, true) + " (" + ilYa(t) + ")" : "jamais");
}

/* ---------- forage ---------- */
function nouveauForage() { ui.forage = { quand: toLocalInput(Date.now()), debut: "", fin: "", commentaire: "", editId: null }; }
function fVol(v) { return v === null || v === undefined ? "—" : fNum(v, 2) + " m³ (" + Math.round(v * 1000).toLocaleString("fr-FR") + " L)"; }
/* Chaque test avec les eaux de surface et la pluie des 30 jours qui le précèdent. */
function lignesForage() {
  const journal = D.pluieJournaliere(S.live("pluies")), avecPluie = S.live("pluies").length > 0;
  return D.testsCalcules(S.live("forages")).map((c) => {
    const j = D.jourISO(c.t);
    return { ...c, mares: D.indiceSurface(points(), obs(), c.t, "mare"), ruisseaux: D.indiceSurface(points(), obs(), c.t, "eau"),
      pluie30: avecPluie ? D.cumul(journal, D.jourPlus(j, -30), D.jourPlus(j, -1)) : null };
  });
}
function vueForage() {
  if (!ui.forage) nouveauForage();
  const f = ui.forage, lignes = lignesForage();
  const tQ = new Date(f.quand).getTime();
  const prec = lignes.filter((x) => x.id !== f.editId && x.t < tQ).slice(-1)[0];
  const reposH = prec ? (tQ - prec.t) / 36e5 : null;
  const vols = lignes.map((c) => c.volume).filter((v) => v !== null);
  const dern = lignes.slice(-1)[0];
  return `<main class="screen">
    <h1>${f.editId ? "Corriger un test" : "Test du forage"}</h1>${voyant()}
    <p class="sub">On tire l'eau jusqu'à ce qu'elle s'épuise d'elle-même, puis on lit le compteur. Au moins ${D.REPOS_MIN_H} h entre deux tests.</p>
    <label class="champ"><span>Date et heure du test</span><input type="datetime-local" data-in="fo-quand" value="${f.quand}"></label>
    ${prec ? `<p class="sub ${reposH < D.REPOS_MIN_H ? "err-t" : ""}">Test précédent : ${fJour(prec.t)} à ${fHeure(prec.t)}, il y a ${fNum(reposH, 0)} h${reposH < D.REPOS_MIN_H ? ` — <b>moins de ${D.REPOS_MIN_H} h de repos</b> : le forage n'a peut-être pas fini de se recharger.` : "."}${prec.indexFin !== null && prec.indexFin !== undefined ? ` Dernier index lu : ${fNum(prec.indexFin, 3)} m³.` : ""}</p>` : `<p class="sub">Premier test.</p>`}
    <div class="grille2">
      <label class="champ"><span>Index au début (m³)</span><input type="text" inputmode="decimal" data-in="fo-debut" value="${esc(f.debut)}" placeholder="ex. 1234,567" autocomplete="off"></label>
      <label class="champ"><span>Index à la fin (m³)</span><input type="text" inputmode="decimal" data-in="fo-fin" value="${esc(f.fin)}" placeholder="quand l'eau s'arrête" autocomplete="off"></label>
    </div>
    <div class="resultat" data-fo-vol>${forageCalc()}</div>
    <label class="champ"><span>Commentaire <span class="facult">facultatif</span></span><textarea rows="2" data-in="fo-com" placeholder="Usage de l'eau, incident…">${esc(f.commentaire)}</textarea></label>
    <div class="row2">
      ${f.editId ? btn("fo-annuler", "Annuler") : ""}
      <button type="button" class="btn primary big grow" data-a="fo-ok" ${D.volumeForage(numDe(f.debut), numDe(f.fin)) === null ? "disabled" : ""}>Enregistrer</button>
    </div>
    ${f.editId ? confirmBtn("forage:" + f.editId, "fo-suppr", "Supprimer ce test", "Confirmer la suppression", "") : ""}
    <h2>Résumé</h2>
    <div class="tuiles3">
      <div class="tuile"><span>Dernier test</span><b>${dern && dern.volume !== null ? fNum(dern.volume, 2) : "—"}</b><small>m³</small></div>
      <div class="tuile"><span>Moyenne</span><b>${vols.length ? fNum(vols.reduce((a, b) => a + b, 0) / vols.length, 2) : "—"}</b><small>m³</small></div>
      <div class="tuile"><span>Tests</span><b>${lignes.length}</b></div>
    </div>
    <h2>Volume et eaux de surface</h2>
    <p class="sub">Peut-on se passer d'une sonde ? Si le volume disponible suit l'état des mares et des ruisseaux, les deux courbes évoluent ensemble. État de surface = moyenne du dernier relevé de chaque point, de moins de ${D.AGE_MAX_J} jours avant le test (0 = à sec, 4 = débordement).</p>
    ${grapheForage(lignes)}
    <h2>Tests</h2>
    ${lignes.length ? `<ul class="liste">${lignes.slice().reverse().map((c) => `<li><button type="button" class="ligne" data-a="fo-edit" data-id="${c.id}">
      <span class="grow"><b>${fJour(c.t)} · ${fHeure(c.t)}</b><span class="sub">${c.reposH !== null ? "Repos " + fNum(c.reposH, 0) + " h" + (c.reposCourt ? " (court)" : "") + " · " : ""}Mares ${c.mares.moy !== null ? fNum(c.mares.moy) + "/4" : "—"} · Ruisseaux ${c.ruisseaux.moy !== null ? fNum(c.ruisseaux.moy) + "/4" : "—"}${c.pluie30 !== null ? " · Pluie 30 j " + fNum(c.pluie30) + " mm" : ""}${c.commentaire ? " · « " + esc(c.commentaire) + " »" : ""}</span></span>
      <b class="mm">${c.volume !== null ? fNum(c.volume, 2) + " m³" : "—"}</b></button></li>`).join("")}</ul>` : `<p class="sub">Aucun test enregistré.</p>`}
  </main>`;
}
function forageCalc() {
  const f = ui.forage, deb = numDe(f.debut), fin = numDe(f.fin);
  if (deb === null || fin === null) return "Volume tiré : —";
  if (fin < deb) return `<span class="err-t">L'index de fin est plus petit que celui du début.</span>`;
  return `Volume tiré : <b>${fVol(D.volumeForage(deb, fin))}</b>`;
}
function majForageCalc() {
  const el = app.querySelector("[data-fo-vol]"); if (el) el.innerHTML = forageCalc();
  const b = app.querySelector('[data-a="fo-ok"]'); if (b) b.disabled = D.volumeForage(numDe(ui.forage.debut), numDe(ui.forage.fin)) === null;
}
function grapheForage(lignes) {
  const L = lignes.filter((c) => c.volume !== null);
  if (L.length < 2) return `<p class="sub">Le graphique apparaîtra à partir de deux tests.</p>`;
  const W = 360, H = 150, g = 30, d = 22, haut = 12, bas = H - 4;
  const t0 = L[0].t, t1 = L[L.length - 1].t;
  const x = (t) => g + ((t - t0) / (t1 - t0 || 1)) * (W - g - d);
  const vmax = Math.max(...L.map((c) => c.volume)) * 1.1 || 1;
  const yv = (v) => bas - (v / vmax) * (bas - haut), ye = (e) => bas - (e / 4) * (bas - haut);
  let s = `<svg class="graphe" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Volume tiré au forage et état des eaux de surface">`;
  for (const e of [0, 2, 4]) s += `<line x1="${g}" x2="${W - d}" y1="${ye(e)}" y2="${ye(e)}" class="g-grille"/><text x="${W - d + 4}" y="${ye(e) + 3}" class="g-t">${e}</text>`;
  s += `<text x="${g - 4}" y="${haut + 3}" text-anchor="end" class="g-t">${fNum(vmax / 1.1, 1)}</text><text x="${g - 4}" y="${bas}" text-anchor="end" class="g-t">0</text><text x="2" y="${H + 14}" class="g-t">m³</text>`;
  for (const c of L) s += `<rect x="${x(c.t) - 4}" y="${yv(c.volume)}" width="8" height="${bas - yv(c.volume)}" class="b-mes"><title>${fJour(c.t)} : ${fNum(c.volume, 2)} m³</title></rect>`;
  for (const [cle, cls] of [["mares", "g-mares"], ["ruisseaux", "g-ruis"]]) {
    const pts = L.filter((c) => c[cle].moy !== null).map((c) => [x(c.t), ye(c[cle].moy)]);
    if (pts.length > 1) s += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" class="${cls}" fill="none"/>`;
    for (const p of pts) s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="${cls} pt"/>`;
  }
  s += `<text x="${g}" y="${H + 14}" class="g-t">${fJour(t0)}</text><text x="${W - d}" y="${H + 14}" text-anchor="end" class="g-t">${fJour(t1)}</text></svg>`;
  return s + `<div class="leg-l"><i class="b-mes"></i>Volume tiré (m³) <i class="l-mares"></i>État des mares (0–4) <i class="l-ruis"></i>État des ruisseaux (0–4)</div>`;
}

/* ---------- photos ---------- */
const photoURLs = new Map();
async function reduirePhoto(file, max = 1600, q = 0.8) {
  let src, w, h;
  try { src = await createImageBitmap(file); w = src.width; h = src.height; }
  catch (_) { const img = new Image(); img.src = URL.createObjectURL(file); await img.decode(); src = img; w = img.naturalWidth; h = img.naturalHeight; }
  const k = Math.min(1, max / Math.max(w, h)), c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("photo illisible")), "image/jpeg", q));
}
async function ajouterPhoto(file) {
  const v = ui.vue, dr = ui.draft; if (v?.k !== "saisie" || !dr) return;
  ui.photoEnCours = true; rerender();
  try {
    const blob = await reduirePhoto(file), p = point(v.pointId) || {};
    const id = uid("ph"), obsId = dr.obsId || dr.nouvelId;
    const nom = D.jourISO(Date.now()) + "_" + String(p.nom || "point").normalize("NFD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-") + "_" + id + ".jpg";
    await S.putPhoto({ id, obsId, nom, blob, t: Date.now(), envoye: false, brouillon: true });
    if (ui.draft === dr) { dr.photos.push({ id, driveId: null, url: null }); dr.ajoutees.push(id); }
    toast("Photo ajoutée (" + Math.round(blob.size / 1024) + " Ko)");
  } catch (err) { toast("Photo impossible : " + err.message); }
  ui.photoEnCours = false; rerender();
}
function oublierBrouillons() { const dr = ui.draft; if (dr?.ajoutees) for (const id of dr.ajoutees) S.delPhoto(id); }
function vignettes(liste, modifiable) {
  if (!liste?.length) return "";
  return `<div class="vignettes">${liste.map((ph) => `<div class="vig"><button type="button" class="vig-b" data-a="photo-voir" data-id="${ph.id}" aria-label="Voir la photo"><img alt="" data-ph="${ph.id}"><span>${ph.url ? "Drive" : "en attente"}</span></button>
    ${modifiable ? `<button type="button" class="vig-x" data-a="photo-suppr" data-id="${ph.id}" aria-label="Retirer la photo">✕</button>` : ""}</div>`).join("")}</div>`;
}
async function urlPhoto(id) {
  if (photoURLs.has(id)) return photoURLs.get(id);
  const ph = await S.getPhoto(id).catch(() => null);
  const u = ph?.blob ? URL.createObjectURL(ph.blob) : null;
  photoURLs.set(id, u); return u;
}
async function chargerVignettes() {
  for (const img of app.querySelectorAll("img[data-ph]")) {
    const u = await urlPhoto(img.dataset.ph);
    if (u) img.src = u; else img.closest(".vig-b")?.classList.add("distante");
  }
}
function trouverLienPhoto(id) {
  for (const o of S.DATA.obs) for (const x of o.photos || []) if (x.id === id) return x;
  return ui.draft?.photos?.find((x) => x.id === id) || null;
}
async function voirPhoto(id) {
  const u = await urlPhoto(id), lien = trouverLienPhoto(id);
  if (!u && lien?.url) { window.open(lien.url, "_blank", "noopener"); return; }
  if (!u) { toast("Photo pas encore arrivée sur cet appareil."); return; }
  const el = document.createElement("div");
  el.className = "photo-plein"; el.setAttribute("role", "dialog");
  el.innerHTML = `<img src="${u}" alt="Photo du relevé"><div class="row2">${lien?.url ? `<a class="btn" href="${esc(lien.url)}" target="_blank" rel="noopener">Ouvrir dans Drive</a>` : ""}<button type="button" class="btn primary">Fermer</button></div>`;
  el.addEventListener("click", (e) => { if (e.target.tagName !== "A") el.remove(); });
  document.body.appendChild(el);
}

/* ---------- événements ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || el.disabled || !app.contains(el)) return;
  const a = el.dataset.a;
  if (a !== "ask-confirm" && ui.confirm && !el.classList.contains("danger-plein")) ui.confirm = null;
  const fn = A[a];
  if (fn) Promise.resolve(fn(el)).catch((err) => { console.error(err); toast("Erreur : " + err.message); });
});
document.addEventListener("input", (e) => {
  const k = e.target.dataset?.in; if (!k) return;
  if (k === "commentaire") ui.draft.commentaire = e.target.value;
  else if (k === "p-nom") { ui.vue.draft.nom = e.target.value; const b = app.querySelector('[data-a="point-ok"]'); if (b) b.disabled = !(e.target.value.trim() && ui.vue.draft.lng); }
  else if (k === "p-alt") { ui.vue.draft.alt = numDe(e.target.value); ui.vue.draft.altAuto = false; }
  else if (k === "sync-url") ui.syncForm.url = e.target.value;
  else if (k === "sync-secret") ui.syncForm.secret = e.target.value;
  else if (k === "fo-debut") { ui.forage.debut = e.target.value; majForageCalc(); }
  else if (k === "fo-fin") { ui.forage.fin = e.target.value; majForageCalc(); }
  else if (k === "fo-com") ui.forage.commentaire = e.target.value;
});
document.addEventListener("change", async (e) => {
  const k = e.target.dataset?.in; if (!k) return;
  if (k === "pl-quand") { ui.pluie.quand = e.target.value; rerender(); }
  else if (k === "fo-quand") { ui.forage.quand = e.target.value; rerender(); }
  else if (k === "photo") { const f = e.target.files[0]; e.target.value = ""; if (f) await ajouterPhoto(f); }
  else if (k === "p-alt") rerender();
  else if (k === "restaurer") {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== "eau-de-la-ferme" || !j.data) throw new Error("ce fichier n'est pas une sauvegarde de cette appli");
      await S.replaceAll(j.data);
      toast("Sauvegarde restaurée (" + (j.data.points || []).length + " points)");
    } catch (err) { toast("Restauration impossible : " + err.message); }
  }
});

/* ---------- thème ---------- */
const mq = window.matchMedia("(prefers-color-scheme: dark)");
function appliquerTheme() {
  const t = ui.theme === "auto" ? (mq.matches ? "dark" : "light") : ui.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#1a1816" : "#f5ead8");
}
mq.addEventListener?.("change", appliquerTheme);

/* ---------- démarrage ---------- */
async function demarrer() {
  try {
    const [mnt, mares, ruisseaux] = await Promise.all(["mnt", "mares", "ruisseaux"].map((n) => fetch("data/" + n + ".json").then((r) => r.json())));
    GEO = { mnt, mares, ruisseaux };
    MORCEAUX = D.decouperLignes(ruisseaux, 5);
    await S.openDB();
    let dev = await S.getMeta("device"); if (!dev) { dev = uid("dev"); await S.setMeta("device", dev); }
    S.setDevice(dev);
    await S.loadAll();
    if (!(await S.getMeta("initialise")) && !S.DATA.points.length) {
      /* horodatage 1 : sur un 2e appareil, la version du tableur (renommage, type…) l'emporte sur ces points de départ */
      await S.saveMany(D.pointsDepuisMares(mares, mnt).map((rec) => ({ entity: "points", rec: { ...rec, updatedAt: 1 } })), { keepTime: true });
      await S.setMeta("initialise", Date.now());
    }
    ui.theme = await S.getMeta("theme", "auto");
    appliquerTheme();
    if (tourneeOuverte()) { ui.tab = "tournee"; suivreGPS(); }
    navigator.storage?.persist?.().catch(() => {});
    S.onChange((info) => { if (info.local) Y.scheduleSync(); if (!info.silent) rerender(); });
    Y.onSync(majVoyants);
    render();
    await Y.initSync();
    const essai = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (essai && "serviceWorker" in navigator) {
      /* serveur de test : pas de copie hors ligne, chaque rechargement prend la dernière version du code */
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    } else if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
      let rechargee = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!rechargee && !ui.vue) { rechargee = true; location.reload(); } });
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main class="screen"><h1>Eau de la ferme</h1><div class="card info">Démarrage impossible : ${esc(err.message)}</div></main>`;
  }
}
demarrer();
// rafraîchit la date de dernière sauvegarde quand l'écran Plus est affiché
new MutationObserver(() => { if (ui.tab === "plus" && !ui.vue) majSauvegarde(); }).observe(app, { childList: true });
