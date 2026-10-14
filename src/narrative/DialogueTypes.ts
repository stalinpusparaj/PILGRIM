/**
 * Dialogue graph format (GDD 2.8) and the runner <-> UI protocol. Types only.
 *
 * DATA. `content/dialogue/<file>.json` is an array of DialogueGraph. A graph id starts with its file id and an
 * underscore (`ch01_evangelist` lives in `ch01.json`, `test_evangelist` in `test.json`), so `play('ch01_x')`
 * can load the right file lazily. The FIRST node is the start node. Every `text` is an i18n key (en.json /
 * ta.json). `tools/validate-dialogue.mjs` checks every file (run it after editing dialogue).
 *
 *   { "id": "ch01_evangelist", "nodes": [
 *     { "id": "n1", "speaker": "evangelist", "text": "ch01.evangelist.1", "anim": "point", "next": "n2",
 *       "effects": { "cam": "over_shoulder_evangelist" } },
 *     { "id": "n2", "speaker": "christian", "text": "ch01.christian.1", "mood": "sad",
 *       "choices": [ { "text": "ch01.choice.run", "next": "n3", "effects": { "hope": 5 } },
 *                    { "text": "ch01.choice.ask", "next": "n4", "cond": "!asked" } ] } ] }
 *
 * - `cond` hides a node or a choice whose condition fails; a hidden node jumps straight to its `next` (its
 *   effects are not applied). Grammar (dialogue-rules.ts): terms joined with `&` (all must hold), each term
 *   optionally negated with a leading `!`:
 *     flagKey            the GameState flag is set and truthy (not false / 0 / '')
 *     flagKey=value      the flag's value as text equals `value`
 *     hasRoll | burden   GameState.hasRoll / GameState.burden
 *     gift:<id>          GameState.hasGift(id)         item:<id>   GameState.has(id) (carried item or gift)
 *     detour:<id>        the detour was taken           hope<30, hope>=60, chapter>=7 (< <= > >= =)
 * - Effects (GDD 2.8: hope, give, take, detour, flag, anim, cam, sfx, music, end) run when a node is entered
 *   (before its line shows) or when a choice is picked:
 *     hope    GameState.addHope(n)
 *     give    'roll' → giveRoll(); 'gift:<id>' → giveGift(id) (the Key of Promise arrives quietly, GDD 2.7.6);
 *             anything else → give(id) (Satchel > CARRIED)
 *     take    GameState.take(id)                    detour  GameState.enterDetour(id)
 *     flag    GameState.setFlag(key, value) for each entry; null clears the flag
 *     anim    '<clip>' or '<speaker>:<clip>' (AnimName). Default actor: the node's speaker; for a choice,
 *             'christian'. Upper-body clips (point, wave...) last until the line is left; full-body loops (sit,
 *             kneel...) until the dialogue ends.
 *     cam     a shot name ('over_shoulder_evangelist', 'close_christian', 'wide'...). The host's camera() gets
 *             it, or (no host camera) the runner emits 'dialogue:cam'. The shot 'release' gives the camera
 *             back to the follow rig; the runner sends it by itself at the end if any shot was requested.
 *     sfx     events.emit('sfx', { id })            music   events.emit('music:play', { id })
 *     end     ends the dialogue: after this node's line, or right after this choice
 *
 * PROTOCOL (src/narrative/Dialogue.ts DialogueRunner, registered as the 'dialogue' service). The runner never
 * touches the DOM, input or audio playback; the UI (DialoguePanel, SpeechBubbles) listens and calls back:
 *
 *   'dialogue:start' {id, speakers}      a graph begins. The runner also emits 'audio:duck'
 *                                        {on: true, by: 'dialogue'}.
 *   'dialogue:line'  DialogueLine        show this line: `bubble` true → world-space bubble over the speaker
 *                                        (SpeechBubbles), false → bottom panel (DialoguePanel). Render t(key)
 *                                        (again on 'lang:changed'), reveal it at `cps` with revealTimes()
 *                                        (src/audio/babblePlan.ts) and play babble with speakLine()
 *                                        (dialogue-voice.ts) so blips and letters stay in sync. The speaker's
 *                                        mouth flaps until lineDone().
 *        UI → runner.lineDone()          the text is fully shown (typewriter finished or was skipped; at once
 *                                        when cps is 0 = Instant). Idempotent.
 *          - no choices: the runner now waits for advance().
 *          - choices: 'dialogue:choices' is emitted synchronously from inside lineDone().
 *        UI → runner.advance()           the player pressed Space / E / A / tapped after the line was shown
 *                                        (a bubble UI may also call it after a reading pause). Called while
 *                                        the line is still typing it implies lineDone() first; ignored while
 *                                        choices are up. Leaving a line emits 'dialogue:lineEnd'.
 *        UI → runner.skipLine()          what Space does: typing → emits 'dialogue:reveal' (show the whole
 *                                        text now) + lineDone(); shown → advance().
 *        UI → runner.skipScene()         hold Space 1 s: runs through the lines (effects still apply, no
 *                                        'dialogue:line' events) up to the next choice or the end.
 *   'dialogue:choices' {choices}         1-3 choices, in display order. Keys 1/2/3, click, tap or pad pick
 *        UI → runner.choose(index)       `index` = the choice's `index` field (its 0-based position in this
 *                                        list). Emits 'dialogue:chose', applies the choice's effects, moves on.
 *   'dialogue:end' {id}                  the graph finished (or stop() was called); 'audio:duck'
 *                                        {on: false, by: 'dialogue'} comes just before it, play() resolves just
 *                                        after it.
 *
 * Who does what else: the host (ChapterManager / PlaySession) supplies actors and camera shots, locks the
 * player on 'dialogue:start' and frees it on 'dialogue:end'. Text speed comes from Settings 'textSpeed'
 * (TEXT_SPEED_CPS in dialogue-voice.ts) and arrives in each line as `cps`.
 */
