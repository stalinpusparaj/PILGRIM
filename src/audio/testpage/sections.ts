/**
 * Music test page blocks: songs (play/stop, states, live position, validateSong problems), every SFX, every
 * ambience, and the volume sliders bound to the settings service.
 */
import { SONGS } from '../../../content/music/themes';
import { events } from '../../core/Events';
import { settings, type SettingsData } from '../../core/Settings';
import { h, setText } from '../../ui/dom';
import { validateSong } from '../Sequencer';
import { downloadWav, levels, renderSfxTour, renderSong } from '../renderOffline';
import type { AmbienceId, MusicState, SfxId, SongId } from '../types';
import { AMBIENCE_IDS, MUSIC_STATE_IDS, SFX_GROUPS, SFX_IDS, SONG_IDS } from './ids';
import type { PageContext, Part } from './types';
import { button, note, row, section, setOutlined, setPressed, slider } from './ui';

// ----------------------------------------------------------------------------------------------- songs

export interface SongsPart extends Part {
  /** Selects and plays a song with the current crossfade time and music state. */
  play(id: SongId): void;
}

/** Copies the live position (AudioEngine.musicPlayer, else a `position` on the facade) into `out`. */
function readPosition(audio: PageContext['audio'], out: { bar: number; beat: number }): boolean {
  const player = audio.musicPlayer;
  if (player) {
    const p = player.position; // the player reuses one object; copy it out
    out.bar = p.bar;
    out.beat = p.beat;
    return true;
  }
  const music: object = audio.music;
  if (!('position' in music)) return false;
  const p: unknown = music.position;
  if (typeof p !== 'object' || p === null || !('bar' in p) || !('beat' in p)) return false;
  const { bar, beat } = p;
  if (typeof bar !== 'number' || typeof beat !== 'number') return false;
  out.bar = bar;
  out.beat = beat;
  return true;
}

function songProblems(id: SongId): string[] {
  const def = SONGS[id];
  if (!def) return ['no song data in content/music/themes.ts'];
  try {
    return validateSong(def);
  } catch (err) {
    return [`validateSong threw: ${String(err)}`];
  }
}

function songLabel(id: SongId): string {
  const def = SONGS[id];
  if (!def) return `${id} (missing)`;
  const meter = `${def.meter[0]}/${def.meter[1]}`;
  return `${def.title} - ${id} - ${def.bpm} bpm, ${meter}, ${def.loopBars} bars${def.key ? `, ${def.key}` : ''}`;
}

/** Runs an offline render for a "Download WAV" button, showing progress and the result's levels in `out`. */
function renderButton(
  label: string,
  out: HTMLElement,
  render: () => Promise<[AudioBuffer, string]>,
): HTMLButtonElement {
  let busy = false;
  return button(label, () => {
    if (busy) return;
    busy = true;
    setText(out, 'Rendering...');
    render()
      .then(([buf, name]) => {
        const l = levels(buf);
        downloadWav(buf, name);
        setText(
          out,
          `Saved ${name}: ${buf.duration.toFixed(1)} s, peak ${l.peakDb.toFixed(1)} dBFS, RMS ${l.rmsDb.toFixed(1)} dBFS.`,
        );
      })
      .catch((err: unknown) => {
        console.error('[music] offline render failed', err);
        setText(out, 'The render failed (see the console).');
      })
      .finally(() => (busy = false));
  });
}

