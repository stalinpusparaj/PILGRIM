/**
 * Binary sniffing for tools/check-assets.mjs: names a binary format from its leading bytes, and recognises
 * genuine OS folder metadata (.DS_Store, Thumbs.db, desktop.ini) by its content, not just its name.
 * Node built-ins only.
 */

const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
const startsWith = (bytes, sig) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
const tag = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));

/** [format, leading bytes]. Text-like signatures carry extra bytes so ordinary text cannot match them. */
// prettier-ignore
const MAGIC = [
  ['UTF-16 text (save it as UTF-8)', [0xff, 0xfe]],
  ['UTF-16 text (save it as UTF-8)', [0xfe, 0xff]],
  ['PNG image', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['JPEG image', [0xff, 0xd8, 0xff]],
  ['GIF image', ascii('GIF87a')],
  ['GIF image', ascii('GIF89a')],
  ['Ogg audio', [...ascii('OggS'), 0]],
  ['MP3 audio (ID3)', [...ascii('ID3'), 2]],
  ['MP3 audio (ID3)', [...ascii('ID3'), 3]],
  ['MP3 audio (ID3)', [...ascii('ID3'), 4]],
  ['FLAC audio', ascii('fLaC')],
  ['MIDI', [...ascii('MThd'), 0, 0, 0, 6]],
  ['glTF binary model (GLB)', [...ascii('glTF'), 1, 0, 0, 0]],
  ['glTF binary model (GLB)', [...ascii('glTF'), 2, 0, 0, 0]],
  ['KTX2 texture', [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['KTX texture', [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb]],
  ['DDS texture', [...ascii('DDS '), 0x7c, 0, 0, 0]],
  ['WOFF font', ascii('wOFF')],
  ['WOFF2 font', ascii('wOF2')],
  ['OpenType font', [...ascii('OTTO'), 0]],
  ['TrueType font', [0x00, 0x01, 0x00, 0x00, 0x00]],
  ['TrueType font', [...ascii('true'), 0]],
  ['TrueType font collection', [...ascii('ttcf'), 0]],
  ['Radiance HDR image', ascii('#?RADIANCE')],
  ['Radiance HDR image', ascii('#?RGBE')],
  ['OpenEXR image', [0x76, 0x2f, 0x31, 0x01]],
  ['FBX model', ascii('Kaydara FBX Binary')],
  ['FBX model (ASCII)', ascii('; FBX ')],
  ['ZIP archive', [0x50, 0x4b, 0x03, 0x04]],
  ['ZIP archive', [0x50, 0x4b, 0x05, 0x06]],
  ['ZIP archive', [0x50, 0x4b, 0x07, 0x08]],
  ['gzip data', [0x1f, 0x8b, 0x08]],
  ['Photoshop image', [...ascii('8BPS'), 0, 1]],
  ['WebM/Matroska video', [0x1a, 0x45, 0xdf, 0xa3]],
  ['WebAssembly', [0x00, 0x61, 0x73, 0x6d]],
  ['OLE compound file', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
];
const RIFF_KINDS = { WEBP: 'WebP image', WAVE: 'WAV audio', 'AVI ': 'AVI video' };
const ISO_BRANDS = {
  avif: 'AVIF image',
  avis: 'AVIF image',
  heic: 'HEIF image',
  heix: 'HEIF image',
  mif1: 'HEIF image',
};

/** Names the binary format if the bytes start with a known magic number, else null. */
export function sniff(bytes) {
  for (const [name, sig] of MAGIC) if (startsWith(bytes, sig)) return name;
  if (bytes.length >= 12 && tag(bytes, 0) === 'RIFF') return RIFF_KINDS[tag(bytes, 8)] ?? 'RIFF media';
  if (bytes.length >= 12 && tag(bytes, 4) === 'ftyp') return ISO_BRANDS[tag(bytes, 8)] ?? 'MP4/MOV media';
  // MPEG audio frame sync (11 set bits) with a valid version and layer: a raw MP3 without an ID3 tag.
  const sync = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (sync && ((bytes[1] >> 3) & 3) !== 1 && ((bytes[1] >> 1) & 3) !== 0) return 'MP3 audio';
  return null;
}

/** desktop.ini: INI text (UTF-8, or UTF-16 LE with a BOM as Windows writes it) opening with a section. */
function isDesktopIni(bytes) {
  const utf16 = startsWith(bytes, [0xff, 0xfe]);
  if (!utf16 && (bytes.includes(0) || sniff(bytes))) return false;
  const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes).replace(/^﻿/, '');
  return /^\s*[[;]/.test(text) && !/[\u0000-\u0008\u000e-\u001f]/.test(text);
}

/** Name -> content test. A file only counts as OS metadata when both match. */
const OS_METADATA = new Map([
  ['.DS_Store', (bytes) => startsWith(bytes, [0, 0, 0, 1, ...ascii('Bud1')])], // Finder
  ['Thumbs.db', (bytes) => startsWith(bytes, MAGIC.find(([name]) => name === 'OLE compound file')[1])],
  ['desktop.ini', isDesktopIni], // Windows Explorer
]);

/** Folder metadata names the OS writes (vite.config.ts leaves files with these names out of dist/). */
export function isOsMetadataName(name) {
  return OS_METADATA.has(name);
}

/** True only for a real OS metadata file: a PNG renamed to Thumbs.db is not one. */
export function isOsMetadata(name, bytes) {
  const test = OS_METADATA.get(name);
  return test !== undefined && test(bytes);
}
