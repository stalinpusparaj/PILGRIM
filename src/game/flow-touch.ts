/**
 * GameFlow's own pause icon for touch players (GDD 2.15 "Pause everywhere", "playable with touch only"). On a
 * touch screen the only pause control is the touch controls' icon, and Input hides the touch controls whenever
 * gameplay input is off: during a conversation or a cutscene, and in a chapter without gameplay input (the test
 * world's fly-through). While the flow is playing and that is the case, this icon stands in the same place (top
 * right, 72 px, the same look), above the dialogue layer and the letterbox (z-index 35). Tapping it (or a screen
 * reader's activation) opens the pause menu through the flow.
 */
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { services } from '../core/Services';
import { h } from '../ui/dom';
import { icon } from '../ui/Svg';

export interface TouchPauseHooks {
  /** The flow is playing and gameplay input is off (so the touch controls and their icon are hidden). */
  wanted(): boolean;
  /** The icon was tapped. */
  press(): void;
}

export class FlowTouchPause {
  readonly button: HTMLButtonElement;
  private readonly offs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private readonly hooks: TouchPauseHooks,
  ) {
    this.button = h('button', {
      type: 'button',
      className: 'pg-flow-pause',
      hidden: true,
      onClick: () => {
        if (!this.button.hidden) this.hooks.press();
      },
    });
    this.button.innerHTML = icon('pause', '56%'); // our own SVG markup
    this.relabel();
    parent.appendChild(this.button);
    const refresh = (): void => this.refresh();
    this.offs.push(
      events.on('flow:state', refresh),
      events.on('input:device', refresh),
      events.on('dialogue:start', refresh),
      events.on('dialogue:end', refresh),
      events.on('cutscene:start', refresh),
      events.on('cutscene:end', refresh),
      events.on('lang:changed', () => this.relabel()),
    );
  }

  /** Shows or hides the icon (the events above call it; the flow calls it when the chapter changes). */
  refresh(): void {
    this.button.hidden = !(services.tryGet('input')?.device === 'touch' && this.hooks.wanted());
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.button.remove();
  }

  private relabel(): void {
    const label = t('ui.touch.pause');
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
  }
}
