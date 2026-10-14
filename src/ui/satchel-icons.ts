/**
 * Inline SVG pictures for MY SATCHEL (GDD 2.3: icons are our own code, no asset files).
 *
 * Two families:
 *  - `tabIcon()` / `uiIcon()`: line icons on a 48×48 grid in `currentColor` (tabs, ticks, close...).
 *  - `itemIcon()`: small painted pictures on a 64×64 grid for the CARRIED cards (scroll, key, sword...), in the
 *    toy palette of GDD 2.11 with a dark ink outline so they read on the cream cards.
 * Every function returns markup built only from the constants below (safe for innerHTML).
 */
import { icon as coreIcon } from './Svg';

export type SatchelTabIcon = 'roll' | 'promises' | 'friends' | 'map' | 'carried';
export type SatchelUiIcon = 'close' | 'tick' | 'star' | 'locked' | 'sparkle' | 'lantern';
export type ItemIconId =
  | 'roll'
  | 'note'
  | 'key_promise'
  | 'sword'
  | 'shield'
  | 'helmet'
  | 'breastplate'
  | 'shoes'
  | 'prayer'
  | 'looking_glass'
  | 'sack';

const INK = '#3b2a1f';

function lineSvg(body: string, size: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `focusable="false">${body}</svg>`
  );
}

const TAB_BODIES: Record<Exclude<SatchelTabIcon, 'carried'>, string> = {
  // A rolled scroll: the sheet between two curls, with writing lines.
  roll:
    '<path d="M13 9h22a4 4 0 0 1 0 8H13"/><path d="M13 9a4 4 0 0 0 0 8v22a4 4 0 0 0 4 0"/>' +
    '<path d="M35 17v18a4 4 0 0 1-4 4H13a4 4 0 0 0 4-4"/><path d="M20 24h10M20 30h7"/>',
  // A little tied scroll with a sparkle above it.
  promises:
    '<rect x="10" y="20" width="24" height="12" rx="6"/><path d="M22 20v12"/><path d="M34 26h4"/>' +
    '<path d="M36 7v8M32 11h8"/><path d="M11 38h18"/>',
  // Two friends side by side.
  friends:
    '<circle cx="17" cy="16" r="6"/><circle cx="32" cy="18" r="5"/>' +
    '<path d="M6 40c0-7 5-12 11-12s11 5 11 12"/><path d="M27 29c1.5-.8 3.2-1.2 5-1.2 5.5 0 10 4.4 10 11"/>',
  // A folded map with a dashed path and an X.
  map:
    '<path d="M6 12l11-4 14 4 11-4v28l-11 4-14-4-11 4z"/><path d="M17 8v28M31 12v28"/>' +
    '<path d="M11 30c4-2 6-6 10-7s7 1 10-2" stroke-dasharray="1 5"/><path d="M33 16l4 4M37 16l-4 4"/>',
};

const UI_BODIES: Record<SatchelUiIcon, string> = {
  close: '<path d="M13 13l22 22M35 13L13 35"/>',
  tick: '<path d="M10 25l9 9 19-20"/>',
  star: '<path d="M24 6l5.3 11 12 1.6-8.8 8.3 2.2 11.9L24 33l-10.7 5.8 2.2-11.9-8.8-8.3 12-1.6z" fill="currentColor"/>',
  locked:
    '<path d="M18 18a6 6 0 1 1 9 5.2c-2 1.2-3 2.4-3 4.8"/><circle cx="24" cy="35" r="1.5" fill="currentColor"/>',
  sparkle:
    '<path d="M24 5c1.5 10 4 12.5 14 14-10 1.5-12.5 4-14 14-1.5-10-4-12.5-14-14 10-1.5 12.5-4 14-14z" ' +
    'fill="currentColor" stroke="none"/>',
  lantern: '<path d="M19 9h10M24 5v4"/><path d="M16 13h16l-2 4v16l2 4H16l2-4V17z"/><path d="M14 41h20"/>',
};

