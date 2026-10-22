/**
 * The jury of twelve (GDD 2.10 Ch X beat 6, GDD 1.5 #2): Bunyan's jurors with kid-safe names (Mr. Greedy-guts and
 * Mr. Lazybones stand in for two of his). As the camera passes along the jury, each one's name card pops up.
 * Plain DOM in the #ui layer (ch10-jury.css); `dispose()` takes it down.
 */
import './ch10-jury.css';
import { t } from '../core/I18n';
import { h, uiRoot } from '../ui/dom';

export const JURY_SIZE = 12;

export class JuryCards {
  private readonly root: HTMLDivElement;
  private card: HTMLDivElement;

  constructor(parent: HTMLElement = uiRoot()) {
    const title = h('div', { className: 'ch10-jury__title' }, t('ch10.jury.title'));
    this.card = h('div', { className: 'ch10-jury__card', role: 'status' });
    this.card.hidden = true;
    this.root = h('div', { className: 'ch10-jury' }, title, this.card);
    parent.appendChild(this.root);
  }

  /** Shows juror `n` (1..12): a fresh card pops up in place of the last. */
  show(n: number): void {
    const next = this.card.cloneNode(false) as HTMLDivElement;
    next.hidden = false;
    next.textContent = t(`ch10.jury.${n}`);
    this.card.replaceWith(next);
    this.card = next;
  }

  dispose(): void {
    this.root.remove();
  }
}
