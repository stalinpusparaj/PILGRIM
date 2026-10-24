/**
 * "Unlock the full journey" (DECISIONS #402): shown after Chapter IV, on a locked chapter and from Settings >
 * About. Three glossy plan cards with the store's own prices: Yearly (best value, free trial), Monthly (free
 * trial) and Forever (one-time). A plan asks a grown-up first (ParentGate, Google Play Families policy), then
 * opens Google Play's purchase sheet through the shell (src/core/Entitlement.ts). RESTORE PURCHASES and MAYBE
 * LATER; the renewal terms are always on screen. Owning the journey (bought or restored) closes it with thanks.
 */
import './paywall.css';
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { entitlement, type Plan, type PlanInfo } from '../core/Entitlement';
import { emblemSvg } from './Emblem';
import { h, setText, uiRoot } from './dom';
import { Menu } from './Menu';
import { askGrownUp } from './ParentGate';
import { Texts, menuButton, playSfx, uid } from './menu-screen';
import { services } from '../core/Services';

export interface PaywallOptions {
  /** The journey is open (bought or restored). */
  onUnlocked(): void;
  /** MAYBE LATER, Escape, pad B. */
  onClose(): void;
}

const PLANS: readonly Plan[] = ['yearly', 'monthly', 'lifetime'];

/** "P3D" → 3, "P1W" → 7 (trial lengths are days or weeks). */
function trialDays(iso: string | undefined): number {
  const m = /^P(\d+)([DW])$/.exec(iso ?? '');
  return m ? Number(m[1]) * (m[2] === 'W' ? 7 : 1) : 0;
}

export class Paywall {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts();
  private readonly menu: Menu;
  private readonly plans: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly off: () => void;
  private disposed = false;

  constructor(parent: HTMLElement, private readonly o: PaywallOptions) {
    const titleId = uid('pg-paywall');
    const tx = this.texts;
    const emblem = h('div', { className: 'pg-paywall__emblem', 'aria-hidden': 'true' });
    emblem.innerHTML = emblemSvg(72, { id: 'pg-paywall-emblem' });
    this.plans = h('div', { className: 'pg-paywall__plans' });
    this.note = h('p', { className: 'pg-paywall__note', role: 'status', 'aria-live': 'polite' });
    const restore = menuButton(tx, 'ui.paywall.restore', { icon: 'star', onClick: () => this.restore() });
    const later = menuButton(tx, 'ui.paywall.later', { onClick: () => o.onClose() });
    const panel = h(
      'div',
      { className: 'panel pg-menu-panel pg-paywall__panel pop-in', role: 'dialog', 'aria-labelledby': titleId },
      emblem,
      tx.text(h('h2', { className: 'pg-menu-title pg-paywall__title', id: titleId }), 'ui.paywall.title'),
      tx.text(h('p', { className: 'pg-paywall__text' }), 'ui.paywall.text'),
      this.plans,
      this.note,
      h('div', { className: 'pg-paywall__row' }, restore, later),
      tx.text(h('p', { className: 'pg-paywall__legal' }), 'ui.paywall.legal'),
    );
    this.root = h('div', { className: 'pg-screen pg-scrim pg-paywall' }, panel);
    parent.appendChild(this.root);
    this.renderPlans();
    this.menu = new Menu({
      root: this.root,
      nav: 'vertical',
      items: () => [...this.plans.querySelectorAll<HTMLElement>('[data-menu-item]'), restore, later],
      onBack: () => o.onClose(),
    });
    this.off = events.on('billing:changed', (s) => {
      if (entitlement.owned) {
        setText(this.note, t('ui.paywall.thanks'));
        playSfx('ui_open');
        window.setTimeout(() => !this.disposed && this.o.onUnlocked(), 900);
        return;
      }
      if (s.event === 'error') setText(this.note, t('ui.paywall.error'));
      else if (s.event === 'restored') setText(this.note, t('ui.paywall.nothingToRestore'));
      this.renderPlans();
    });
  }

  private renderPlans(): void {
    const { products, status } = entitlement.state;
    this.plans.replaceChildren();
    if (!entitlement.canBuy) {
      const key = status === 'offline' ? 'ui.paywall.offline' : 'ui.paywall.connecting';
      this.plans.append(h('p', { className: 'pg-paywall__wait' }, t(key)));
      return;
    }
    for (const plan of PLANS) {
      const info = products[plan];
      if (info) this.plans.append(this.planCard(plan, info));
    }
  }

  private planCard(plan: Plan, info: PlanInfo): HTMLButtonElement {
    const days = trialDays(info.trial);
    const price =
      plan === 'yearly' ? 'ui.paywall.perYear' : plan === 'monthly' ? 'ui.paywall.perMonth' : 'ui.paywall.once';
    const card = h(
      'button',
      {
        type: 'button',
        className: `btn pg-paywall__plan pg-paywall__plan--${plan}${plan === 'yearly' ? '' : ' btn-secondary'}`,
        dataset: { menuItem: '', plan },
        onClick: () => this.buy(plan),
      },
      plan === 'yearly' ? h('span', { className: 'pg-paywall__badge' }, t('ui.paywall.best')) : null,
      h('span', { className: 'pg-paywall__name' }, t(`ui.paywall.${plan}`)),
      h('span', { className: 'pg-paywall__price' }, t(price, { price: info.price })),
      days > 0 ? h('span', { className: 'pg-paywall__trial' }, t('ui.paywall.trial', { days })) : null,
    );
    return card;
  }

  private buy(plan: Plan): void {
    void askGrownUp().then((ok) => {
      if (!ok || this.disposed) return;
      setText(this.note, '');
      entitlement.buy(plan);
    });
  }

  private restore(): void {
    setText(this.note, t('ui.paywall.restoring'));
    entitlement.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.off();
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }
}

/**
 * The paywall over whatever is on screen (Settings, the play map; z raised over Settings). `pauseGame` stops the
 * loop and gameplay input while it is up (in play). Escape closes only the paywall (the grown-up check first).
 */
export function openPaywallOver(opts: { pauseGame?: boolean; onDone?: () => void } = {}): void {
  const engine = opts.pauseGame ? services.tryGet('engine') : undefined;
  const input = opts.pauseGame ? services.tryGet('input') : undefined;
  const wasPaused = engine?.loop.paused ?? false;
  if (engine) engine.loop.paused = true;
  input?.setGameplayActive(false);
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    wall.dispose();
    if (engine) engine.loop.paused = wasPaused;
    input?.setGameplayActive(true);
    opts.onDone?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || document.querySelector('.pg-gate')) return; // the grown-up check closes first
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const wall: Paywall = new Paywall(uiRoot(), { onUnlocked: close, onClose: close });
  wall.root.classList.add('pg-paywall--over');
  window.addEventListener('keydown', onKey, true);
}
