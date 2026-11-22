/* Écrans : fonctions qui renvoient du HTML à partir de l'état (S) et des données calculées (C).
   Les interactions passent par data-a="action" (clic) et data-in="champ" (saisie), gérés dans app.js. */
import { esc, fmtShort, fmtLong, fmtNum, daysBetween, addDays, MOIS, MOIS_COURT, plural, normText, parseISO } from "./util.js";
import { GEO, padLabel, parcelLabel } from "./geo.js";
import { OUT, lotTimeline, lotLocation, restClass, lotUGB, compForDate, ugbOf, padHistory } from "./domain.js";
import { mapHTML } from "./mapsvg.js";
import { icon } from "./icons.js";
import { LOT_COLORS } from "./migrate.js";

const lotOf = (C, id) => C.D.lots.find((l) => l.id === id) || null;
const dot = (color) => `<span class="dot" style="background:${esc(color)}"></span>`;
const ugbTxt = (u) => (u > 0 ? fmtNum(u, 1) + " UGB" : "UGB non renseignés");
const CLS_BADGE = { ready: "b-ready", never: "b-never", soon: "b-soon", early: "b-early", occ: "b-occ" };
const dayChoices = (today) => [["Aujourd’hui", today], ["Hier", addDays(today, -1)], ["Avant-hier", addDays(today, -2)]];
function dateWords(d, today) {
  if (d === today) return "aujourd’hui";
  if (d === addDays(today, -1)) return "hier";
  if (d === addDays(today, -2)) return "avant-hier";
  return "le " + fmtShort(d, d.slice(0, 4) !== today.slice(0, 4));
}
function statusText(st, target) {
  if (!st || st.status === "never") return "Jamais pâturé";
  if (st.status === "occ") return "Occupé";
  return "Repos " + st.rest + " j" + (st.rest >= target ? "" : "");
}
function dateChips(C, current, actPrefix) {
  const custom = !dayChoices(C.today).some((d) => d[1] === current);
  return `<div class="chips fill" style="margin-top:10px">` +
    dayChoices(C.today).map(([t, d]) => `<button type="button" class="chip${current === d ? " on" : ""}" data-a="${actPrefix}-day" data-d="${d}">${t}</button>`).join("") +
    `<button type="button" class="chip${custom ? " on" : ""}" style="flex:0 0 auto;min-width:48px;padding:0 ${custom ? "10px" : "0"};font-size:14px" data-a="${actPrefix}-cal" aria-label="Choisir une autre date">${icon("cal", 20)}${custom ? esc(fmtShort(current)) : ""}</button></div>`;
}

/* =================== ACCUEIL =================== */
export function viewHome(S, C) {
  const syncTxt = { ok: "À jour", pending: C.sync.pending + " en attente", offline: "Hors ligne" + (C.sync.pending ? " · " + C.sync.pending : ""), error: "Erreur synchro", off: "Synchro non réglée" }[C.sync.state] || "";
  let h = `<div class="screen"><div class="spread"><div><h1>Troupeaux</h1><div class="sub">${esc(fmtLong(C.today))}</div></div>
    <button type="button" class="pill ${C.sync.busy ? "pending" : C.sync.state}" data-a="go-sync" aria-label="État de la synchronisation"><span class="led"></span>${C.sync.busy ? "Synchro…" : esc(syncTxt)}</button></div>`;

  if (C.v8Available && !C.D.moves.length && C.sync.state === "off") {
    h += `<div class="card" style="margin-top:16px"><b>Données de l’ancienne version trouvées sur cet appareil.</b><div class="small muted" style="margin-top:4px">Troupeaux, compositions, mouvements et foin seront convertis. Vos données v8 restent intactes.</div>
      <button type="button" class="btn primary block" style="margin-top:10px" data-a="import-v8-local">Importer les données v8</button></div>`;
  }
  const lots = C.D.lots.filter((l) => !l.archived);
  if (!lots.length) {
    h += `<div class="card" style="margin-top:16px"><b>Aucun troupeau.</b><div class="small muted" style="margin-top:4px">Créez un troupeau, ou importez vos données (Plus → Exports et sauvegarde → Restaurer).</div>
      <button type="button" class="btn primary block" style="margin-top:10px" data-a="lot-new">${icon("plus", 20)} Créer un troupeau</button></div>`;
  }
  /* Tuiles en 2 colonnes : hors-paddock d'abord (ce sont eux qui reçoivent le foin).
     Toucher la tuile ouvre la fiche du troupeau ; Foin = 1 appui = 1 round-baller aujourd'hui. */
  const info = lots.map((l) => ({ l, loc: lotLocation(C.D.moves, l.id, C.today) }));
  const rank = (x) => (!x.loc ? 2 : x.loc.loc === OUT ? 0 : 1);
  info.sort((a, b) => rank(a) - rank(b));
  h += `<div class="tiles">`;
  for (const { l, loc } of info) {
    const days = loc ? daysBetween(loc.since, C.today) : 0;
    const inPad = loc && loc.loc !== OUT;
    const where = !loc ? "Pas encore placé" : loc.loc === OUT ? "Hors-paddock" : padLabel(loc.loc);
    const long = inPad && days >= C.settings.longStay;
    const since = (loc ? (days === 0 ? "aujourd’hui" : days + " j") + " · " : "") + ugbTxt(lotUGB(C.D, l.id, C.today));
    const n = C.D.foins.filter((f) => f.lotId === l.id && f.date === C.today).length;
    h += `<div class="tile" style="border-top-color:${esc(l.color)}">
      <button type="button" class="tile-main" data-a="lot-open" data-lot="${esc(l.id)}" data-back="home" aria-label="Fiche du troupeau ${esc(l.name)}">
        <span class="tile-name">${esc(l.name)}</span>
        <span class="tile-where">${esc(where)}</span>
        <span class="tile-since${long ? " long" : ""}">${esc(since)}</span>
      </button>
      <div class="tile-actions">
        <button type="button" class="btn primary" data-a="move-start" data-lot="${esc(l.id)}">Déplacer</button>
        <button type="button" class="btn hay" data-a="foin-quick" data-lot="${esc(l.id)}">Foin${n ? `<span class="cnt">${n}</span>` : ""}</button>
      </div></div>`;
  }
  h += `</div>`;
  if (lots.length) {
    const ready = GEO.pads.filter((p) => { const c = restClass(C.status[p.id], C.settings.restTarget); return c === "ready" || c === "never"; }).length;
    h += `<button type="button" class="card linkcard" style="margin-top:12px" data-a="go-carte"><span class="ico">${icon("sprout", 24)}</span><span class="txt"><span class="t1">${ready} paddocks prêts</span><span class="t2">Repos ≥ ${C.settings.restTarget} j ou jamais pâturés</span></span>${icon("next", 20, 'style="color:var(--muted)"')}</button>`;
  }
  /* Dernières saisies (corrections rapides) */
  const recent = C.D.moves.map((m) => ({ k: "m", r: m })).concat(C.D.foins.map((f) => ({ k: "f", r: f })))
    .sort((a, b) => (b.r.updatedAt || 0) - (a.r.updatedAt || 0)).slice(0, 5);
  if (recent.length) {
    h += `<h2>Dernières saisies</h2><div class="list">`;
    for (const it of recent) {
      const lot = lotOf(C, it.r.lotId);
      const t1 = it.k === "m" ? (lot ? lot.name : "?") + " → " + padLabel(it.r.to) : (it.r.type === "enrubanne" ? "Enrubanné" : "Foin") + " · " + (lot ? lot.name : "?");
      h += `<button type="button" class="li" data-a="${it.k === "m" ? "edit-move" : "edit-foin"}" data-id="${esc(it.r.id)}"><span class="grow"><span class="t1">${esc(t1)}</span><span class="t2">${esc(fmtLong(it.r.date))}${it.k === "f" ? " · fauche " + esc(it.r.year) : ""}</span></span><span class="small muted">Corriger</span></button>`;
    }
    h += `</div>`;
  }
  if (C.backupHint) h += `<div class="notice warn" style="margin-top:12px">${esc(C.backupHint)}</div>`;
  return h + `</div>`;
}

