/**
 * The engine's mixer (GDD 2.13 buses). Used by AudioEngine for every sound, the ambience included; it carries
 * the amb- prefix only because of file ownership while the audio system is built in parallel.
 *
 * music / voice / effects / ambience -> master -> limiter (DynamicsCompressor) -> soft clipper -> out -> speakers.
 * One shared ConvolverNode (generated impulse, Synth.createReverbImpulse) is fed by a music send (the music
 * player's per-track sends, taken after its faders) and an ambience send. Each send follows its bus level, so
 * turning the music down also turns its reverb down. Bus gains come from Settings (perceptual v^2 curve), duck,
 * silence and visibility.
 */
import { DEFAULT_SETTINGS, type SettingsData } from '../core/Settings';
import { services } from '../core/Services';
import { createReverbImpulse } from './Synth';

/** The engine's mixer nodes. For meters, tests and the music test page. */
export interface AudioBuses {
  readonly master: GainNode;
  readonly music: GainNode;
  readonly voice: GainNode;
  readonly effects: GainNode;
  readonly ambience: GainNode;
  /** Reverb sends (into the shared convolver). The MusicPlayer (and InstrumentBank) use musicSend. */
  readonly musicSend: GainNode;
  readonly ambienceSend: GainNode;
  /** Final node before the destination (after the limiter); its gain is the tab-hidden mute. */
  readonly out: GainNode;
}

/** What the mix depends on besides the volume settings. */
export interface MixFlags {
  /** Dialogue is on: music -6 dB. */
  ducked: boolean;
  /**
   * 'music:silence': ambience and the shared reverb return off until the next music:play / ambience:set (only
   * music and ambience feed the reverb, so its ringing tail would otherwise fill the silence).
   */
  silenced: boolean;
  /** Tab hidden: everything off. */
  hidden: boolean;
}

/**
 * Bus trims at full volume: the mix balance. Measured in Chrome at the default volumes (0.8): the Pilgrim theme
 * about -22 dBFS RMS (peaks -12) at the output, babble peaks about -11, effect peaks -10..-6, ambience beds
 * about -27 RMS. `master` drives the limiter a little so phones are loud
 * enough; the limiter (makeup gain ~ +3.8 dB below its threshold) and the clipper keep every peak under 0 dBFS.
 */
const MIX = { master: 1.4, music: 1, voice: 1.25, effects: 1, ambience: 0.8, reverb: 0.8 } as const;
/** -6 dB (GDD 2.13: dialogue ducks music by 6 dB). */
export const DUCK_GAIN = Math.pow(10, -6 / 20);
const REVERB_SECONDS = 2.4;
const REVERB_DECAY = 3;

export class Mixer implements AudioBuses {
  readonly master: GainNode;
  readonly music: GainNode;
  readonly voice: GainNode;
  readonly effects: GainNode;
  readonly ambience: GainNode;
  readonly musicSend: GainNode;
  readonly ambienceSend: GainNode;
  readonly out: GainNode;
  private readonly reverbOut: GainNode;
  private readonly nodes: AudioNode[] = [];

  /** Any context: the engine's AudioContext, or an OfflineAudioContext for offline renders (renderOffline.ts). */
  constructor(private readonly ctx: BaseAudioContext) {
    this.out = this.gain(1);
    this.master = this.gain(0);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 3;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = 'none';
    this.nodes.push(limiter, clip);
    this.master.connect(limiter).connect(clip).connect(this.out).connect(ctx.destination);
    this.music = this.gain(0);
    this.voice = this.gain(0);
    this.effects = this.gain(0);
    this.ambience = this.gain(0);
    for (const bus of [this.music, this.voice, this.effects, this.ambience]) bus.connect(this.master);
    const reverbIn = this.gain(1);
    const convolver = ctx.createConvolver();
    convolver.normalize = false; // the impulse has unit energy per channel
    convolver.buffer = createReverbImpulse(ctx, REVERB_SECONDS, REVERB_DECAY);
    this.nodes.push(convolver);
    this.reverbOut = this.gain(MIX.reverb);
    reverbIn.connect(convolver).connect(this.reverbOut).connect(this.master);
    this.musicSend = this.gain(0);
    this.ambienceSend = this.gain(0);
    this.musicSend.connect(reverbIn);
    this.ambienceSend.connect(reverbIn);
  }

  /** Sets every bus from settings and `f`; `tc` = ramp time constant in seconds (0 = instant). */
  apply(f: MixFlags, tc: number): void {
    const s: Readonly<SettingsData> = services.tryGet('settings')?.data ?? DEFAULT_SETTINGS;
    const t = this.ctx.currentTime;
    const music = MIX.music * curve(s.volMusic) * (f.ducked ? DUCK_GAIN : 1);
    const amb = f.silenced ? 0 : MIX.ambience * curve(s.volAmbience);
    setGain(this.master.gain, MIX.master * curve(s.volMaster), t, tc);
    setGain(this.music.gain, music, t, tc);
    setGain(this.musicSend.gain, music, t, tc);
    setGain(this.voice.gain, MIX.voice * curve(s.volVoices), t, tc);
    setGain(this.effects.gain, MIX.effects * curve(s.volEffects), t, tc);
    setGain(this.ambience.gain, amb, t, tc);
    setGain(this.ambienceSend.gain, amb, t, tc);
    setGain(this.reverbOut.gain, f.silenced ? 0 : MIX.reverb, t, tc);
    setGain(this.out.gain, f.hidden ? 0 : 1, t, tc);
  }

  dispose(): void {
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
  }

  private gain(v: number): GainNode {
    const n = this.ctx.createGain();
    n.gain.value = v;
    this.nodes.push(n);
    return n;
  }
}

/** Settings volume 0..1 -> gain (perceptual: half way sounds about half as loud). */
export function curve(v: number): number {
  const c = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  return c * c;
}

/** Linear up to 0.8, then a tanh knee that never passes 0.96: whatever the limiter misses cannot clip. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const knee = 0.8;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

function setGain(p: AudioParam, v: number, t: number, tc: number): void {
  if (tc <= 0) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  } else {
    p.setTargetAtTime(v, t, tc);
  }
}
