/**
 * Music test page: babble demo. Voice preset x mood, live voice tweaks (with the JSON to paste into
 * content/characters/recipes.json), a text box and a typewriter that reveals the line on the same clock as the
 * babble (babblePlan.revealTimes), so sync can be judged by eye and ear.
 */
import { h, setText } from '../../ui/dom';
import { DEFAULT_CPS, revealTimes } from '../babblePlan';
import type { Mood, VoiceParams } from '../types';
import { VOICE_PRESETS } from '../voices';
import { MOOD_IDS } from './ids';
import type { PageContext, Part } from './types';
import { button, note, row, section, select, slider } from './ui';

const SAMPLE = 'Hello, friend! Is this the narrow way? I hope so. Shall we walk it together?';
const WAVES: readonly VoiceParams['wave'][] = ['sine', 'triangle', 'square', 'sawtooth'];
const FALLBACK: VoiceParams = { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 };
/** Pause between lines when playing every voice or every mood (ms). */
const GAP_MS = 350;

export function babblePart(page: PageContext): Part {
  const names = Object.keys(VOICE_PRESETS);
  const voice: VoiceParams = { ...(VOICE_PRESETS[names[0] ?? ''] ?? FALLBACK) };
  let mood: Mood = 'neutral';
  let cps = DEFAULT_CPS;
  let handle: { stop(): void } | null = null;
  let raf = 0;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by stop(): a running "every voice / every mood" sequence sees it and ends. */
  let run = 0;

  const json = h('code', { className: 'selectable', style: { fontSize: 'var(--fs-small)', wordBreak: 'break-all' } });
  const showJson = (): void => {
    const v = { pitch: round(voice.pitch), speed: round(voice.speed), wave: voice.wave, vowel: round(voice.vowel) };
    setText(json, `"voice": ${JSON.stringify(v)}`);
  };
  const edit = <K extends keyof VoiceParams>(key: K) => (v: VoiceParams[K]): void => {
    voice[key] = v;
    showJson();
  };
  const pitch = slider('Pitch', 0.25, 2.2, 0.01, voice.pitch, edit('pitch'));
  const speed = slider('Speed', 0.4, 2, 0.01, voice.speed, edit('speed'));
  const vowel = slider('Vowel', 0, 1, 0.01, voice.vowel, edit('vowel'));
  const wave = select('Wave', WAVES, voice.wave, edit('wave'));
  const voiceSel = select('Voice', names, names[0] ?? '', (name) => loadPreset(name));
  const moodSel = select('Mood', MOOD_IDS, mood, (m) => (mood = m));
  const cpsSlider = slider('Chars/s', 10, 80, 1, cps, (v) => (cps = v), 0);
  const text = h('textarea', {
    value: SAMPLE,
    rows: 2,
    'aria-label': 'Line to speak',
    style: {
      width: '100%',
      padding: '0.5em',
      borderRadius: 'var(--radius-sm)',
      border: '2px solid var(--panel-edge)',
      color: 'var(--ink)',
      background: '#fff',
      resize: 'vertical',
    },
  });
  const shown = h('p', {
    className: 'panel-inset',
    dataset: { babbleText: '' },
    style: { minHeight: '3.2em', margin: '0', fontSize: 'var(--fs-large)' },
  });
  showJson();

  function loadPreset(name: string): void {
    const p = VOICE_PRESETS[name];
    if (!p) return;
    Object.assign(voice, p);
    pitch.set(p.pitch);
    speed.set(p.speed);
    vowel.set(p.vowel);
    wave.input.value = p.wave;
    voiceSel.input.value = name;
    showJson();
  }

  /** Speaks the text box line with the current settings; resolves when the line is done. */
  function say(): Promise<void> {
    handle?.stop();
    cancelAnimationFrame(raf);
    const line = text.value;
    const spoken = page.audio.babble.speak({ ...voice }, line, { mood, cps, at: page.at() });
    handle = spoken;
    typewriter(line, cps);
    return spoken.done;
  }

  function typewriter(line: string, rate: number): void {
    const { times } = revealTimes(line, rate);
    const start = performance.now() + 30; // Babble starts its first blip ~30 ms after speak()
    let count = -1;
    const frame = (now: number): void => {
      const t = (now - start) / 1000;
      let n = Math.max(0, count);
      while (n < times.length && times[n] <= t) n++;
      if (n !== count) {
        count = n;
        setText(shown, line.slice(0, n));
      }
      raf = n < times.length ? requestAnimationFrame(frame) : 0;
    };
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    run++;
    if (gapTimer !== null) clearTimeout(gapTimer);
    gapTimer = null;
    handle?.stop();
    handle = null;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /** Runs steps one after another (each speaks a line), until stop(). */
  async function sequence(steps: ReadonlyArray<() => void>): Promise<void> {
    stop();
    const token = run;
    for (const step of steps) {
      if (token !== run) return;
      step();
      await say();
      if (token !== run) return;
      await new Promise<void>((resolve) => (gapTimer = setTimeout(resolve, GAP_MS)));
    }
  }

  const everyVoice = (): void => void sequence(names.map((name) => () => loadPreset(name)));
  const everyMood = (): void =>
    void sequence(
      MOOD_IDS.map((m) => () => {
        mood = m;
        moodSel.input.value = m;
      }),
    );

  return {
    el: section(
      'Babble voices',
      note('One blip per 2-3 letters, in time with the text. Pick a voice and a mood, then Speak.'),
      row(voiceSel.el, moodSel.el, wave.el),
      row(pitch.el, speed.el),
      row(vowel.el, cpsSlider.el),
      json,
      text,
      row(
        button(
          'Speak',
          () => {
            stop();
            void say();
          },
          true,
        ),
        button('Stop', stop),
        button('Every voice', everyVoice),
        button('Every mood', everyMood),
      ),
      shown,
    ),
    dispose: stop,
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
