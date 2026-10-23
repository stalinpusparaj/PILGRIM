/**
 * A badge's moment on screen: a cream card with a gold medal (our own inline SVG) pops in under the toasts,
 * "NEW BADGE! +50 points", the badge's name and its line, for 3.4 s (on phones in the middle of the screen, clear of
 * the objective and the corner icons). Several in a row queue up. Screen readers hear it once
 * (role status). App-lifetime, owned by the badge watcher (src/game/badges.ts).
 */
import './badge-card.css';
import { t } from '../core/I18n';
import { h, uiRoot } from './dom';

const SHOW_MS = 3400;
const LEAVE_MS = 320;

const MEDAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" ' +
  'focusable="false"><path d="M20 4h10l6 16H26z" fill="#4f7fa6"/><path d="M44 4H34l-6 16h10z" fill="#d8574a"/>' +
  '<circle cx="32" cy="40" r="20" fill="#c4861b"/><circle cx="32" cy="40" r="16" fill="#f2b33d"/>' +
  '<path d="M32 28l3.5 7.2 7.9 1.1-5.7 5.5 1.4 7.8L32 45.9l-7.1 3.7 1.4-7.8-5.7-5.5 7.9-1.1z" fill="#fff4dc"/></svg>';

export class BadgeCard {
  private readonly queue: Array<{ name: string; line: string; points: number }> = [];
  private current: HTMLElement | null = null;
  private timer = 0;

  show(nameKey: string, lineKey: string, points: number): void {
    this.queue.push({ name: t(nameKey), line: t(lineKey), points });
    if (!this.current) this.next();
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.current?.remove();
    this.current = null;
    this.queue.length = 0;
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) return;
    const medal = h('span', { className: 'pg-badge-card__medal', 'aria-hidden': 'true' });
    medal.innerHTML = MEDAL_SVG;
    const card = h(
      'div',
      { className: 'pg-badge-card', role: 'status' },
      medal,
      h(
        'span',
        { className: 'pg-badge-card__text' },
        h('span', { className: 'pg-badge-card__kicker' }, `${t('ui.badge.new')}  ${t('ui.badge.points', { points: item.points })}`),
        h('span', { className: 'pg-badge-card__name' }, item.name),
        h('span', { className: 'pg-badge-card__line' }, item.line),
      ),
    );
    uiRoot().append(card);
    this.current = card;
    this.timer = window.setTimeout(() => {
      card.classList.add('is-leaving');
      this.timer = window.setTimeout(() => {
        card.remove();
        if (this.current === card) this.current = null;
        this.next();
      }, LEAVE_MS);
    }, SHOW_MS);
  }
}