/* =================== DÉPLACER =================== */
/* hauteur de carte : pas plus haute que nécessaire (la ferme est presque carrée) */
const mapMaxH = () => Math.round(Math.max(280, Math.min(window.innerWidth, 760) - 32) * 1.2);
export const moveMapH = () => Math.max(300, Math.min(560, mapMaxH(), window.innerHeight - 330));
export const carteMapH = () => Math.max(320, Math.min(560, mapMaxH(), window.innerHeight - 300));

export function viewMove(S, C) {
  const M = S.move, lot = lotOf(C, M.lotId);
  if (!lot) return `<div class="screen">Troupeau introuvable.</div>`;
  const target = C.settings.restTarget;
  const cur = lotLocation(C.D.moves, lot.id, C.today);
  const curPad = cur && cur.loc !== OUT ? cur.loc : null;
  const st = C.statusAt(C.today);
  let h = `<div class="topbar"><div class="row" style="flex-wrap:nowrap;gap:4px"><button type="button" class="iconbtn" data-a="move-cancel" aria-label="Retour">${icon("back", 24)}</button>
    <div style="min-width:0;flex:1 1 auto"><div class="ttl">Déplacer ${esc(lot.name)}</div>
    <div class="sub small">${cur ? (cur.loc === OUT ? "Hors-paddock depuis le " + esc(fmtShort(cur.since)) : "Actuellement : " + esc(padLabel(cur.loc)) + " · " + daysBetween(cur.since, C.today) + " j") : "Pas encore placé"}</div></div></div>
    <div class="seg" style="margin-top:10px"><button type="button" class="${M.view === "map" ? "on" : ""}" data-a="move-view" data-v="map">Carte</button><button type="button" class="${M.view === "list" ? "on" : ""}" data-a="move-view" data-v="list">Liste</button></div></div>`;
  h += `<div class="screen">`;
  if (curPad) {
    h += `<button type="button" class="pick dashed" style="margin-bottom:12px" data-a="move-pick" data-id="${OUT}">${icon("shelter", 26, 'style="color:var(--muted)"')}<span class="grow"><span class="t1">Hors-paddock</span><span class="t2">Piste, stabulation… · ferme le séjour en cours</span></span></button>`;
  }
  if (M.view === "map") {
    h += `<div class="small muted" style="margin-bottom:8px">Pincez pour zoomer · touchez le paddock de destination</div>`;
    h += mapHTML({
      ctx: "mv", vb: M.vb, selId: null, height: moveMapH(),
      look: (id) => ({ cls: restClass(st[id], target), title: padLabel(id) + " — " + statusText(st[id], target) }),
      markers: C.markersAt(C.today), showNames: true
    });
    h += legendHTML(target);
  } else {
    const q = normText(M.q);
    h += `<label class="sr" for="padSearch">Rechercher un paddock</label><input id="padSearch" class="input" type="search" data-in="move-q" value="${esc(M.q)}" placeholder="N° ou parcelle (ex. 41, Saulaie)" autocomplete="off">`;
    const cands = GEO.pads.filter((p) => {
      if (st[p.id] && st[p.id].occupants.length) return false;
      if (!q) return true;
      return p.num === q || normText(parcelLabel(p.parcel) + " " + p.num).includes(q);
    });
    const restOf = (p) => (st[p.id] && st[p.id].status === "rest" ? st[p.id].rest : -1);
    const curParcel = curPad ? GEO.byId[curPad].parcel : null;
    const key = (p) => (p.parcel === curParcel ? 0 : 1) * 1e6 - (restOf(p) === -1 ? target : restOf(p) + 0.5);
    const ready = cands.filter((p) => restOf(p) === -1 || restOf(p) >= target).sort((a, b) => key(a) - key(b));
    const resting = cands.filter((p) => restOf(p) !== -1 && restOf(p) < target).sort((a, b) => restOf(b) - restOf(a));
    const all = M.showAll || q;
    const row = (p) => {
      const r = restOf(p), c = restClass(st[p.id], target);
      return `<button type="button" class="pick" data-a="move-pick" data-id="${esc(p.id)}"><span class="grow"><span class="t1">${esc(padLabel(p.id))}</span><span class="t2">${fmtNum(p.area, 2)} ha${p.parcel === curParcel ? " · même parcelle" : ""}</span></span><span class="badge ${CLS_BADGE[c]}">${r === -1 ? "Jamais pâturé" : "Repos " + r + " j"}</span></button>`;
    };
    h += `<div class="spread" style="margin:18px 2px 8px;align-items:baseline"><b>Prêts</b><span class="small muted">${ready.length} paddocks · même parcelle d’abord</span></div><div class="stack" style="gap:8px">${(all ? ready : ready.slice(0, 10)).map(row).join("") || '<div class="notice">Aucun.</div>'}</div>`;
    h += `<div class="spread" style="margin:20px 2px 8px;align-items:baseline"><b>Encore en repos</b><span class="small muted">${resting.length} paddocks</span></div><div class="stack" style="gap:8px">${(all ? resting : resting.slice(0, 5)).map(row).join("") || '<div class="notice">Aucun.</div>'}</div>`;
    if (!all && (ready.length > 10 || resting.length > 5)) h += `<button type="button" class="btn block" style="margin-top:12px" data-a="move-all">Afficher tous les paddocks</button>`;
  }
  return h + `</div>`;
}

/* Panneau de validation d'un déplacement (commun à l'écran Déplacer et à l'onglet Carte) */
function moveConfirmBody(sh, C) {
  const lot = lotOf(C, sh.lotId), target = C.settings.restTarget;
  if (!lot) return "Troupeau introuvable.";
  const cur = lotLocation(C.D.moves, lot.id, sh.date);
  const st = C.statusAt(sh.date);
  const warns = [];
  let dest;
  if (sh.to === OUT) dest = "Hors-paddock (piste, stabulation…)";
  else {
    const s = st[sh.to], others = s ? s.occupants.filter((x) => x !== lot.id) : [];
    dest = padLabel(sh.to) + " · " + fmtNum(GEO.byId[sh.to].area, 2) + " ha";
    if (others.length) warns.push("Déjà occupé par " + others.map((id) => (lotOf(C, id) || { name: id }).name).join(", "));
    else if (s && s.status === "rest" && s.rest < target) warns.push("Repos " + s.rest + " j — objectif " + target + " j");
    else if (s && s.status === "never") warns.push(""); // pas d'alerte
  }
  if (cur && cur.loc === sh.to) warns.push(sh.to === OUT ? "Le troupeau est déjà hors-paddock à cette date." : "Le troupeau est déjà dans ce paddock à cette date.");
  const lastMove = C.D.moves.filter((m) => m.lotId === lot.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (lastMove && sh.date < lastMove.date) warns.push("Date antérieure au dernier déplacement (" + fmtShort(lastMove.date) + ") : la saisie s’insérera dans l’historique.");
  return `<div class="row" style="flex-wrap:nowrap">${dot(lot.color)}<div class="ttl">${sh.to === OUT ? "Sortir" : "Déplacer"} ${esc(lot.name)}</div></div>
    <div class="small muted" style="margin-top:4px">${cur ? (cur.loc === OUT ? "Actuellement hors-paddock" : "Actuellement : " + esc(padLabel(cur.loc))) : "Pas encore placé"}</div>
    <div class="small muted" style="margin-top:12px">Destination</div><div style="font-size:19px;font-weight:700">${esc(dest)}</div>
    ${sh.to === OUT ? "" : padHistHTML(C, sh.to, sh.date)}
    ${warns.filter(Boolean).map((w) => `<div class="warnline">${icon("warn", 18)}${esc(w)}</div>`).join("")}
    ${dateChips(C, sh.date, "mc")}
    <button type="button" class="btn primary big block" style="margin-top:12px" data-a="mc-confirm">${sh.to === OUT ? "Sortir du paddock" : "Déplacer ici"} ${esc(dateWords(sh.date, C.today))}</button>
    <button type="button" class="btn block" style="margin-top:8px" data-a="sheet-close">Annuler</button>`;
}

/* Ouverture / fermeture du paddock : séjour en cours ou dernier séjour, et le précédent */
function padHistHTML(C, padId, ref) {
  const hist = padHistory(C.D, padId, ref);
  if (!hist.length) return `<div class="padhist">Jamais pâturé</div>`;
  const name = (id) => (lotOf(C, id) || { name: "troupeau supprimé" }).name;
  const line = (x) => x.end === null
    ? `<div><b>Ouvert depuis le ${esc(fmtShort(x.start, true))}</b> (${plural(daysBetween(x.start, ref), "jour", "jours")}) · ${esc(name(x.lotId))}</div>`
    : `<div>Ouvert le ${esc(fmtShort(x.start, true))}, <b>fermé le ${esc(fmtShort(x.end, true))}</b> (${plural(daysBetween(x.start, x.end), "jour", "jours")}) · ${esc(name(x.lotId))}</div>`;
  const open = hist.filter((x) => x.end === null);
  const closed = hist.filter((x) => x.end !== null).sort((a, b) => (a.end < b.end ? 1 : -1));
  let h = open.map(line).join("");
  if (closed.length) h += line(closed[0]) + (open.length ? "" : `<div class="muted">Fermé depuis ${plural(daysBetween(closed[0].end, ref), "jour", "jours")}</div>`);
  return `<div class="padhist">${h}</div>`;
}

function legendHTML(target) {
  const it = (c, t) => `<span><i style="background:var(--c-${c})"></i>${t}</span>`;
  return `<div class="legend">${it("ready", "Prêt (≥ " + target + " j)")}${it("soon", "Bientôt")}${it("early", "Trop tôt (< " + Math.round(target / 2) + " j)")}${it("occ", "Occupé")}${it("never", "Jamais pâturé")}</div>`;
}
function pressureColor(v, max) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const r = Math.max(0, Math.min(1, v / max));
  return `hsl(${Math.round(120 - 120 * r)},75%,45%)`;
}

