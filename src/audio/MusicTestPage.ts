/**
 * Music test page (`?music=<songId>`, ARCHITECTURE "Runtime modes"): a full-screen dev page to judge the audio
 * on any speaker. Plain English (dev tool).
 *
 * - A big "Tap to start audio" button unlocks the AudioContext (browsers need a gesture; iOS needs resume()).
 *   The page's own engine asks iOS for the 'playback' audio session, so an iPhone in silent mode still plays;
 *   the overlay also says to turn silent mode off (iOS before 16.4 cannot be asked).
 * - Songs: every SongId with its validateSong() problems; the ?music= song is preselected and starts right
 *   after the unlock. Play / Stop, crossfade time, music states, live bar:beat.
 * - Babble demo (voice presets x moods, typewriter in sync), a button for every SfxId, every ambience + off,
 *   and the volume sliders bound to the settings service.
 *
 * Uses the 'audio' service when one is registered, otherwise builds (and later disposes) its own AudioEngine.
 */
import { services } from '../core/Services';
import { h, uiRoot } from '../ui/dom';
import { AudioEngine } from './AudioEngine';
import { babblePart } from './testpage/BabbleDemo';
import { isSongId } from './testpage/ids';
import { ambiencePart, sfxPart, songsPart, volumesPart, type SongsPart } from './testpage/sections';
import type { PageContext, Part, TestPageAudio } from './testpage/types';
import { note, row, section, select } from './testpage/ui';
import type { SongId, Vec3 } from './types';

type PositionName = 'centre' | 'left' | 'right' | 'behind' | 'far';

/** Listener-relative test positions (the listener sits at the origin looking down -Z). */
const POSITIONS: Readonly<Record<PositionName, Vec3 | undefined>> = {
  centre: undefined,
  left: [-3, 0, -0.5],
  right: [3, 0, -0.5],
  behind: [0, 0, 3],
  far: [0, 0, -25],
};
const POSITION_NAMES = Object.keys(POSITIONS) as PositionName[];

const UPDATE_MS = 100;

export class MusicTestPage {
  private readonly requested: string | null;
  private readonly preselect: SongId | null;
  private root: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private audio: TestPageAudio | null = null;
  private ownsAudio = false;
  private parts: Part[] = [];
  private songs: SongsPart | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private position: PositionName = 'centre';
  private unlocked = false;
  private disposed = false;

  /** `songId` comes from `?music=`; an unknown id is reported on the page and nothing is preselected. */
  constructor(songId: string | null) {
    this.requested = songId;
    this.preselect = isSongId(songId) ? songId : null;
  }

  start(): void {
    if (this.root || this.disposed) return;
    const root = h('div', {
      className: 'ui-interactive safe-pad',
      dataset: { musicTest: '' },
      style: {
        position: 'fixed',
        inset: '0',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        touchAction: 'pan-y',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
        background: 'var(--night)',
      },
    });
    this.root = root;
    uiRoot().append(root);

    let audio: TestPageAudio;
    try {
      const shared = services.tryGet('audio');
      if (shared) {
        audio = shared;
      } else {
        // 'playback': the page exists to judge the music on phone speakers, silent mode or not.
        audio = new AudioEngine({ audioSession: 'playback' });
        this.ownsAudio = true;
      }
    } catch (err) {
      console.error('[music] the audio engine could not start', err);
      root.append(section('Audio is not available', note('This browser could not start Web Audio.')));
      return;
    }
    this.audio = audio;

    const page: PageContext = { audio, at: () => POSITIONS[this.position] };
    this.songs = songsPart(page, this.preselect);
    this.parts = [this.songs, babblePart(page), sfxPart(page), ambiencePart(page), volumesPart()];
    root.append(this.header(), ...this.parts.map((p) => p.el));
    this.overlay = this.unlockOverlay();
    root.append(this.overlay);

    if (audio.ready) this.afterUnlock();
    this.timer = setInterval(this.update, UPDATE_MS);
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const part of this.parts) part.dispose?.();
    this.parts = [];
    this.songs = null;
    const audio = this.audio;
    if (audio) {
      // Leave a shared engine quiet; our own engine goes away completely.
      audio.music.stop(0.3);
      audio.ambience.set(null, 0.3);
      if (this.ownsAudio) audio.dispose();
    }
    this.audio = null;
    this.root?.remove();
    this.root = null;
    this.overlay = null;
    this.status = null;
  }

  private readonly update = (): void => {
    if (!this.unlocked && this.audio?.ready) this.afterUnlock();
    for (const part of this.parts) part.update?.();
  };

  private header(): HTMLElement {
    const unknown =
      this.requested && !this.preselect ? `"?music=${this.requested}" is not a song id; pick one below.` : null;
    const pos = select('Position', POSITION_NAMES, this.position, (p) => (this.position = p));
    return section(
      'PILGRIM music test page',
      note(
        this.preselect
          ? `Song from the address bar: ${this.preselect}. It starts after the tap.`
          : 'Add ?music=<song id> to the address to preselect a song.',
      ),
      unknown && h('p', { style: { margin: '0', color: 'var(--berry)', fontWeight: '800' } }, unknown),
      row(pos.el, note('Position applies to sound effects and babble (left / right test the panner).')),
      note(this.ownsAudio ? 'Engine: own AudioEngine for this page.' : "Engine: the shared 'audio' service."),
    );
  }

  private unlockOverlay(): HTMLElement {
    this.status = h('p', { className: 'on-scene', style: { margin: '0', textAlign: 'center' } }, '');
    return h(
      'div',
      {
        className: 'ui-interactive',
        dataset: { unlock: '' },
        style: {
          position: 'fixed',
          inset: '0',
          zIndex: '5',
          display: 'grid',
          placeItems: 'center',
          alignContent: 'center',
          gap: '16px',
          padding: '16px',
          background: 'rgba(28, 20, 34, 0.92)',
        },
      },
      h(
        'button',
        {
          className: 'btn',
          type: 'button',
          style: { fontSize: 'var(--fs-title)', padding: '0.8em 1.6em', borderRadius: 'var(--radius-lg)' },
          onClick: () => void this.unlock(),
        },
        'Tap to start audio',
      ),
      this.preselect && h('p', { className: 'on-scene', style: { margin: '0' } }, `Then playing: ${this.preselect}`),
      this.status,
      h(
        'p',
        { className: 'on-scene', style: { margin: '0', textAlign: 'center', fontSize: 'var(--fs-small)' } },
        'No sound on an iPhone or iPad? Turn off silent mode and turn the volume up.',
      ),
    );
  }

  private async unlock(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.unlocked) return;
    if (this.status) this.status.textContent = 'Starting audio...';
    try {
      await audio.unlock();
    } catch (err) {
      console.warn('[music] unlock failed', err);
      if (this.status) this.status.textContent = 'Audio could not start. Tap again.';
      return;
    }
    this.afterUnlock();
  }

  /** Runs once, after the first successful unlock (by our button or any gesture the engine caught itself). */
  private afterUnlock(): void {
    if (this.unlocked || this.disposed) return;
    this.unlocked = true;
    if (this.overlay) this.overlay.hidden = true;
    if (this.preselect && this.songs && this.audio && this.audio.music.current === null) {
      this.songs.play(this.preselect);
    }
  }
}