/** Tab icon (the CARRIED tab reuses the satchel icon of the touch controls). */
export function tabIcon(name: SatchelTabIcon, size = '1.6em'): string {
  if (name === 'carried') return coreIcon('satchel', size);
  return lineSvg(TAB_BODIES[name], size);
}

export function uiIcon(name: SatchelUiIcon, size = '1em'): string {
  return lineSvg(UI_BODIES[name], size);
}

/**
 * The Hope lantern for the footer: frame in ink, flame drawn as its own group so CSS can scale it
 * (`.pg-satchel__flame`, transform-origin at the wick).
 */
export function lanternSvg(size = '1.8em'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" ` +
    `focusable="false"><path d="M15 11h18l-2 4v20l2 4H15l2-4V15z" fill="#5b4636"/>` +
    `<g class="pg-satchel__flame"><path d="M24 14c5.5 6.5 7 11 7 14.5a7 7 0 0 1-14 0c0-3.5 1.5-8 7-14.5z" ` +
    `fill="#ffb94a"/><path d="M24 21c3 3.5 3.5 5.5 3.5 7.5a3.5 3.5 0 0 1-7 0c0-2 .5-4 3.5-7.5z" fill="#fff2c2"/></g>` +
    `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M19 8h10M24 4v4"/><path d="M15 11h18l-2 4v20l2 4H15l2-4V15z"/><path d="M13 43h22"/></g></svg>`
  );
}

// ------------------------------------------------------------------------------------------ item pictures

