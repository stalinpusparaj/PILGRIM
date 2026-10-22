/**
 * A plain screen fade for story jumps (a night's sleep, being carried off): one black layer over the HUD and under
 * the menus. Opacity only (no flashes, GDD 2.15 accessibility). `fadeOut` resolves when the screen is dark,
 * `fadeIn` when it is clear again and the layer is gone.
 */
import { h, uiRoot } from './dom';

let layer: HTMLDivElement | null = null;

function ensure(parent: HTMLElement): HTMLDivElement {
  if (layer?.isConnected) return layer;
  layer = h('div', {
    className: 'pg-fade',
    'aria-hidden': 'true',
    style: {
      position: 'fixed',
      inset: '0',
      zIndex: '390',
      background: '#0d0a12',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 0s linear',
    },
  });
  parent.append(layer);
  return layer;
}

function to(opacity: number, seconds: number, parent: HTMLElement): Promise<void> {
  const el = ensure(parent);
  el.style.transition = `opacity ${Math.max(0, seconds)}s ease-in-out`;
  void el.offsetWidth; // start the transition from the current value
  el.style.opacity = String(opacity);
  return new Promise((done) => window.setTimeout(done, Math.max(0, seconds) * 1000 + 30));
}

export function fadeOut(seconds = 1, parent: HTMLElement = uiRoot()): Promise<void> {
  return to(1, seconds, parent);
}

export async function fadeIn(seconds = 1, parent: HTMLElement = uiRoot()): Promise<void> {
  await to(0, seconds, parent);
  clearFade();
}

/** Removes the layer at once (chapter dispose). */
export function clearFade(): void {
  layer?.remove();
  layer = null;
}
