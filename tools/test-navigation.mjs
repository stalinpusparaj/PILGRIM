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
class ElementStub {
  children = [];
  attrs = {};
  style = {};
  hidden = false;
  className = '';
  textContent = '';
  classList = {
    toggle: (name, on) => {
      const list = new Set(this.className.split(' ').filter(Boolean));
      on ? list.add(name) : list.delete(name);
      this.className = [...list].join(' ');
    },
    contains: (name) => this.className.split(' ').includes(name),
  };
  append(...children) {
    this.children.push(...children);
  }
  appendChild(child) {
    this.append(child);
    return child;
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(key, value) {
    this.attrs[key] = String(value);
  }
  removeAttribute(key) {
    delete this.attrs[key];
  }
  remove() {
    this.removed = true;
  }
}
globalThis.Node = ElementStub;
globalThis.document = {
  createElement: () => new ElementStub(),
  createElementNS: () => new ElementStub(),
  createTextNode: (text) => Object.assign(new ElementStub(), { textContent: text }),
  documentElement: new ElementStub(),
  body: new ElementStub(),
};
const root = pathToFileURL(process.cwd() + '/');
const load = (p) => import(new URL(p, root));
const THREE = await import('three');
const { services } = await load('src/core/Services.ts');
const { events } = await load('src/core/Events.ts');
const { GuideMarker } = await load('src/ui/hud-guide.ts');
const { FollowCamera } = await load('src/player/Camera.ts');
const { Minimap } = await load('src/ui/Minimap.ts');
const { Way } = await load('src/gen/Way.ts');
const player = {
  renderPosition: new THREE.Vector3(),
  forward: new THREE.Vector3(0, 0, -1),
  controller: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), grounded: true },
  character: { height: 1.7, burdenSize: 1.6, animator: { steps: 0 } },
};
const goal = new THREE.Vector3(30, 0, 30);
services.register('guide', {
  sample: () => ({ target: goal, player: player.renderPosition, custom: true, distance: 30 }),
});
const avoid = { top: 0, right: 0, bottom: 0, left: 0, touch: false, buttons: [], corners: [] };
const guide = new GuideMarker();
const view = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  for (const pitch of [-0.35, 0, 0.65]) {
    const forward = new THREE.Vector3(Math.sin(yaw), Math.sin(pitch), -Math.cos(yaw)).normalize();
    view.lookAt(forward);
    view.updateMatrixWorld();
    const side = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    for (const sign of [-1, 1]) {
      goal
        .copy(forward)
        .setY(0)
        .multiplyScalar(-30)
        .addScaledVector(side, sign * 30);
      guide.render(view, true, 1280, 720, avoid);
      const arrow = guide.el.children[1];
      assert(arrow.classList.contains('is-on'));
      const angle = Number(arrow.style.transform.match(/rotate\(([-\d.]+)/)[1]);
      const rad = (angle * Math.PI) / 180;
      assert(Math.sign(Math.sin(rad)) === sign, 'arrow must preserve right/left when target is behind');
      assert(-Math.cos(rad) > 0, 'behind target must point back');
    }
  }
}
view.lookAt(0, 0, -1);
goal.set(100, 0, 10);
const occupied = { x: 1100, y: 350, w: 180, h: 300 };
guide.render(view, true, 1280, 720, { ...avoid, corners: [occupied] });
const placement = guide.el.children[1].style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px/);
assert(
  Number(placement[1]) + 36 <= occupied.x || Number(placement[2]) + 36 <= occupied.y,
  'arrow must avoid the minimap',
);
guide.render(view, false, 1280, 720, avoid);
assert(!guide.el.children[1].classList.contains('is-on'));
guide.dispose();
console.log('PASS: arrow bearing for 4 headings × 3 pitches × left/right; hidden HUD.');

