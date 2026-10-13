/** Character Lab panel styles (dev tool; mirrors the F1 debug panel look, docked top-left). */
export const PANEL_CSS = `
.lab { position: fixed; z-index: 9000; box-sizing: border-box; width: 318px; max-width: calc(100vw - 16px);
  top: calc(8px + env(safe-area-inset-top, 0px)); left: calc(8px + env(safe-area-inset-left, 0px));
  max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px); padding: 6px 8px 8px;
  overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; pointer-events: auto;
  background: rgba(14, 12, 20, 0.82); color: #e9e6f2; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.3) transparent; }
.lab * { box-sizing: border-box; font: inherit; }
.lab [hidden] { display: none !important; }
.lab :focus-visible { outline: 2px solid #7ab8ff; outline-offset: 1px; }
.lab-head { display: flex; align-items: center; gap: 8px; }
.lab-head strong { flex: 1; color: #ffd27a; font-weight: 700; }
.lab-sec { margin-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 4px; }
.lab-sec > summary { cursor: pointer; color: #ffd27a; padding: 2px 0; }
.lab-sub { opacity: 0.7; margin: 4px 0 2px; }
.lab-wrap, .lab-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px 0; align-items: center; }
.lab-list { display: grid; grid-template-columns: 1fr; gap: 3px; padding: 3px 0; max-height: 260px; overflow-y: auto; }
.lab-list .lab-btn { text-align: left; }
.lab-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 3px 0; }
.lab-btn { padding: 3px 8px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
  background: rgba(255, 255, 255, 0.08); color: inherit; cursor: pointer; }
.lab-btn:hover { background: rgba(255, 255, 255, 0.18); }
.lab-btn.on { background: rgba(255, 210, 122, 0.35); border-color: #ffd27a; color: #fff; }
.lab-ctl { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; }
.lab-ctl input { margin: 0; accent-color: #ffd27a; }
.lab-slider { width: 100%; }
.lab-slider .lab-k { width: 7.5em; flex: none; }
.lab-slider input { flex: 1; min-width: 0; }
.lab-colour { display: flex; align-items: center; gap: 6px; cursor: pointer; overflow: hidden; }
.lab-colour input { width: 30px; height: 22px; padding: 0; border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px; background: none; flex: none; }
.lab-colour span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab-select { background: #221d2e; color: inherit; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px; }
.lab-readouts { margin-top: 4px; }
.lab-kv { display: flex; justify-content: space-between; gap: 8px; }
.lab-k { opacity: 0.7; white-space: nowrap; }
.lab-v { font-variant-numeric: tabular-nums; text-align: right; color: #fff; }
.lab-status { min-height: 1.4em; color: #a8e6a1; }
.lab-json { width: 100%; background: #0d0b12; color: #e9e6f2; border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px; resize: vertical; }
`;
