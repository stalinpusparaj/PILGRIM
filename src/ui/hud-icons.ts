/**
 * Hand-drawn inline SVG for the HUD (GDD 2.3: icons are our own code): the Hope lantern, hearts, and the small
 * badges on toasts and the objective. Markup is built only from constants here, so it is safe for innerHTML.
 * Colours that carry meaning are always paired with a shape (GDD 2.15 Accessibility).
 */

const WOOD_DARK = '#4a3426';
const WOOD = '#7a5236';
const WOOD_LIGHT = '#a87443';

/**
 * The Hope lantern on a 64×88 grid. The flame sits in two nested groups: `.l-size` is scaled by Hope (CSS
 * variable --flame, eased by a transition) and `.l-flicker` flickers with a CSS animation, so nothing is
 * written per frame. Both scale around the wick (32, 66). `.l-glass` brightens with --glow.
 */
export function lanternSvg(): string {
  return (
    '<svg class="hud-lantern__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 88" ' +
    'aria-hidden="true" focusable="false">' +
    // Handle loop.
    `<path d="M22 17C22 3 42 3 42 17" fill="none" stroke="${WOOD_DARK}" stroke-width="4" stroke-linecap="round"/>` +
    // Roof and its rim.
    `<path d="M17 24L23 13H41L47 24Z" fill="${WOOD}" stroke="${WOOD_DARK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<rect x="11" y="21" width="42" height="7" rx="3.5" fill="${WOOD_LIGHT}" stroke="${WOOD_DARK}" stroke-width="3"/>` +
    // Glass: a dark pane under a warm pane whose opacity follows Hope, so low Hope reads as a dim lantern.
    '<rect x="15" y="28" width="34" height="42" rx="7" fill="#3a2f3d"/>' +
    '<rect class="l-glass" x="15" y="28" width="34" height="42" rx="7" fill="#ffd88a"/>' +
    // Flame.
    '<g class="l-size"><g class="l-flicker">' +
    '<path class="l-flame-outer" d="M32 33C39.5 43.5 43 50 43 56.5A11 11 0 0 1 21 56.5C21 50 24.5 43.5 32 33Z"/>' +
    '<path class="l-flame-inner" d="M32 44C35.6 49.5 37.5 53 37.5 57A5.5 5.5 0 0 1 26.5 57C26.5 53 28.4 49.5 32 44Z"/>' +
    '</g></g>' +
    `<rect x="30.5" y="64" width="3" height="5" rx="1.5" fill="${WOOD_DARK}"/>` +
    // Shine on the glass, then the frame over everything.
    '<path d="M20 34V57" stroke="#fffaf0" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>' +
    `<rect x="15" y="28" width="34" height="42" rx="7" fill="none" stroke="${WOOD_DARK}" stroke-width="3.5"/>` +
    // Base.
    `<rect x="11" y="69" width="42" height="8" rx="4" fill="${WOOD_LIGHT}" stroke="${WOOD_DARK}" stroke-width="3"/>` +
    `<rect x="18" y="77" width="28" height="7" rx="3.5" fill="${WOOD}" stroke="${WOOD_DARK}" stroke-width="3"/>` +
    '</svg>'
  );
}

const HEART =
  'M12 21C5 15.4 1.5 11.5 1.5 7.3A5.3 5.3 0 0 1 12 5.2A5.3 5.3 0 0 1 22.5 7.3C22.5 11.5 19 15.4 12 21Z';
const HEART_LEFT = 'M12 21C5 15.4 1.5 11.5 1.5 7.3A5.3 5.3 0 0 1 12 5.2Z';

/** One heart: the outline is always drawn; CSS shows the full or the half fill from `data-state`. */
export function heartSvg(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 23" aria-hidden="true" focusable="false">' +
    `<path class="h-back" d="${HEART}"/>` +
    `<path class="h-full" d="${HEART}"/>` +
    `<path class="h-half" d="${HEART_LEFT}"/>` +
    `<path class="h-edge" d="${HEART}"/>` +
    '</svg>'
  );
}

export type BadgeIcon = 'scroll' | 'gift' | 'star' | 'sign' | 'dizzy' | 'flag';

const BADGES: Record<BadgeIcon, string> = {
  // A rolled scroll with writing lines (Promises, the Roll).
  scroll:
    '<rect x="9" y="6" width="30" height="7" rx="3.5"/><rect x="9" y="35" width="30" height="7" rx="3.5"/>' +
    '<path d="M13 13v22M35 13v22M18 20h12M18 27h12"/>',
  // A wrapped present with a bow (gifts).
  gift:
    '<rect x="9" y="21" width="30" height="19" rx="3"/><rect x="6" y="14" width="36" height="7" rx="2"/>' +
    '<path d="M24 14v26M24 14c-3-5-11-7-11-2 0 3 7 2 11 2 4 0 11 1 11-2 0-5-8-3-11 2"/>',
  // A five-pointed star (anything good).
  star: '<path d="M24 6l5.2 11 12 1.5-8.8 8.2 2.3 11.9L24 32.8l-10.7 5.8 2.3-11.9-8.8-8.2 12-1.5z"/>',
  // A signpost (on or off the Way).
  sign: '<path d="M24 43V7M24 10h13l5 5-5 5H24M24 24H11l-5 5 5 5h13"/>',
  // Little stars circling (bonk).
  dizzy:
    '<path d="M8 30c0-9 7-14 16-14s16 5 16 14"/>' +
    '<path d="M13 9l1.6 3.4 3.7.5-2.7 2.5.7 3.6-3.3-1.8-3.3 1.8.7-3.6L8.7 13l3.7-.5z"/>' +
    '<path d="M35 9l1.6 3.4 3.7.5-2.7 2.5.7 3.6-3.3-1.8-3.3 1.8.7-3.6-2.7-2.5 3.7-.5z"/>',
  // A pennant on a pole (objective).
  flag: '<path d="M13 43V6"/><path d="M13 8h23l-6 7 6 7H13"/>',
};

/** A chunky stroked badge icon in currentColor (48×48 grid, like src/ui/Svg.ts). */
export function badgeSvg(name: BadgeIcon): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" ' +
    'stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    `${BADGES[name]}</svg>`
  );
}

/** The hold ring around the button glyph: a track and a fill drawn with stroke-dashoffset (pathLength 100). */
export function ringSvg(): string {
  return (
    '<svg class="hud-bubble__ring" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true" ' +
    'focusable="false"><circle class="r-track" cx="24" cy="24" r="21" pathLength="100"/>' +
    '<circle class="r-fill" cx="24" cy="24" r="21" pathLength="100"/></svg>'
  );
}