const main = new Way(
  [
    [0, 0, 0],
    [10, 0, 30],
    [0, 0, 80],
  ],
  3,
  'way',
  'main',
);
const world = { ways: { main, detours: [] }, level: { waystones: [{ at: [0, 0, 30] }] } };
const minimap = new Minimap();
minimap.setSource(world, player);
const map = minimap.el.children[1].children[0];
for (const [x, z, angle] of [
  [0, -1, 0],
  [1, 0, 90],
  [0, 1, 180],
  [-1, 0, -90],
]) {
  player.forward.set(x, 0, z);
  player.controller.velocity.set(-z * 3, 0, x * 3);
  player.renderPosition.set(10, 0, 20);
  minimap.update(0.1, true);
  assert.equal(map.attrs.viewBox, '-38 -28 96 96');
  assert(map.children[3].attrs.transform.includes(`rotate(${angle})`));
  assert.equal(map.children[1].style.display, '');
  assert(map.children[1].attrs.d.startsWith('M10 20 L'));
}
player.controller.velocity.set(0, 0, 0);
minimap.update(0.1, true);
assert.equal(map.children[1].style.display, 'none');
goal.set(10000, 0, 10000);
minimap.update(0.1, true);
assert(Number(map.children[2].attrs.cx) <= 53 && Number(map.children[2].attrs.cy) <= 63);
minimap.update(0.1, false);
assert.equal(minimap.el.hidden, true);
minimap.setSource(world, player);
assert.equal(map.children[0].children.length, 2);
minimap.dispose();
assert.equal(minimap.el.removed, true);
console.log(
  'PASS: minimap cardinal headings, independent movement, centering, off-map goal, rebuild and disposal.',
);

const flat = { raycast: () => null, groundAt: () => 0 };
const baseline = events.count();
for (const aspect of [390 / 844, 16 / 9]) {
  const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
  const follow = new FollowCamera(camera, player, flat);
  assert(camera.position.y >= 3.5, 'raised follow camera should clear the sack');
  assert(
    Math.hypot(camera.position.x - player.renderPosition.x, camera.position.z - player.renderPosition.z) >=
      5.5,
    'camera should sit further behind',
  );
  camera.updateMatrixWorld();
  const chest = player.renderPosition
    .clone()
    .add(new THREE.Vector3(0, 1.25, 0))
    .project(camera);
  assert(Math.abs(chest.x) < 0.85 && Math.abs(chest.y) < 0.85, 'player remains in frame');
  follow.suspend();
  assert.equal(follow.suspended, true);
  follow.resume(0);
  assert.equal(follow.suspended, false);
  for (let i = 0; i < 60; i++) {
    follow.update(1 / 60);
    follow.render(1, 1 / 60);
  }
  assert(Number.isFinite(camera.position.y));
  follow.dispose();
}
const wallCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
const wallFollow = new FollowCamera(wallCamera, player, {
  raycast: (_p, _d, max) => (max > 2 ? 2 : null),
  groundAt: () => 0,
});
assert(
  wallCamera.position.clone().sub(player.renderPosition).length() < 4.5,
  'spring arm must still retract for obstacles',
);
assert(wallCamera.position.y >= 0.35, 'camera stays above ground');
wallFollow.dispose();
assert.equal(events.count(), baseline);
main.dispose();
console.log('PASS: portrait/landscape camera framing, suspend/resume and listener cleanup.');

// Follow behavior and cinematic motion are verified without a browser or GPU.
const { CameraFeel } = await load('src/player/camera-feel.ts');
const savedSettings = services.tryGet('settings');
const savedInput = services.tryGet('input');
const prefs = { ...savedSettings.data, autoCamera: 'default', reduceMotion: false };
services.register('settings', { data: prefs });
const input = { device: 'kbm', mouseLooks: true, look: { x: 0, y: 0 }, move: { x: 0, y: 0 } };
services.register('input', input);
const advance = (follow, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    follow.update(1 / 60);
    follow.render(1, 1 / 60);
  }
};
const error = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
player.renderPosition.set(0, 0, 0);
player.controller.position.set(0, 0, 0);
player.controller.velocity.set(0, 0, 0);
for (const device of ['kbm', 'touch', 'pad']) {
  input.device = device;
  player.forward.set(0, 0, 1);
  const follow = new FollowCamera(new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500), player, flat);
  player.forward.set(0, 0, -1);
  advance(follow, 4);
  assert(error(follow.yaw, Math.PI) < 0.02, device + ' must follow through a full turn even at rest');
  input.look.x = 0.4;
  follow.update(1 / 60);
  input.look.x = 0;
  const manual = follow.yaw;
  advance(follow, 0.5);
  assert(error(follow.yaw, manual) < 1e-8, 'manual orbit gets a quiet interval');
  advance(follow, 3);
  assert(error(follow.yaw, Math.PI) < 0.02, 'follow resumes after manual orbit');
  follow.dispose();
}
player.forward.set(0, 0, 1);
const reverse = new FollowCamera(new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500), player, flat);
input.move.y = -1;
player.forward.set(0, 0, -1);
advance(reverse, 2);
assert(error(reverse.yaw, 0) < 1e-8, 'held reverse must not cause a camera-relative steering spiral');
input.move.y = 0;
advance(reverse, 4);
assert(error(reverse.yaw, Math.PI) < 0.02);
reverse.dispose();
prefs.autoCamera = 'off';
player.forward.set(0, 0, 1);
const manualOnly = new FollowCamera(new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500), player, flat);
player.forward.set(0, 0, -1);
advance(manualOnly, 4);
assert(error(manualOnly.yaw, 0) < 1e-8);
manualOnly.dispose();
const feel = new CameraFeel();
feel.reset(player, false);
player.controller.velocity.set(0, 0, 6);
for (let i = 0; i < 120; i++) {
  const yaw = i * 0.02;
  player.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
  feel.step(1 / 60, player, false);
}
assert(feel.pullBack > 0.5 && feel.pullBack <= 0.65);
assert(feel.travelAhead > 0.5 && feel.travelAhead <= 0.65);
assert(feel.travelLift > 0 && feel.travelLift <= 0.18);
assert(Math.abs(feel.roll) > 0 && Math.abs(feel.roll) <= 0.02);
feel.step(1 / 60, player, true);
for (const key of ['pullBack', 'travelAhead', 'travelLift', 'roll', 'fovKick'])
  assert.equal(feel[key], 0, 'reduced motion disables ' + key);
