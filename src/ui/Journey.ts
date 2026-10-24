/** Contextual coaching and replay-safe discovery rewards. All progress lives in the existing save flags. */
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { buildFlags } from '../core/Flags';
import { badgeById } from '../game/badges';
import { h } from './dom';
import { focusedInteractable } from './hud-focus';
import { readSeconds } from './hud-banners';
import './journey.css';

/** Chapters of the full game and of the demo (VITE_DEMO: Chapters I-IV). */
const CHAPTERS = 13;
const DEMO_CHAPTERS = 4;

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
  /** The hint shown last (its kind, not its text: the distance ticks) and how long it stays up. */
  private hintKey = '';
  private hintTime = 0;

  constructor() {
    this.el.append(this.stats, this.hint, this.reward);
    const on = events.on.bind(events);
    this.offs.push(
      on('promise:collected', ({ id }) => this.award(`promise.${id}`, 50, 'promise')),
      on('friend:met', ({ id }) => this.award(`friend.${id}`, 25, 'friend')),
      on('waystone:read', ({ id }) => this.award(`waystone.${id}`, 20, 'waystone')),
      on('chapter:complete', ({ chapter }) => this.award(`chapter.${chapter}`, 100, 'chapter')),
      // A badge's points show on its own medal card (src/ui/BadgeCard.ts), so no second popup here.
      on('achievement:unlocked', ({ id }) => this.award(`badge.${id}`, badgeById(id)?.points ?? 50, 'badge', true)),
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

  private award(id: string, points: number, key: string, quiet = false): void {
    const state = services.tryGet('state');
    if (!state || state.flag(`journey.reward.${id}`)) return;
    state.setFlag(`journey.reward.${id}`, true);
    state.setFlag('journey.score', this.score() + points);
    if (quiet) return this.refresh();
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
    if (this.hintTime > 0) this.hintTime -= dt;
    this.el.hidden = !visible || (this.hintTime <= 0 && this.rewardTime <= 0);
    this.el.classList.toggle('is-reading', this.hintTime > 0);
    if (!visible) return;
    if (!this.el.hidden) this.placeUnderObjective();
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

  /**
   * On a touch phone the tip sits at the top, just under the objective banner (or the corner icons), so the play
   * area and the thumbs' buttons stay clear (journey.css `.hud.is-touch .journey`).
   */
  private placeUnderObjective(): void {
    const obj = this.el.parentElement?.querySelector<HTMLElement>('.hud-objective');
    const box = obj && getComputedStyle(obj).visibility !== 'hidden' ? obj.getBoundingClientRect() : null;
    const parentTop = this.el.parentElement?.getBoundingClientRect().top ?? 0;
    this.el.style.setProperty('--journey-top', box && box.height > 0 ? `${Math.round(box.bottom - parentTop + 8)}px` : '');
  }

  private refresh(): void {
    const state = services.tryGet('state');
    const input = services.tryGet('input');
    if (!state || !input) return;
    const last = buildFlags.DEMO ? DEMO_CHAPTERS : CHAPTERS;
    const stats = t('ui.journey.stats', { chapter: Math.min(last, state.chapter), total: last, score: this.score() });
    const here = this.promisesHere(state.data.promises);
    this.stats.textContent = here ? `${stats}  ·  ${t('ui.journey.promisesHere', here)}` : stats;
    const guide = services.tryGet('guide')?.sample();
    const focus = focusedInteractable();
    let key = 'follow';
    if (focus) key = 'use';
    else if (!state.flag('journey.moved')) key = 'move';
    else if (!state.flag('journey.jumped')) key = 'jump';
    else if (guide?.offWay) key = 'return';
    else if (guide?.custom && guide.distance < 4) key = 'near';
    const device = input.device;
    // A new hint (and the chapter line with it) stays up long enough to read slowly, then fades: the play area
    // keeps only the controls.
    if (`${key}.${device}` !== this.hintKey) {
      this.hintKey = `${key}.${device}`;
      this.hintTime = readSeconds(t(`ui.journey.${key}.${device}`));
    }
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

  /** Promises of the level being played: how many are found (null when the level has none). */
  private promisesHere(found: readonly string[]): { found: number; total: number } | null {
    const level = services.tryGet('chapters')?.session?.world.level;
    const ids = level?.promises.map((p) => p.id) ?? [];
    if (ids.length === 0) return null;
    return { found: ids.filter((id) => found.includes(id)).length, total: ids.length };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.el.remove();
  }
}
