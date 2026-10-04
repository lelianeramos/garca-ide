/**
 * ÍCONES SVG — GARÇA DE BOTAS CODE STUDIO
 * ---------------------------------------
 * Parte 20.4: biblioteca única e consistente, inline, sem CDN.
 * B21/N10: ZERO emojis na interface. Todos os ícones são SVG 24×24,
 * stroke-width 1.8, stroke-linecap round (padrão Lucide/Tabler).
 */

const PATHS = {
  code: '<path d="m9 18-6-6 6-6M15 6l6 6-6 6"/>',
  blocks: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 8V4M9 4h6"/><circle cx="9.5" cy="13" r="1.2"/><circle cx="14.5" cy="13" r="1.2"/><path d="M3 12v3M21 12v3"/>',
  motor: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  sensor: '<path d="M12 3a9 9 0 0 1 9 9M12 8a4 4 0 0 1 4 4"/><circle cx="12" cy="12" r="1.4"/><path d="M3 12a9 9 0 0 1 9-9"/>',
  hub: '<path d="m4 7 8-4 8 4v10l-8 4-8-4z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M5 20h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5a7 7 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L13.7 2h-3.4l-.4 3a8 8 0 0 0-2.5 1.5l-2.5-1L2.8 9l2.1 1.5a7 7 0 0 0 0 3L2.8 15l1.8 3.4 2.5-1a8 8 0 0 0 2.5 1.5l.4 3h3.4l.4-3a8 8 0 0 0 2.5-1.5l2.4 1 2-3.4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  variables: '<path d="M4 7c2 0 3 1 3.5 3L9 17c.4 1.6 1.4 2.5 3 2.5M20 7c-2 0-3 1-3.5 3L15 17c-.4 1.6-1.4 2.5-3 2.5"/>',
  functions: '<path d="M7 21V8a3 3 0 0 1 3-3h2M5 12h6M17 3v18M14 8h6"/>',
  debug: '<path d="M12 3v3M8 6l8 0M6 12H3M21 12h-3M7.5 17 5 19.5M16.5 17 19 19.5"/><rect x="7" y="6" width="10" height="12" rx="5"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m6.5 9 3 3-3 3M12.5 15h5"/>',
  files: '<path d="M3 5h7l2 2h9v12H3z"/><path d="M8 11h8M8 15h5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z"/>',
  folderOpen: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v1.5H6.2a2 2 0 0 0-1.9 1.4L3 17.5z"/><path d="M3 17.5 5.4 11h16l-2.4 6.5a1.5 1.5 0 0 1-1.4 1H4.5A1.5 1.5 0 0 1 3 17.5z"/>',
  module: '<path d="M12 2.5 21 7v10l-9 4.5L3 17V7z"/><path d="m3 7 9 4.5L21 7M12 11.5V21"/>',
  entry: '<path d="m7 4 13 8-13 8z"/><circle cx="12" cy="12" r="10" opacity=".35"/>',
  run: '<path d="m7 4 13 8-13 8z"/>',
  compile: '<path d="m9 18-6-6 6-6M15 6l6 6-6 6"/><path d="M13 4l-2 16"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><rect x="4.5" y="9.5" width="9" height="5" rx="1"/>',
  github: '<path d="M12 .8a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2.1c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.1c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .8z"/>',
  commit: '<circle cx="12" cy="12" r="3.2"/><path d="M2.5 12h6.3m6.4 0h6.3"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M8 11h6"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  trash: '<path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  alert: '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.6v.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  fileCode: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9.5 12.5-2 2 2 2M14.5 12.5l2 2-2 2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M20 4 8.5 15.5M20 20 8.5 8.5"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-6h8v6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9"/><path d="M4 5v4h4M4 13a8 8 0 0 0 14 4.5L20 15"/><path d="M20 19v-4h-4"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  sound: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2V16h5.2v-.1c0-.8.3-1.5.9-2A6 6 0 0 0 12 3z"/>',
  control: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/>',
  operators: '<path d="M5 5h6v6H5zM13 13h6v6h-6z"/><path d="M16 5v6M13 8h6M5 16h6"/>',
  myblocks: '<path d="M12 2.5 21 7v10l-9 4.5L3 17V7z"/><path d="M12 11.5 8 9.5M12 11.5l4-2"/>',
  flag: '<path d="M5 21V4M5 4h11l-1.5 3.5L16 11H5"/>',
  dependency: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5 11 16M16 7.5 13 16M8.5 6h7"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  desktop: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4M6.4 8A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
};

/**
 * Gera o SVG inline.
 * @param {string} name chave de PATHS
 * @param {object} opts { size, filled, className, title }
 */
export function icon(name, opts = {}) {
  const body = PATHS[name];
  if (!body) return "";
  const size = opts.size ?? 16;
  const filled = opts.filled ? ' fill="currentColor" stroke="none"' : "";
  const label = opts.title ? `<title>${opts.title}</title>` : "";
  const aria = opts.title ? `aria-label="${opts.title}" role="img"` : 'aria-hidden="true"';
  return `<svg class="ui-icon ${opts.className ?? ""}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${aria}${filled}>${label}${body}</svg>`;
}

/** Ícone de categoria (usado na sidebar). */
export const CATEGORY_ICONS = {
  events: "flag", movement: "move", motors: "motor", sound: "sound",
  light: "light", control: "control", sensors: "sensor", operators: "operators",
  variables: "variables", myblocks: "myblocks", hub: "hub", libraries: "module",
};

export function categoryIcon(categoryId, size = 15) {
  return icon(CATEGORY_ICONS[categoryId] ?? "blocks", { size });
}

export const ICON_NAMES = Object.keys(PATHS);
export default icon;
