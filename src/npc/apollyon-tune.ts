/**
 * F1 "Apollyon tuning" (dev builds or ?debug=1): live sliders for the fight's timing while it runs, so a playtest
 * can find the right feel without a rebuild. They write FIGHT in place (read every step); a reload puts the
 * shipped values back. The readout line is the values to copy into FIGHT once they feel right.
 * Developer-facing: plain English, no i18n.
 */
import { services } from '../core/Services';
import { FIGHT } from './apollyon-phases';

type Key = 'telegraph' | 'dart' | 'dartEasy' | 'gap' | 'open' | 'down';

const SLIDERS: ReadonlyArray<[Key, string, number, number, number]> = [
  ['telegraph', 'Paw / belly tell (s, Normal; Easy x2)', 0.4, 2, 0.05],
  ['dart', 'Dart speed Normal (m/s)', 2, 12, 0.25],
  ['dartEasy', 'Dart speed Easy (m/s)', 2, 12, 0.25],
  ['gap', 'Dart gap in a volley (s)', 0.2, 1.2, 0.05],
  ['open', 'Belly open after a block (s)', 1, 5, 0.25],
  ['down', 'Knocked-down sword window (s)', 2, 8, 0.25],
];

const GROUP = 'Apollyon tuning';

/** Installs the sliders; returns their remover (no-op without the debug panel). */
export function installApollyonTuning(): () => void {
  const debug = services.tryGet('debug');
  if (!debug) return () => {};
  const offs = SLIDERS.map(([key, label, min, max, step]) =>
    debug.addSlider(GROUP, label, min, max, step, () => FIGHT[key], (v) => (FIGHT[key] = v)),
  );
  offs.push(
    debug.addReadout('Tuning', () => SLIDERS.map(([k]) => `${k}: ${+FIGHT[k].toFixed(2)}`).join(', ')),
  );
  return () => {
    for (const off of offs) off();
  };
}
