/**
 * Timed events of a cutscene (TimedEvent in cutscene-types.ts): sorted once, fired in time order by the player,
 * each in its own try/catch so one broken callback never stalls a scene. Also resolves how a 'say' line is
 * shown: the context's `say`, else the 'bubbles' service (SpeechBubbles), else the letterbox captions.
 */
import '../audio/events';
import { events, type EventName } from '../core/Events';
import { services } from '../core/Services';
import type { Character } from '../gen/CharacterFactory';
import type { Mood } from '../audio/types';
import type { CutsceneContext, MusicCue, SayFn, SayHandle, TimedEvent } from './cutscene-types';

/** Event names and payloads are checked where a TimedEvent is written (EmitTuple); here they pass through. */
const emitAny = events.emit as unknown as (this: typeof events, name: EventName, payload?: unknown) => void;

export function sortEvents(list: readonly TimedEvent[] | undefined): TimedEvent[] {
  return (list ?? [])
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => Number.isFinite(e.at))
    .sort((x, y) => x.e.at - y.e.at || x.i - y.i)
    .map(({ e }) => e);
}

function playMusic(cue: MusicCue): void {
  if (cue === 'stop') events.emit('music:stop', {});
  else if (cue === 'silence') events.emit('music:silence', {});
  else if (typeof cue === 'string') events.emit('music:play', { id: cue });
  else if ('id' in cue) events.emit('music:play', cue);
  else events.emit('music:state', cue);
}

export function fireEvent(e: TimedEvent, cutsceneId: string): void {
  try {
    if ('run' in e) e.run();
    else if ('sfx' in e) events.emit('sfx', typeof e.sfx === 'string' ? { id: e.sfx } : e.sfx);
    else if ('music' in e) playMusic(e.music);
    else emitAny.call(events, e.emit[0], e.emit[1]);
  } catch (err) {
    console.error(`[cutscene] "${cutsceneId}": event at ${e.at}s threw`, err);
  }
}

/** Collects the handles of lines on screen so a skip can close them. */
export class LineTracker {
  private readonly open: SayHandle[] = [];

  add(h: SayHandle | void): void {
    if (h && typeof h.close === 'function') this.open.push(h);
  }

  closeAll(): void {
    for (const h of this.open.splice(0)) {
      try {
        h.close?.();
      } catch (err) {
        console.error('[cutscene] closing a line threw', err);
      }
    }
  }

  forget(): void {
    this.open.length = 0;
  }
}

/** The SpeechBubbles service as a SayFn (bubbles auto-dismiss 2 s after their text is shown). */
function bubbleSay(): SayFn | null {
  const bubbles = services.tryGet('bubbles');
  if (!bubbles) return null;
  return (actor: Character, key: string, opts: { mood?: Mood; params?: Record<string, string | number> }) => {
    const handle = bubbles.speak(actor, key, { mood: opts.mood, params: opts.params });
    return { close: () => handle.dismiss() };
  };
}

/** How lines are shown: the context's own `say`, the bubbles service, or `fallback` (letterbox captions). */
export function resolveSay(ctx: CutsceneContext, fallback: SayFn): SayFn {
  const say = ctx.say ?? bubbleSay() ?? fallback;
  return (actor, key, opts) => {
    try {
      return say(actor, key, opts);
    } catch (err) {
      console.error(`[cutscene] showing line "${key}" threw; using a caption`, err);
      return say === fallback ? undefined : fallback(actor, key, opts);
    }
  };
}
