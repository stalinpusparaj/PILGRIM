/**
 * F1 panel controls for the HUD (dev or ?debug=1 only; debug labels are developer-facing English). Everything
 * goes through the same events and service calls the game uses, so the panel tests the real paths.
 */
import { events } from '../core/Events';
import { services } from '../core/Services';
import { EPILOGUE_CHAPTER } from '../core/Save';

const TEST_TOASTS = [
  'ui.toast.rollUpdated',
  'ui.toast.promise',
  'ui.toast.leftWay',
  'ui.toast.backOnWay',
  'ui.toast.bonk',
  'ui.toast.gift.sword',
  'ui.toast.rollGone',
  'ui.toast.rollFound',
];
const TEST_OBJECTIVES = [
  'ui.hud.objective.followLight',
  'ui.hud.objective.findSteps',
  'ui.hud.objective.keepMiddle',
  'ui.hud.objective.dontSleep',
];
const HEART_STEPS: ReadonlyArray<number | null> = [5, 4.5, 3, 1, 0, null];

export interface HudDebugTarget {
  setHearts(n: number | null, max?: number): void;
  readonly visible: boolean;
  /** Hope shown by the lantern when there is no 'state' service to change. */
  previewHope(value: number): void;
  readonly hope: number;
}

/** Adds a "HUD" group to the debug panel when there is one. Returns the remover. */
export function installHudDebug(hud: HudDebugTarget): () => void {
  const debug = services.tryGet('debug');
  if (!debug) return () => {};
  let toast = 0;
  let objective = 0;
  let chapter = 0;
  let hearts = 0;
  const addHope = (d: number): void => {
    const state = services.tryGet('state');
    if (state) state.addHope(d);
    else hud.previewHope(hud.hope + d);
  };
  const offs = [
    debug.addButton('HUD', 'Toast', () => {
      events.emit('hud:toast', { key: TEST_TOASTS[toast++ % TEST_TOASTS.length]! });
    }),
    debug.addButton('HUD', 'Toast x3', () => {
      for (let i = 0; i < 3; i++)
        events.emit('hud:toast', { key: TEST_TOASTS[toast++ % TEST_TOASTS.length]! });
    }),
    debug.addButton('HUD', 'Objective', () => {
      const key = TEST_OBJECTIVES[objective++ % TEST_OBJECTIVES.length]!;
      const state = services.tryGet('state');
      if (state) state.setObjective(key);
      else events.emit('objective:changed', { key });
    }),
    debug.addButton('HUD', 'Satchel closed', () => events.emit('satchel:closed')),
    debug.addButton('HUD', 'Chapter card', () => {
      chapter = (chapter % EPILOGUE_CHAPTER) + 1;
      events.emit('hud:chapterCard', { chapter });
    }),
    debug.addButton('HUD', 'Hearts', () => hud.setHearts(HEART_STEPS[hearts++ % HEART_STEPS.length] ?? null)),
    debug.addButton('HUD', 'Hope -10', () => addHope(-10)),
    debug.addButton('HUD', 'Hope +10', () => addHope(10)),
    debug.addToggle(
      'HUD',
      'Visible',
      () => hud.visible,
      (on) => events.emit('hud:visible', { on }),
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
