/**
 * Loading screen (GDD 2.14 "Loading"): the chapter name, a short friendly line, a bar and
 * "Building the world... 42%". A chunky rounded cream panel over a dusk backdrop, system fonts, our emblem
 * bobbing on top. The bar moves with a compositor-only transform transition and a shine sweep, so it keeps
 * animating smoothly while the world is built in 8 ms slices. Fades in on show(), out on hide().
 *
 *   const loading = new Loading();
 *   loading.show(chapterLoadingInfo('1'));
 *   await buildWorld(level, preset, (p) => loading.setProgress(p));
 *   await loading.hide();
 */
import { i18n, t } from '../core/I18n';
import { hashString } from '../gen/rng';
import { paintChapterArt } from './art';
import { emblemSvg } from './Emblem';
import { h, setText, uiRoot } from './dom';

export interface LoadingInfo {
  /** Big title, already translated (e.g. "THE CITY OF DESTRUCTION"). */
  title: string;
  /** Small line above the title, already translated (e.g. "CHAPTER I"). */
  kicker?: string;
  /** The chapter whose diorama paints the backdrop ('1'..'13', 'epilogue'), when there is one. */
  art?: string | null;
  /** Picks which friendly line comes first (default: from the title), so a chapter always opens the same way. */
  seed?: number;
  /** How the land just finished went (Promises, badges), already translated; shown under the title. */
  recap?: string | null;
}

/** Fade length; matches --dur-slow in styles.css. */
const FADE_MS = 420;
/** Friendly lines rotate this often on long loads. */
const LINE_MS = 3200;
const LINE_SWAP_MS = 180;
const MAX_LINES = 50;

/** Title texts for a chapter id: '1'..'13', 'ch01'..'ch13' or 'epilogue'. Unknown ids show the id itself. */
export function chapterLoadingInfo(id: string): LoadingInfo {
  const m = /^(?:ch)?0*(\d{1,2})$/.exec(id);
  const key = m ? m[1]! : id;
  if (!i18n.has(`ui.chapter.${key}.title`)) return { title: id.toUpperCase() };
  return { kicker: t(`ui.chapter.${key}.number`), title: t(`ui.chapter.${key}.title`), art: key };
}

/** Keys ui.loading.line.1..N that exist in en.json. */
function lineKeys(): string[] {
  const keys: string[] = [];
  for (let n = 1; n <= MAX_LINES && i18n.has(`ui.loading.line.${n}`); n++) keys.push(`ui.loading.line.${n}`);
  return keys;
}

export class Loading {
  readonly root: HTMLDivElement;
  private readonly kicker: HTMLParagraphElement;
  private readonly title: HTMLHeadingElement;
  private readonly line: HTMLParagraphElement;
  private readonly recap: HTMLParagraphElement;
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly pct: HTMLParagraphElement;
  private readonly parent: HTMLElement;

  private lines: string[] = [];
  private lineIndex = 0;
  private lineTimer: number | null = null;
  private swapTimer: number | null = null;
  private hideTimer: number | null = null;
  private hideResolve: (() => void) | null = null;
  private shown = false;
  private progress = 0;
  private shownPct = -1;
  private disposed = false;