/* =================== CARTE =================== */
export function viewCarte(S, C) {
  const K = S.carte, target = C.settings.restTarget, ref = K.ref || C.today;
  const st = C.statusAt(ref);
  const pr = K.layer === "pressure" || K.pad ? C.pressureAt(ref) : null;
  const pMax = C.settings.pressureMax;
  let h = `<div class="screen"><h1>Carte</h1><div class="sub">${ref === C.today ? "Situation aujourd’hui" : "Situation au " + esc(fmtShort(ref, true))} · pincez pour zoomer, touchez un paddock</div>
    <div class="seg" style="margin:12px 0"><button type="button" class="${K.layer !== "pressure" ? "on" : ""}" data-a="carte-layer" data-v="rest">Repos</button><button type="button" class="${K.layer === "pressure" ? "on" : ""}" data-a="carte-layer" data-v="pressure">Pression</button></div>`;
  /* troupeaux au pré : un appui montre leur paddock (et le bouton « Sortir → hors-paddock ») */
  const inPads = C.D.lots.filter((l) => !l.archived).map((l) => ({ l, x: lotLocation(C.D.moves, l.id, ref) })).filter((o) => o.x && o.x.loc !== OUT);
  if (inPads.length) h += `<div class="chips scroll" style="margin-bottom:10px" data-hscroll="ct-lots"><span class="small muted" style="align-self:center;flex:0 0 auto">Au pré :</span>` + inPads.map((o) => `<button type="button" class="chip${K.pad === o.x.loc ? " on" : ""}" style="min-height:44px;${K.pad === o.x.loc ? `background:${esc(o.l.color)};border-color:${esc(o.l.color)}` : `border-color:${esc(o.l.color)}`}" data-a="ct-lot" data-pad="${esc(o.x.loc)}">${dot(o.l.color)}${esc(o.l.name)}</button>`).join("") + `</div>`;
  h += mapHTML({
    ctx: "ct", vb: K.vb, selId: K.pad, height: carteMapH(),
    look: (id) => {
      if (K.layer === "pressure") {
        const v = pr.byPad[id] ? pr.byPad[id].pressure : null, f = v > 0 ? pressureColor(v, pMax) : null;
        return { cls: f ? "x" : "never", fill: f, title: padLabel(id) + " — " + (v ? fmtNum(v, 2) + " UGB/ha/an" : "pas de pâturage") };
      }
      return { cls: restClass(st[id], target), title: padLabel(id) + " — " + statusText(st[id], target) };
    },
    markers: C.markersAt(ref)
  });
  let tail = ""; // légende et réglages : sous la fiche du paddock choisi
  if (K.layer === "pressure") tail += `<div class="grad" style="background:linear-gradient(90deg,hsl(120,75%,45%),hsl(60,75%,45%),hsl(0,75%,45%))"></div><div class="spread small muted" style="margin-top:4px"><span>0</span><span>Pression ${esc(pr.year)} jusqu’au ${esc(fmtShort(ref))} (UGB/ha/an)</span><span>${fmtNum(pMax, 1)}+</span></div>`;
  else tail += legendHTML(target);
  tail += `<details class="opts"${K.optsOpen ? " open" : ""}><summary>Réglages de la carte</summary>
    <label class="field"><span>Date de référence (situation passée)</span><input class="input" type="date" max="${C.today}" value="${esc(ref)}" data-in="carte-ref"></label>
    <div class="row" style="margin-top:8px">
      <label class="field" style="flex:1 1 140px"><span>Objectif de repos (j)</span><input class="input" type="number" min="1" max="365" value="${target}" data-in="set-restTarget"></label>
      <label class="field" style="flex:1 1 140px"><span>Pression max. (UGB/ha/an)</span><input class="input" type="number" min="0.1" step="0.1" value="${pMax}" data-in="set-pressureMax"></label></div>
    ${ref !== C.today ? `<button type="button" class="btn block" style="margin-top:10px" data-a="carte-ref-today">Revenir à aujourd’hui</button>` : ""}</details>`;
  if (K.pad && GEO.byId[K.pad]) {
    const p = GEO.byId[K.pad], s = st[p.id] || { status: "never", occupants: [] }, c = restClass(s, target);
    const occNames = s.occupants.map((id) => (lotOf(C, id) || { name: id }).name);
    let status, detail;
    if (s.status === "occ") {
      status = "Occupé par " + occNames.join(", ");
      const l0 = lotLocation(C.D.moves, s.occupants[0], ref);
      detail = l0 ? "Entré le " + fmtShort(l0.since) + " · " + daysBetween(l0.since, ref) + " j" : "";
    } else if (s.status === "rest") { status = "Repos " + s.rest + " j" + (s.rest >= target ? " — prêt" : " — trop tôt"); detail = "Dernière sortie le " + fmtShort(s.lastEnd, true); }
    else { status = "Jamais pâturé"; detail = "Aucun historique"; }
    const prv = pr && pr.byPad[p.id] ? pr.byPad[p.id].pressure : null;
    h += `<div class="card" id="padcard" style="margin-top:12px"><div class="spread" style="align-items:baseline"><div style="font-size:20px;font-weight:700">${esc(padLabel(p.id))}</div><div class="small muted">${fmtNum(p.area, 2)} ha</div></div>
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><i style="width:14px;height:14px;border-radius:4px;background:var(--c-${c});display:inline-block;flex:0 0 auto"></i><b>${esc(status)}</b></div>
      ${prv ? `<div class="small muted" style="margin-top:2px">Pression ${fmtNum(prv, 2)} UGB/ha/an</div>` : ""}
      ${padHistHTML(C, p.id, ref)}`;
    /* sortir un troupeau présent : passage hors-paddock (date au choix dans la validation) */
    if (s.occupants.length && ref === C.today) {
      h += `<div class="stack" style="margin-top:12px;gap:8px">` + s.occupants.map((id) => { const l = lotOf(C, id); return l ? `<button type="button" class="btn block" data-a="mc-open" data-lot="${esc(l.id)}" data-pad="${OUT}">${icon("shelter", 20)} Sortir ${esc(l.name)} → hors-paddock</button>` : ""; }).join("") + `</div>`;
    }
    const avail = C.D.lots.filter((l) => !l.archived && !s.occupants.includes(l.id));
    if (avail.length && ref === C.today) {
      h += `<div class="small muted" style="margin-top:12px">Y mettre un troupeau</div><div class="chips" style="margin-top:6px">` +
        avail.map((l) => `<button type="button" class="chip" style="border-color:${esc(l.color)};color:${esc(l.color)}" data-a="mc-open" data-lot="${esc(l.id)}" data-pad="${esc(p.id)}">${esc(l.name)}</button>`).join("") + `</div>`;
    }
    h += `</div>`;
  }
  return h + tail + `</div>`;
}