services.register('settings', savedSettings);
if (savedInput) services.register('input', savedInput);
else services.unregister('input');
console.log(
  'PASS: automatic follow on keyboard/mouse, touch and gamepad; full turns; manual-look grace; reverse guard; explicit Off; bounded cinema and reduced motion.',
);

// Persisted settings and safe resume snapshots.
const { Settings, sanitizeSettings } = await load('src/core/Settings.ts');
const { movementPaceScale } = await load('src/core/MovementPace.ts');
const stored = new Map();
const storage = {
  getItem: (k) => stored.get(k) ?? null,
  setItem: (k, v) => stored.set(k, v),
  removeItem: (k) => stored.delete(k),
};
globalThis.localStorage = storage;
const preferences = new Settings(storage);
assert.equal(preferences.data.movementPace, 'normal');
for (const [pace, scale] of [
  ['slow', 2 / 3],
  ['normal', 0.8],
  ['fast', 1],
]) {
  preferences.set('movementPace', pace);
  assert.equal(
    new Settings(storage).data.movementPace,
    pace,
    'movement preference survives a new settings instance',
  );
  assert.equal(movementPaceScale(pace), scale);
}
assert.equal(sanitizeSettings({ movementPace: 'turbo' }).movementPace, 'normal');
assert.equal(sanitizeSettings({}).movementPace, 'normal', 'old settings acquire Normal pace');
const { gameplayRows } = await load('src/ui/settings-rows.ts');
assert.deepEqual(
  gameplayRows()
    .find((row) => row.id === 'movementPace')
    .options.map((o) => o.id),
  ['slow', 'normal', 'fast'],
);
console.log('PASS: speed choices, default/migration, invalid preferences and remembered settings.');

