/**
 * "A new version is ready!" on the title screen (DECISIONS #397): shown when Google Play reports a newer version
 * (NativeShell 'app:update') that the player has not skipped. UPDATE opens the Play listing behind the grown-up
 * check; SKIP hides it until an even newer version comes out (remembered per versionCode).
 */
import './update-banner.css';
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { nativeLinks, updateAvailable } from '../core/NativeShell';
import { h } from './dom';
import { askGrownUp } from './ParentGate';
import { icon } from './Svg';

const SKIP_KEY = 'pilgrim.update.skipped';

function skipped(): number {
  try {
    return Number(localStorage.getItem(SKIP_KEY)) || 0;
  } catch {
    return 0;
  }
}

export class UpdateBanner {
  private el: HTMLElement | null = null;
  private readonly off: () => void;

  constructor(private readonly parent: HTMLElement) {
    this.off = events.on('app:update', () => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    const code = updateAvailable();
    const native = nativeLinks();
    if (this.el || code === null || !native || code <= skipped()) return;
    const glyph = h('span', { className: 'pg-update__icon', 'aria-hidden': 'true' });
    glyph.innerHTML = icon('star', '100%');
    const now = h('button', { type: 'button', className: 'btn pg-update__now', dataset: { menuItem: '' } }, t('ui.update.now'));
    const skip = h('button', { type: 'button', className: 'btn btn-secondary pg-update__skip', dataset: { menuItem: '' } }, t('ui.update.skip'));
    now.addEventListener('click', () => void askGrownUp().then((ok) => ok && native.rate()));
    skip.addEventListener('click', () => {
      try {
        localStorage.setItem(SKIP_KEY, String(code));
      } catch {
        /* not remembered: it shows again next launch */
      }
      this.hide();
    });
    this.el = h(
      'div',
      { className: 'pg-update panel', role: 'status' },
      glyph,
      h('div', { className: 'pg-update__text' }, h('strong', {}, t('ui.update.title')), h('span', {}, t('ui.update.text'))),
      h('div', { className: 'pg-update__buttons' }, skip, now),
    );
    this.parent.appendChild(this.el);
  }

  private hide(): void {
    this.el?.remove();
    this.el = null;
  }

  dispose(): void {
    this.off();
    this.hide();
  }
}
