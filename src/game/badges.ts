/**
 * Badges (GDD 2.15 save `achievements`; GDD 2.10 names "Wide Awake" and "Sharp Eyes"): small, funny rewards for
 * curiosity, kindness and skill — never for grinding (GDD 2.2 pillar 4). The registry is content/badges.json
 * (id, chapter it belongs to or 0, journey points, i18n keys for its name, line and the teasing hint the Satchel
 * shows while it is still locked). Unlocking goes through `GameState.unlock` ('achievement:unlocked'); the watcher
 * celebrates it once: a toast, bells and a sparkle (Journey adds the points).
 *
 * The watcher is app-lifetime (installed once by main.ts) and only listens to events, so chapters need not know
 * about badges. Per-chapter tracking (an arrow bonk, a lost heart, being caught, the lowest Hope) restarts with
 * every chapter launch ('hud:chapterCard').
 */
import raw from '../../content/badges.json';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { PROMISE_TOTAL } from '../core/GameState';
import { BadgeCard } from '../ui/BadgeCard';

export interface Badge {
  id: string;
  chapter: number;
  points: number;
  name: string;
  line: string;
  hint: string;
}

export const BADGES: readonly Badge[] = (raw as Badge[]).map((b) => ({ ...b }));
export function badgeById(id: string): Badge | null {
  return BADGES.find((b) => b.id === id) ?? null;
}

/** Friends to meet for "Good Company". */
const FRIENDS_FOR_BADGE = 12;
/** "Bright Lantern": Hope never below this in Chapter IX. */
const BRIGHT_HOPE = 50;
const STALLS = ['games', 'sweets', 'hats', 'trinkets'] as const;

interface Track {
  chapter: number;
  arrowHit: boolean;
  heartLost: boolean;
  caught: boolean;
  keyHinted: boolean;
  minHope: number;
}

const fresh = (chapter: number): Track => ({
  chapter,
  arrowHit: false,
  heartLost: false,
  caught: false,
  keyHinted: false,
  minHope: 100,
});

/** Starts watching; returns the remover (tests, HMR). */
export function installBadges(): () => void {
  let track = fresh(0);
  const card = new BadgeCard();
  const state = (): ReturnType<typeof services.tryGet<'state'>> => services.tryGet('state');
  const unlock = (id: string): void => {
    if (badgeById(id)) state()?.unlock(id);
  };
  const offs = [
    events.on('hud:chapterCard', ({ chapter }) => {
      track = fresh(chapter);
      track.minHope = state()?.hope ?? 100;
    }),
    events.on('achievement:unlocked', ({ id }) => celebrate(id, card)),
    events.on('player:bonk', ({ reason }) => {
      if (reason === 'arrow') track.arrowHit = true;
    }),
    events.on('hearts:changed', ({ value, max }) => {
      if (value < max) track.heartLost = true;
    }),
    events.on('hope:changed', ({ value }) => {
      track.minHope = Math.min(track.minHope, value);
    }),
    events.on('hud:toast', ({ key }) => {
      if (key.startsWith('ch10.toast.caught')) track.caught = true;
    }),
    events.on('dialogue:start', ({ id }) => {
      if (id === 'ch10_pride') unlock('prideTrip');
      if (id === 'ch11_key_hint') track.keyHinted = true;
    }),
    events.on('flag:changed', ({ key, value }) => {
      if (key === 'ch05.patience' && value === true) unlock('patientHeart');
      if (key === 'ch10.escaped' && value === true && !track.caught) unlock('unseen');
      if (key === 'ch08.fightDone' && value === true && !track.heartLost) unlock('unshaken');
      if (key === 'ch11.locksOpen' && value === 1 && !track.keyHinted) unlock('keyRemembered');
    }),
    events.on('promise:collected', ({ total }) => {
      unlock('firstPromise');
      if (total >= PROMISE_TOTAL) unlock('promiseKeeper');
    }),
    events.on('friend:met', () => {
      if ((state()?.friendsMet().length ?? 0) >= FRIENDS_FOR_BADGE) unlock('goodCompany');
    }),
    events.on('chapter:complete', ({ chapter }) => {
      const s = state();
      if (!s) return;
      if (chapter === 4 && !track.arrowHit) unlock('arrowDodger');
      if (chapter === 9 && track.minHope >= BRIGHT_HOPE) unlock('brightLantern');
      if (chapter === 10) {
        const yes = STALLS.some((id) => s.flag(`ch10.yes.${id}`) === true);
        const no = STALLS.filter((id) => s.flag(`ch10.no.${id}`) === true).length;
        if (!yes && no >= 2) unlock('noThankYou');
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
    card.dispose();
  };
}

/** A badge's moment: the medal card, bells, a burst of sparkles round Christian. */
function celebrate(id: string, card: BadgeCard): void {
  const b = badgeById(id);
  if (!b) return;
  card.show(b.name, b.line, b.points);
  events.emit('sfx', { id: 'bells', volume: 0.6 });
  const p = services.tryGet('player')?.renderPosition;
  if (!p) return;
  events.emit('sfx', { id: 'sparkle', at: [p.x, p.y + 1.5, p.z] });
  const particles = services.tryGet('chapters')?.session?.world.particles;
  particles?.emit('sparkle', p.clone().setY(p.y + 1.2), 36, { spread: 1.2 });
  particles?.emit('motes', p.clone().setY(p.y + 0.4), 14, { spread: 1.6 });
}
