/**
 * Bakes one seamless loop of a song in one state (BakedMusic.ts, DECISIONS #391) and keeps it on the device.
 * One loop is rendered through the real sequencer, instruments and reverb, then its ring-out (note releases,
 * reverb tail) is added back onto the loop's start, exactly as it rings into every repeat. Baked loops are
 * stored as 16-bit PCM in the Cache API under a key that includes a hash of the song data, so each tune is made
 * once per install (and again only when its notes change). Bakes run one at a time.
 */
import { hashString } from '../gen/rng';
import { prepareSong } from './seq-song';
import type { MusicState, SongDef, SongId } from './types';

/** 24 kHz: these soft instruments sit well under 10 kHz; half the work and storage of 48 kHz. */
export const BAKE_RATE = 24000;
const BAKE_STEP = 0.25;
const STORE = 'pilgrim-music-v1';
/** Same-origin keys (never fetched: Cache API storage only). */
const KEY_HOST = '/__pilgrim-music/';

let queue: Promise<unknown> = Promise.resolve();

function storeKey(id: SongId, state: MusicState, def: SongDef): string {
  return `${KEY_HOST}${id}/${state}/${hashString(JSON.stringify(def)).toString(36)}-${BAKE_RATE}`;
}

async function openStore(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(STORE);
  } catch {
    return null;
  }
}

function toPcm(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new Int16Array(n * ch + 2);
  out[0] = ch;
  out[1] = 0;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    const o = 2 + c * n;
    for (let i = 0; i < n; i++) out[o + i] = Math.max(-32767, Math.min(32767, Math.round(d[i]! * 32767)));
  }
  return out.buffer;
}

function fromPcm(data: ArrayBuffer): AudioBuffer | null {
  const all = new Int16Array(data);
  const ch = all[0] ?? 0;
  if (ch < 1 || ch > 2) return null;
  const n = Math.floor((all.length - 2) / ch);
  if (n <= 0) return null;
  const buf = new AudioBuffer({ length: n, sampleRate: BAKE_RATE, numberOfChannels: ch });
  for (let c = 0; c < ch; c++) {
    const d = new Float32Array(n);
    const o = 2 + c * n;
    for (let i = 0; i < n; i++) d[i] = all[o + i]! / 32767;
    buf.copyToChannel(d, c);
  }
  return buf;
}

async function render(id: SongId, state: MusicState, def: SongDef): Promise<AudioBuffer> {
  const { renderSong, SONG_START } = await import('./renderOffline');
  const song = prepareSong(id, def);
  const loopSec = song.loopBeats * song.spb;
  const full = await renderSong(id, [{ state, loops: 1 }], { [id]: def }, { sampleRate: BAKE_RATE, step: BAKE_STEP, unity: true });
  const start = Math.round(SONG_START * BAKE_RATE);
  const length = Math.round(loopSec * BAKE_RATE);
  const loop = new AudioBuffer({ length, sampleRate: BAKE_RATE, numberOfChannels: full.numberOfChannels });
  for (let c = 0; c < full.numberOfChannels; c++) {
    const src = full.getChannelData(c);
    const d = new Float32Array(length);
    d.set(src.subarray(start, start + length));
    // Wrap the ring-out past the loop's end back onto its start.
    for (let i = start + length, j = 0; i < src.length; i++, j = (j + 1) % length) d[j]! += src[i]!;
    loop.copyToChannel(d, c);
  }
  return loop;
}

/**
 * A baked loop of `id` in `state`: from the device store, else rendered (queued) and stored. Null on failure, or
 * when `wanted()` says no by the time its turn comes (a tune that is no longer playing never delays the next).
 */
export function bakedLoop(
  id: SongId,
  state: MusicState,
  def: SongDef,
  wanted: () => boolean = () => true,
): Promise<AudioBuffer | null> {
  const key = storeKey(id, state, def);
  const job = queue.then(async () => {
    const store = await openStore();
    try {
      const hit = await store?.match(key);
      if (hit) {
        const buf = fromPcm(await hit.arrayBuffer());
        if (buf) return buf;
      }
    } catch {
      /* fall through to a fresh bake */
    }
    if (!wanted()) return null;
    const buf = await render(id, state, def);
    try {
      await store?.put(key, new Response(toPcm(buf), { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      /* storage full or refused: it plays anyway, and bakes again next launch */
    }
    return buf;
  });
  queue = job.catch(() => null);
  return job.catch((err: unknown) => {
    console.warn(`[music] could not bake "${id}" (${state})`, err);
    return null;
  });
}
