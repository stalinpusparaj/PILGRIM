/**
 * Babble voices (GDD 2.13): language-free syllable blips that play while dialogue text appears.
 *
 * Each line gets a small voice chain: blips (oscillator in the voice's wave + short envelope) feed a tone
 * low-pass and two formant band-passes (F1/F2 from the vowel colour, moved per syllable so the vowel alternates),
 * then an optional tremolo (scared lines, growling giants), a fader, an optional PannerNode, and the voice bus.
 * The plan (timing, melody, vowels) comes from babblePlan.ts and is deterministic per text.
 *
 * Level: every voice is normalised to the same loudness on small speakers (harmonics of the wave through the
 * voice's own filters, weighted like a phone speaker), so a square-wave giant is no louder than a sine angel.
 * Nothing is ever loud: peaks stay well under the voice bus, and at most MAX_LINES lines play at once.
 *
 * Realtime contexts schedule blips with a small look-ahead timer; an OfflineAudioContext gets the whole line
 * scheduled at once (used by tests and level checks).
 */
import {
  BABBLE_BASE_HZ,
  DEFAULT_CPS,
  MOOD_SHAPES,
  formant1,
  formant2,
  planBabble,
  sanitizeVoice,
  toneCutoff,
  type BabblePlan,
  type MoodShape,
} from './babblePlan';
import { WAVE_MIX, createLevelScratch, loudness, type LevelScratch } from './babbleLevel';
import type { Mood, Vec3, VoiceParams } from './types';

export interface BabbleOptions {
  mood?: Mood;
  /** Text reveal speed in characters per second (default 40, GDD 2.8). */
  cps?: number;
  /** World position for a positional voice (uses the shared ctx.listener). */
  at?: Vec3;
}

export interface BabbleHandle {
  /** Stops the line with a short fade (safe to call more than once). */
  stop(): void;
  /** Resolves when the line has been spoken (or stopped). Never rejects. */
  readonly done: Promise<void>;
}

const LOOKAHEAD = 0.12;
const TICK_MS = 25;
const START_DELAY = 0.03;
/** Blip envelope peak before loudness normalisation. */
const BLIP_PEAK = 0.5;
/** Weighted loudness every voice is normalised to: lines sit near -25 dBFS RMS, peaks under -10 dBFS. */
const TARGET_LOUDNESS = 0.1;
/** Normalisation never boosts or cuts more than this. */
const MIN_COMP = 0.05;
const MAX_COMP = 4;
/** Voices pitched below this growl: rough amplitude modulation at GROWL_HZ. */
const GROWL_BELOW = 0.42;
const GROWL_HZ = 27;
const GROWL_DEPTH = 0.55;
/** Bell envelopes (sine voices) decay fast, so they carry less energy than a sustained blip. */
const BELL_MAKE_UP = 1.6;
/** Lines allowed at once; the oldest is faded out when a new one would exceed it. */
const MAX_LINES = 6;
const FADE = 0.04;

function isOffline(ctx: BaseAudioContext): boolean {
  return typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
}

function setPannerPosition(p: PannerNode, at: Vec3): void {
  if (p.positionX) {
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
  } else {
    p.setPosition(at[0], at[1], at[2]);
  }
}

export class Babble {
  private readonly lines = new Set<Line>();
  private readonly scratch: LevelScratch;
  private disposed = false;

  /** `ctx` may be an OfflineAudioContext (tests); `out` is the voice bus. */
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
  ) {
    this.scratch = createLevelScratch();
  }

  /** Lines currently playing. */
  get active(): number {
    return this.lines.size;
  }

  speak(voice: VoiceParams, text: string, opts: BabbleOptions = {}): BabbleHandle {
    if (this.disposed || this.ctx.state === 'closed') return silentLine(voice, text, opts);
    const v = sanitizeVoice(voice);
    const mood = moodOf(opts);
    const plan = planBabble(v, text, mood, cpsOf(opts));
    if (plan.count === 0) return waitHandle(plan.end);
    // Not unlocked yet (or suspended): stay silent but keep the timing, so callers awaiting `done` still flow.
    if (!isOffline(this.ctx) && this.ctx.state !== 'running') return waitHandle(plan.end);

    if (this.lines.size >= MAX_LINES) {
      const oldest = this.lines.values().next().value;
      oldest?.stop();
    }
    const line = new Line(this.ctx, this.out, v, MOOD_SHAPES[mood], plan, opts.at, this.scratch);
    this.lines.add(line);
    void line.done.then(() => this.lines.delete(line));
    return line;
  }

  /** Stops every line at once and refuses new ones. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const line of this.lines) line.stop(true);
    this.lines.clear();
  }
}

/**
 * A silent line that still takes the line's length: `done` resolves when speak() would have finished (or on
 * stop()). The engine returns it while audio cannot play (before the unlock, no Web Audio), so dialogue that
 * waits on `done` keeps its pace.
 */