const { Save, newSave } = await load('src/core/Save.ts');
const { GameState } = await load('src/core/GameState.ts');
const idb = await load('src/core/idb.ts');
const { captureResume, restoreResume, clearResume } = await load('src/world/resume-progress.ts');
const { ProgressAutosave } = await load('src/core/ProgressAutosave.ts');
const state = new GameState();
state.setFlag('ch01.stage', 'town');
state.setObjective('ch01.objective.walkTown');
const session = {
  state,
  isDisposed: false,
  levelId: 'ch01',
  world: { level: { size: 300 } },
  slough: { sinking: false },
  col: { groundAt: () => 1.25 },
  camera: { snap() {} },
  player: {
    mode: 'play',
    isGrounded: true,
    controller: { position: new THREE.Vector3(20, 1.25, 30) },
    forward: new THREE.Vector3(1, 0, 0),
    teleport(p, yaw) {
      this.controller.position.copy(p);
      this.restoredYaw = yaw;
    },
  },
};
const snapshot = captureResume(session, false);
assert(snapshot);
assert.equal(snapshot.flags['resume.x'], 20);
assert.equal(state.flag('resume.x'), undefined, 'capture must not mutate live state');
const disk = new Save();
const write = disk.write('auto', snapshot);
assert(stored.has('pilgrim.save.backup.auto'), 'backup must be synchronous for pagehide');
await write;
await idb.del('auto'); // Simulate losing the live IDB/memory state; durable backup remains.
const loaded = await new Save().load('auto');
assert.equal(loaded.flags['resume.x'], 20);
assert.equal(loaded.flags['ch01.stage'], 'town');
assert.equal(loaded.flags.goal, 'ch01.objective.walkTown');
session.state = new GameState(loaded);
session.player.controller.position.set(0, 0, 0);
assert(restoreResume(session));
assert.equal(session.player.controller.position.x, 20);
assert.equal(session.player.restoredYaw, Math.PI / 2);
clearResume(session);
assert.equal(session.state.flag('resume.x'), undefined);
session.player.mode = 'cutscene';
assert.equal(captureResume(session, false), null);
session.player.mode = 'play';
session.slough.sinking = true;
assert.equal(captureResume(session, false), null);
session.slough.sinking = false;
assert.equal(captureResume(session, true), null);
session.state = new GameState(loaded);
session.state.setFlag('resume.x', 10000);
assert.equal(restoreResume(session), false);
session.state = new GameState(loaded);
session.state.setFlag('resume.level', 'ch02');
assert.equal(restoreResume(session), false);
await disk.remove('auto');
assert.equal(await disk.load('auto'), null);
console.log(
  'PASS: synchronous durable backup, save/load, exact safe position/facing/story flags, invalid-location rejection and deletion.',
);

// EventTarget stubs exercise pause/pagehide/disposal independently of browser UI.
globalThis.window = new EventTarget();
const docEvents = new EventTarget();
document.addEventListener = docEvents.addEventListener.bind(docEvents);
document.removeEventListener = docEvents.removeEventListener.bind(docEvents);
document.hidden = false;
let live = snapshot,
  writes = 0;
const realSave = services.tryGet('save');
services.register('save', {
  write: async () => {
    writes++;
  },
});
const count = events.count();
const autosave = new ProgressAutosave(() => live);
autosave.update(0.5);
assert.equal(writes, 1, 'first safe interval saves');
for (let i = 0; i < 10; i++) autosave.update(0.5);
assert.equal(writes, 2, 'periodic save at five seconds');
live = null;
events.emit('game:pause', { reason: 'test' });
assert.equal(writes, 3, 'pause saves last safe state');
window.dispatchEvent(new Event('pagehide'));
assert.equal(writes, 4, 'pagehide flushes last safe state');
events.emit('state:reset');
autosave.dispose();
assert.equal(writes, 4, 'old session must not overwrite a newly loaded game');
assert.equal(events.count(), count, 'autosave must clean up listeners');
if (realSave) services.register('save', realSave);
else services.unregister('save');
delete globalThis.window;
console.log(
  'PASS: five-second autosave, pause/exit flush, safe fallback, state-reset isolation and cleanup.',
);

// Chapter I restore must not send a saved traveler back to reading the Book.
const chapterOne = (await load('src/chapters/ch01.ts')).default;
for (const [stage, objective] of [
  ['day', 'ch01.objective.talkFamily'],
  ['town', 'ch01.objective.walkTown'],
  ['homeward', 'ch01.objective.goHome'],
  ['gate', 'ch01.objective.toGate'],
  ['way', 'ui.hud.objective.followLight'],
]) {
  const s = new GameState();
  s.setFlag('ch01.stage', stage);
  const friends = [];
  const interactions = [];
  const npc = { character: { root: { visible: true } } };
  const ctx = {
    state: s,
    level: { landmarks: [], npcs: [], zones: [] },
    session: { world: { terrain: {} } },
    objective: (k) => s.setObjective(k),
    guide: () => {},
    npc: () => npc,
    addCompanion: (id) => friends.push(id),
    onTalk: () => () => {},
    onTrigger: () => () => {},
    onInteract: (item) => {
      interactions.push(item.id);
      return () => {};
    },
  };
  chapterOne.start(ctx);
  assert.equal(s.objective, objective);
  assert(!interactions.includes('book'));
  if (stage === 'way') assert(friends.includes('pliable'));
  chapterOne.dispose();
}
const { HelpBeats } = await load('src/chapters/ch02-help.ts');
const rescued = new GameState();
rescued.setFlag('ch02.handTaken', true);
let repeatTalk = false;
const help = new HelpBeats(
  {
    state: rescued,
    onTalk: () => {
      repeatTalk = true;
    },
  },
  { alone: () => true, onHelped: () => {} },
);
help.install();
assert(help.done);
assert(repeatTalk);
console.log(
  'PASS: Chapter I stage/objective/companion restoration and Chapter II completed rescue restoration.',
);