/* =================== CALENDRIER =================== */
export function viewCal(S, C) {
  const K = S.cal, lots = C.D.lots;
  let h = `<div class="${K.fs ? "fs" : "screen"}"><div class="spread"><div><h1>Calendrier</h1><div class="sub">Touchez une période pour la corriger</div></div>
    <button type="button" class="iconbtn" data-a="cal-fs" aria-label="${K.fs ? "Quitter le plein écran" : "Plein écran"}">${icon(K.fs ? "close" : "expand", 24)}</button></div>`;
  if (!lots.length) return h + `<div class="notice" style="margin-top:12px">Aucun troupeau.</div></div>`;
  const lot = lotOf(C, K.lotId) || lots.find((l) => !l.archived) || lots[0];
  h += `<div class="chips scroll" style="margin-top:12px" data-hscroll="cal-lots">` + lots.filter((l) => !l.archived || l.id === lot.id).map((l) =>
    `<button type="button" class="chip${l.id === lot.id ? " on" : ""}" style="${l.id === lot.id ? `background:${esc(l.color)};border-color:${esc(l.color)}` : ""}" data-a="cal-lot" data-lot="${esc(l.id)}">${esc(l.name)}</button>`).join("") + `</div>`;
  const tl = lotTimeline(C.D.moves, lot.id);
  const years = new Set();
  tl.stays.concat(tl.outs).forEach((s) => { for (let y = +s.start.slice(0, 4); y <= +(s.end || C.today).slice(0, 4); y++) years.add(y); });
  C.D.foins.filter((f) => f.lotId === lot.id).forEach((f) => years.add(+f.date.slice(0, 4)));
  const ys = [...years].sort();
  if (!ys.length) return h + `<div class="notice" style="margin-top:12px">Aucune donnée pour ce troupeau.</div></div>`;
  const Y = ys.includes(K.year) ? K.year : ys[ys.length - 1];
  h += `<div class="row" style="margin-top:8px"><label class="small muted" for="calYear">Année</label><select id="calYear" class="input" style="width:auto" data-in="cal-year">${ys.map((y) => `<option${y === Y ? " selected" : ""}>${y}</option>`).join("")}</select></div>`;
  const y0 = Y + "-01-01", y1 = Y + "-12-31";
  const clip = (s) => { const e = s.end || C.today; if (e < y0 || s.start > y1) return null; return { a: s.start < y0 ? y0 : s.start, b: e > y1 ? y1 : e }; };
  const segs = tl.stays.map((s) => ({ s, c: clip(s) })).filter((x) => x.c);
  const outs = tl.outs.map((s) => ({ s, c: clip(s) })).filter((x) => x.c);
  const foins = C.D.foins.filter((f) => f.lotId === lot.id && f.date >= y0 && f.date <= y1);
  let r0 = y1, r1 = y0;
  segs.concat(outs).forEach((x) => { if (x.c.a < r0) r0 = x.c.a; if (x.c.b > r1) r1 = x.c.b; });
  foins.forEach((f) => { if (f.date < r0) r0 = f.date; if (f.date > r1) r1 = f.date; });
  if (r0 > r1) return h + `<div class="notice" style="margin-top:12px">Aucune période en ${Y}.</div></div>`;
  r0 = r0.slice(0, 8) + "01";
  const N = daysBetween(r0, r1) + 1;
  const avail = Math.min(window.innerWidth, K.fs ? 4000 : 760) - (K.fs ? 32 : 32) - 28 - 100;
  const dw = Math.max(0.6, avail / N), TW = Math.round(N * dw);
  const x = (d) => (daysBetween(r0, d) * dw).toFixed(1);
  let head = "";
  for (let d = parseISO(r0); ; d.setMonth(d.getMonth() + 1)) {
    const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
    if (iso > r1) break;
    head += `<div class="g-month" style="left:${x(iso)}px">${dw * 30 >= 34 ? MOIS_COURT[d.getMonth()] : MOIS_COURT[d.getMonth()].charAt(0).toUpperCase()}${d.getMonth() === 0 && dw * 30 >= 34 ? " " + d.getFullYear() : ""}</div>`;
  }
  const todayLine = C.today >= r0 && C.today <= r1 ? `<div class="g-today" style="left:${x(C.today)}px"></div>` : "";
  const sel = K.sel;
  const bar = (it, color, kind) => {
    const on = sel && sel.kind === kind && sel.id === it.s.startId;
    /* fin exclusive, sauf séjour en cours (aujourd'hui inclus) ou coupé au 31 décembre (inclus) */
    const w = Math.max(6, (daysBetween(it.c.a, it.c.b) + (!it.s.end || it.s.end > y1 ? 1 : 0)) * dw);
    const bg = it.s.end ? color : `repeating-linear-gradient(45deg,${color},${color} 4px,${color}99 4px,${color}99 8px)`;
    return `<button type="button" class="g-bar${on ? " sel" : ""}" style="left:${x(it.c.a)}px;width:${w.toFixed(1)}px;background:${bg}" data-a="cal-sel" data-kind="${kind}" data-id="${esc(it.s.startId)}" aria-label="${esc(padLabel(it.s.loc) + " du " + fmtShort(it.s.start) + (it.s.end ? " au " + fmtShort(it.s.end) : " à aujourd’hui"))}"></button>`;
  };
  let g = `<div class="card" style="margin-top:12px;padding:10px 4px 10px 10px"><div class="gantt" data-hscroll="cal-gantt-${esc(lot.id)}"><div style="width:${TW + 104}px">`;
  g += `<div class="g-row" style="border-top:none"><div class="g-lab"></div><div class="g-head" style="width:${TW}px">${head}</div></div>`;
  const order = [];
  segs.forEach((x2) => { if (!order.includes(x2.s.loc)) order.push(x2.s.loc); });
  for (const pid of order) {
    const p = GEO.byId[pid];
    g += `<div class="g-row"><div class="g-lab"><div class="p">${esc(p ? parcelLabel(p.parcel) : "?")}</div><div class="n">${esc(p ? "n°" + p.num : pid)}</div></div><div class="g-track" style="width:${TW}px">${todayLine}${segs.filter((s) => s.s.loc === pid).map((s) => bar(s, lot.color, "stay")).join("")}</div></div>`;
  }
  if (outs.length) g += `<div class="g-row"><div class="g-lab"><div class="p">Piste, stabul.</div><div class="n" style="font-size:14px">Hors-paddock</div></div><div class="g-track" style="width:${TW}px">${todayLine}${outs.map((s) => bar(s, "#8C9389", "out")).join("")}</div></div>`;
  g += `<div class="g-row"><div class="g-lab"><div class="n" style="font-size:14px;color:var(--hay-text)">Foin</div><div class="p">${foins.length} round-baller${foins.length > 1 ? "s" : ""}</div></div><div class="g-track" style="width:${TW}px;height:30px">${foins.map((f) => `<div class="g-foin${f.type === "enrubanne" ? " enr" : ""}" style="left:${(daysBetween(r0, f.date) * dw - 2).toFixed(1)}px" title="${esc((f.type === "enrubanne" ? "Enrubanné" : "Foin") + " — " + fmtShort(f.date))}"></div>`).join("")}</div></div>`;
  g += `</div></div><div class="legend"><span><i style="background:${esc(lot.color)}"></i>Séjour en paddock</span><span><i style="background:#8C9389"></i>Hors-paddock</span><span><i style="background:#C08A2B"></i>Foin</span><span><i style="background:#2F7D32"></i>Enrubanné</span></div></div>`;
  h += g;
  if (sel) {
    const s = (sel.kind === "out" ? tl.outs : tl.stays).find((z) => z.startId === sel.id);
    if (s) {
      const e = s.end || C.today;
      h += `<div class="card" style="margin-top:12px"><div style="font-size:19px;font-weight:700">${esc(padLabel(s.loc))}</div>
        <div class="muted" style="margin-top:2px">${esc(fmtShort(s.start, true))} → ${s.end ? esc(fmtShort(s.end, true)) : "en cours"} · ${plural(daysBetween(s.start, e), "jour", "jours")}${sel.kind === "stay" ? " · " + esc(ugbTxt(lotUGB(C.D, lot.id, s.start))) : ""}</div>
        <div class="row" style="margin-top:12px">
          <button type="button" class="btn" style="flex:1 1 140px" data-a="edit-move" data-id="${esc(s.startId)}">Corriger l’entrée</button>
          ${s.endId ? `<button type="button" class="btn" style="flex:1 1 140px" data-a="edit-move" data-id="${esc(s.endId)}">Corriger la sortie</button>` : ""}
          ${sel.kind === "stay" ? `<button type="button" class="btn soft" style="flex:1 1 140px" data-a="cal-locate" data-id="${esc(s.loc)}">Voir sur la carte</button>` : ""}
        </div><div class="small muted" style="margin-top:8px">La sortie d’un séjour est le déplacement suivant du troupeau.</div></div>`;
    }
  }
  return h + `</div>`;
}