export function silentLine(voice: VoiceParams, text: string, opts: BabbleOptions = {}): BabbleHandle {
  return waitHandle(planBabble(sanitizeVoice(voice), text, moodOf(opts), cpsOf(opts)).end);
}

function moodOf(opts: BabbleOptions): Mood {
  return opts.mood && MOOD_SHAPES[opts.mood] ? opts.mood : 'neutral';
}

function cpsOf(opts: BabbleOptions): number {
  return opts.cps !== undefined && Number.isFinite(opts.cps) && opts.cps > 0 ? opts.cps : DEFAULT_CPS;
}

/** A handle that only keeps time (no sound). */
function waitHandle(seconds: number): BabbleHandle {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const timer = setTimeout(finish, Math.max(0, seconds) * 1000);
  return {
    done,
    stop: () => {
      clearTimeout(timer);
      finish();
    },
  };
}

/** One spoken line: its voice chain, the blip scheduler and cleanup. */
class Line implements BabbleHandle {
  readonly done: Promise<void>;
  private resolveDone: () => void = () => undefined;
  private readonly offline: boolean;
  private readonly chain: AudioNode[] = [];
  private readonly lfos: OscillatorNode[] = [];
  private readonly live = new Set<OscillatorNode>();
  private readonly input: GainNode;
  private readonly bp1: BiquadFilterNode;
  private readonly bp2: BiquadFilterNode;
  private readonly fader: GainNode;
  private readonly level: number;
  private readonly bell: boolean;
  private readonly t0: number;
  private readonly deadline: number;
  private next = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private safety: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  private torn = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    private readonly voice: VoiceParams,
    mood: MoodShape,
    private readonly plan: BabblePlan,
    at: Vec3 | undefined,
    scratch: LevelScratch,
  ) {
    this.done = new Promise<void>((resolve) => (this.resolveDone = resolve));
    this.offline = isOffline(ctx);
    this.bell = voice.wave === 'sine';
    this.t0 = ctx.currentTime + START_DELAY;
    this.deadline = performance.now() + (plan.end + START_DELAY + 0.5) * 1000;

    // input -> [tone low-pass, F1 band-pass, F2 band-pass] -> fader -> [tremolo] -> [panner] -> out
    const mix = WAVE_MIX[voice.wave];
    this.input = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = toneCutoff(voice.vowel + mood.vowel, mood.bright);
    lp.Q.value = 0.5;
    this.bp1 = ctx.createBiquadFilter();
    this.bp1.type = 'bandpass';
    this.bp1.Q.value = 5;
    this.bp1.frequency.value = formant1(voice.vowel, voice.pitch);
    this.bp2 = ctx.createBiquadFilter();
    this.bp2.type = 'bandpass';
    this.bp2.Q.value = 7;
    this.bp2.frequency.value = formant2(voice.vowel, voice.pitch);
    const gDry = ctx.createGain();
    gDry.gain.value = mix.dry;
    const g1 = ctx.createGain();
    g1.gain.value = mix.f1;
    const g2 = ctx.createGain();
    g2.gain.value = mix.f2;
    this.fader = ctx.createGain();
    this.input.connect(lp).connect(gDry).connect(this.fader);
    this.input.connect(this.bp1).connect(g1).connect(this.fader);
    this.input.connect(this.bp2).connect(g2).connect(this.fader);
    this.chain.push(this.input, lp, this.bp1, this.bp2, gDry, g1, g2, this.fader);

    let tail: AudioNode = this.fader;
    const growl = voice.pitch < GROWL_BELOW ? GROWL_DEPTH : 0;
    /** Level make-up for the tremolo, so it wobbles without making the line quieter. */
    let tremMakeUp = 1;
    if (growl > 0 || mood.tremolo > 0) {
      const trem = ctx.createGain();
      const base = 1 - 0.5 * (growl + mood.tremolo);
      trem.gain.value = base;
      if (growl > 0) this.addLfo(trem, GROWL_HZ, growl * 0.5);
      if (mood.tremolo > 0) this.addLfo(trem, mood.tremoloHz, mood.tremolo * 0.5);
      const m = 0.5 * (growl + mood.tremolo);
      tremMakeUp = 1 / Math.sqrt(base * base + (m * m) / 2);
      tail.connect(trem);
      this.chain.push(trem);
      tail = trem;
    }
    if (at) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 2;
      p.maxDistance = 40;
      p.rolloffFactor = 0.9;
      setPannerPosition(p, at);
      tail.connect(p);
      this.chain.push(p);
      tail = p;
    }
    tail.connect(out);

    const f0 = BABBLE_BASE_HZ * voice.pitch * Math.pow(2, mood.semis / 12);
    const loud = loudness(voice.wave, f0, [lp, this.bp1, this.bp2], [mix.dry, mix.f1, mix.f2], scratch);
    const comp = loud > 0 ? Math.min(MAX_COMP, Math.max(MIN_COMP, TARGET_LOUDNESS / loud)) : 1;
    this.level = BLIP_PEAK * comp * mood.gain * tremMakeUp * (this.bell ? BELL_MAKE_UP : 1);

    if (this.offline) {
      for (let k = 0; k < plan.count; k++) this.blip(k);
      this.next = plan.count;
    } else {
      this.tick();
    }
  }

  stop(immediate = false): void {
    this.finish(true, immediate);
  }

  private addLfo(target: GainNode, hz: number, depth: number): void {
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = hz;
    const amt = this.ctx.createGain();
    amt.gain.value = depth;
    lfo.connect(amt).connect(target.gain);
    lfo.start(this.ctx.currentTime);
    this.lfos.push(lfo);
    this.chain.push(amt);
  }

  private readonly tick = (): void => {
    this.timer = null;
    if (this.finished) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (performance.now() >= this.deadline) {
      this.finish(false, false);
      return;
    }
    if (ctx.state === 'running') {
      const plan = this.plan;
      const horizon = now + LOOKAHEAD;
      while (this.next < plan.count && this.t0 + plan.time[this.next] < horizon) {
        // A blip that is already late (the page stalled) is skipped rather than bunched up.
        if (this.t0 + plan.time[this.next] >= now - 0.015) this.blip(this.next);
        this.next++;
      }
      if (now >= this.t0 + plan.end) {
        this.finish(false, false);
        return;
      }
    }
    this.timer = setTimeout(this.tick, TICK_MS);
  };

  private blip(k: number): void {
    const ctx = this.ctx;
    const plan = this.plan;
    const t = Math.max(this.t0 + plan.time[k], ctx.currentTime);
    const d = plan.dur[k];
    const f = plan.hz[k];
    const osc = ctx.createOscillator();
    osc.type = this.voice.wave;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * plan.glide[k], t + d);
    const env = ctx.createGain();
    const g = env.gain;
    const peak = this.level * plan.gain[k];
    g.setValueAtTime(0, t);
    let stopAt: number;
    if (this.bell) {
      // Bell-like: instant strike, ringing exponential decay.
      g.linearRampToValueAtTime(peak, t + 0.004);
      g.setTargetAtTime(0, t + 0.004, d * 0.5);
      stopAt = t + 0.004 + d * 3;
    } else {
      const attack = Math.min(0.012, d * 0.2);
      g.linearRampToValueAtTime(peak, t + attack);
      g.linearRampToValueAtTime(peak * 0.72, t + d * 0.6);
      g.linearRampToValueAtTime(0, t + d);
      stopAt = t + d + 0.005;
    }
    const v = plan.vowel[k];
    this.bp1.frequency.setTargetAtTime(formant1(v, this.voice.pitch), t, 0.01);
    this.bp2.frequency.setTargetAtTime(formant2(v, this.voice.pitch), t, 0.01);
    osc.connect(env).connect(this.input);
    osc.onended = () => this.ended(osc, env);
    osc.start(t);
    osc.stop(stopAt);
    this.live.add(osc);
  }

  private ended(osc: OscillatorNode, env: GainNode): void {
    osc.onended = null;
    osc.disconnect();
    env.disconnect();
    this.live.delete(osc);
    if (this.live.size > 0) return;
    if (this.finished) this.teardown();
    else if (this.offline && this.next >= this.plan.count) this.finish(false, false);
  }

  private finish(cut: boolean, immediate: boolean): void {
    if (this.finished) {
      if (immediate) this.teardown();
      return;
    }
    this.finished = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    if (cut && !immediate) {
      const g = this.fader.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + FADE);
      for (const osc of this.live) osc.stop(now + FADE + 0.01);
    }
    this.resolveDone();
    if (immediate || this.live.size === 0) this.teardown();
    // onended normally tears down; this covers a context that stops running before the blips end.
    else this.safety = setTimeout(() => this.teardown(), 1500);
  }

  private teardown(): void {
    if (this.torn) return;
    this.torn = true;
    if (this.safety !== null) clearTimeout(this.safety);
    this.safety = null;
    for (const osc of this.live) {
      osc.onended = null;
      try {
        osc.stop();
      } catch {
        // already stopped
      }
      osc.disconnect();
    }
    this.live.clear();
    for (const lfo of this.lfos) {
      try {
        lfo.stop();
      } catch {
        // already stopped
      }
      lfo.disconnect();
    }
    this.lfos.length = 0;
    for (const node of this.chain) node.disconnect();
    this.chain.length = 0;
  }
}