export function songsPart(page: PageContext, initial: SongId | null): SongsPart {
  const music = page.audio.music;
  let selected: SongId | null = initial;
  let fade = 1.5;
  const pos = { bar: 0, beat: 0 };

  const songButtons = new Map<SongId, HTMLButtonElement>();
  const list = h('div', { style: { display: 'grid', gap: '8px' } });
  for (const id of SONG_IDS) {
    const problems = songProblems(id);
    const btn = button(songLabel(id), () => play(id));
    btn.style.justifyContent = 'flex-start';
    btn.style.textAlign = 'left';
    btn.dataset.song = id;
    songButtons.set(id, btn);
    const status =
      problems.length === 0
        ? h('span', { style: { color: 'var(--leaf)', fontWeight: '800' } }, 'OK')
        : h(
            'details',
            { style: { color: 'var(--berry)' } },
            h('summary', null, `${problems.length} problem${problems.length === 1 ? '' : 's'}`),
            h(
              'ul',
              { style: { margin: '4px 0', fontSize: 'var(--fs-small)' } },
              problems.map((p) => h('li', null, p)),
            ),
          );
    list.append(h('div', { style: { display: 'grid', gap: '2px' } }, btn, status));
  }

  const stateButtons = new Map<MusicState, HTMLButtonElement>();
  for (const s of MUSIC_STATE_IDS)
    stateButtons.set(
      s,
      button(s, () => music.setState(s, fade)),
    );

  const now = h('p', { style: { margin: '0', fontWeight: '800', fontVariantNumeric: 'tabular-nums' } }, '-');
  const fadeSlider = slider('Crossfade s', 0, 4, 0.1, fade, (v) => (fade = v), 1);
  const wavNote = note(
    'Download WAV renders one loop of the selected song in the current state, as the game mixes it.',
  );
  const wav = renderButton('Download WAV', wavNote, async () => {
    const id = selected ?? music.current ?? 'pilgrim';
    const state = music.state;
    return [await renderSong(id, [{ state, loops: 1 }]), `${id}-${state}.wav`];
  });

  function play(id: SongId): void {
    selected = id;
    music.play(id, fade, music.state);
  }

  return {
    el: section(
      'Songs',
      note('Tap a song to play it. Songs crossfade; states crossfade the track layers.'),
      row(
        button('Play', () => selected && play(selected), true),
        button('Stop', () => music.stop(fade)),
        fadeSlider.el,
      ),
      row(h('span', null, 'State:'), [...stateButtons.values()]),
      now,
      row(wav, wavNote),
      list,
    ),
    play,
    update() {
      const current = music.current;
      for (const [id, btn] of songButtons) {
        setPressed(btn, id === current);
        setOutlined(btn, id === selected);
      }
      const state = music.state;
      for (const [s, btn] of stateButtons) setPressed(btn, s === state);
      if (!current) {
        setText(now, selected ? `Stopped. Selected: ${selected}` : 'Stopped.');
      } else if (readPosition(page.audio, pos)) {
        setText(now, `Playing ${current} (${state})  bar ${pos.bar + 1} : beat ${(pos.beat + 1).toFixed(2)}`);
      } else {
        setText(now, `Playing ${current} (${state})  position not exposed by the engine`);
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------- sfx

export function sfxPart(page: PageContext): Part {
  let volume = 1;
  let pitch = 1;
  const groups = new Map<string, SfxId[]>();
  for (const id of SFX_IDS) {
    const g = SFX_GROUPS[id];
    const ids = groups.get(g) ?? [];
    ids.push(id);
    groups.set(g, ids);
  }
  const blocks = [...groups].map(([name, ids]) =>
    h(
      'div',
      { style: { display: 'grid', gap: '6px' } },
      h('h3', { style: { margin: '4px 0 0', fontSize: 'var(--fs-body)' } }, name),
      row(
        ids.map((id) => {
          const b = button(id, () => page.audio.playSfx(id, { at: page.at(), volume, pitch }));
          b.dataset.sfx = id;
          return b;
        }),
      ),
    ),
  );
  const wavNote = note('Every effect once, one after another.');
  const wav = renderButton('Download WAV', wavNote, async () => [
    (await renderSfxTour(SFX_IDS)).buffer,
    'sfx-tour.wav',
  ]);
  return {
    el: section(
      `Sound effects (${SFX_IDS.length})`,
      row(
        slider('Volume', 0, 1, 0.05, volume, (v) => (volume = v)).el,
        slider('Pitch', 0.5, 2, 0.05, pitch, (v) => (pitch = v)).el,
      ),
      row(wav, wavNote),
      blocks,
    ),
  };
}

// -------------------------------------------------------------------------------------------- ambience

export function ambiencePart(page: PageContext): Part {
  let current: AmbienceId | null = null;
  const fade = 2;
  const buttons = new Map<AmbienceId | null, HTMLButtonElement>();
  const pick = (id: AmbienceId | null): void => {
    current = id;
    page.audio.ambience.set(id, fade);
  };
  buttons.set(
    null,
    button('off', () => pick(null)),
  );
  for (const id of AMBIENCE_IDS) {
    const b = button(id, () => pick(id));
    b.dataset.ambience = id;
    buttons.set(id, b);
  }
  return {
    el: section('Ambience', note('Beds crossfade over 2 s.'), row([...buttons.values()])),
    update() {
      for (const [id, btn] of buttons) setPressed(btn, id === current);
    },
  };
}

// --------------------------------------------------------------------------------------------- volumes

type VolumeKey = 'volMaster' | 'volMusic' | 'volVoices' | 'volEffects' | 'volAmbience';

const VOLUMES: ReadonlyArray<readonly [VolumeKey, string]> = [
  ['volMaster', 'Master'],
  ['volMusic', 'Music'],
  ['volVoices', 'Voices'],
  ['volEffects', 'Effects'],
  ['volAmbience', 'Ambience'],
];

function isVolumeKey(key: string): key is VolumeKey {
  return VOLUMES.some(([k]) => k === key);
}

/** Sliders bound to the settings service (the engine follows `settings:changed` live). */
export function volumesPart(): Part {
  const sliders = new Map<keyof SettingsData, ReturnType<typeof slider>>();
  for (const [key, label] of VOLUMES) {
    sliders.set(
      key,
      slider(label, 0, 1, 0.01, settings.data[key], (v) => settings.set(key, v)),
    );
  }
  const off = events.on('settings:changed', ({ key }) => {
    if (!isVolumeKey(key)) return;
    const s = sliders.get(key);
    if (s && s.get() !== settings.data[key]) s.set(settings.data[key]);
  });
  return {
    el: section(
      'Volumes',
      note('Saved in the game settings.'),
      [...sliders.values()].map((s) => s.el),
    ),
    dispose: off,
  };
}
