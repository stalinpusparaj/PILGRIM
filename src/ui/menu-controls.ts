/**
 * Pause > CONTROLS (GDD 2.14): a readable card of the controls for the device in use, built from the live
 * bindings (keyboard keys follow the player's remapping; gamepad and touch from the tables Input uses). Tabs
 * switch between keyboard and mouse, gamepad and touch. Every row is focusable, so keyboard and pad players can
 * walk down a long card on a small screen.
 */
import { events } from '../core/Events';
import { debugEnabled } from '../core/Flags';
import { t } from '../core/I18n';
import { ACTIONS, PAD_BINDINGS, type Action, type InputDevice } from '../core/Input';
import { services } from '../core/Services';
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, menuButton, uid } from './menu-screen';
import { bindingGlyph, icon, padGlyph, type IconName } from './Svg';

export interface ControlsCardOptions {
  onBack(): void;
  onMenuButton?: () => void;
}

const DEVICES: readonly InputDevice[] = ['kbm', 'pad', 'touch'];
const DEVICE_KEYS: Record<InputDevice, string> = {
  kbm: 'ui.settings.controls.keyboard',
  pad: 'ui.settings.controls.gamepad',
  touch: 'ui.settings.controls.touch',
};
const MOVES: readonly Action[] = ['moveForward', 'moveLeft', 'moveBack', 'moveRight'];
const CHOICES: readonly Action[] = ['choice1', 'choice2', 'choice3'];
const DPAD = [12, 13, 14, 15];
const TOUCH_BUTTONS: ReadonlyArray<{ id: IconName; label: string; actions: readonly Action[] }> = [
  { id: 'jump', label: 'ui.touch.jump', actions: ['jump', 'skip'] },
  { id: 'use', label: 'ui.touch.use', actions: ['use'] },
  { id: 'pray', label: 'ui.touch.pray', actions: ['pray'] },
  { id: 'sword', label: 'ui.touch.sword', actions: ['sword'] },
  { id: 'shield', label: 'ui.touch.shield', actions: ['shield'] },
];
/** A thumb stick and a swipe, drawn here (our own inline SVG, GDD 2.3). */
const STICK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1.6em" height="1.6em" fill="none" ' +
  'stroke="currentColor" stroke-width="4" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="19"/>' +
  '<circle cx="24" cy="24" r="8" fill="currentColor"/></svg>';
const SWIPE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1.6em" height="1.6em" fill="none" ' +
  'stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><path d="M6 24h36M14 16l-8 8 8 8M34 16l8 8-8 8"/></svg>';

export class ControlsCard {
  readonly root: HTMLDivElement;
  private readonly texts: Texts;
  private readonly tabs: Record<InputDevice, HTMLButtonElement>;
  private readonly list: HTMLUListElement;
  private readonly menu: Menu;
  private readonly offs: Array<() => void> = [];
  private device: InputDevice;
  private picked = false;

  constructor(parent: HTMLElement, o: ControlsCardOptions) {
    this.texts = new Texts(() => this.render());
    this.device = services.tryGet('input')?.device ?? 'kbm';
    const titleId = uid('pg-controls');
    const tabRow = this.texts.attr(
      h('div', { className: 'pg-controls__tabs', role: 'tablist' }),
      'aria-label',
      'ui.controls.devices',
    );
    this.tabs = {} as Record<InputDevice, HTMLButtonElement>;
    for (const d of DEVICES) {
      const tab = h('button', {
        type: 'button',
        className: 'pg-tab',
        role: 'tab',
        dataset: { menuItem: '', key: DEVICE_KEYS[d] },
        onClick: () => this.select(d, true),
      });
      this.texts.text(tab, DEVICE_KEYS[d]);
      this.tabs[d] = tab;
      tabRow.append(tab);
    }
    this.list = h('ul', { className: 'pg-controls__list', role: 'tabpanel' });
    const back = menuButton(this.texts, 'ui.common.back', {
      onClick: () => o.onBack(),
      className: 'pg-controls__back',
    });
    this.root = h(
      'div',
      { className: 'panel pg-menu-panel pg-controls pop-in', role: 'dialog', 'aria-labelledby': titleId },
      this.texts.text(h('h2', { className: 'pg-menu-title', id: titleId }), 'ui.pause.controls'),
      tabRow,
      this.list,
      back,
    );
    this.render();
    parent.appendChild(this.root);
    this.menu = new Menu({
      root: this.root,
      nav: 'vertical',
      items: () => [this.tabs.kbm, this.tabs.pad, this.tabs.touch, ...this.rows(), back],
      initial: () => this.tabs[this.device],
      onBack: () => o.onBack(),
      onShoulder: (dir) => this.cycle(dir),
      ...(o.onMenuButton ? { onMenuButton: o.onMenuButton } : {}),
    });
    this.offs.push(
      events.on('input:bindings', () => this.render()),
      events.on('input:device', ({ device }) => {
        if (!this.picked) this.select(device, false);
      }),
    );
  }

