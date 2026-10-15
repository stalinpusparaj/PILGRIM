/** Source-level navigation regressions. No browser, GPU, or external network required. */
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(url) + '.ts')) return { url: url.href + '.ts', shortCircuit: true };
      if (existsSync(fileURLToPath(url) + '/index.ts'))
        return { url: url.href + '/index.ts', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    if (url.endsWith('.json'))
      return {
        format: 'module',
        source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}`,
        shortCircuit: true,
      };
    if (url.endsWith('.ts'))
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
          mode: 'transform',
          sourceUrl: url,
        }).replaceAll('import.meta.env', '({DEV:false})'),
        shortCircuit: true,
      };
    return next(url, context);
  },
});

// Only platform adapters are mocked; real voice routing, settings, events and typewriter run here.
globalThis.document = Object.assign(new EventTarget(), {
  hidden: false,
  documentElement: { lang: 'en', setAttribute() {} },
  body: { classList: { toggle() {} } },
  createElement: () => ({ style: {}, setAttribute() {}, textContent: '' }),
});
globalThis.window = new EventTarget();
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
const played = [];
let cancelled = 0;
let availableVoices = [
  { name: 'Local English', lang: 'en-US', localService: true },
  { name: 'Remote Tamil', lang: 'ta-IN', localService: false },
];
window.speechSynthesis = {
  getVoices: () => availableVoices,
  speak: (u) => played.push(u),
  cancel: () => {
    cancelled++;
  },
};
const { SpokenVoice } = await import('../src/audio/SpokenVoice.ts');
const { settings, sanitizeSettings } = await import('../src/core/Settings.ts');
const { events } = await import('../src/core/Events.ts');
const { services } = await import('../src/core/Services.ts');
const voice = { pitch: 1.1, speed: 1, wave: 'triangle', vowel: 0.5 };
const speech = new SpokenVoice();
const ducks = [];
const off = events.on('audio:duck', (event) => ducks.push(event.on));
assert.equal(sanitizeSettings({}).voiceMode, 'spoken');
assert.equal(sanitizeSettings({ voiceMode: 'bad', voiceGuidance: 'yes' }).voiceGuidance, true);
settings.set('volMaster', 0.5);
settings.set('volVoices', 0.6);
let handle = speech.speak('A full spoken sentence.', voice, 1);
assert.equal(played.at(-1).text, 'A full spoken sentence.');
assert.equal(played.at(-1).volume, 0.3);
assert.equal(played.at(-1).voice.localService, true);
const count = played.length;
await speech.speak('A competing crowd bark.', voice).done;
assert.equal(played.length, count, 'ambient barks never interrupt an active speaker');
const old = handle;
handle = speech.speak('Priority dialogue.', voice, 1);
await old.done;
old.stop();
assert.equal(played.at(-1).text, 'Priority dialogue.');
played.at(-1).onend();
await handle.done;
assert.deepEqual(ducks.slice(-4), [true, false, true, false]);
settings.set('lang', 'ta');
assert.equal(speech.speak('தமிழ்', voice), null, 'remote-only Tamil voice uses classic fallback');
settings.set('lang', 'en');
settings.set('voiceMode', 'classic');
assert.equal(speech.speak('Classic.', voice), null);
settings.set('voiceMode', 'off');
await speech.speak('Silent.', voice).done;
assert.equal(played.length, count + 1);
settings.set('voiceMode', 'spoken');
handle = speech.speak('Pause me.', voice);
events.emit('game:pause', { reason: 'menu' });
await handle.done;
const pausedCount = played.length;
await speech.speak('Paused.', voice).done;
assert.equal(played.length, pausedCount);
events.emit('game:resume');
handle = speech.speak('Hide me.', voice);
document.hidden = true;
document.dispatchEvent(new Event('visibilitychange'));
await handle.done;
document.hidden = false;
handle = speech.speak('Volume change.', voice);
settings.set('volVoices', 0.8);
await handle.done;
// Quitting a paused game must not leave narration muted on the next journey.
events.emit('game:pause', { reason: 'menu' });
events.emit('flow:state', { state: 'title', prev: 'paused' });
events.emit('flow:state', { state: 'opening', prev: 'title' });
handle = speech.speak('A new journey.', voice, 1);
assert.equal(played.at(-1).text, 'A new journey.');
handle.stop();
await handle.done;
// Native completion IDs prevent an old utterance callback from closing a new line.
const nativeCalls = [];
window.PilgrimVoice = { available: () => true, speak: (...args) => nativeCalls.push(args), stop() {} };
let native = speech.speak('Native one.', voice, 1);
const firstId = nativeCalls.at(-1).at(-1);
const newer = speech.speak('Native two.', voice, 1);
await native.done;
let ended = false;
void newer.done.then(() => {
  ended = true;
});
const complete = (id) => {
  const event = new Event('pilgrim:voice-end');
  event.detail = id;
  window.dispatchEvent(event);
};
complete(firstId);
await Promise.resolve();
assert.equal(ended, false);
complete(nativeCalls.at(-1).at(-1));
await newer.done;
delete window.PilgrimVoice;
// Instant text must pass the entire line to speech, and skipping must stop it.
const { typewrite } = await import('../src/ui/typewriter.ts');
settings.set('textSpeed', 'instant');
const line = 'This whole sentence should be spoken even when text is instant.';
let spokenText = '';
let stopped = false;
const tw = typewrite({ replaceChildren() {} }, line, {
  speak: (text) => {
    spokenText = text;
    return {
      stop() {
        stopped = true;
      },
      done: Promise.resolve(),
    };
  },
});
await tw.done;
assert.equal(spokenText, line);
tw.skip();
assert.equal(stopped, true);
// Objective narration uses translated text, obeys its toggle and yields to dialogue.
settings.set('voiceGuidance', true);
events.emit('objective:changed', { key: 'ui.title.start' });
assert.equal(played.at(-1).text, 'START THE JOURNEY');
speech.stop();
settings.set('voiceGuidance', false);
const beforeObjective = played.length;
events.emit('objective:changed', { key: 'ui.title.start' });
assert.equal(played.length, beforeObjective);
speech.dispose();
off();
assert.ok(cancelled >= 4);
console.log(
  'PASS: local-only language selection, fallback, volumes, modes, overlap, interruption, native callback identity, instant text and objective narration.',
);
