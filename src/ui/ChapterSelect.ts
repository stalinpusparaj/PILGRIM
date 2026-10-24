/**
 * CHAPTERS (GDD 2.14 title menu): a card for each of Chapters I-XIII and the Epilogue. A chapter is open up to
 * the furthest chapter reached in any save; later ones show a lock and "Not reached yet". In demo builds
 * (VITE_DEMO) Chapters V onwards show "In the full game". Each card carries a little swatch of its chapter's
 * sky and ground (GDD 2.10 palettes), so the list reads like a map of the journey.
 *
 *   const select = new ChapterSelect(uiRoot(), { onPick: (n) => flow.startChapter(n), onBack });
 *   select.setFurthest(5);   // from Save.list()
 */
import { buildFlags } from '../core/Flags';
import { entitlement } from '../core/Entitlement';
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { PALETTES, type PaletteId } from '../gen/palette';
import { h } from './dom';
import { paintChapterArt } from './art';
import './chapter-cards.css';
import { Menu } from './Menu';
import { Texts, menuButton, playSfx, uid } from './menu-screen';

export interface ChapterSelectOptions {
  onPick(chapter: number): void;
  onBack(): void;
}

export type ChapterLock = 'open' | 'locked' | 'demo';

/** Chapter numbers in the list; 14 is the Epilogue (Save's EPILOGUE_CHAPTER). */
export const CHAPTER_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const EPILOGUE = 14;
/** GDD 2.1: the demo has Chapters I-IV. */
export const DEMO_LAST_CHAPTER = 4;

const PALETTE_OF: Record<number, PaletteId> = {
  1: 'city',
  2: 'slough',
  3: 'wrongHill',
  4: 'wicketGate',
  5: 'interpreter',
  6: 'cross',
  7: 'hill',
  8: 'humiliation',
  9: 'shadow',
  10: 'vanity',
  11: 'doubting',
  12: 'delectable',
  13: 'river',
  14: 'epilogue',
};

const LOCK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1.2em" height="1.2em" fill="none" ' +
  'stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><rect x="9" y="21" width="30" height="21" rx="5"/><path d="M15 21v-6a9 9 0 0 1 18 0v6"/>' +
  '<circle cx="24" cy="31.5" r="2.5" fill="currentColor"/></svg>';

/** i18n key part for a chapter number: '1'..'13' or 'epilogue'. */
export function chapterKey(n: number): string {
  return n === EPILOGUE ? 'epilogue' : String(n);
}

/** 'demo': beyond the free chapters and not unlocked (the demo build, or the full journey not bought yet). */
export function chapterLock(n: number, furthest: number, paid = entitlement.isChapterLocked(n)): ChapterLock {
  if (paid && n > DEMO_LAST_CHAPTER) return 'demo';
  return n <= Math.max(1, furthest) ? 'open' : 'locked';
}

