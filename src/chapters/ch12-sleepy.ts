/**
 * Chapter XII beat 7 (GDD 2.10): "Enchanted Ground: a sleepy meter fills as you walk ... each answered question
 * pushes the sleepiness back." On the 'sleepy' zone a moon meter fills (faster standing still than walking, slower
 * on Easy), a warm drowsy haze creeps over the screen and Zzz float over Christian. Past 60 % a nudge says to talk
 * with Hopeful; a chat with him pushes it back. Full: he falls asleep (the chapter's `onAsleep`: Hope -40, back
 * at the waystone, GDD 2.7.8) and the meter empties.
 */
import '../audio/events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { h, uiRoot } from '../ui/dom';
import './ch12-sleepy.css';
import type { ChapterContext } from './types';

/** Seconds to fill walking (Easy, Normal); standing still fills STILL × faster; a chat takes PUSH off. */
const FILL = { easy: 50, normal: 34, still: 1.4, push: 0.55, nudge: 0.6, zzz: 1.1 } as const;

/** A crescent moon (our own inline SVG). */
const MOON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" ' +
  'focusable="false"><path fill="currentColor" d="M15.5 3a8.5 8.5 0 1 0 5.4 15.1A7 7 0 0 1 15.5 3z"/></svg>';

export class SleepyMeter {
  private value = 0;
  private nudged = false;
  private zzz = 0;
  private place = 0;
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private readonly haze: HTMLDivElement;

  constructor(
    private readonly ctx: ChapterContext,
    private readonly onAsleep: () => Promise<void>,
  ) {
    this.fill = h('span', { className: 'pg-sleepy__fill' });
    const moon = h('span', { className: 'pg-sleepy__moon', 'aria-hidden': 'true' });
    moon.innerHTML = MOON_SVG;
    this.root = h(
      'div',
      { className: 'pg-sleepy', role: 'meter', 'aria-label': t('ch12.sleepy.label'), 'aria-valuemin': '0', 'aria-valuemax': '100' },
      moon,
      h('span', { className: 'pg-sleepy__label' }, t('ch12.sleepy.label')),
      h('span', { className: 'pg-sleepy__bar' }, this.fill),
    );
    this.haze = h('div', { className: 'pg-sleepy-haze', 'aria-hidden': 'true' });
    uiRoot().append(this.haze, this.root);
    ctx.own(() => this.dispose());
  }

  get level(): number {
    return this.value;
  }

  /** A chat with Hopeful wakes them up a little. */
  pushBack(): void {
    this.value = Math.max(0, this.value - FILL.push);
    if (this.value < FILL.nudge) this.nudged = false;
    this.show();
  }

  update(dt: number): void {
    const s = this.ctx.session;
    const on = s.zones.inZone('sleepy');
    this.root.classList.toggle('is-on', on && s.player.mode !== 'cutscene');
    this.root.classList.toggle('is-touch', services.tryGet('input')?.device === 'touch');
    if (on && s.player.mode === 'play') {
      const normal = services.tryGet('settings')?.data.difficulty === 'normal';
      const still = s.player.speed < 0.3 ? FILL.still : 1;
      this.value = Math.min(1, this.value + (dt / (normal ? FILL.normal : FILL.easy)) * still);
      if (this.value >= FILL.nudge && !this.nudged) {
        this.nudged = true;
        this.ctx.toast('ch12.toast.tooSleepy');
      }
      this.zzz -= dt;
      if (this.value > 0.5 && this.zzz <= 0) {
        this.zzz = FILL.zzz;
        const p = s.player.renderPosition;
        s.world.particles.emit('zzz', p.clone().setY(p.y + 1.7), 1);
      }
      if (this.value >= 1) {
        this.value = 0;
        this.nudged = false;
        void this.onAsleep();
      }
    }
    this.place -= dt;
    if (on && this.place <= 0) {
      this.place = 0.25;
      this.dodgeObjective();
    }
    this.show(on);
  }

  /** Long objectives wrap to two or three lines on a phone: keep the meter just under it while it shows. */
  private dodgeObjective(): void {
    const obj = document.querySelector<HTMLElement>('.hud-objective');
    const css = obj ? getComputedStyle(obj) : null;
    const shown = obj && css && css.visibility !== 'hidden' && Number(css.opacity) > 0.05;
    this.root.style.top = shown ? `${Math.round(obj.getBoundingClientRect().bottom + 10)}px` : '';
  }

  private show(on = this.root.classList.contains('is-on')): void {
    const pct = Math.round(this.value * 100);
    this.fill.style.width = `${pct}%`;
    this.root.setAttribute('aria-valuenow', String(pct));
    this.root.classList.toggle('is-high', this.value >= FILL.nudge);
    this.haze.style.opacity = on ? String(this.value * 0.5) : '0';
  }

  private dispose(): void {
    this.root.remove();
    this.haze.remove();
  }
}