  get shown(): InputDevice {
    return this.device;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }

  private rows(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>('[data-menu-item]')];
  }

  private cycle(dir: -1 | 1): void {
    const i = DEVICES.indexOf(this.device);
    const next = DEVICES[(i + dir + DEVICES.length) % DEVICES.length]!;
    this.select(next, true);
    this.menu.focus(this.tabs[next]);
  }

  private select(d: InputDevice, byPlayer: boolean): void {
    if (byPlayer) this.picked = true;
    if (d === this.device) return;
    const focusWasRow = this.menu?.focused?.closest('.pg-controls__list') != null;
    this.device = d;
    this.render();
    if (focusWasRow) this.menu.focus(this.tabs[d], false);
  }

  private render(): void {
    for (const d of DEVICES) {
      const on = d === this.device;
      this.tabs[d].setAttribute('aria-selected', String(on));
      this.tabs[d].classList.toggle('is-selected', on);
    }
    const rows = this.device === 'kbm' ? keyboardRows() : this.device === 'pad' ? padRows() : touchRows();
    this.list.replaceChildren(...rows);
  }
}

// ------------------------------------------------------------------------------------------------- rows

function glyphs(markup: string): HTMLSpanElement {
  const span = h('span', { className: 'pg-controls__glyphs', 'aria-hidden': 'true' });
  span.innerHTML = markup; // our own SVG / escaped key legends from Svg.ts
  return span;
}

function chip(text: string): string {
  const span = document.createElement('span');
  span.className = 'pg-controls__chip';
  span.textContent = text;
  return span.outerHTML;
}

function row(visual: HTMLElement, label: string, note?: string): HTMLLIElement {
  return h(
    'li',
    { className: 'pg-controls__row', tabIndex: -1, dataset: { menuItem: '' } },
    visual,
    h('span', { className: 'pg-controls__label' }, label, note ? h('small', null, note) : null),
  );
}

function bindingsOf(a: Action): string[] {
  return services.tryGet('input')?.getBindings(a) ?? [];
}

function keyboardRows(): HTMLLIElement[] {
  const out: HTMLLIElement[] = [];
  const primary = MOVES.map((a) => bindingsOf(a)[0]).filter((c): c is string => !!c);
  const alt = MOVES.map((a) => bindingsOf(a)[1]).filter((c): c is string => !!c);
  const sets = [primary, alt].filter((s) => s.length > 0).map((s) => s.map(bindingGlyph).join(''));
  out.push(row(glyphs(sets.join('<span class="pg-controls__or">/</span>')), t('ui.settings.controls.move')));
  out.push(row(glyphs(chip(t('ui.controls.mouse'))), t('ui.settings.controls.look')));
  for (const a of ACTIONS) {
    if (MOVES.includes(a) || CHOICES.includes(a) || (a === 'debug' && !debugEnabled)) continue;
    out.push(row(glyphs(bindingsOf(a).map(bindingGlyph).join('')), t(`ui.settings.action.${a}`)));
    if (a === 'skip') {
      const keys = CHOICES.map((c) => bindingsOf(c)[0]).filter((c): c is string => !!c);
      out.push(row(glyphs(keys.map(bindingGlyph).join('')), t('ui.controls.choices')));
    }
  }
  return out;
}

function padRows(): HTMLLIElement[] {
  const out: HTMLLIElement[] = [];
  const dpad = DPAD.map((b) => padGlyph(b)).join('');
  out.push(row(glyphs(chip(t('ui.settings.controls.leftStick')) + dpad), t('ui.settings.controls.move')));
  out.push(row(glyphs(chip(t('ui.settings.controls.rightStick'))), t('ui.settings.controls.look')));
  for (const [button, actions] of PAD_BINDINGS) {
    if (DPAD.includes(button)) continue;
    const label = actions.map((a) => t(`ui.settings.action.${a}`)).join(' · ');
    out.push(row(glyphs(padGlyph(button)), label));
  }
  return out;
}

function touchRows(): HTMLLIElement[] {
  const out: HTMLLIElement[] = [];
  out.push(row(glyphs(STICK_SVG), t('ui.settings.controls.move'), t('ui.settings.touch.stick')));
  out.push(row(glyphs(SWIPE_SVG), t('ui.settings.controls.look'), t('ui.settings.touch.look')));
  for (const b of TOUCH_BUTTONS) {
    const label = `${t(b.label)}: ${b.actions.map((a) => t(`ui.settings.action.${a}`)).join(' · ')}`;
    out.push(row(glyphs(`<span class="pg-controls__round">${icon(b.id, '1.3em')}</span>`), label));
  }
  out.push(row(glyphs(icon('satchel', '1.6em')), t('ui.settings.touch.satchel')));
  out.push(row(glyphs(icon('pause', '1.6em')), t('ui.settings.touch.pause')));
  out.push(row(glyphs(icon('sword', '1.6em')), t('ui.settings.touch.combat')));
  return out;
}
