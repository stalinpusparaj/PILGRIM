/**
 * Styles of the `?dialogue=test` overlay (a dev demo): injected once while a demo is alive, removed with it.
 * Built on the global tokens and `.panel` / `.btn` classes of src/ui/styles.css. A column in the top-left
 * corner (the F1 panel keeps the top-right; the dialogue panel the bottom) that wraps on a 375 px phone. Every
 * control is at least 48 px (the main button 72 px on touch and narrow screens), and nothing animates beyond a
 * soft pop (the global reduce-motion rules switch it off).
 */
const CSS = `
.dtest-bar { position: absolute; top: 0; left: 0; display: flex; flex-direction: column; gap: 10px;
  align-items: flex-start; max-width: min(440px, 100%);
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right)) 0 calc(12px + var(--safe-left)); }
.dtest-readout.panel { display: grid; gap: 4px; min-width: 0; max-width: min(360px, 100%); padding: 10px 14px;
  border-width: 3px; border-radius: var(--radius); box-shadow: 0 5px 0 var(--shadow-solid), 0 10px 24px var(--shadow);
  font-size: var(--fs-small); overflow: visible; }
.dtest-hope { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dtest-lantern { flex: none; width: 34px; height: 44px; overflow: visible; }
.dtest-lantern .dtest-flame { transform-box: fill-box; transform-origin: 50% 100%;
  transition: transform var(--dur-slow) var(--ease-out); }
.dtest-hope-col { display: grid; gap: 3px; flex: 1; min-width: 0; }
.dtest-hope-label { display: flex; align-items: baseline; gap: 8px; font-weight: 800; white-space: nowrap; }
.dtest-hope-num { font-variant-numeric: tabular-nums; color: var(--ink-soft); }
.dtest-meter { position: relative; height: 14px; width: min(170px, 42vw); border-radius: 999px;
  background: var(--panel-deep); border: 2px solid var(--panel-edge); overflow: hidden; }
.dtest-meter-fill { position: absolute; inset: 0; transform-origin: 0 50%; background: var(--accent);
  transition: transform var(--dur-slow) var(--ease-out); }
.dtest-delta { display: inline-block; padding: 0 8px; border-radius: 999px; line-height: 1.5;
  font-weight: 800; white-space: nowrap; color: var(--ink); background: var(--accent-light);
  border: 2px solid var(--accent-deep); animation: pilgrim-pop var(--dur-slow) var(--ease-bounce) both; }
.dtest-delta.down { background: var(--panel-deep); border-color: var(--berry); }
.dtest-lang-line { color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dtest-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-start; align-items: center;
  max-width: 100%; }
.dtest-actions .btn { min-height: 56px; }
.dtest-play { min-width: 9em; }
.dtest-status { padding: 6px 14px; border-radius: var(--radius); background: var(--scrim); color: var(--ink-inverse);
  font-weight: 700; min-height: 48px; display: inline-flex; align-items: center; }
.dtest-langs { display: inline-flex; border-radius: var(--radius); box-shadow: 0 5px 0 var(--shadow-solid), 0 8px 16px var(--shadow); }
.dtest-langs .btn { box-shadow: none; border-radius: 0; min-width: 48px; min-height: 56px; padding: 0.5em 0.9em; }
.dtest-langs .btn:first-child { border-radius: var(--radius) 0 0 var(--radius); border-right-width: 1px; }
.dtest-langs .btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; border-left-width: 1px; }
.dtest-langs .btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent-deep); }
.dtest-langs .btn:active { transform: translateY(2px); }
.dtest-langs .btn:focus-visible { position: relative; z-index: 1; box-shadow: 0 0 0 4px var(--panel); }
.dtest-langs .sep { display: none; }
.dtest-root .btn.dtest-padfocus { outline: 4px solid var(--focus); outline-offset: 4px; position: relative; z-index: 1; }
@media (max-width: 480px) {
  .dtest-status.is-playing { display: none; }
}
@media (max-width: 760px), (pointer: coarse) {
  .dtest-play { min-height: 72px !important; }
  .dtest-langs .btn { min-height: 60px; }
}
`;

let el: HTMLStyleElement | null = null;
let users = 0;

/** Adds the stylesheet (reference counted). Call `releaseDemoStyle()` once per acquire. */
export function acquireDemoStyle(): void {
  users++;
  if (el) return;
  el = document.createElement('style');
  el.id = 'pg-dialogue-test-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function releaseDemoStyle(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || !el) return;
  el.remove();
  el = null;
}
