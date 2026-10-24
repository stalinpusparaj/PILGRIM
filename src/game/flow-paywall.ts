/**
 * The end of the free chapters (DECISIONS #402): the paywall when the full journey is sold through the store,
 * else the demo build's "The Way goes on..." card (GDD 2.14 Demo end).
 */
import { FREE_LAST_CHAPTER, entitlement } from '../core/Entitlement';
import { DemoEnd } from '../ui/DemoEnd';
import { Paywall } from '../ui/Paywall';

interface Flow {
  showTitle(): void;
  startChapter(chapter: number): Promise<void>;
}

/** GameFlow.showDemoEnd's screen; buying the journey goes on to chapter `next`. */
export function endOfFree(parent: HTMLElement, flow: Flow, next: number): { dispose(): void } {
  // No store to sell through (a browser, the demo build): the demo end card.
  if (!entitlement.hasStore) return new DemoEnd(parent, { onTitle: () => flow.showTitle() });
  return new Paywall(parent, {
    onUnlocked: () => void flow.startChapter(next),
    onClose: () => flow.showTitle(),
  });
}

/** True when finishing `chapter` reaches a chapter that is still locked (after Chapter IV). */
export function paywallAfter(chapter: number): boolean {
  return chapter >= FREE_LAST_CHAPTER && entitlement.isChapterLocked(chapter + 1);
}
