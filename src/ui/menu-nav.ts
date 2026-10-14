/**
 * Geometry helpers for Menu (split out to keep Menu.ts small): which items can take focus, the nearest item in a
 * direction (spatial navigation for grids and side-by-side buttons) and scrolling a panel to show an item.
 */
import type { PadDir } from './menu-pad';

type MenuDir = PadDir;

/** Two items count as on the same line when their edges are this close (px). */
const EDGE_EPS = 4;

export const KEY_DIRS: Record<'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', MenuDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function isUsable(el: HTMLElement): boolean {
  if (!el.isConnected || el.hidden || el.closest('[hidden], [inert]')) return false;
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  return el.getClientRects().length > 0;
}

/**
 * Scrolls the item's own scrolling panels (inside the menu root) just enough to show it. Never scrollIntoView():
 * that would also scroll the overflow-hidden #ui layer and shift the whole screen.
 */
export function scrollToShow(el: HTMLElement, root: HTMLElement): void {
  const margin = 12;
  for (let p = el.parentElement; p && root.contains(p); p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight + 1) continue;
    const overflow = getComputedStyle(p).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const box = p.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top + margin) p.scrollTop -= box.top + margin - r.top;
    else if (r.bottom > box.bottom - margin) p.scrollTop += r.bottom - (box.bottom - margin);
    return;
  }
}

/** Gap between two 1-D intervals (0 when they overlap). */
function gap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, b0 - a1, a0 - b1);
}

/** The nearest item in a direction, weighting sideways offset more than distance. */
export function spatialNext(items: HTMLElement[], from: HTMLElement, dir: MenuDir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    let primary: number;
    let ortho: number;
    let centre: number;
    if (dir === 'down' || dir === 'up') {
      const ok = dir === 'down' ? b.top >= a.bottom - EDGE_EPS : b.bottom <= a.top + EDGE_EPS;
      if (!ok) continue;
      primary = Math.max(0, dir === 'down' ? b.top - a.bottom : a.top - b.bottom);
      ortho = gap(a.left, a.right, b.left, b.right);
      centre = Math.abs(a.left + a.right - b.left - b.right) / 2;
    } else {
      const ok = dir === 'right' ? b.left >= a.right - EDGE_EPS : b.right <= a.left + EDGE_EPS;
      if (!ok) continue;
      primary = Math.max(0, dir === 'right' ? b.left - a.right : a.left - b.right);
      ortho = gap(a.top, a.bottom, b.top, b.bottom);
      centre = Math.abs(a.top + a.bottom - b.top - b.bottom) / 2;
    }
    const score = primary + ortho * 3 + centre * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}
