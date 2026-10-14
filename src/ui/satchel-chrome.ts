/**
 * The frame of MY SATCHEL: scrim, rounded panel (role=dialog), title "MY SATCHEL", close button, the five tabs
 * (ARIA tabs with icons; icon-only on narrow screens, where the page title names the tab), the scrolling page
 * body and the footer ("Promises: 7 of 24", "Detours: 2", plus the Hope lantern, which has no numbers).
 */
import { PROMISE_TOTAL, type GameState } from '../core/GameState';
import { t } from '../core/I18n';
import { h, setText } from './dom';
import { knownPromiseCount } from './satchel-data';
import { lanternSvg, tabIcon, uiIcon } from './satchel-icons';
import { SATCHEL_TABS, svgSpan, type SatchelTab } from './satchel-view';
import { padGlyph } from './Svg';

export interface TabParts {
  button: HTMLButtonElement;
  label: HTMLSpanElement;
}

export interface SatchelChrome {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  title: HTMLHeadingElement;
  close: HTMLButtonElement;
  tablist: HTMLDivElement;
  tabs: Map<SatchelTab, TabParts>;
  pageTitle: HTMLHeadingElement;
  body: HTMLDivElement;
  page: HTMLDivElement;
  hope: HTMLSpanElement;
  promises: HTMLSpanElement;
  detours: HTMLSpanElement;
}

const TAB_KEYS: Record<SatchelTab, string> = {
  roll: 'ui.satchel.tab.roll',
  promises: 'ui.satchel.tab.promises',
  friends: 'ui.satchel.tab.friends',
  map: 'ui.satchel.tab.map',
  carried: 'ui.satchel.tab.carried',
};

export function tabLabel(tab: SatchelTab): string {
  return t(TAB_KEYS[tab]);
}

export function buildChrome(onTab: (tab: SatchelTab) => void, onClose: () => void): SatchelChrome {
  const title = h('h1', { className: 'pg-satchel__title', id: 'pg-satchel-title' });
  const padHint = h('span', { className: 'pg-satchel__padHint', 'aria-hidden': 'true' });
  padHint.innerHTML = `${padGlyph(4, '1.5em')}${padGlyph(5, '1.5em')}`; // our own SVG markup
  const close = h(
    'button',
    { type: 'button', className: 'btn btn-secondary pg-satchel__close', onClick: onClose },
    svgSpan('pg-satchel__closeIcon', uiIcon('close', '1.3em')),
    svgSpan('pg-satchel__padB', padGlyph(1, '1.3em')),
  );
  const tabs = new Map<SatchelTab, TabParts>();
  const tablist = h('div', { className: 'pg-satchel__tabs', role: 'tablist' });
  for (const tab of SATCHEL_TABS) {
    const label = h('span', { className: 'pg-satchel__tabLabel' });
    const button = h(
      'button',
      {
        type: 'button',
        className: 'pg-satchel__tab',
        role: 'tab',
        id: `pg-satchel-tab-${tab}`,
        'aria-controls': 'pg-satchel-page',
        tabIndex: -1,
        dataset: { key: `tab:${tab}`, tab },
        onClick: () => onTab(tab),
      },
      svgSpan('pg-satchel__tabIcon', tabIcon(tab, '1.7em')),
      label,
    );
    tabs.set(tab, { button, label });
    tablist.append(button);
  }
  const pageTitle = h('h2', { className: 'pg-satchel__pageTitle' });
  const page = h('div', { className: 'pg-satchel__page', id: 'pg-satchel-page', role: 'tabpanel' });
  const body = h('div', { className: 'pg-satchel__body', dataset: { scroll: 1 } }, pageTitle, page);
  const hope = h('span', { className: 'pg-satchel__hope', role: 'img' });
  hope.innerHTML = lanternSvg('2em'); // our own SVG markup
  const promises = h('span', { className: 'pg-satchel__count' });
  const detours = h('span', { className: 'pg-satchel__count pg-satchel__count--detours' });
  const panel = h(
    'div',
    {
      className: 'panel pg-satchel__panel pop-in',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'pg-satchel-title',
    },
    h('header', { className: 'pg-satchel__head' }, title, padHint, close),
    tablist,
    body,
    h('footer', { className: 'pg-satchel__foot' }, hope, promises, detours),
  );
  const root = h('div', { className: 'pg-satchel' }, panel);
  return { root, panel, title, close, tablist, tabs, pageTitle, body, page, hope, promises, detours };
}

/** Writes every translated string of the frame (also after a language change). */
export function applyChromeText(c: SatchelChrome, current: SatchelTab): void {
  setText(c.title, t('ui.satchel.title'));
  c.close.setAttribute('aria-label', t('ui.common.close'));
  c.close.title = t('ui.common.close');
  c.tablist.setAttribute('aria-label', t('ui.satchel.tabs'));
  c.hope.setAttribute('aria-label', t('ui.hud.hope'));
  for (const [tab, parts] of c.tabs) {
    const text = tabLabel(tab);
    setText(parts.label, text);
    parts.button.setAttribute('aria-label', text);
  }
  setText(c.pageTitle, tabLabel(current));
  c.page.setAttribute('aria-labelledby', `pg-satchel-tab-${current}`);
}

/** Marks the selected tab (aria-selected + roving tabindex; the style adds a raised shape, not only colour). */
export function selectTabButton(c: SatchelChrome, current: SatchelTab): void {
  for (const [tab, parts] of c.tabs) {
    const on = tab === current;
    parts.button.setAttribute('aria-selected', String(on));
    parts.button.tabIndex = on ? 0 : -1;
  }
  setText(c.pageTitle, tabLabel(current));
  c.page.setAttribute('aria-labelledby', `pg-satchel-tab-${current}`);
}

export function updateFooter(c: SatchelChrome, state: GameState): void {
  const n = knownPromiseCount(state.data.promises);
  const promises = t('ui.satchel.footer.promises', { n, total: PROMISE_TOTAL });
  const detours = t('ui.satchel.footer.detours', { n: state.data.detours.length });
  if (c.promises.dataset['text'] !== promises) {
    c.promises.dataset['text'] = promises;
    c.promises.replaceChildren(svgSpan('pg-satchel__countIcon', tabIcon('promises', '1.3em')), promises);
  }
  if (c.detours.dataset['text'] !== detours) {
    c.detours.dataset['text'] = detours;
    c.detours.replaceChildren(svgSpan('pg-satchel__countIcon', tabIcon('map', '1.3em')), detours);
  }
  c.hope.style.setProperty('--hope', (Math.max(0, Math.min(100, state.hope)) / 100).toFixed(3));
}