export class ChapterSelect {
  readonly root: HTMLDivElement;
  // A language change also re-writes the progress lines ("Promises 0/1"), which are not bound keys.
  private readonly texts = new Texts(() => this.applyLocks());
  private readonly cards = new Map<number, HTMLButtonElement>();
  /** A purchase (or a lapsed subscription) re-draws the locks at once. */
  private readonly offBilling = events.on('billing:changed', () => this.applyLocks());
  private readonly menu: Menu;
  private furthest = 1;
  private progress: ((chapter: number) => string | null) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly opts: ChapterSelectOptions,
  ) {
    const titleId = uid('pg-chapters');
    const back = menuButton(this.texts, 'ui.common.back', {
      onClick: () => opts.onBack(),
      className: 'pg-back',
    });
    const grid = h('div', { className: 'pg-chapters__grid' });
    for (const n of CHAPTER_NUMBERS) {
      const card = this.card(n);
      this.cards.set(n, card);
      grid.append(card);
    }
    const panel = h(
      'div',
      { className: 'panel pg-menu-panel pg-chapters__panel pop-in' },
      h(
        'div',
        { className: 'pg-chapters__head' },
        back,
        this.texts.text(h('h2', { className: 'pg-menu-title', id: titleId }), 'ui.title.chapters'),
      ),
      grid,
    );
    this.root = h(
      'div',
      {
        className: 'pg-screen pg-scrim pg-chapters',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      panel,
    );
    this.applyLocks();
    parent.appendChild(this.root);
    this.menu = new Menu({
      root: panel,
      nav: 'grid',
      items: () => [back, ...this.cards.values()],
      initial: () => this.cards.get(this.lastOpen()) ?? null,
      onBack: () => opts.onBack(),
    });
    playSfx('ui_open');
  }

  /** The furthest chapter reached in any save (1 when there is none). Keeps the focus where it is. */
  setFurthest(n: number): void {
    const next = Math.max(1, Math.min(EPILOGUE, Math.floor(n) || 1));
    if (next === this.furthest) return;
    const onFirst = this.menu.focused === this.cards.get(this.lastOpen());
    this.furthest = next;
    this.applyLocks();
    if (onFirst) this.menu.focusInitial();
  }

  /** Each open chapter's finds line ("Promises 1/2 · Badges 0/1"), or null for none. */
  setProgress(line: ((chapter: number) => string | null) | null): void {
    this.progress = line;
    this.applyLocks();
  }

  lockOf(n: number): ChapterLock {
    return chapterLock(n, this.furthest);
  }

  dispose(): void {
    this.offBilling();
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }

  private lastOpen(): number {
    let last = 1;
    for (const n of CHAPTER_NUMBERS) if (this.lockOf(n) === 'open') last = n;
    return last;
  }

  private card(n: number): HTMLButtonElement {
    const key = chapterKey(n);
    const pal = PALETTES[PALETTE_OF[n] ?? 'title'];
    const swatch = h('span', {
      className: 'pg-chapter__swatch',
      'aria-hidden': 'true',
      style: {
        '--sky-top': pal.sky.top,
        '--sky-low': pal.sky.horizon,
        '--ground': pal.ground.mid,
        '--path': pal.ground.path,
      },
    });
    paintChapterArt(swatch, n);
    // Premium frame (chapter-cards.css): a glass sheen that sweeps across, and a gold lock seal for locked lands.
    const seal = h('span', { className: 'pg-chapter__seal' });
    seal.innerHTML = LOCK_SVG; // our own markup
    swatch.append(h('span', { className: 'pg-chapter__shine' }), seal);
    const status = h('span', { className: 'pg-chapter__status' });
    const card = h(
      'button',
      {
        type: 'button',
        className: 'pg-chapter',
        dataset: { menuItem: '', chapter: n, key: `ui.chapter.${key}.title` },
        style: { '--card-i': String(n) }, // staggers the light sweep down the list
        onClick: () => this.pick(n),
      },
      swatch,
      h(
        'span',
        { className: 'pg-chapter__text' },
        this.texts.text(h('span', { className: 'pg-chapter__number' }), `ui.chapter.${key}.number`),
        this.texts.text(h('span', { className: 'pg-chapter__title' }), `ui.chapter.${key}.title`),
        status,
      ),
    );
    return card;
  }

  private applyLocks(): void {
    for (const [n, card] of this.cards) {
      const lock = this.lockOf(n);
      card.dataset.lock = lock;
      // A chapter of the full journey still opens (the paywall) when the store sells it: not disabled.
      const sells = lock === 'demo' && entitlement.gated && !buildFlags.DEMO;
      card.setAttribute('aria-disabled', String(lock !== 'open' && !sells));
      const status = card.querySelector<HTMLElement>('.pg-chapter__status');
      if (!status) continue;
      this.texts.unbind(status.lastElementChild ?? status);
      status.replaceChildren();
      if (lock === 'open') {
        const line = this.progress?.(n) ?? null;
        if (line) status.append(h('span', { className: 'pg-chapter__finds' }, line));
        continue;
      }
      const icon = h('span', { className: 'pg-chapter__lock', 'aria-hidden': 'true' });
      icon.innerHTML = LOCK_SVG;
      const text = h('span');
      const paid = buildFlags.DEMO ? 'ui.chapters.fullGame' : 'ui.chapters.unlock';
      this.texts.text(text, lock === 'demo' ? paid : 'ui.chapters.locked');
      status.append(icon, text);
    }
  }

  private pick(n: number): void {
    // A chapter of the full journey opens the paywall (the flow's startChapter shows it).
    if (this.lockOf(n) === 'demo' && entitlement.gated && !buildFlags.DEMO) return this.opts.onPick(n);
    if (this.lockOf(n) !== 'open') {
      playSfx('ui_close');
      return;
    }
    this.opts.onPick(n);
  }
}

/** Readable name of a chapter for logs and tests, e.g. "CHAPTER II: THE SLOUGH OF DESPOND". */
export function chapterName(n: number): string {
  const key = chapterKey(n);
  return `${t(`ui.chapter.${key}.number`)}: ${t(`ui.chapter.${key}.title`)}`;
}