/* =================== PLUS =================== */
export function viewPlus(S, C) {
  if (S.sub === "lots") return viewLots(S, C);
  if (S.sub === "lot") return viewLot(S, C);
  if (S.sub === "journal") return viewJournal(S, C);
  if (S.sub === "sync") return viewSync(S, C);
  if (S.sub === "exports") return viewExports(S, C);
  if (S.sub === "settings") return viewSettings(S, C);
  if (S.sub === "mapcfg") return viewMapCfg(S, C);
  const totalUGB = C.D.lots.filter((l) => !l.archived).reduce((s, l) => s + lotUGB(C.D, l.id, C.today), 0);
  const syncTxt = C.sync.state === "off" ? "Non réglée" : C.sync.state === "ok" ? "À jour" : C.sync.state === "error" ? "Erreur : " + C.sync.lastErr : C.sync.pending + " en attente";
  const item = (a, t1, t2) => `<button type="button" class="li" data-a="${a}"><span class="grow"><span class="t1">${t1}</span><span class="t2">${t2}</span></span>${icon("next", 20, 'style="color:var(--muted)"')}</button>`;
  return `<div class="screen"><h1 style="margin-bottom:14px">Plus</h1><div class="list">
    ${item("sub-lots", "Troupeaux et UGB", plural(C.D.lots.filter((l) => !l.archived).length, "troupeau", "troupeaux") + " · " + fmtNum(totalUGB, 1) + " UGB")}
    ${item("sub-journal", "Journal", "Tous les déplacements et le foin, filtres, corrections")}
    ${item("sub-sync", "Synchronisation", esc(syncTxt))}
    ${item("sub-exports", "Exports et sauvegarde", "CSV, ZIP, sauvegarde JSON, restauration")}
    ${item("sub-settings", "Réglages", "Objectif de repos " + C.settings.restTarget + " j · catégories UGB · thème")}
    ${item("sub-mapcfg", "Parcelles et paddocks", GEO.parcels.length + " parcelles · " + GEO.pads.length + " paddocks · " + fmtNum(GEO.pads.reduce((s, p) => s + p.area, 0), 1) + " ha")}
  </div><p class="small muted" style="margin:14px 4px">Suivi pâturage v9.2.2 · ${C.D.moves.length} déplacements · ${C.D.foins.length} foin</p></div>`;
}
const subHead = (title, back = "plus-back") => `<div class="row" style="flex-wrap:nowrap;gap:4px;margin:-8px 0 8px -10px"><button type="button" class="iconbtn" data-a="${back}" aria-label="Retour">${icon("back", 24)}</button><h1 style="font-size:24px">${title}</h1></div>`;

function viewLots(S, C) {
  let h = `<div class="screen">${subHead("Troupeaux et UGB")}<div class="list">`;
  for (const l of C.D.lots) {
    const comp = compForDate(C.D.comps, l.id, C.today);
    h += `<button type="button" class="li" data-a="lot-open" data-lot="${esc(l.id)}">${dot(l.color)}<span class="grow"><span class="t1">${esc(l.name)}${l.archived ? " (archivé)" : ""}</span><span class="t2">${esc(ugbTxt(comp ? ugbOf(comp.items, C.D.catsAll) : 0))}${comp ? " · composition du " + esc(fmtShort(comp.eff, true)) : ""}</span></span>${icon("next", 20, 'style="color:var(--muted)"')}</button>`;
  }
  if (!C.D.lots.length) h += `<div class="li"><span class="muted">Aucun troupeau.</span></div>`;
  return h + `</div><button type="button" class="btn primary block" style="margin-top:12px" data-a="lot-new">${icon("plus", 20)} Nouveau troupeau</button></div>`;
}

function viewLot(S, C) {
  const E = S.lotEdit, l = lotOf(C, E.lotId);
  if (!l) return `<div class="screen">${subHead("Troupeau", "sub-lots")}<div class="notice">Troupeau introuvable.</div></div>`;
  const comps = C.D.comps.filter((c) => c.lotId === l.id).sort((a, b) => (a.eff < b.eff ? 1 : -1));
  const draft = E.draft || {};
  /* catégories proposées + catégories supprimées encore présentes dans la composition chargée */
  const cats = C.D.catsAll.filter((k) => !k.deleted || Number(draft[k.id]) > 0);
  const catName = (k) => k.name + (k.deleted ? " (supprimée)" : "");
  let h = `<div class="screen">${subHead(esc(l.name), "lot-back")}
    <div class="card"><label class="field" style="margin-top:0"><span>Nom</span><input class="input" value="${esc(l.name)}" data-in="lot-name" data-lot="${esc(l.id)}"></label>
    <div class="field"><span>Couleur</span><div class="chips">${LOT_COLORS.map((c) => `<button type="button" class="chip" style="min-width:48px;padding:0;background:${c};border-color:${c === l.color ? "var(--ink)" : c};${c === l.color ? "box-shadow:0 0 0 2px var(--card) inset" : ""}" data-a="lot-color" data-lot="${esc(l.id)}" data-c="${c}" aria-label="Couleur ${c}"></button>`).join("")}<label class="chip colorpick" style="${LOT_COLORS.includes(l.color) ? "" : `background:${esc(l.color)};border:2px solid var(--ink)`}" title="Autre couleur">${LOT_COLORS.includes(l.color) ? "+" : ""}<input type="color" value="${esc(l.color)}" data-in="lot-color-custom" data-lot="${esc(l.id)}" aria-label="Autre couleur" style="position:absolute;opacity:0;width:1px;height:1px"></label></div></div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn" data-a="lot-archive" data-lot="${esc(l.id)}">${l.archived ? "Réactiver" : "Archiver"}</button><button type="button" class="btn danger" data-a="lot-delete" data-lot="${esc(l.id)}">Supprimer…</button></div>
    <div class="small muted" style="margin-top:6px">Archiver masque le troupeau sans effacer son historique.</div></div>`;
  h += `<h2>Composition</h2><div class="card"><div class="row"><label class="field" style="margin-top:0;flex:1 1 160px"><span>Date d’effet</span><input class="input" type="date" value="${esc(E.eff)}" data-in="comp-eff"></label>
    <div style="flex:1 1 120px"><div class="small muted">UGB</div><div style="font-size:22px;font-weight:700">${fmtNum(ugbOf(draft, cats), 2)}</div></div></div>
    <table class="tbl" style="margin-top:10px"><thead><tr><th>Catégorie</th><th class="r">Coef.</th><th class="r">Effectif</th></tr></thead><tbody>`;
  for (const c of cats) h += `<tr><td>${esc(catName(c))}</td><td class="r">${fmtNum(c.ugb, 2)}</td><td class="r"><input class="input num" type="number" min="0" step="1" inputmode="numeric" value="${draft[c.id] ? esc(draft[c.id]) : ""}" data-in="comp-n" data-cat="${esc(c.id)}" aria-label="Effectif ${esc(c.name)}"></td></tr>`;
  h += `</tbody></table>${cats.length ? "" : '<div class="notice">Aucune catégorie : ajoutez-en dans Réglages.</div>'}
    <div class="row" style="margin-top:12px"><button type="button" class="btn" data-a="comp-dup" ${comps.length ? "" : "disabled"}>Reprendre la dernière</button><button type="button" class="btn primary" style="flex:1 1 auto" data-a="comp-save">Enregistrer la composition</button></div>
    <div class="row" style="margin-top:10px"><input class="input" style="flex:1 1 160px" placeholder="Nouvelle catégorie…" data-in="newcat-name" value="${esc(S.newCat.name)}"><input class="input num" type="number" step="0.01" placeholder="UGB" data-in="newcat-ugb" value="${esc(S.newCat.ugb)}"><button type="button" class="btn" data-a="cat-add">Ajouter</button></div></div>`;
  h += `<h2>Historique</h2>`;
  if (!comps.length) h += `<div class="notice">Aucune composition enregistrée.</div>`;
  else h += `<div class="list">` + comps.map((c) => `<div class="li"><span class="grow"><span class="t1">${esc(fmtShort(c.eff, true))}</span><span class="t2">${fmtNum(ugbOf(c.items, C.D.catsAll), 2)} UGB · ${esc(C.D.catsAll.filter((k) => c.items && c.items[k.id]).map((k) => c.items[k.id] + " " + catName(k)).join(", ") || "vide")}</span></span><button type="button" class="btn ghost" data-a="comp-load" data-id="${esc(c.id)}">Charger</button><button type="button" class="btn ghost" style="color:var(--warn-text)" data-a="comp-del" data-id="${esc(c.id)}">Suppr.</button></div>`).join("") + `</div>`;
  return h + `</div>`;
}

