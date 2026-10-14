/**
 * The Settings overlay skeleton: scrim, panel (dialog), title, BACK button, the tab row and the empty tab
 * panel that SettingsUI fills. Pad glyphs (B on BACK, LB / RB beside the tabs) are hidden until a pad is used.
 */
import { t } from '../core/I18n';
import { h } from './dom';
import { padGlyph } from './Svg';
import { SETTINGS_TABS, type SettingsTab } from './settings-rows';

const BODY_ID = 'pg-settings-body';
const TITLE_ID = 'pg-settings-title';
const BACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1.2em" height="1.2em" fill="none" ' +
  'stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><path d="M30 10 16 24l14 14"/></svg>';

export interface SettingsView {
  readonly root: HTMLDivElement;
  readonly panel: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly tabs: readonly HTMLButtonElement[];
  /** Shown only while the pad is the device in use. */
  readonly padOnly: readonly HTMLElement[];
  /** Hidden while the pad is the device in use (the BACK arrow makes way for the B badge). */
  readonly nonPad: readonly HTMLElement[];
}

export interface SettingsViewHandlers {
  back(): void;
  tab(id: SettingsTab): void;
  tabKey(e: KeyboardEvent): void;
}

/** `pop` plays the opening pop (not when the screen is rebuilt for a language change). */
export function buildSettingsView(on: SettingsViewHandlers, pop: boolean): SettingsView {
  const arrow = h('span', { className: 'pg-settings__backicon', 'aria-hidden': 'true' });
  arrow.innerHTML = BACK_SVG; // our own markup
  const padB = glyphSpan(padGlyph(1, '1.5em'));
  const padLB = glyphSpan(padGlyph(4, '2.4em'));
  const padRB = glyphSpan(padGlyph(5, '2.4em'));
  const tabs = SETTINGS_TABS.map((id) =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: tabElementId(id),
        className: 'pg-settings__tab',
        'aria-controls': BODY_ID,
        dataset: { focusId: `tab:${id}` },
        onClick: () => on.tab(id),
      },
      t(`ui.settings.section.${id}`),
    ),
  );
  const tablist = h(
    'div',
    {
      className: 'pg-settings__tablist',
      role: 'tablist',
      'aria-label': t('ui.settings.tabs'),
      onKeydown: on.tabKey,
    },
    tabs,
  );
  const body = h('div', { className: 'pg-settings__body', id: BODY_ID, role: 'tabpanel', tabIndex: -1 });
  const back = h(
    'button',
    {
      type: 'button',
      className: 'btn pg-settings__back',
      dataset: { focusId: 'back' },
      onClick: () => on.back(),
    },
    padB,
    arrow,
    h('span', null, t('ui.common.back')),
  );
  const panel = h(
    'div',
    {
      className: pop ? 'panel pg-settings__panel pop-in' : 'panel pg-settings__panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': TITLE_ID,
    },
    h(
      'div',
      { className: 'pg-settings__head' },
      h('h2', { className: 'pg-settings__title', id: TITLE_ID }, t('ui.settings.title')),
      back,
    ),
    h('div', { className: 'pg-settings__tabs' }, padLB, tablist, padRB),
    body,
  );
  const root = h(
    'div',
    // Pointer input hides the keyboard / pad focus ring again (see .is-nav in settings.css).
    { className: 'pg-settings ui-interactive', onPointerdown: () => root.classList.remove('is-nav') },
    panel,
  );
  return { root, panel, body, tabs, padOnly: [padB, padLB, padRB], nonPad: [arrow] };
}

export function tabElementId(id: SettingsTab): string {
  return `pg-settings-tab-${id}`;
}

function glyphSpan(markup: string): HTMLSpanElement {
  const span = h('span', { className: 'pg-settings__padglyph', 'aria-hidden': 'true', hidden: true });
  span.innerHTML = markup; // our own SVG markup (Svg.ts)
  return span;
}
