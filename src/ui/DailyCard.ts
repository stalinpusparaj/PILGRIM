/**
 * Morning Manna (DECISIONS #403): the day's three tips, the Pilgrim's Path (7 stones, gold where the day's quest was
 * done), today's little quest and, once earned, the lantern colours. Opens by itself over the title once a day
 * (from the second day on) and from the sun button in the title's corner (`DailyButton`).
 */
import './daily.css';
import { PATH_STONES, QUESTS, daily, dayKey } from '../core/Daily';
import { t } from '../core/I18n';
import { cheerFor, tipsFor, type Tip } from '../game/daily-tips';
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, menuButton, playSfx, uid } from './menu-screen';

export const SUN_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="13" r="5" fill="#ffd36b" stroke="#c98a1b" stroke-width="1.5"/>' +
  '<g stroke="#e8a930" stroke-width="2" stroke-linecap="round"><path d="M12 3.5v2.5M4.5 13H2M22 13h-2.5M5.8 6.8l1.8 1.8M18.2 6.8l-1.8 1.8"/></g>' +
  '<path d="M3 20h18" stroke="#8a6a3a" stroke-width="2" stroke-linecap="round"/></svg>';

const TIP_LABEL: Record<Tip['kind'], string> = {
  hint: 'ui.daily.kind.hint', play: 'ui.daily.kind.play', verse: 'ui.daily.kind.verse', fact: 'ui.daily.kind.fact',
};

export interface DailyCardOptions {
  /** The chapter the player is in (chapter hints). */
  chapter: number;
  onClose(): void;
}

export class DailyCard {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts(() => this.render());
  private readonly body = h('div', { className: 'pg-daily__body' });
  private readonly lanternRow = h('div', { className: 'pg-daily__lanterns' });
  private readonly menu: Menu;
  private readonly go: HTMLButtonElement;
  private readonly gift: string;

  constructor(parent: HTMLElement, private readonly o: DailyCardOptions) {
    this.gift = daily.data.newGift;
    daily.markCardShown();
    const titleId = uid('pg-daily');
    const sun = h('div', { className: 'pg-daily__sun', 'aria-hidden': 'true' });
    sun.innerHTML = SUN_ICON;
    this.go = menuButton(this.texts, 'ui.daily.go', { primary: true, icon: 'play', onClick: () => o.onClose() });
    const panel = h(
      'div',
      { className: 'panel pg-menu-panel pg-daily__panel pop-in', role: 'dialog', 'aria-labelledby': titleId },
      h('div', { className: 'pg-daily__head' }, sun, this.texts.text(h('h2', { className: 'pg-menu-title pg-daily__title', id: titleId }), 'ui.daily.title')),
      this.body,
      this.lanternRow,
      this.go,
    );
    this.root = h('div', { className: 'pg-screen pg-scrim pg-daily' }, panel);
    parent.appendChild(this.root);
    this.render();
    this.menu = new Menu({
      root: this.root,
      items: () => [...this.lanternRow.querySelectorAll<HTMLElement>('[data-menu-item]'), this.go],
      onBack: () => o.onClose(),
      autoFocus: false,
    });
    playSfx('ui_open');
    // Focus on LET'S GO (bottom) without scrolling: the card opens at its top, the greeting and tips.
    this.go.focus({ preventScroll: true });
  }

  private render(): void {
    const d = daily.data;
    const tips = tipsFor(dayKey(), this.o.chapter).map((tip) =>
      h(
        'li',
        { className: `pg-daily__tip pg-daily__tip--${tip.kind}` },
        h('span', { className: 'pg-daily__kind' }, t(TIP_LABEL[tip.kind])),
        h('span', { className: 'pg-daily__text' }, t(tip.key)),
        tip.ref ? h('span', { className: 'pg-daily__ref' }, t(tip.ref)) : null,
      ),
    );
    const stones = Array.from({ length: PATH_STONES }, (_, i) =>
      h('span', {
        className: `pg-daily__stone${i < d.stones ? ' is-lit' : ''}${d.gold.includes(i) ? ' is-gold' : ''}${i === d.stones - 1 ? ' is-today' : ''}`,
      }),
    );
    const q = daily.quest;
    const quest = q
      ? h(
          'div',
          { className: `pg-daily__quest${q.done ? ' is-done' : ''}` },
          h('span', { className: 'pg-daily__kind' }, t('ui.daily.quest')),
          h('span', { className: 'pg-daily__text' }, t(`ui.daily.quest.${q.id}`)),
          h('span', { className: 'pg-daily__progress' }, q.done ? t('ui.daily.questDoneShort') : t('ui.daily.progress', { n: q.n, total: QUESTS[q.id].need })),
        )
      : null;
    const gift = this.gift ? h('p', { className: 'pg-daily__gift' }, t('ui.daily.gift', { name: t(`ui.daily.lantern.${this.gift}`) })) : null;
    this.body.replaceChildren(
      h(
        'div',
        { className: 'pg-daily__cheer' },
        h('span', { className: 'pg-daily__kind' }, t('ui.daily.kind.cheer')),
        h('p', { className: 'pg-daily__cheer-text' }, t(cheerFor(dayKey()))),
      ),
      h('p', { className: 'pg-daily__greet' }, t(d.days > 1 ? 'ui.daily.greetBack' : 'ui.daily.greet')),
      h('ul', { className: 'pg-daily__tips' }, ...tips),
      h(
        'div',
        { className: 'pg-daily__path' },
        h('span', { className: 'pg-daily__kind' }, t('ui.daily.path')),
        h('div', { className: 'pg-daily__stones', role: 'img', 'aria-label': t('ui.daily.pathText', { n: d.stones }) }, ...stones),
        h('span', { className: 'pg-daily__text' }, t(d.stones >= PATH_STONES ? 'ui.daily.pathFull' : 'ui.daily.pathText', { n: d.stones })),
      ),
      ...(gift ? [gift] : []),
      ...(quest ? [quest] : []),
    );
    this.renderLanterns();
  }

  private renderLanterns(): void {
    const ids = daily.lanterns;
    this.lanternRow.hidden = ids.length < 2;
    if (ids.length < 2) return;
    const chips = ids.map((id) =>
      h(
        'button',
        {
          type: 'button',
          className: `pg-daily__chip pg-daily__chip--${id}${daily.data.lantern === id ? ' is-on' : ''}`,
          dataset: { menuItem: '', lantern: id },
          'aria-pressed': String(daily.data.lantern === id),
          'aria-label': t(`ui.daily.lantern.${id}`),
          onClick: () => {
            daily.setLantern(id);
            playSfx('ui_open');
            this.renderLanterns();
          },
        },
      ),
    );
    this.lanternRow.replaceChildren(h('span', { className: 'pg-daily__kind' }, t('ui.daily.lanternLabel')), ...chips);
  }

  dispose(): void {
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }
}

/** The small sun button in the title's corner that opens Morning Manna again. */
export function dailyButton(onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', className: 'pg-daily-btn ui-interactive', 'aria-label': t('ui.daily.open') });
  b.innerHTML = SUN_ICON;
  b.addEventListener('click', onClick);
  return b;
}