function viewJournal(S, C) {
  const J = S.journal;
  let h = `<div class="screen">${subHead("Journal")}
    <div class="seg"><button type="button" class="${J.kind === "moves" ? "on" : ""}" data-a="jr-kind" data-v="moves">Déplacements</button><button type="button" class="${J.kind === "foins" ? "on" : ""}" data-a="jr-kind" data-v="foins">Foin</button></div>
    <div class="row" style="margin-top:10px"><select class="input" style="flex:1 1 160px" data-in="jr-lot" aria-label="Troupeau"><option value="">Tous les troupeaux</option>${C.D.lots.map((l) => `<option value="${esc(l.id)}"${J.lotId === l.id ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
    <label class="sr" for="jrFrom">Du</label><input id="jrFrom" class="input" style="flex:1 1 130px" type="date" value="${esc(J.from)}" data-in="jr-from"><label class="sr" for="jrTo">Au</label><input id="jrTo" class="input" style="flex:1 1 130px" type="date" value="${esc(J.to)}" data-in="jr-to"></div>`;
  const arr = (J.kind === "moves" ? C.D.moves : C.D.foins).filter((r) => (!J.lotId || r.lotId === J.lotId) && (!J.from || r.date >= J.from) && (!J.to || r.date <= J.to))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.createdAt || 0) - (a.createdAt || 0)));
  h += `<div class="small muted" style="margin:10px 2px">${arr.length} ligne(s) · touchez une ligne pour la corriger ou la supprimer</div>`;
  if (!arr.length) return h + `<div class="notice">Aucun résultat.</div></div>`;
  h += `<div class="list">` + arr.slice(0, J.limit).map((r) => {
    const lot = lotOf(C, r.lotId);
    const t1 = J.kind === "moves" ? (lot ? lot.name : "?") + " → " + padLabel(r.to) : (r.type === "enrubanne" ? "Enrubanné" : "Foin") + " · " + (lot ? lot.name : "?");
    return `<button type="button" class="li" data-a="${J.kind === "moves" ? "edit-move" : "edit-foin"}" data-id="${esc(r.id)}">${lot ? dot(lot.color) : ""}<span class="grow"><span class="t1">${esc(t1)}</span><span class="t2">${esc(fmtShort(r.date, true))}${J.kind === "foins" ? " · fauche " + esc(r.year) : ""}</span></span></button>`;
  }).join("") + `</div>`;
  if (arr.length > J.limit) h += `<button type="button" class="btn block" style="margin-top:10px" data-a="jr-more">Afficher plus</button>`;
  return h + `</div>`;
}

function viewSync(S, C) {
  const y = C.sync;
  const st = { ok: "À jour", pending: "Envois en attente", offline: "Hors ligne", error: "Erreur", off: "Non réglée" }[y.state];
  return `<div class="screen">${subHead("Synchronisation")}
    <div class="card"><div class="row"><b>État : ${esc(st)}</b>${y.busy ? '<span class="muted">· en cours…</span>' : ""}</div>
    <div class="small muted" style="margin-top:4px">${y.pending} modification(s) en attente d’envoi${y.lastOk ? " · dernier échange réussi : " + esc(new Date(y.lastOk).toLocaleString("fr-FR")) : ""}</div>
    ${y.lastErr ? `<div class="notice warn" style="margin-top:8px">${esc(y.lastErr)}</div>` : ""}
    <button type="button" class="btn primary block" style="margin-top:12px" data-a="sync-now" ${y.busy ? "disabled" : ""}>Synchroniser maintenant</button></div>
    <h2>Réglage</h2><div class="card">
    <div class="small muted">Adresse du script Apps Script v9 (…/exec) et secret défini dans le script. Les données sont envoyées dans les onglets v9_* du tableur.</div>
    <label class="field"><span>Adresse du script</span><input class="input" data-in="sync-url" value="${esc(S.syncForm.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
    <label class="field"><span>Secret</span><input class="input" data-in="sync-secret" value="${esc(S.syncForm.secret)}" autocomplete="off"></label>
    <div class="row" style="margin-top:12px"><button type="button" class="btn primary" data-a="sync-save">Enregistrer</button><button type="button" class="btn" data-a="sync-test">Tester</button></div>
    ${S.syncMsg ? `<div class="notice" style="margin-top:10px">${esc(S.syncMsg)}</div>` : ""}</div>
    <h2>Dépannage</h2><div class="card"><div class="stack">
    <button type="button" class="btn block" data-a="sync-full">Tout récupérer depuis le tableur</button>
    <button type="button" class="btn block" data-a="sync-pushall">Renvoyer toutes mes données au tableur</button></div>
    <div class="small muted" style="margin-top:8px">« Renvoyer » sert au premier envoi depuis l’appareil qui a importé les données v8. En cas de conflit, la modification la plus récente l’emporte.</div></div></div>`;
}

function viewExports(S, C) {
  const y = new Date().getFullYear();
  const years = [...new Set(C.D.moves.concat(C.D.foins).map((m) => +m.date.slice(0, 4)).concat([y]))].sort((a, b) => b - a);
  return `<div class="screen">${subHead("Exports et sauvegarde")}
    <div class="card"><b>Sauvegarde</b><div class="small muted" style="margin-top:4px">Dernière sauvegarde : ${C.lastBackup ? esc(new Date(C.lastBackup).toLocaleString("fr-FR")) : "jamais"} · stockage persistant : ${esc(C.persist)}</div>
    <div class="row" style="margin-top:10px"><label class="small muted" for="exYear">Année</label><select id="exYear" class="input" style="width:auto" data-in="ex-year">${years.map((v) => `<option${v === S.exYear ? " selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="stack" style="margin-top:10px"><button type="button" class="btn primary block" data-a="ex-zip">Tout télécharger (ZIP)</button><button type="button" class="btn block" data-a="ex-share">Partager le ZIP…</button></div></div>
    <h2>Fichiers séparés</h2><div class="list">
    <button type="button" class="li" data-a="ex-csv" data-k="sejours"><span class="grow"><span class="t1">Séjours (CSV)</span><span class="t2">Une ligne par séjour : lieu, entrée, sortie, jours</span></span></button>
    <button type="button" class="li" data-a="ex-csv" data-k="journalier"><span class="grow"><span class="t1">Calendrier journalier (CSV)</span><span class="t2">Une ligne par jour de pâturage, UGB et UGB/ha</span></span></button>
    <button type="button" class="li" data-a="ex-csv" data-k="deplacements"><span class="grow"><span class="t1">Déplacements (CSV)</span><span class="t2">Le journal brut</span></span></button>
    <button type="button" class="li" data-a="ex-csv" data-k="compositions"><span class="grow"><span class="t1">Compositions (CSV)</span><span class="t2">Effectifs par catégorie et UGB</span></span></button>
    <button type="button" class="li" data-a="ex-csv" data-k="foin"><span class="grow"><span class="t1">Foin (CSV)</span><span class="t2">Round-ballers apportés</span></span></button>
    <button type="button" class="li" data-a="ex-json"><span class="grow"><span class="t1">Sauvegarde complète (JSON)</span><span class="t2">Pour transférer ou restaurer</span></span></button></div>
    <h2>Restaurer</h2><div class="card"><div class="small muted">Fichier de sauvegarde v9 (JSON), ou sauvegarde de l’ancienne version v8 (convertie automatiquement) : remplace les données de cet appareil. Un fichier de réparation, lui, ajoute des éléments sans rien remplacer.</div>
    <button type="button" class="btn block" style="margin-top:10px" data-a="pick-file" data-k="restore">Choisir un fichier…</button>
    ${C.v8Available && (C.sync.state === "off" || C.D.moves.length) ? `<button type="button" class="btn block" style="margin-top:8px" data-a="import-v8-local">${C.D.moves.length ? "Réimporter" : "Importer"} les données v8 de ce navigateur</button>` : ""}
    ${S.restoreMsg ? `<div class="notice" style="margin-top:10px">${esc(S.restoreMsg)}</div>` : ""}</div></div>`;
}

function viewSettings(S, C) {
  const cats = C.D.cats;
  return `<div class="screen">${subHead("Réglages")}
    <div class="card"><div class="row"><label class="field" style="flex:1 1 140px;margin-top:0"><span>Objectif de repos (jours)</span><input class="input" type="number" min="1" max="365" value="${C.settings.restTarget}" data-in="set-restTarget"></label>
    <label class="field" style="flex:1 1 140px;margin-top:0"><span>« Long séjour » à partir de (jours)</span><input class="input" type="number" min="1" max="365" value="${C.settings.longStay}" data-in="set-longStay"></label></div>
    <div class="field"><span>Thème</span><div class="seg"><button type="button" class="${C.settings.theme !== "dark" ? "on" : ""}" data-a="set-theme" data-v="light">Clair</button><button type="button" class="${C.settings.theme === "dark" ? "on" : ""}" data-a="set-theme" data-v="dark">Sombre</button></div></div></div>
    <h2>Catégories et coefficients UGB</h2><div class="card"><table class="tbl"><thead><tr><th>Catégorie</th><th class="r">Coef. UGB</th><th></th></tr></thead><tbody>
    ${cats.map((c) => `<tr><td><input class="input" value="${esc(c.name)}" data-in="cat-name" data-id="${esc(c.id)}" aria-label="Nom"></td><td class="r"><input class="input num" type="number" step="0.01" value="${esc(c.ugb)}" data-in="cat-ugb" data-id="${esc(c.id)}" aria-label="Coefficient"></td><td class="r"><button type="button" class="btn ghost" style="color:var(--warn-text)" data-a="cat-del" data-id="${esc(c.id)}" aria-label="Supprimer ${esc(c.name)}">${icon("close", 20)}</button></td></tr>`).join("")}
    </tbody></table><div class="row" style="margin-top:10px"><input class="input" style="flex:1 1 160px" placeholder="Nouvelle catégorie…" data-in="newcat-name" value="${esc(S.newCat.name)}"><input class="input num" type="number" step="0.01" placeholder="UGB" data-in="newcat-ugb" value="${esc(S.newCat.ugb)}"><button type="button" class="btn" data-a="cat-add">Ajouter</button></div>
    <div class="small muted" style="margin-top:8px">Une catégorie supprimée n’est plus proposée pour les nouvelles compositions ; les compositions passées qui l’utilisent la comptent toujours. Attention : changer un coefficient recalcule les UGB de tout l’historique.</div></div>
    <h2>Indicateurs</h2><div class="card small">${plural(C.D.lots.length, "troupeau", "troupeaux")} · ${plural(C.D.moves.length, "déplacement", "déplacements")} · ${C.D.lots.filter((l) => { const x = lotLocation(C.D.moves, l.id, C.today); return x && x.loc !== OUT; }).length} au pré · ${GEO.pads.length} paddocks</div>
    <h2>Zone sensible</h2><div class="card"><div class="small muted">Efface toutes les données de cet appareil (pas celles du tableur). Faites une sauvegarde avant.</div><button type="button" class="btn danger block" style="margin-top:10px" data-a="reset-all">Effacer les données de cet appareil…</button>
    <button type="button" class="btn block" style="margin-top:8px" data-a="load-demo">Charger une démo…</button><div class="small muted" style="margin-top:6px">La démo remplace les données de cet appareil ; elle n’est possible que sans synchronisation.</div></div></div>`;
}

function viewMapCfg(S, C) {
  const byParcel = {};
  GEO.pads.forEach((p) => { (byParcel[p.parcel] = byParcel[p.parcel] || []).push(p); });
  return `<div class="screen">${subHead("Parcelles et paddocks")}
    <div class="list">${GEO.parcels.map((p) => `<div class="li"><span class="grow"><span class="t1">${esc(p.label)}</span><span class="t2">${(byParcel[p.id] || []).length} paddocks · ${fmtNum((byParcel[p.id] || []).reduce((s, x) => s + x.area, 0), 2)} ha</span></span></div>`).join("")}</div>
    <h2>Mettre à jour le découpage</h2><div class="card"><div class="small muted">Fichiers GeoJSON exportés de QGIS (de préférence en Lambert-93). Les identifiants de paddocks doivent rester les mêmes pour conserver l’historique.</div>
    <div class="field"><span>Parcelles (GeoJSON)</span><button type="button" class="btn" data-a="pick-file" data-k="parcels">${S.files.parcels ? esc(S.files.parcels.name) : "Choisir…"}</button></div>
    <div class="field"><span>Paddocks (GeoJSON)</span><button type="button" class="btn" data-a="pick-file" data-k="paddocks">${S.files.paddocks ? esc(S.files.paddocks.name) : "Choisir…"}</button></div>
    <div class="row" style="margin-top:10px"><button type="button" class="btn primary" data-a="map-import">Importer le découpage</button>${GEO.custom ? `<button type="button" class="btn" data-a="map-reset">Revenir à la carte d’origine</button>` : ""}</div></div>
    <h2>Fond de carte</h2><div class="card"><div class="small muted">Image (PNG/JPG) et son fichier de géoréférencement (.pgw, .jgw, .wld).</div>
    <div class="field"><span>Image</span><button type="button" class="btn" data-a="pick-file" data-k="raster">${S.files.raster ? esc(S.files.raster.name) : "Choisir…"}</button></div>
    <div class="field"><span>Fichier world</span><button type="button" class="btn" data-a="pick-file" data-k="world">${S.files.world ? esc(S.files.world.name) : "Choisir…"}</button></div>
    <div class="row" style="margin-top:10px"><button type="button" class="btn primary" data-a="raster-import">Importer le fond</button>${GEO.customRaster ? `<button type="button" class="btn" data-a="raster-reset">Revenir au fond d’origine</button>` : ""}</div>
    ${S.mapMsg ? `<div class="notice" style="margin-top:10px">${esc(S.mapMsg)}</div>` : ""}</div></div>`;
}

/* =================== NAVIGATION, FEUILLES, TOAST =================== */
export function viewNav(S) {
  const b = (scr, ic, t) => `<button type="button" class="${S.screen === scr ? "on" : ""}" data-a="nav" data-v="${scr}"${S.screen === scr ? ' aria-current="page"' : ""}>${icon(ic, 26)}${t}</button>`;
  return `<nav class="tabs" aria-label="Navigation principale"><div class="in">${b("home", "herd", "Troupeaux")}${b("carte", "map", "Carte")}${b("cal", "calLines", "Calendrier")}${b("plus", "menu", "Plus")}</div></nav>`;
}

export function viewSheet(S, C) {
  const sh = S.sheet;
  if (!sh) return "";
  let body = "";
  if (sh.type === "foin") {
    const lot = lotOf(C, sh.lotId), loc = lotLocation(C.D.moves, sh.lotId, sh.date);
    const ty = (v, t, hay) => `<button type="button" class="btn big" style="${sh.ftype === v ? `background:${hay ? "var(--hay)" : "var(--primary)"};border-color:${hay ? "var(--hay)" : "var(--primary)"};color:#fff` : ""}" data-a="foin-type" data-v="${v}">${t}</button>`;
    const yr = new Date().getFullYear();
    body = `<div class="ttl">Foin · ${esc(lot ? lot.name : "")}</div><div class="small muted">1 saisie = 1 round-baller apporté · ${esc(loc ? padLabel(loc.loc) : "lieu inconnu")}</div>
      <div class="small muted" style="margin-top:14px">Type</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">${ty("foin", "Foin", true)}${ty("enrubanne", "Enrubanné", false)}</div>
      <div class="small muted" style="margin-top:14px">Année de fauche</div><div class="chips fill" style="margin-top:6px">${[yr, yr - 1, yr - 2].map((y) => `<button type="button" class="chip${sh.year === y ? " on" : ""}" data-a="foin-year" data-v="${y}">${y}</button>`).join("")}</div>
      <div class="small muted" style="margin-top:14px">Date</div>${dateChips(C, sh.date, "foin")}
      <button type="button" class="btn primary big block" style="margin-top:18px" data-a="foin-save" ${sh.ftype ? "" : "disabled"}>${sh.ftype ? "Enregistrer" : "Choisissez le type"}</button>`;
  } else if (sh.type === "moveConfirm") {
    body = moveConfirmBody(sh, C);
  } else if (sh.type === "date") {
    const y = sh.y, m = sh.m, first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
    const cur = S.sheetBack && S.sheetBack.date;
    const nextDis = y * 12 + m >= +C.today.slice(0, 4) * 12 + +C.today.slice(5, 7) - 1;
    let cells = "";
    for (let i = 0; i < lead; i++) cells += `<span></span>`;
    for (let d = 1; d <= n; d++) {
      const iso = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      cells += `<button type="button" class="${iso === cur ? "on" : ""}${iso === C.today ? " today" : ""}" data-a="date-pick" data-d="${iso}" ${iso > C.today ? "disabled" : ""} aria-label="${d} ${MOIS[m]} ${y}">${d}</button>`;
    }
    body = `<div class="ttl">${sh.target === "foin" ? "Date de la distribution" : "Date du déplacement"}</div>
      <div class="spread" style="align-items:center;margin-top:12px"><button type="button" class="btn" style="width:48px;padding:0" data-a="date-month" data-v="-1" aria-label="Mois précédent">${icon("back", 22)}</button>
      <b style="font-size:18px">${MOIS[m].charAt(0).toUpperCase() + MOIS[m].slice(1)} ${y}</b>
      <button type="button" class="btn" style="width:48px;padding:0" data-a="date-month" data-v="1" ${nextDis ? "disabled" : ""} aria-label="Mois suivant">${icon("next", 22)}</button></div>
      <div class="cal7" style="margin-top:12px"><span class="wd">L</span><span class="wd">M</span><span class="wd">M</span><span class="wd">J</span><span class="wd">V</span><span class="wd">S</span><span class="wd">D</span>${cells}</div>
      <div class="small muted" style="margin-top:10px">Les dates futures ne sont pas proposées.</div>`;
  } else if (sh.type === "editMove") {
    const opts = [`<option value="${OUT}"${sh.to === OUT ? " selected" : ""}>Hors-paddock</option>`].concat(GEO.parcels.map((pc) =>
      `<optgroup label="${esc(pc.label)}">` + GEO.pads.filter((p) => p.parcel === pc.id).map((p) => `<option value="${esc(p.id)}"${p.id === sh.to ? " selected" : ""}>${esc(padLabel(p.id))}</option>`).join("") + `</optgroup>`));
    body = `<div class="ttl">Corriger le déplacement</div>
      <label class="field"><span>Troupeau</span><select class="input" data-in="em-lot">${C.D.lots.map((l) => `<option value="${esc(l.id)}"${l.id === sh.lotId ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Date</span><input class="input" type="date" max="${C.today}" value="${esc(sh.date)}" data-in="em-date"></label>
      <label class="field"><span>Destination</span><select class="input" data-in="em-to">${opts.join("")}</select></label>
      <button type="button" class="btn primary big block" style="margin-top:16px" data-a="em-save">Enregistrer</button>
      <button type="button" class="btn danger block" style="margin-top:8px" data-a="em-del">Supprimer ce déplacement</button>
      <div class="small muted" style="margin-top:8px">Supprimer un déplacement prolonge le séjour précédent jusqu’au déplacement suivant.</div>`;
  } else if (sh.type === "editFoin") {
    const yr = new Date().getFullYear();
    body = `<div class="ttl">Corriger le foin</div>
      <label class="field"><span>Troupeau</span><select class="input" data-in="ef-lot">${C.D.lots.map((l) => `<option value="${esc(l.id)}"${l.id === sh.lotId ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Date</span><input class="input" type="date" max="${C.today}" value="${esc(sh.date)}" data-in="ef-date"></label>
      <div class="field"><span>Type</span><div class="seg"><button type="button" class="${sh.ftype === "foin" ? "on" : ""}" data-a="ef-type" data-v="foin">Foin</button><button type="button" class="${sh.ftype === "enrubanne" ? "on" : ""}" data-a="ef-type" data-v="enrubanne">Enrubanné</button></div></div>
      <label class="field"><span>Année de fauche</span><input class="input" type="number" min="2000" max="${yr}" value="${esc(sh.year)}" data-in="ef-year"></label>
      <button type="button" class="btn primary big block" style="margin-top:16px" data-a="ef-save">Enregistrer</button>
      <button type="button" class="btn danger block" style="margin-top:8px" data-a="ef-del">Supprimer</button>`;
  } else if (sh.type === "newLot") {
    body = `<div class="ttl">Nouveau troupeau</div><label class="field"><span>Nom</span><input id="newLotName" class="input" data-in="newlot-name" value="${esc(sh.name)}" autocomplete="off"></label>
      <button type="button" class="btn primary big block" style="margin-top:16px" data-a="lot-create" ${sh.name.trim() ? "" : "disabled"}>Créer</button>`;
  } else if (sh.type === "confirm") {
    body = `<div class="ttl">${esc(sh.title)}</div><div style="margin-top:8px">${esc(sh.text)}</div>
      <button type="button" class="btn ${sh.danger ? "danger" : "primary"} big block" style="margin-top:16px;${sh.danger ? "background:var(--warn-text);color:#fff;border-color:var(--warn-text)" : ""}" data-a="confirm-ok">${esc(sh.ok)}</button>
      <button type="button" class="btn block" style="margin-top:8px" data-a="sheet-close">Annuler</button>`;
  }
  return `<div class="sheet-wrap"><button type="button" class="scrim" data-a="sheet-close" aria-label="Fermer"></button><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${body}</div></div>`;
}

export function viewToast(S) {
  if (!S.toast || S.sheet) return ""; // pas de message par-dessus une fenêtre de saisie
  return `<div class="toast${S.screen === "move" ? " high" : ""}" role="status">${icon("check", 22, 'style="color:#A7E3B0;flex:0 0 auto"')}<span class="msg">${esc(S.toast.msg)}</span>${S.toast.edit ? `<button type="button" data-a="${esc(S.toast.edit.a)}" data-id="${esc(S.toast.edit.id)}">Modifier</button>` : ""}${S.toast.undo ? `<button type="button" data-a="undo">Annuler</button>` : ""}</div>`;
}
