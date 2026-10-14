/**
 * Settings > Controls (GDD 2.6 "All keys remappable. Settings saved.", GDD 2.14 "remap list, Press a key...,
 * RESET"): every Action with its current keys, a "Press a key..." capture through input.captureNextKey()
 * (Esc cancels), RESET (input.resetBindings()), and read-only gamepad and touch cards (settings-cards.ts).
 *
 * - Each key is a button; pressing it waits for the next key or mouse button and rebinds that slot. An action
 *   with one key also gets a "+" slot to add a second. Input moves a key that another action used, and refuses
 *   a change that would leave an action with no key at all: the screen then says so.
 * - While waiting, a prompt covers the panel. Keyboard and mouse players cancel with Esc (any mouse button is
 *   a valid binding, so there is no mouse-clickable Cancel); touch and pad players get a CANCEL button (and pad
 *   B), which cancels by sending Esc to Input's capture.
 * - The debug action is listed only where the debug panel exists (dev builds, ?debug=1).
 */
import './settings-controls.css';
import { events } from '../core/Events';
import { debugEnabled } from '../core/Flags';
import { i18n, t } from '../core/I18n';
import { ACTIONS, DEFAULT_BINDINGS, type Action, type InputDevice } from '../core/Input';
import { services } from '../core/Services';
import { h, setText } from './dom';
import { bindingGlyph, keyGlyph } from './Svg';
import { gamepadCard, touchCard } from './settings-cards';
import { focusInto } from './settings-nav';

/** Slots shown per action: the primary key and one alternate (actions may hold up to 4; all are shown). */
const MIN_SLOTS = 2;
const STATUS_MS = 4500;

export class ControlsTab {
  readonly el: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly status: HTMLParagraphElement;
  private readonly prompt: HTMLDivElement;
  private readonly promptAction: HTMLParagraphElement;
  private readonly promptHint: HTMLParagraphElement;
  private readonly promptError: HTMLParagraphElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly overlayParent: HTMLElement;
  private captureToken = 0;
  private capturing = false;
  private statusTimer: number | null = null;
  private disposed = false;

  /** `overlayParent` hosts the "Press a key..." prompt (the panel, so it covers the whole screen's content). */
  constructor(overlayParent: HTMLElement, device: InputDevice) {
    this.overlayParent = overlayParent;
    const titleId = 'pg-set-keys-title';
    this.list = h('ul', { className: 'pg-set-keys', 'aria-labelledby': titleId });
    this.status = h('p', { className: 'pg-set-status', role: 'status', 'aria-live': 'polite' });
    const reset = h(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary pg-set-reset',
        dataset: { focusId: 'reset' },
        disabled: !services.has('input'),
        onClick: () => this.reset(),
      },
      t('ui.settings.reset'),
    );
    this.el = h(
      'div',
      { className: 'pg-set-controls' },
      h(
        'section',
        { className: 'pg-set-group' },
        h(
          'div',
          { className: 'pg-set-group__head' },
          h('h3', { className: 'pg-set-group__title', id: titleId }, t('ui.settings.controls.keyboard')),
          reset,
        ),
        this.status,
        this.list,
      ),
      gamepadCard(),
      touchCard(),
    );