import type { Character, Expression } from '../gen/CharacterFactory';
import type { FlagValue } from '../core/GameState';
import type { Mood, SfxId, SongId, VoiceParams } from '../audio/types';

export type { Expression } from '../gen/CharacterFactory';
export type { Mood } from '../audio/types';

// Constants (MAX_CHOICES, MAX_LINES_IN_A_ROW, PLAYER_SPEAKER, CAM_RELEASE) live in dialogue-rules.ts.

export interface DialogueGraph {
  id: string;
  /** The first node is the start. */
  nodes: DialogueNode[];
}

export interface DialogueNode {
  id: string;
  /** NPC id from the level (World.npcs), or 'christian' (the player). */
  speaker: string;
  /** i18n key. */
  text: string;
  /** AnimName played on the speaker as the line starts (upper-body clips only for the line). */
  anim?: string;
  /** Face for the line; defaults from `mood` (sad → sad, excited → happy...). */
  expr?: Expression;
  /** Babble mood; defaults from `expr`, else 'neutral'. */
  mood?: Mood;
  /** World-space bubble over the speaker instead of the bottom panel. */
  bubble?: boolean;
  next?: string;
  /** Max 3 (MAX_CHOICES). */
  choices?: DialogueChoice[];
  effects?: DialogueEffects;
  /** See the cond grammar above. */
  cond?: string;
}

export interface DialogueChoice {
  /** i18n key. */
  text: string;
  /** Defaults to the node's `next`. */
  next?: string;
  effects?: DialogueEffects;
  cond?: string;
}

export interface DialogueEffects {
  hope?: number;
  give?: string;
  take?: string;
  detour?: string;
  /** null clears the flag. */
  flag?: Record<string, FlagValue | null>;
  anim?: string;
  cam?: string;
  sfx?: SfxId;
  music?: SongId;
  end?: boolean;
}

/** Where an effects block came from (passed to the host's `effect` hook). */
export interface EffectContext {
  graph: string;
  node: string;
  /** The node's speaker. */
  speaker: string;
  from: 'node' | 'choice';
}

/** Supplied by the game (ChapterManager / PlaySession), or by a test. Every member is optional to implement. */
export interface DialogueHost {
  /** The Character that speaks for `speaker`, or null (no face, mouth or anims then). */
  actor(speaker: string): Character | null;
  /** Camera cut for a `cam` effect ('release' = back to the follow rig). Without it: 'dialogue:cam' events. */
  camera?(shot: string, speaker: string): void;
  /** Sees every effects block after the runner applied it (custom reactions). */
  effect?(e: DialogueEffects, ctx: EffectContext): void;
}

/** 'dialogue:line' payload. */
export interface DialogueLine {
  graph: string;
  node: string;
  speaker: string;
  /** Recipe id of the speaker's Character (portraits), or null when unknown. */
  recipe: string | null;
  /** i18n key: render t(key) when drawing (and again on 'lang:changed'). */
  key: string;
  mood: Mood;
  expr: Expression | null;
  /** true: world-space bubble over the speaker; false: the bottom panel. */
  bubble: boolean;
  /** Babble voice of the speaker. */
  voice: VoiceParams;
  /** Reveal speed in characters per second from Settings 'textSpeed'; 0 = Instant (show the whole line). */
  cps: number;
  /** Choices follow once lineDone() is called. */
  hasChoices: boolean;
  /** 1-based line number within this play of the graph. */
  index: number;
}

export interface DialogueChoiceView {
  /** Pass this to choose(). It is the 0-based position in the shown list. */
  index: number;
  /** i18n key. */
  key: string;
}

export interface DialogueChoicesEvent {
  graph: string;
  node: string;
  speaker: string;
  choices: DialogueChoiceView[];
}

declare module '../core/Events' {
  interface EventMap {
    'dialogue:start': { id: string; speakers: string[] };
    'dialogue:line': DialogueLine;
    /** skipLine() during the typewriter: show the whole line now. */
    'dialogue:reveal': { graph: string; node: string };
    /** The current line was left (advance, choice, skip, end): hide its bubble / text. */
    'dialogue:lineEnd': { graph: string; node: string };
    'dialogue:choices': DialogueChoicesEvent;
    'dialogue:chose': { graph: string; node: string; index: number; key: string };
    /** Camera shot request, only when the host has no camera() (shot 'release' = back to the follow rig). */
    'dialogue:cam': { graph: string; node: string; shot: string; speaker: string };
    // 'dialogue:end' { id } is declared in src/core/Events.ts.
  }
}