// Restore the remaining chapter environments using real scene objects, without rendering.
const { PALETTES } = await load('src/gen/palette.ts');
const chapterThree = (await load('src/chapters/ch03.ts')).default;
for (const phase of ['mountain', 'done']) {
  const s = new GameState();
  s.setChapter(3);
  s.setFlag('ch03.phase', phase);
  s.setFlag('ch03.wisemanTold', true);
  if (phase === 'done') s.setFlag('ch03.rejoined', true);
  const road = new Way(
    [
      [0, 0, 0],
      [10, 0, 20],
      [20, 0, 50],
    ],
    3,
    'detour',
    'wrong_hill',
  );
  const world = {
    scene: new THREE.Scene(),
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    palette: PALETTES.wrongHill,
    terrain: { heightAt: () => 0 },
    wayById: () => road,
  };
  const ctx = {
    state: s,
    level: { seed: 31, triggers: [], landmarks: [] },
    session: {
      world,
      player: { controller: { position: new THREE.Vector3() } },
      burden: {
        grow: () => {
          throw Error('must not regrow burden on restore');
        },
      },
    },
    npc: () => null,
    landmark: () => new THREE.Vector3(),
    objective: (k) => s.setObjective(k),
    guide: () => {},
    onTrigger: () => {},
    onTalk: () => {},
    onZone: () => {},
  };
  chapterThree.start(ctx);
  assert.equal(s.flag('ch03.phase'), phase);
  assert.equal(s.objective, phase === 'done' ? 'ch03.objective.followWay' : 'ch03.objective.goToVillage');
  chapterThree.dispose();
  assert.equal(world.scene.children.length, 0);
  road.dispose();
}
const chapterFour = (await load('src/chapters/ch04.ts')).default;
const gateState = new GameState();
gateState.setChapter(4);
gateState.setFlag('ch04.insideGate', true);
let doorCollider = true,
  knockRemoved = false;
const gateWorld = {
  level: { seed: 41 },
  scene: new THREE.Scene(),
  palette: PALETTES.wicketGate,
  terrain: { heightAt: () => 0 },
};
const gateCtx = {
  state: gateState,
  level: { seed: 41, triggers: [], landmarks: [{ id: 'wicket_gate', rotY: 0 }] },
  session: {
    world: gateWorld,
    col: {
      addCollider: () => 7,
      removeCollider: () => {
        doorCollider = false;
      },
    },
  },
  landmark: (id) => new THREE.Vector3(id === 'castle_ridge' ? 30 : 0, 0, 0),
  npc: () => null,
  objective: (k) => gateState.setObjective(k),
  guide: () => {},
  onInteract: () => () => {
    knockRemoved = true;
  },
  onTrigger: () => {},
  onZone: () => {},
};
chapterFour.start(gateCtx);
assert.equal(gateState.objective, 'ui.hud.objective.followStraightWay');
assert(knockRemoved);
assert(!doorCollider, 'saved open gate must be traversable');
chapterFour.dispose();
assert.equal(gateWorld.scene.children.length, 0);
console.log(
  'PASS: Chapter III mountain/rejoined restoration without duplicate burden growth; Chapter IV open gate restored with collider removed.',
);

const { Player } = await load('src/player/Player.ts');
const movementSettings = services.tryGet('settings');
for (const [pace, factor] of [
  ['slow', 2 / 3],
  ['normal', 0.8],
  ['fast', 1],
]) {
  services.register('settings', { data: { ...movementSettings.data, movementPace: pace } });
  for (const burden of [true, false]) {
    const params = Player.prototype.resolveParams.call({
      burdenSys: null,
      state: { burden },
      speedScale: 0.65,
      params: {},
    });
    assert(Math.abs(params.walkSpeed - (burden ? 3 : 3.4) * factor * 0.65) < 1e-10);
    assert(Math.abs(params.runSpeed - (burden ? 4.2 : 6) * factor * 0.65) < 1e-10);
    assert.equal(params.jumpHeight, burden ? 0.3 : 1.1, 'pace must not change jump height');
  }
}
services.register('settings', movementSettings);
console.log(
  'PASS: real player movement parameters for all three paces, burdened/free and swamp scaling; jump height unchanged.',
);