    this.promptAction = h('p', { className: 'pg-set-capture__action' });
    this.promptHint = h('p', { className: 'pg-set-capture__hint' }, t('ui.settings.controls.escToCancel'));
    this.promptError = h('p', {
      className: 'pg-set-capture__error',
      role: 'status',
      'aria-live': 'assertive',
    });
    this.cancelBtn = h(
      'button',
      { type: 'button', className: 'btn pg-set-capture__cancel', onClick: () => this.cancelCapture() },
      t('ui.settings.controls.cancel'),
    );
    this.prompt = h(
      'div',
      { className: 'pg-set-capture', hidden: true },
      h(
        'div',
        { className: 'pg-set-capture__box', role: 'alertdialog', 'aria-modal': 'true', tabIndex: -1 },
        this.promptAction,
        h('p', { className: 'pg-set-capture__prompt' }, t('ui.settings.pressKey')),
        this.promptError,
        this.promptHint,
        this.cancelBtn,
      ),
    );
    this.overlayParent.appendChild(this.prompt);
    this.setDevice(device);
    this.refresh();
  }

  /** True while waiting for a key: the screen must leave keys and pad buttons to the capture. */
  get isCapturing(): boolean {
    return this.capturing;
  }

  /** Rebuilds the key list from Input (after 'input:bindings'), keeping focus on the same slot. */
  refresh(): void {
    const focusId =
      document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusId : '';
    const input = services.tryGet('input');
    const rows: HTMLLIElement[] = [];
    for (const action of ACTIONS) {
      if (action === 'debug' && !debugEnabled) continue;
      const codes = input ? input.getBindings(action) : [...DEFAULT_BINDINGS[action]];
      rows.push(this.row(action, codes, input !== null));
    }
    this.list.replaceChildren(...rows);
    if (focusId)
      this.list.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)?.focus({ preventScroll: true });
  }

  /** Touch and pad players get a CANCEL button; keyboard and mouse players are told about Esc. */
  setDevice(device: InputDevice): void {
    const kbm = device === 'kbm';
    this.cancelBtn.hidden = kbm;
    this.promptHint.hidden = !kbm;
  }

  /** Ends a pending capture without changing anything. */
  cancelCapture(): void {
    if (!this.capturing) return;
    // Input's KeyCapture listens first on window (capture phase) and stops the event, so this Esc reaches
    // only the capture: it resolves with '' (cancelled) and never counts as a pause press. The keyup is a
    // safety net: should the keydown ever reach Input, Esc is not left held.
    const init: KeyboardEventInit = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
    this.endCapture(); // the capture's own continuation finds it already closed
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelCapture();
    this.disposed = true;
    this.captureToken++;
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.prompt.remove();
    this.el.remove();
  }

  // ----------------------------------------------------------------------------------------------- internals

  private row(action: Action, codes: readonly string[], enabled: boolean): HTMLLIElement {
    const label = t(`ui.settings.action.${action}`);
    const slots: HTMLButtonElement[] = codes.map((code, slot) => {
      const btn = h('button', {
        type: 'button',
        className: 'pg-set-keybtn',
        disabled: !enabled,
        'aria-label': t('ui.settings.controls.changeKey', { action: label, key: keyName(code) }),
        dataset: { focusId: `key:${action}:${slot}` },
        onClick: () => void this.capture(action, slot),
      });
      btn.innerHTML = bindingGlyph(code); // our own markup; the legend is escaped by Svg.ts
      return btn;
    });
    for (let slot = codes.length; slot < MIN_SLOTS; slot++) {
      slots.push(
        h(
          'button',
          {
            type: 'button',
            className: 'pg-set-keybtn pg-set-keybtn--add',
            disabled: !enabled,
            'aria-label': t('ui.settings.controls.addKey', { action: label }),
            dataset: { focusId: `key:${action}:${slot}` },
            onClick: () => void this.capture(action, slot),
          },
          h('span', { 'aria-hidden': 'true' }, '+'),
        ),
      );
    }
    return h(
      'li',
      { className: 'pg-set-key' },
      h('span', { className: 'pg-set-key__label' }, label),
      h('span', { className: 'pg-set-key__slots' }, slots),
    );
  }

  /** Waits for a key and rebinds; a refused key keeps the prompt open and says why (Esc still cancels). */
  private async capture(action: Action, slot: number): Promise<void> {
    const input = services.tryGet('input');
    if (!input || this.disposed) return;
    const token = ++this.captureToken;
    this.capturing = true;
    setText(this.promptAction, t(`ui.settings.action.${action}`));
    setText(this.promptError, '');
    this.prompt.hidden = false;
    const box = this.prompt.firstElementChild;
    if (box instanceof HTMLElement) box.focus({ preventScroll: true });
    events.emit('sfx', { id: 'ui_click' });
    for (;;) {
      const code = await input.captureNextKey();
      if (token !== this.captureToken || this.disposed) return;
      if (!code || !this.capturing) break; // cancelled
      if (input.rebind(action, code, slot)) {
        events.emit('sfx', { id: 'ui_choice' });
        break;
      }
      setText(this.promptError, t('ui.settings.controls.refused'));
    }
    this.endCapture();
    // The list was rebuilt on 'input:bindings'; put focus back on the slot that was changed.
    const target = this.list.querySelector<HTMLElement>(`[data-focus-id="key:${action}:${slot}"]`);
    if (target) focusInto(target);
  }

  private endCapture(): void {
    this.capturing = false;
    this.prompt.hidden = true;
  }

  private reset(): void {
    const input = services.tryGet('input');
    if (!input) return;
    this.cancelCapture();
    input.resetBindings();
    events.emit('sfx', { id: 'ui_choice' });
    this.say(t('ui.settings.controls.resetDone'));
  }

  private say(text: string): void {
    setText(this.status, text);
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = null;
      setText(this.status, '');
    }, STATUS_MS);
  }
}

/** Spoken name of a key: a translated name where we have one (ui.settings.key.*), else its keycap legend. */
function keyName(code: string): string {
  const key = `ui.settings.key.${code}`;
  return i18n.has(key) ? t(key) : keyGlyph(code);
}
