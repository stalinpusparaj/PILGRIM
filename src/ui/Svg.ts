/**
 * Hand-written inline SVG icons (GDD 2.3: no asset files, icons are our own code) plus helpers that turn
 * key codes and gamepad buttons into glyphs for prompts and the remap list.
 *
 * Every icon is drawn on a 48×48 grid with chunky rounded strokes in `currentColor`, so CSS picks the
 * colour. Functions return markup strings built only from our own constants (safe for innerHTML); any
 * text that could come from storage is escaped.
 */
import type { InputDevice } from '../core/Input';

export type IconName =
  | 'jump'
  | 'use'
  | 'pray'
  | 'sword'
  | 'shield'
  | 'satchel'
  | 'pause'
  | 'play'
  | 'mouseLeft'
  | 'mouseRight'
  | 'mouseMiddle'
  | 'view'
  | 'menu'
  | 'gear'
  | 'home'
  | 'pad'
  | 'book'
  | 'star'
  | 'share'
  | 'like'
  | 'mail';

const MOUSE_BODY = '<rect x="12" y="5" width="24" height="38" rx="12"/><path d="M24 5v14M12 19h24"/>';

const ICON_BODIES: Record<IconName, string> = {
  // Up arrow springing off the ground line.
  jump: '<path d="M24 33V9M13 19 24 8l11 11"/><path d="M10 41h28"/>',
  // Open hand: four fingers, thumb and palm.
  use:
    '<path d="M15 27V15a3 3 0 0 1 6 0v9M21 23V12a3 3 0 0 1 6 0v11M27 23V14a3 3 0 0 1 6 0v10' +
    'M33 24v-5a3 3 0 0 1 6 0v12c0 7-5 12-11 12h-3c-4 0-7-2-9-5l-7-9a3 3 0 0 1 4.5-4.2L15 27"/>',
  // Light burst: a bright centre with eight rays.
  pray:
    '<circle cx="24" cy="24" r="7" fill="currentColor"/>' +
    '<path d="M24 4v7M24 37v7M4 24h7M37 24h7M9.9 9.9l4.9 4.9M33.2 33.2l4.9 4.9M38.1 9.9l-4.9 4.9M14.8 33.2l-4.9 4.9"/>',
  // Blade, cross-guard, grip and pommel.
  sword:
    '<path d="M41 7l-2.5 9L22 32.5 15.5 26 32 9.5z"/><path d="M12 23l13 13M17 31l-6.5 6.5"/>' +
    '<circle cx="8.5" cy="39.5" r="3" fill="currentColor"/>',
  // Rounded heater shield with a cross.
  shield: '<path d="M24 5l15 5v13c0 10-6.5 17-15 20-8.5-3-15-10-15-20V10z"/><path d="M24 14v19M17 21h14"/>',
  // Satchel: strap, bag body, flap and clasp.
  satchel:
    '<path d="M16 15c0-5 3.5-8 8-8s8 3 8 8"/><rect x="7" y="15" width="34" height="27" rx="7"/>' +
    '<path d="M7 22c4 5 10 7 17 7s13-2 17-7"/><circle cx="24" cy="29" r="2.5" fill="currentColor"/>',
  pause:
    '<rect x="12" y="10" width="8" height="28" rx="2" fill="currentColor"/>' +
    '<rect x="28" y="10" width="8" height="28" rx="2" fill="currentColor"/>',
  play: '<path d="M17 10v28l21-14z" fill="currentColor"/>',
  // The pressed button is a filled quarter, so the shape (not only colour) shows which one.
  mouseLeft: MOUSE_BODY + '<path d="M24 5a12 12 0 0 0-12 12v2h12z" fill="currentColor"/>',
  mouseRight: MOUSE_BODY + '<path d="M24 5a12 12 0 0 1 12 12v2H24z" fill="currentColor"/>',
  mouseMiddle:
    MOUSE_BODY + '<rect x="21" y="9" width="6" height="9" rx="3" fill="currentColor" stroke="none"/>',
  view: '<rect x="7" y="11" width="21" height="17" rx="4"/><rect x="20" y="20" width="21" height="17" rx="4"/>',
  menu: '<path d="M11 15h26M11 24h26M11 33h26"/>',
  // Settings: a round cog with eight teeth around a hollow centre.
  gear:
    '<circle cx="24" cy="24" r="6"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2' +
    'M37.4 10.6l-4.2 4.2M14.8 33.2l-4.2 4.2"/><circle cx="24" cy="24" r="13"/>',
  // Title screen: a little house with a door.
  home: '<path d="M7 23 24 8l17 15"/><path d="M12 19v21h24V19"/><path d="M20 40V29h8v11"/>',
  // Controls: a game pad with a cross and two buttons.
  pad:
    '<path d="M14 14h20c6 0 10 5 10 12v4c0 5-6 7-9 3l-3-4H16l-3 4c-3 4-9 2-9-3v-4c0-7 4-12 10-12z"/>' +
    '<path d="M15 20v8M11 24h8"/><circle cx="32" cy="21" r="1.8" fill="currentColor"/>' +
    '<circle cx="36" cy="26" r="1.8" fill="currentColor"/>',
  // Chapters: an open book.
  book: '<path d="M24 13c-5-4-12-4-17-2v27c5-2 12-2 17 2 5-4 12-4 17-2V11c-5-2-12-2-17 2z"/><path d="M24 13v27"/>',
  // Credits: a five-point star.
  star: '<path d="M24 6l5.4 11.6L42 19l-9.4 8.6L35 40l-11-6.2L13 40l2.4-12.4L6 19l12.6-1.4z"/>',
  // Share: three linked dots.
  share:
    '<circle cx="35" cy="12" r="5"/><circle cx="13" cy="24" r="5"/><circle cx="35" cy="36" r="5"/>' +
    '<path d="M17.5 21.5l13-7M17.5 26.5l13 7"/>',
  // Like: a thumb up.
  like: '<path d="M15 22v19H8V22z"/><path d="M15 22l8-14c3 0 5 2 4 6l-2 7h11c3 0 5 3 4 6l-3 11c-1 2-2 3-4 3H15"/>',
  // Feedback: an envelope.
  mail: '<rect x="6" y="11" width="36" height="26" rx="5"/><path d="M7 13l17 13 17-13"/>',
};

