/**
 * Dialogue effects and conditions against the session state (GDD 2.8): hope, give, take, detour and flag go
 * through GameState (the 'state' service) so its events fire; anim goes to the ActorStage; cam to the host's
 * camera() or a 'dialogue:cam' event; sfx and music to the audio events. `end` is handled by the runner.
 *
 * Without a 'state' service (tests, tools) conditions read as "nothing set" and state effects are skipped with
 * one dev warning.
 */
import { events } from '../core/Events';
import { GIFT_IDS, type GameState, type GiftId } from '../core/GameState';
import '../audio/events';
import type { ActorStage } from './dialogue-actors';
import { PLAYER_SPEAKER, type CondReader } from './dialogue-rules';
import type { DialogueEffects, DialogueHost, EffectContext } from './DialogueTypes';

/** Reads conditions from a GameState (or reads "nothing set" without one). */
export function stateReader(state: () => GameState | undefined): CondReader {
  return {
    flag: (key) => state()?.flag(key),
    get hasRoll() {
      return state()?.hasRoll ?? false;
    },
    get burden() {
      return state()?.burden ?? false;
    },
    hasGift: (id) => {
      const s = state();
      return s !== undefined && isGiftId(id) && s.hasGift(id);
    },
    has: (id) => state()?.has(id) ?? false,
    detour: (id) => state()?.data.detours.includes(id) ?? false,
    get hope() {
      return state()?.hope ?? 0;
    },
    get chapter() {
      return state()?.chapter ?? 0;
    },
  };
}

export function isGiftId(id: string): id is GiftId {
  return (GIFT_IDS as readonly string[]).includes(id);
}

export interface EffectTarget {
  host: DialogueHost;
  stage: ActorStage;
  state(): GameState | undefined;
  /** Called with every camera shot sent (so the runner knows to release the camera at the end). */
  onShot(shot: string): void;
}

let warnedNoState = false;

/** Applies an effects block (all but `end`). */
export function applyEffects(e: DialogueEffects | undefined, ctx: EffectContext, to: EffectTarget): void {
  if (!e) return;
  const s = to.state();
  const needsState = e.hope !== undefined || e.give || e.take || e.detour || e.flag;
  if (needsState && !s && import.meta.env.DEV && !warnedNoState) {
    warnedNoState = true;
    console.warn('[dialogue] no "state" service: hope / give / take / detour / flag effects are skipped');
  }
  if (s) {
    if (e.flag) for (const [k, v] of Object.entries(e.flag)) s.setFlag(k, v ?? undefined);
    if (e.give) give(s, e.give);
    if (e.take) s.take(e.take);
    if (e.detour) s.enterDetour(e.detour);
    if (e.hope !== undefined) s.addHope(e.hope);
  }
  if (e.anim) {
    const colon = e.anim.indexOf(':');
    const who = colon >= 0 ? e.anim.slice(0, colon) : ctx.from === 'choice' ? PLAYER_SPEAKER : ctx.speaker;
    to.stage.play(to.stage.actor(who), colon >= 0 ? e.anim.slice(colon + 1) : e.anim);
  }
  if (e.cam) sendShot(e.cam, ctx, to);
  if (e.sfx) events.emit('sfx', { id: e.sfx });
  if (e.music) events.emit('music:play', { id: e.music });
  try {
    to.host.effect?.(e, ctx);
  } catch (err) {
    console.error('[dialogue] host.effect threw', err);
  }
}

/** A camera shot: the host's camera() when it has one, else a 'dialogue:cam' event. */
export function sendShot(shot: string, ctx: EffectContext, to: EffectTarget): void {
  to.onShot(shot);
  if (to.host.camera) {
    try {
      to.host.camera(shot, ctx.speaker);
    } catch (err) {
      console.error(`[dialogue] host.camera("${shot}") threw`, err);
    }
    return;
  }
  events.emit('dialogue:cam', { graph: ctx.graph, node: ctx.node, shot, speaker: ctx.speaker });
}

function give(s: GameState, id: string): void {
  if (id === 'roll') {
    s.giveRoll();
    return;
  }
  if (id.startsWith('gift:')) {
    const gift = id.slice(5);
    // GDD 2.7.6: the Key of Promise arrives quietly (no toast) and is never hinted before Chapter XI.
    if (isGiftId(gift)) s.giveGift(gift, gift === 'key_promise');
    else console.warn(`[dialogue] unknown gift "${gift}"`);
    return;
  }
  s.give(id);
}
