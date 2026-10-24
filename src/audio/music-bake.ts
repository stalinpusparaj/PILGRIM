/**
 * Bakes one seamless loop of a song stem (BakedMusic.ts, DECISIONS #391-#393) and keeps it on the device. One
 * loop is rendered through the real sequencer, instruments and reverb, its ring-out (note releases, reverb tail)
 * is added back onto the loop's start exactly as it rings into every repeat, and it is mixed to mono (phone
 * speakers). Loops are stored as 4-bit IMA ADPCM (adpcm.ts) in the Cache API under a key holding a hash of the
 * stem's notes, so each is made once per install. Bakes run one at a time; a song needed now goes ahead of the
 * background prebake of every song.
 */
import { adpcmDecode, adpcmEncode } from './adpcm';
import { hashString } from '../gen/rng';
import { prepareSong } from './seq-song';
import type { SongDef, SongId } from './types';

/** 24 kHz: these soft instruments sit well under 10 kHz; half the work and storage of 48 kHz. */
export const BAKE_RATE = 24000;
const BAKE_STEP = 0.25;
const STORE = 'pilgrim-music-v2';
/** Same-origin keys (never fetched: Cache API storage only). */
const KEY_HOST = '/__pilgrim-music/';

function storeKey(id: SongId, def: SongDef): string {
  return `${KEY_HOST}${id}/${hashString(JSON.stringify(def)).toString(36)}-${BAKE_RATE}m`;
}

interface Job { run(): Promise<void>; urgent: boolean }
const jobs: Job[] = [];
let working = false;

function enqueue<T>(urgent: boolean, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = { urgent, run: () => task().then(resolve, reject) };
    if (urgent) {
      const at = jobs.findIndex((j) => !j.urgent);
      jobs.splice(at < 0 ? jobs.length : at, 0, job);
    } else jobs.push(job);
    void pump();
  });
}

async function pump(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job.run().catch(() => {});
  } finally {
    working = false;
  }
}

async function openStore(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(STORE);
  } catch {
    return null;
  }
}

/** [length: u32][ADPCM codes] */
function pack(mono: Float32Array): ArrayBuffer {
  const codes = adpcmEncode(mono);
  const out = new Uint8Array(4 + codes.length);
  new DataView(out.buffer).setUint32(0, mono.length, true);
  out.set(codes, 4);
  return out.buffer;
}

function unpack(data: ArrayBuffer): AudioBuffer | null {
  if (data.byteLength < 8) return null;
  const length = new DataView(data).getUint32(0, true);
  const codes = new Uint8Array(data, 4);
  if (length <= 0 || codes.length < (length + 1) >> 1) return null;
  const buf = new AudioBuffer({ length, sampleRate: BAKE_RATE, numberOfChannels: 1 });
  buf.copyToChannel(adpcmDecode(codes, length), 0);
  return buf;
}

async function render(id: SongId, def: SongDef): Promise<AudioBuffer> {
  const { renderSong, SONG_START } = await import('./renderOffline');
  const song = prepareSong(id, def);
  const loopSec = song.loopBeats * song.spb;
  const full = await renderSong(id, [{ state: 'calm', loops: 1 }], { [id]: def }, { sampleRate: BAKE_RATE, step: BAKE_STEP, unity: true });
  const start = Math.round(SONG_START * BAKE_RATE);
  const length = Math.round(loopSec * BAKE_RATE);
  const mono = new Float32Array(length);
  const gain = 1 / full.numberOfChannels;
  for (let c = 0; c < full.numberOfChannels; c++) {
    const src = full.getChannelData(c);
    // The loop, then its ring-out wrapped back onto the start.
    for (let i = start, j = 0; i < src.length; i++, j = j + 1 === length ? 0 : j + 1) mono[j]! += src[i]! * gain;
  }
  const loop = new AudioBuffer({ length, sampleRate: BAKE_RATE, numberOfChannels: 1 });
  loop.copyToChannel(mono, 0);
  return loop;
}

/**
 * A baked loop of one song stem (`def` holds only that stem's tracks): from the device store, else rendered and
 * stored. `urgent` (a song needed now) goes ahead of background prebakes. Null on failure, or when `wanted()`
 * says no by the time its turn comes (a tune that is no longer playing never delays the next).
 */
export function bakedLoop(
  id: SongId,
  def: SongDef,
  opts: { urgent?: boolean; wanted?: () => boolean } = {},
): Promise<AudioBuffer | null> {
  const key = storeKey(id, def);
  return enqueue(opts.urgent ?? true, async () => {
    const store = await openStore();
    try {
      const hit = await store?.match(key);
      const buf = hit ? unpack(await hit.arrayBuffer()) : null;
      if (buf) return buf;
    } catch {
      /* fall through to a fresh bake */
    }
    if (opts.wanted && !opts.wanted()) return null;
    const buf = await render(id, def);
    try {
      await store?.put(key, new Response(pack(buf.getChannelData(0)), { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      /* storage full or refused: it plays anyway, and bakes again next launch */
    }
    return buf;
  }).catch((err: unknown) => {
    console.warn(`[music] could not bake "${id}"`, err);
    return null;
  });
}


/** Removes stores from earlier bake formats (pilgrim-music-v1: stereo 16-bit). */
export async function forgetOldStores(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete('pilgrim-music-v1');
  } catch {
    /* nothing to forget */
  }
}
