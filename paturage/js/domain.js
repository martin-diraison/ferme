/* Règles métier — fonctions pures (testées par tests/domain.test.mjs).
   Modèle : un « déplacement » = { id, lotId, date, to, createdAt } où `to` est un id de paddock
   ou OUT (hors-paddock). Le lieu d'un troupeau à une date = destination de son dernier déplacement.
   Un séjour couvre les jours [début, fin[ : le jour du changement compte pour le nouveau lieu. */

import { addDays, daysBetween } from "./util.js";

export const OUT = "OUT";

export function sortMoves(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.createdAt || 0, cb = b.createdAt || 0;
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* Chronologie d'un troupeau : séjours en paddock, périodes hors-paddock, lieu courant.
   `upto` (ISO, inclus) ignore les déplacements postérieurs. Les déplacements vers le lieu
   déjà occupé sont redondants (ignorés, listés dans `redundant`). */
export function lotTimeline(moves, lotId, upto) {
  const ms = moves.filter((m) => m.lotId === lotId && !m.deleted && (!upto || m.date <= upto)).sort(sortMoves);
  const stays = [], outs = [], redundant = [];
  let cur = null;
  for (const m of ms) {
    if (cur && cur.loc === m.to) { redundant.push(m.id); continue; }
    if (cur) { cur.end = m.date; cur.endId = m.id; (cur.loc === OUT ? outs : stays).push(cur); }
    cur = { loc: m.to, start: m.date, startId: m.id, end: null, endId: null };
  }
  if (cur) (cur.loc === OUT ? outs : stays).push(cur);
  return { stays, outs, current: cur, redundant };
}

/* Lieu d'un troupeau à une date : { loc, since, moveId } ou null (jamais placé). */
export function lotLocation(moves, lotId, date) {
  const c = lotTimeline(moves, lotId, date).current;
  return c ? { loc: c.loc, since: c.start, moveId: c.startId } : null;
}

/* État de chaque paddock à la date `ref` : occupants, dernière sortie, jours de repos. */
export function paddockStatus(D, padIds, ref) {
  const res = {};
  for (const id of padIds) res[id] = { occupants: [], lastEnd: null, rest: null, status: "never" };
  const lotIds = new Set(D.moves.filter((m) => !m.deleted).map((m) => m.lotId));
  for (const lotId of lotIds) {
    const tl = lotTimeline(D.moves, lotId, ref);
    for (const st of tl.stays) {
      if (st.end !== null && st.end === st.start) continue; // passage de 0 jour (deux déplacements le même jour) : pas pâturé
      const r = res[st.loc] || (res[st.loc] = { occupants: [], lastEnd: null, rest: null, status: "never" });
      if (st.end === null) r.occupants.push(lotId);
      else if (!r.lastEnd || st.end > r.lastEnd) r.lastEnd = st.end;
    }
  }
  for (const id in res) {
    const r = res[id];
    if (r.occupants.length) { r.status = "occ"; r.rest = 0; }
    else if (r.lastEnd) { r.status = "rest"; r.rest = Math.max(0, daysBetween(r.lastEnd, ref)); }
  }
  return res;
}

/* Historique d'un paddock jusqu'à `ref` : séjours (tous troupeaux), du plus récent au plus ancien.
   Chaque séjour : { lotId, start (ouverture), end (fermeture, exclue ; null = en cours) }. */
export function padHistory(D, padId, ref) {
  const out = [];
  const lotIds = new Set(D.moves.filter((m) => !m.deleted && m.to === padId).map((m) => m.lotId));
  for (const lotId of lotIds) {
    for (const st of lotTimeline(D.moves, lotId, ref).stays) {
      if (st.loc !== padId || (st.end !== null && st.end === st.start)) continue;
      out.push({ lotId, start: st.start, end: st.end });
    }
  }
  return out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

/* Classe de couleur d'un paddock selon le repos et l'objectif. */
export function restClass(st, target) {
  if (!st) return "never";
  if (st.status === "occ") return "occ";
  if (st.status === "never") return "never";
  if (st.rest < target * 0.5) return "early";
  if (st.rest < target) return "soon";
  return "ready";
}

/* Composition en vigueur à une date (date d'effet ≤ date) et UGB. */
export function compForDate(comps, lotId, date) {
  let best = null, first = null;
  for (const c of comps) {
    if (c.deleted || c.lotId !== lotId) continue;
    if (!first || c.eff < first.eff) first = c;
    if (c.eff > date) continue;
    if (!best || c.eff > best.eff) best = c;
  }
  /* avant la première composition connue : on retient cette première composition
     (sinon le troupeau compterait pour 0 UGB et la pression serait nulle) */
  return best || first;
}
export function ugbOf(items, cats) {
  let s = 0;
  /* les catégories supprimées comptent encore pour les compositions qui les utilisent :
     supprimer une catégorie ne réécrit pas l'historique */
  for (const c of cats) s += (Number((items || {})[c.id]) || 0) * (Number(c.ugb) || 0);
  return s;
}
export function lotUGB(D, lotId, date) {
  const c = compForDate(D.comps, lotId, date);
  return c ? ugbOf(c.items, D.catsAll || D.cats) : 0;
}

/* Jours de pâturage (un par jour et par troupeau) entre from et to inclus, bornés à `today`.
   Utilisé pour la pression et l'export journalier. cb(lotId, padId, dayISO). */
export function forEachGrazingDay(D, from, to, today, cb) {
  const lotIds = new Set(D.moves.filter((m) => !m.deleted).map((m) => m.lotId));
  const hardEnd = to < today ? to : today;
  for (const lotId of lotIds) {
    const tl = lotTimeline(D.moves, lotId, hardEnd);
    for (const st of tl.stays) {
      let d = st.start < from ? from : st.start;
      const endExcl = st.end === null ? addDays(hardEnd, 1) : st.end;
      while (d < endExcl && d <= hardEnd) { cb(lotId, st.loc, d); d = addDays(d, 1); }
    }
  }
}

/* Pression de l'année de `ref` jusqu'à `ref` : UGB·jours / surface / 365 (UGB/ha/an). */
export function pressureByPaddock(D, pads, ref) {
  const year = ref.slice(0, 4);
  const ugbDays = {};
  const cache = {};
  forEachGrazingDay(D, year + "-01-01", year + "-12-31", ref, (lotId, padId, d) => {
    const k = lotId + "|" + d;
    if (cache[k] === undefined) cache[k] = lotUGB(D, lotId, d);
    ugbDays[padId] = (ugbDays[padId] || 0) + cache[k];
  });
  const out = {};
  for (const p of pads) {
    const u = ugbDays[p.id] || 0;
    out[p.id] = { ugbDays: u, pressure: p.area > 0 ? u / p.area / 365 : null };
  }
  return { year, byPad: out };
}

/* Conversion des données v8 (événements Entrée/Sortie) en déplacements v9.
   En v8, la date de SORTIE est le DERNIER JOUR passé dans le paddock (« sortie le 4, entrée
   le 5 » = rotation continue). En v9, un déplacement daté du jour J place le troupeau au
   nouveau lieu dès J. Une sortie v8 du jour J devient donc un passage hors-paddock à J+1,
   absorbé si une entrée a lieu ce jour-là (transfert sans interruption).
   Par jour : d'abord les entrées, puis les sorties du paddock courant. Une sortie du même jour
   qu'une entrée ailleurs est un transfert (sortie auto v8). Sorties sans entrée : signalées. */
export function convertV8Movements(v8moves, aliases = {}) {
  const fix = (p) => aliases[p] || p;
  const byLot = {};
  for (const m of v8moves || []) {
    if (!m || !m.lotId || !m.dt || !m.paddockId || !(m.type === "IN" || m.type === "OUT")) continue;
    (byLot[m.lotId] = byLot[m.lotId] || []).push(m);
  }
  const moves = [], orphanOuts = [], redundantIns = [], absorbedOuts = [];
  let seq = 1;
  for (const lotId in byLot) {
    const evs = byLot[lotId];
    const days = [...new Set(evs.map((e) => e.dt))].sort();
    let cur = null, pending = null; // pending = sortie v8 en attente : { id, date (J+1), pad }
    const flush = () => { if (pending) { moves.push({ id: pending.id, lotId, date: pending.date, to: OUT, createdAt: seq++ }); cur = OUT; pending = null; } };
    for (const day of days) {
      const ins = evs.filter((e) => e.dt === day && e.type === "IN");
      const outsD = evs.filter((e) => e.dt === day && e.type === "OUT");
      if (pending && day > pending.date) flush();
      if (pending && day === pending.date) {
        if (ins.length) { absorbedOuts.push(pending.id); pending = null; } // entrée le lendemain : transfert continu
        else flush();
      }
      for (const e of ins) {
        const p = fix(e.paddockId);
        if (p === cur) { redundantIns.push(e.id); continue; }
        moves.push({ id: e.id, lotId, date: day, to: p, createdAt: seq++ });
        cur = p;
      }
      for (const e of outsD) {
        const p = fix(e.paddockId);
        if (cur && p === cur && !pending) {
          pending = { id: e.id, date: addDays(day, 1), pad: p };
        } else if (!ins.length || !ins.some((i) => fix(i.paddockId) !== p)) {
          orphanOuts.push(e.id);
        } else {
          absorbedOuts.push(e.id);
        }
      }
    }
    flush();
  }
  return { moves, orphanOuts, redundantIns, absorbedOuts };
}
