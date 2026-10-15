/** Contextual coaching and replay-safe discovery rewards. All progress lives in the existing save flags. */
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { h } from './dom';
import { focusedInteractable } from './hud-focus';
import './journey.css';

export class Journey {
  readonly el = h('div', { className: 'journey' });
  private readonly stats = h('div', { className: 'journey-stats' });
  private readonly hint = h('div', { className: 'journey-hint' });
  private readonly reward = h('div', { className: 'journey-reward', role: 'status', 'aria-live': 'polite' });
  private readonly offs: Array<() => void> = [];
  private clock = 0;
  private rewardTime = 0;
  private rewardKey = '';
  private rewardPoints = 0;
  private flip = false;

  constructor() {
    this.el.append(this.stats, this.hint, this.reward);
    const on = events.on.bind(events);
    this.offs.push(
      on('promise:collected', ({ id }) => this.award(`promise.${id}`, 50, 'promise')),
      on('friend:met', ({ id }) => this.award(`friend.${id}`, 25, 'friend')),
      on('waystone:read', ({ id }) => this.award(`waystone.${id}`, 20, 'waystone')),
      on('chapter:complete', ({ chapter }) => this.award(`chapter.${chapter}`, 100, 'chapter')),
      on('interact:use', () => {
        services.tryGet('state')?.setFlag('journey.used', true);
      }),
      on('state:reset', () => { this.rewardTime = 0; this.reward.hidden = true; }),
      on('lang:changed', () => this.refresh()),
      on('input:device', () => this.refresh()),
      on('input:bindings', () => this.refresh()),
    );
    this.reward.hidden = true;
    this.refresh();
  }

  private award(id: string, points: number, key: string): void {
    const state = services.tryGet('state');
    if (!state || state.flag(`journey.reward.${id}`)) return;
    state.setFlag(`journey.reward.${id}`, true);
    state.setFlag('journey.score', this.score() + points);
    this.rewardKey = key;
    this.rewardPoints = points;
    this.rewardTime = 3.5;
    this.flip = !this.flip;
    this.reward.className = `journey-reward ${this.flip ? 'reward-a' : 'reward-b'}`;
    this.reward.hidden = false;
    this.refresh();
  }

  private score(): number {
    const n = services.tryGet('state')?.flag('journey.score');
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  update(dt: number, visible: boolean): void {
    this.el.hidden = !visible;
    if (!visible) return;
    const input = services.tryGet('input');
    const state = services.tryGet('state');
    if (input && state) {
      if (Math.hypot(input.move.x, input.move.y) > 0.2) state.setFlag('journey.moved', true);
      if (input.pressed('jump')) state.setFlag('journey.jumped', true);
    }
    if (this.rewardTime > 0) {
      this.rewardTime -= dt;
      if (this.rewardTime <= 0) this.reward.hidden = true;
    }
    this.clock += dt;
    if (this.clock < 0.25) return;
    this.clock = 0;
    this.refresh();
  }

  private refresh(): void {
    const state = services.tryGet('state');
    const input = services.tryGet('input');
    if (!state || !input) return;
    this.stats.textContent = t('ui.journey.stats', { chapter: Math.min(4, state.chapter), score: this.score() });
    const guide = services.tryGet('guide')?.sample();
    const focus = focusedInteractable();
    let key = 'follow';
    if (focus) key = 'use';
    else if (!state.flag('journey.moved')) key = 'move';
    else if (!state.flag('journey.jumped')) key = 'jump';
    else if (guide?.offWay) key = 'return';
    else if (guide?.custom && guide.distance < 4) key = 'near';
    const device = input.device;
    // Glyph HTML is produced by Input from validated bindings; localized copy stays text-only.
    this.hint.replaceChildren();
    const copy = h('span');
    copy.textContent = t(`ui.journey.${key}.${device}`);
    this.hint.appendChild(copy);
    const action = focus?.action ?? (key === 'jump' ? 'jump' : key === 'move' ? 'moveForward' : null);
    if (action && device !== 'touch') {
      const glyph = h('span', { className: 'journey-key' });
      glyph.innerHTML = input.glyph(action);
      this.hint.appendChild(glyph);
    }
    if (guide?.custom && guide.distance >= 4 && key === 'follow') {
      const distance = h('span', { className: 'journey-distance' });
      distance.textContent = t('ui.journey.distance', { distance: Math.ceil(guide.distance) });
      this.hint.appendChild(distance);
    }
    if (this.rewardKey) this.reward.textContent = t(`ui.journey.reward.${this.rewardKey}`, { points: this.rewardPoints });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.el.remove();
  }
}
