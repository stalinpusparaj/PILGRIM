/**
 * F1 panel controls for the follow camera (dev or ?debug=1 only; developer strings stay plain English).
 */
import { services } from '../core/Services';
import { CAMERA_TUNE } from './camera-config';

export interface CameraDebugTarget {
  snap(): void;
  debugLine(): string;
}

const GROUP = 'Camera';

/** Adds the readout, tuning sliders and a snap button. Returns the remover (call it in dispose()). */
export function installCameraDebug(cam: CameraDebugTarget): () => void {
  const debug = services.tryGet('debug');
  if (!debug) return () => undefined;
  const offs = [
    debug.addReadout('Follow cam', () => cam.debugLine()),
    debug.addSlider(
      GROUP,
      'Shoulder (burden)',
      0,
      1.6,
      0.05,
      () => CAMERA_TUNE.shoulder,
      (v) => (CAMERA_TUNE.shoulder = v),
    ),
    debug.addSlider(
      GROUP,
      'Look height (burden)',
      0.9,
      1.9,
      0.05,
      () => CAMERA_TUNE.lookBurdened,
      (v) => (CAMERA_TUNE.lookBurdened = v),
    ),
    debug.addSlider(
      GROUP,
      'Look height (free)',
      0.8,
      1.6,
      0.05,
      () => CAMERA_TUNE.lookFree,
      (v) => (CAMERA_TUNE.lookFree = v),
    ),
    debug.addButton(GROUP, 'Snap behind', () => cam.snap()),
  ];
  return () => {
    for (const off of offs) off();
  };
}
