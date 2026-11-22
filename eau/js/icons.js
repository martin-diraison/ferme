/* Pictogrammes (traits, viewBox 24) */
const P = {
  source: '<path d="M12 3c-1.6 3.4-5 5.6-5 9a5 5 0 0 0 10 0c0-3.4-3.4-5.6-5-9Z"/>',
  mare: '<path d="M3 13c0-3.5 4-6 9-6s9 2.5 9 6-4 5-9 5-9-1.5-9-5Z"/><path d="M7 13c1.6-1.2 3.4-1.2 5 0s3.4 1.2 5 0"/>',
  ruisseau: '<path d="M3 8c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/><path d="M3 15c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/>',
  zone_humide: '<path d="M4 17h16"/><path d="M8 17V9M8 9 5 6M8 9l3-3"/><path d="M16 17v-6M16 11l-2.5-2.5M16 11l2.5-2.5"/>',
  pluie: '<path d="M7 3h10v9a5 5 0 0 1-10 0Z"/><path d="M12 8v4"/>',
  carte: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  liste: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  tournee: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  plus_menu: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  retour: '<path d="M15 5l-7 7 7 7"/>',
  gps: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  ajout: '<path d="M12 5v14M5 12h14"/>',
  calques: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  tout: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  arret: '<path d="M4 12h6"/><path d="M14 8l6 8M20 8l-6 8"/>',
  chrono: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  fleche: '<path d="M9 5l7 7-7 7"/>',
  forage: '<path d="M3 20h18"/><path d="M10 20V8h4v12"/><path d="M12 8V3M8.5 3h7"/><path d="M12 13v3"/>',
  photo: '<path d="M4 8h3.5l2-3h5l2 3H20v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
};
export function picto(nom, size = 22, extra = "") {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[nom] || ""}</svg>`;
}
export function pictoSVG(type, size = 18) { return picto(type, size); }