function svg(body: string, size: number | string, stroked: boolean): string {
  const stroke = stroked
    ? ' fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"'
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}"` +
    `${stroke} aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Inline SVG markup for an icon. `size` is any SVG length (number = px); defaults to the font size. */
export function icon(name: IconName, size: number | string = '1em'): string {
  return svg(ICON_BODIES[name], size, true);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ------------------------------------------------------------------------------------------------ keys

/** Keycap legends for codes whose name is not their printed label (hardware legends, not translated). */
const KEY_LEGENDS = new Map<string, string>([
  ['Space', 'Space'],
  ['ShiftLeft', 'Shift'],
  ['ShiftRight', 'Shift'],
  ['ControlLeft', 'Ctrl'],
  ['ControlRight', 'Ctrl'],
  ['AltLeft', 'Alt'],
  ['AltRight', 'Alt'],
  ['MetaLeft', '⌘'],
  ['MetaRight', '⌘'],
  ['Tab', 'Tab'],
  ['Escape', 'Esc'],
  ['Enter', 'Enter'],
  ['NumpadEnter', 'Enter'],
  ['Backspace', '⌫'],
  ['CapsLock', 'Caps'],
  ['Delete', 'Del'],
  ['Insert', 'Ins'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PgUp'],
  ['PageDown', 'PgDn'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['IntlBackslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['Backquote', '`'],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['NumpadAdd', '+'],
  ['NumpadSubtract', '-'],
  ['NumpadMultiply', '*'],
  ['NumpadDivide', '/'],
  ['NumpadDecimal', '.'],
  ['Mouse0', 'LMB'],
  ['Mouse1', 'MMB'],
  ['Mouse2', 'RMB'],
]);

/** Short plain-text legend for a binding code: 'KeyE' → 'E', 'Digit1' → '1', 'ArrowUp' → '↑'. */
export function keyGlyph(code: string): string {
  const legend = KEY_LEGENDS.get(code);
  if (legend) return legend;
  const m = /^(?:Key|Digit)([A-Z0-9])$/.exec(code) ?? /^Numpad([0-9])$/.exec(code);
  if (m) return code.startsWith('Numpad') ? `Num ${m[1]}` : m[1];
  const mouse = /^Mouse(\d)$/.exec(code);
  if (mouse) return `M${Number(mouse[1]) + 1}`;
  return code;
}

