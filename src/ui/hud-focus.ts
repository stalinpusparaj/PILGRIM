/**
 * What the HUD's interaction bubble reads from the Interactables service (src/world/Interactables.ts,
 * ARCHITECTURE "Gameplay (Phase 2)"): the focused interactable and its hold progress. Type-only import, so the
 * HUD does not pull the world module in; with no 'interactables' service (menus, the dev scene) nothing is
 * focused.
 */
import { services } from '../core/Services';
import type { Interactable } from '../world/Interactables';

/** The part of an Interactable the bubble reads. */
export type FocusTarget = Pick<
  Interactable,
  'id' | 'pos' | 'verb' | 'enabled' | 'height' | 'holdSeconds' | 'action'
>;

/** The focused interactable, or null (nothing in reach, switched off, or no 'interactables' service). */
export function focusedInteractable(): FocusTarget | null {
  const f = services.tryGet('interactables')?.focused ?? null;
  return f && f.enabled ? f : null;
}

/** The service's own hold progress 0..1, or null when there is no 'interactables' service. */
export function serviceHoldProgress(): number | null {
  const svc = services.tryGet('interactables');
  if (!svc) return null;
  const v = svc.holdProgress;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
