/**
 * Read-only reference cards for Settings > Controls: the gamepad layout (GDD 2.6 "Gamepad", not remappable)
 * and the touch controls (GDD 2.6 "Touch"). Built from the same tables Input uses (PAD_BINDINGS,
 * TOUCH_ACTIONS), so they always match the game.
 *
 * Each card is focusable (tabindex 0) so keyboard and pad users can scroll down to read it.
 */
import { t } from '../core/I18n';
import { PAD_BINDINGS, type Action } from '../core/Input';
import { h } from './dom';
import { icon, padGlyph, type IconName } from './Svg';
import { TOUCH_ACTIONS } from './Touch';

/** D-pad buttons (standard mapping 12..15) are shown as one "Move" row. */
const DPAD = [12, 13, 14, 15];

/** Markup from our own SVG builders (no user text), inside an aria-hidden span. */
function glyph(markup: string, className = 'pg-set-ref__glyph'): HTMLSpanElement {
  const span = h('span', { className, 'aria-hidden': 'true' });
  span.innerHTML = markup;
  return span;
}

function actionText(actions: readonly Action[]): string {
  return actions.map((a) => t(`ui.settings.action.${a}`)).join(' · ');
}

function row(visual: HTMLElement, name: string | null, text: string): HTMLLIElement {
  return h(
    'li',
    { className: 'pg-set-ref__row' },
    visual,
    h(
      'span',
      { className: 'pg-set-ref__text' },
      name ? h('strong', { className: 'pg-set-ref__name' }, name) : null,
      h('span', null, text),
    ),
  );
}

function card(id: string, title: string, note: string | null, rows: HTMLLIElement[]): HTMLElement {
  const titleId = `pg-set-ref-${id}`;
  return h(
    'section',
    {
      className: 'pg-set-ref panel-inset',
      tabIndex: 0,
      role: 'group',
      'aria-labelledby': titleId,
      dataset: { focusId: `card:${id}` },
    },
    h('h3', { className: 'pg-set-group__title', id: titleId }, title),
    note ? h('p', { className: 'pg-set-ref__note' }, note) : null,
    h('ul', { className: 'pg-set-ref__list' }, rows),
  );
}

export function gamepadCard(): HTMLElement {
  const rows: HTMLLIElement[] = [
    row(glyph(padGlyph(10, '100%')), t('ui.settings.controls.leftStick'), t('ui.settings.controls.move')),
    row(glyph(padGlyph(11, '100%')), t('ui.settings.controls.rightStick'), t('ui.settings.controls.look')),
    row(
      glyph(DPAD.map((b) => padGlyph(b, '50%')).join(''), 'pg-set-ref__glyph pg-set-ref__glyph--dpad'),
      t('ui.settings.controls.dpad'),
      t('ui.settings.controls.move'),
    ),
  ];
  for (const [button, actions] of PAD_BINDINGS) {
    if (DPAD.includes(button)) continue;
    rows.push(row(glyph(padGlyph(button, '100%')), null, actionText(actions)));
  }
  return card('pad', t('ui.settings.controls.gamepad'), t('ui.settings.controls.padNote'), rows);
}

/** Our own little joystick and look-drag pictures (48×48 grid, like Svg.ts icons). */
const STICK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="100%" height="100%" fill="none" ' +
  'stroke="currentColor" stroke-width="4" aria-hidden="true" focusable="false">' +
  '<circle cx="24" cy="24" r="19"/><circle cx="24" cy="24" r="8" fill="currentColor"/></svg>';
const LOOK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="100%" height="100%" fill="none" ' +
  'stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><path d="M8 24h32M14 17l-7 7 7 7M34 17l7 7-7 7"/></svg>';

const ROUND_BUTTONS: ReadonlyArray<'jump' | 'use' | 'pray' | 'sword' | 'shield'> = [
  'jump',
  'use',
  'pray',
  'sword',
  'shield',
];

function roundIcon(name: IconName): HTMLSpanElement {
  return glyph(icon(name, '100%'), 'pg-set-ref__glyph pg-set-ref__glyph--round');
}

export function touchCard(): HTMLElement {
  const rows: HTMLLIElement[] = [
    row(glyph(STICK_SVG), null, t('ui.settings.touch.stick')),
    row(glyph(LOOK_SVG), null, t('ui.settings.touch.look')),
  ];
  // The round button's picture is what the player sees on screen; the text says what it does.
  for (const id of ROUND_BUTTONS) rows.push(row(roundIcon(id), null, actionText(TOUCH_ACTIONS[id])));
  rows.push(row(roundIcon('satchel'), null, t('ui.settings.touch.satchel')));
  rows.push(row(roundIcon('pause'), null, t('ui.settings.touch.pause')));
  return card('touch', t('ui.settings.controls.touch'), t('ui.settings.touch.combat'), rows);
}