const MOUSE_ICONS = new Map<string, IconName>([
  ['Mouse0', 'mouseLeft'],
  ['Mouse1', 'mouseMiddle'],
  ['Mouse2', 'mouseRight'],
]);

const KEYCAP_STYLE =
  'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.8em;' +
  'height:1.8em;padding:0 .45em;border:2px solid currentColor;border-bottom-width:4px;border-radius:.45em;' +
  'font:inherit;font-weight:700;font-size:.85em;line-height:1;vertical-align:middle;white-space:nowrap';
const ICON_GLYPH_STYLE = 'display:inline-flex;align-items:center;vertical-align:middle;line-height:0';

function iconGlyph(name: IconName): string {
  return `<span class="pg-glyph" style="${ICON_GLYPH_STYLE}">${icon(name, '1.6em')}</span>`;
}

/** HTML for one binding: a keycap (`<kbd>`) for keys, a mouse picture for mouse buttons. */
export function bindingGlyph(code: string): string {
  const mouse = MOUSE_ICONS.get(code);
  if (mouse) return iconGlyph(mouse);
  return `<kbd class="pg-glyph" style="${KEYCAP_STYLE}">${escapeHtml(keyGlyph(code))}</kbd>`;
}

// --------------------------------------------------------------------------------------------- gamepad

/** Standard-mapping button names by index (Xbox legends, the most common layout). */
const PAD_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'LS',
  'RS',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
];
/** Face-button colours. The letter is always drawn too, so colour is never the only signal (GDD 2.15). */
const FACE_COLOURS = new Map<number, string>([
  [0, '#3f9e4a'],
  [1, '#d2473d'],
  [2, '#3b78d0'],
  [3, '#d9a21b'],
]);
const PAD_DARK = '#353b4f';
const DPAD_ROTATION = [0, 180, 270, 90]; // up, down, left, right

export function padButtonName(index: number): string {
  return PAD_NAMES[index] ?? `B${index}`;
}

function padLabel(text: string, fontSize: number): string {
  return (
    `<text x="24" y="25" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${fontSize}" ` +
    `font-weight="700" font-family="system-ui, sans-serif">${escapeHtml(text)}</text>`
  );
}

/** Badge for a standard-mapping gamepad button (letters, bumpers, triggers, d-pad arrows, View/Menu). */
export function padGlyph(index: number, size: number | string = '1.6em'): string {
  const name = padButtonName(index);
  const face = FACE_COLOURS.get(index);
  const disc = (fill: string): string => `<circle cx="24" cy="24" r="21" fill="${fill}"/>`;
  const inner = (paths: string, transform: string): string =>
    `<g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" ` +
    `transform="${transform}">${paths}</g>`;
  let body: string;
  if (face) {
    body = disc(face) + padLabel(name, 24);
  } else if (index >= 4 && index <= 7) {
    body = `<rect x="2" y="11" width="44" height="26" rx="11" fill="${PAD_DARK}"/>` + padLabel(name, 17);
  } else if (index >= 12 && index <= 15) {
    body =
      disc(PAD_DARK) +
      inner('<path d="M24 35V13M15 22l9-9 9 9"/>', `rotate(${DPAD_ROTATION[index - 12]} 24 24)`);
  } else if (index === 8 || index === 9) {
    body =
      disc(PAD_DARK) + inner(ICON_BODIES[index === 8 ? 'view' : 'menu'], 'translate(10.8 10.8) scale(.55)');
  } else {
    body = disc(PAD_DARK) + padLabel(name, 15);
  }
  return svg(body, size, false);
}

/**
 * Prompt glyph for an action on the given device: a pad badge, the touch button icon, or the first
 * keyboard/mouse binding. Returns '' when the device has nothing to show.
 */
export function actionGlyph(
  device: InputDevice,
  codes: readonly string[],
  padButton: number | undefined,
  touchIcon: IconName | null,
): string {
  if (device === 'pad' && padButton !== undefined) {
    return `<span class="pg-glyph" style="${ICON_GLYPH_STYLE}">${padGlyph(padButton)}</span>`;
  }
  if (device === 'touch' && touchIcon) return iconGlyph(touchIcon);
  const code = codes[0];
  return code ? bindingGlyph(code) : '';
}