const ITEM_BODIES: Record<ItemIconId, string> = {
  // Parchment roll with a gold seal and a ribbon.
  roll:
    `<rect x="14" y="16" width="36" height="34" rx="3" fill="#f6e7c4"/>` +
    `<rect x="10" y="10" width="44" height="10" rx="5" fill="#e9d29e"/>` +
    `<rect x="10" y="46" width="44" height="10" rx="5" fill="#e9d29e"/>` +
    `<path d="M20 28h24M20 34h18" stroke="#b89a66" stroke-width="2.5" stroke-linecap="round"/>` +
    `<circle cx="42" cy="40" r="6" fill="#e8c25a"/><path d="M39 45l-2 8 5-3 5 3-2-8" fill="#d8574a"/>`,
  // Folded note with a corner turned down and two lines of writing.
  note:
    `<path d="M14 10h28l10 10v34H14z" fill="#fbf3dc"/><path d="M42 10v10h10" fill="#eadbb4"/>` +
    `<path d="M21 28h22M21 35h22M21 42h14" stroke="#7a8db0" stroke-width="2.5" stroke-linecap="round"/>`,
  // The Key of Promise: round bow with a heart-shaped hole, long stem, two teeth (key gold #FFC94A, Ch XI).
  key_promise:
    `<circle cx="20" cy="22" r="12" fill="#ffc94a"/>` +
    `<path d="M20 27l-4.5-4.5a3 3 0 0 1 4.5-4 3 3 0 0 1 4.5 4z" fill="#a8741a"/>` +
    `<rect x="28" y="19" width="26" height="6" rx="3" fill="#ffc94a"/>` +
    `<rect x="44" y="25" width="5" height="9" rx="1.5" fill="#ffc94a"/><rect x="36" y="25" width="4" height="6" rx="1.5" fill="#ffc94a"/>`,
  // Short sword: steel blade, gold guard and grip, round pommel (Christian's armour, GDD 2.11).
  sword:
    `<path d="M50 8l6 0 0 6-26 26-6-6z" fill="#d9dee3"/>` +
    `<path d="M16 32l16 16" stroke="#e8c25a" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M18 46l-6 6" stroke="#8a5a3b" stroke-width="6" stroke-linecap="round"/>` +
    `<circle cx="10" cy="54" r="4.5" fill="#e8c25a"/>`,
  // Round shield with our emblem: a gold rising sun over a path.
  shield:
    `<circle cx="32" cy="32" r="24" fill="#4f7fa6"/><circle cx="32" cy="32" r="24" fill="none" stroke="#b8c2cc" stroke-width="5"/>` +
    `<path d="M24 31a8 8 0 0 1 16 0z" fill="#e8c25a"/>` +
    `<path d="M32 18v4M22.5 22.5l2.8 2.8M41.5 22.5l-2.8 2.8" stroke="#e8c25a" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M14 31h36" stroke="#f6dfa8" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M30.5 32h3l6 18h-15z" fill="#f6dfa8"/>`,
  // Helmet with a blue plume.
  helmet:
    `<path d="M30 22c-2-9 4-16 14-17-3 3-4 7-3 11 2-2 6-3 9-2-5 2-8 5-10 9z" fill="#4f7fa6"/>` +
    `<path d="M12 42a20 20 0 0 1 40 0v6H12z" fill="#b8c2cc"/><rect x="11" y="44" width="42" height="8" rx="3" fill="#e8c25a"/>` +
    `<rect x="28" y="30" width="8" height="18" rx="2" fill="#8a96a3"/><circle cx="32" cy="22" r="3" fill="#e8c25a"/>`,
  // Breastplate with gold trim and a sun dot.
  breastplate:
    `<path d="M14 12h10c2 4 5 6 8 6s6-2 8-6h10l4 14-6 4v24H16V30l-6-4z" fill="#b8c2cc"/>` +
    `<path d="M16 54h32" stroke="#e8c25a" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="34" r="5" fill="#e8c25a"/>`,
  // A sturdy brown boot with a thick sole.
  shoes:
    `<path d="M18 8h16v26c6 2 16 4 20 10v6H12V30z" fill="#9c6644"/>` +
    `<rect x="10" y="48" width="46" height="8" rx="3" fill="#5b4636"/><path d="M20 18h10M20 25h10" stroke="#e7d3b0" stroke-width="2.5" stroke-linecap="round"/>`,
  // A ring of gold light with rays.
  prayer:
    `<circle cx="32" cy="32" r="18" fill="#fff2c2"/><circle cx="32" cy="32" r="18" fill="none" stroke="#f2b33d" stroke-width="5"/>` +
    `<circle cx="32" cy="32" r="7" fill="#ffd27a"/>` +
    `<path d="M32 4v6M32 54v6M4 32h6M54 32h6M12 12l4 4M48 48l4 4M52 12l-4 4M16 48l-4 4" stroke="#f2b33d" stroke-width="3.5" stroke-linecap="round"/>`,
  // A brass telescope.
  looking_glass:
    `<path d="M8 40l30-18 6 10-30 18z" fill="#c4861b"/><path d="M36 20l14-8 6 10-14 8z" fill="#e8b04a"/>` +
    `<ellipse cx="53" cy="17" rx="3" ry="5.5" transform="rotate(-30 53 17)" fill="#8fcbef"/>` +
    `<path d="M24 46l-4 12M26 44l8 12" stroke="#6e5d50" stroke-width="3.5" stroke-linecap="round"/>`,
  // Anything else: a small tied sack.
  sack:
    `<path d="M24 18h16l-2 6c8 4 14 12 14 20 0 8-8 12-20 12S12 52 12 44c0-8 6-16 14-20z" fill="#a38a62"/>` +
    `<path d="M24 22h16" stroke="#c9a66b" stroke-width="4" stroke-linecap="round"/>`,
};

const ITEM_OUTLINE: Partial<Record<ItemIconId, string>> = {
  roll: '<rect x="10" y="10" width="44" height="46" rx="5"/>',
  note: '<path d="M14 10h28l10 10v34H14z"/>',
  shield: '<circle cx="32" cy="32" r="26.5"/>',
};

/** A painted picture for a CARRIED card; unknown ids get the sack. */
export function itemIcon(id: string, size = '64'): string {
  const key: ItemIconId = isItemIcon(id) ? id : 'sack';
  const outline = ITEM_OUTLINE[key];
  const ink = outline
    ? `<g fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" opacity="0.55">${outline}</g>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" ` +
    `focusable="false">${ITEM_BODIES[key]}${ink}</svg>`
  );
}

export function isItemIcon(id: string): id is ItemIconId {
  return Object.hasOwn(ITEM_BODIES, id);
}