  constructor(parent: HTMLElement = uiRoot()) {
    this.parent = parent;
    acquireStyle();
    this.kicker = h('p', { className: 'pg-loading__kicker' });
    this.title = h('h1', { className: 'pg-loading__title' });
    this.line = h('p', { className: 'pg-loading__line' });
    this.recap = h('p', { className: 'pg-loading__recap' });
    this.fill = h('div', { className: 'pg-loading__fill' }, h('div', { className: 'pg-loading__shine' }));
    this.bar = h(
      'div',
      {
        className: 'pg-loading__bar',
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': 0,
      },
      this.fill,
    );
    this.pct = h('p', { className: 'pg-loading__pct', 'aria-hidden': 'true' });
    const emblem = h('div', { className: 'pg-loading__emblem', 'aria-hidden': 'true' });
    emblem.innerHTML = emblemSvg(84, { id: 'pg-loading-emblem' });
    this.root = h(
      'div',
      { className: 'pg-loading', 'aria-busy': 'true' },
      h(
        'div',
        { className: 'panel pg-loading__panel' },
        emblem,
        this.kicker,
        this.title,
        this.recap,
        this.line,
        this.bar,
        this.pct,
      ),
    );
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Mounts (or re-titles) the screen and fades it in. Progress starts at 0. */
  show(info: LoadingInfo): void {
    if (this.disposed) return;
    this.cancelHide();
    paintChapterArt(this.root, info.art ?? null);
    setText(this.kicker, info.kicker ?? '');
    this.kicker.hidden = !info.kicker;
    setText(this.title, info.title);
    setText(this.recap, info.recap ?? '');
    this.recap.hidden = !info.recap;
    this.lines = lineKeys();
    const seed = info.seed ?? hashString(info.title);
    this.lineIndex = this.lines.length > 0 ? seed % this.lines.length : 0;
    this.showLine();
    this.line.removeAttribute('role');
    this.bar.hidden = false;
    this.pct.hidden = false;
    this.root.setAttribute('aria-busy', 'true');
    // Back to 0 without animating the bar backwards (a second load reuses the screen).
    this.fill.style.transition = 'none';
    this.progress = 0;
    this.shownPct = -1;
    this.renderProgress();
    if (!this.root.isConnected) this.parent.appendChild(this.root);
    void this.fill.offsetWidth;
    this.fill.style.removeProperty('transition');
    if (!this.shown) {
      this.shown = true;
      void this.root.offsetWidth; // commit opacity 0 so the fade-in transition runs
      this.root.classList.add('is-shown');
    }
    this.startLines();
  }

  /** 0..1; never moves backwards while shown. */
  setProgress(p: number): void {
    if (this.disposed || !Number.isFinite(p)) return;
    const v = Math.min(1, Math.max(0, p));
    if (v <= this.progress) return;
    this.progress = v;
    this.renderProgress();
  }

  /**
   * Replaces the friendly line and the bar with a message (a level that failed to build). The screen stays
   * up until hide() or dispose(). The text must already be translated (dev screens may pass plain English).
   */
  showError(text: string): void {
    if (this.disposed) return;
    this.stopLines();
    setText(this.line, text);
    this.line.setAttribute('role', 'alert');
    this.bar.hidden = true;
    this.pct.hidden = true;
    this.root.setAttribute('aria-busy', 'false');
  }

  /** Fades out and unmounts. Resolves when the fade is done (or at once if not shown). */
  hide(): Promise<void> {
    if (!this.shown || this.disposed) return Promise.resolve();
    this.shown = false;
    this.stopLines();
    this.root.classList.remove('is-shown');
    this.root.setAttribute('aria-busy', 'false');
    return new Promise((resolve) => {
      this.hideResolve = resolve;
      // A timer, not transitionend: reduce-motion shortens the transition and hidden tabs may skip it.
      this.hideTimer = window.setTimeout(() => this.finishHide(), FADE_MS + 40);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLines();
    this.cancelHide();
    this.root.remove();
    this.shown = false;
    releaseStyle();
  }

  private renderProgress(): void {
    const pct = Math.floor(this.progress * 100);
    // translateX keeps the rounded end of the fill intact (scaleX would squash it) and runs on the compositor.
    this.fill.style.transform = `translateX(${(this.progress - 1) * 100}%)`;
    if (pct === this.shownPct) return;
    this.shownPct = pct;
    const text = t('ui.loading.building', { pct });
    setText(this.pct, text);
    this.bar.setAttribute('aria-valuenow', String(pct));
    this.bar.setAttribute('aria-valuetext', text);
  }

  private showLine(): void {
    const key = this.lines[this.lineIndex];
    setText(this.line, key ? t(key) : '');
  }

  private startLines(): void {
    this.stopLines();
    if (this.lines.length < 2) return;
    this.lineTimer = window.setInterval(() => {
      this.line.classList.add('is-swapping');
      this.swapTimer = window.setTimeout(() => {
        this.swapTimer = null;
        this.lineIndex = (this.lineIndex + 1) % this.lines.length;
        this.showLine();
        this.line.classList.remove('is-swapping');
      }, LINE_SWAP_MS);
    }, LINE_MS);
  }

  private stopLines(): void {
    if (this.lineTimer !== null) window.clearInterval(this.lineTimer);
    if (this.swapTimer !== null) window.clearTimeout(this.swapTimer);
    this.lineTimer = null;
    this.swapTimer = null;
    this.line.classList.remove('is-swapping');
  }

  private finishHide(): void {
    this.hideTimer = null;
    this.root.remove();
    const resolve = this.hideResolve;
    this.hideResolve = null;
    resolve?.();
  }

  /** A show() during the fade-out (or dispose) settles the pending hide promise straight away. */
  private cancelHide(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    const resolve = this.hideResolve;
    this.hideResolve = null;
    resolve?.();
  }
}

// ------------------------------------------------------------------------------------------------ styles

let styleEl: HTMLStyleElement | null = null;
let styleUsers = 0;

function acquireStyle(): void {
  styleUsers++;
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.id = 'pg-loading-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}

function releaseStyle(): void {
  styleUsers = Math.max(0, styleUsers - 1);
  if (styleUsers > 0 || !styleEl) return;
  styleEl.remove();
  styleEl = null;
}

/* Uses the tokens from styles.css (panel colours, radii, font stacks, text scale, safe areas). */
const CSS = `
.pg-loading {
  position: fixed; inset: 0; z-index: 800;
  display: flex; align-items: center; justify-content: center;
  padding: calc(var(--gap) + var(--safe-top)) calc(var(--gap) + var(--safe-right))
    calc(var(--gap) + var(--safe-bottom)) calc(var(--gap) + var(--safe-left));
  background:
    radial-gradient(120% 80% at 50% 115%, rgba(242, 179, 61, 0.28) 0%, rgba(242, 179, 61, 0) 55%),
    radial-gradient(140% 100% at 50% 100%, #4a3a5c 0%, var(--night) 70%);
  font-family: var(--font-body);
  opacity: 0;
  transition: opacity var(--dur-slow) var(--ease-out);
  pointer-events: auto;
  touch-action: none;
}
.pg-loading.is-shown { opacity: 1; }
.pg-loading__panel {
  width: min(520px, 100%);
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  text-align: center;
  transform: translateY(10px) scale(0.97);
  transition: transform var(--dur-slow) var(--ease-bounce);
}
.pg-loading.is-shown .pg-loading__panel { transform: none; }
.pg-loading__emblem {
  width: 72px; height: 72px; margin-top: -4px;
  filter: drop-shadow(0 4px 0 var(--shadow-solid));
  animation: pg-loading-bob 2.6s ease-in-out infinite;
}
.pg-loading__emblem svg { display: block; width: 100%; height: 100%; }
.pg-loading__kicker {
  margin: 4px 0 0; color: var(--ink-soft);
  font-size: var(--fs-small); font-weight: 800; letter-spacing: 0.16em;
}
.pg-loading__title {
  margin: 0; color: var(--ink);
  font-family: var(--font-title); font-size: var(--fs-title); line-height: 1.12;
  text-wrap: balance; overflow-wrap: anywhere;
}
.pg-loading__recap {
  margin: 0 0 4px; color: var(--accent-deep); font-weight: 700; font-size: calc(var(--fs-body) * 0.9); line-height: 1.35;
}
.pg-loading__line {
  margin: 2px 0 8px; min-height: 1.4em; color: var(--ink-soft);
  font-size: var(--fs-body); line-height: 1.4;
  transition: opacity ${LINE_SWAP_MS}ms ease;
}
.pg-loading__line.is-swapping { opacity: 0; }
.pg-loading__bar {
  position: relative; width: 100%; height: 28px; overflow: hidden;
  background: var(--panel-deep);
  border: 4px solid var(--panel-edge); border-radius: 999px;
  box-shadow: inset 0 3px 0 rgba(59, 36, 20, 0.12);
}
.pg-loading__fill {
  position: absolute; inset: 0; overflow: hidden;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--accent-light) 0%, var(--accent) 60%, var(--accent-deep) 100%);
  transform: translateX(-100%);
  transition: transform 320ms var(--ease-out);
  will-change: transform;
}
.pg-loading__shine {
  position: absolute; inset: 0;
  background: linear-gradient(100deg, rgba(255, 255, 255, 0) 35%, rgba(255, 255, 255, 0.55) 50%,
    rgba(255, 255, 255, 0) 65%);
  transform: translateX(-100%);
  animation: pg-loading-shine 1.6s linear infinite;
}
.pg-loading__pct {
  margin: 4px 0 0; color: var(--ink);
  font-size: var(--fs-body); font-weight: 700; font-variant-numeric: tabular-nums;
}
@keyframes pg-loading-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes pg-loading-shine { to { transform: translateX(100%); } }
@media (max-width: 480px) {
  .pg-loading__emblem { width: 56px; height: 56px; }
  .pg-loading__bar { height: 24px; }
}
`;
