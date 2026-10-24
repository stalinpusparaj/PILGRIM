/**
 * "Ask a grown-up" (DECISIONS #397; Google Play Families policy): before anything leaves the game (the store,
 * sharing, Facebook, feedback mail) a small sum a young child cannot answer by chance. Three answers, one right;
 * a wrong one closes the check. Escape, B or Cancel close it too.
 */
import './parent-gate.css';
import { t } from '../core/I18n';
import { h, uiRoot } from './dom';

let open: Promise<boolean> | null = null;

/** Resolves true only when the sum is answered correctly. */
export function askGrownUp(parent: HTMLElement = uiRoot()): Promise<boolean> {
  if (open) return open;
  const a = 6 + Math.floor(Math.random() * 7); // 6..12
  const b = 5 + Math.floor(Math.random() * 7); // 5..11
  const right = a + b;
  const answers = shuffle([right, right + 1 + Math.floor(Math.random() * 3), right - 1 - Math.floor(Math.random() * 3)]);
  open = new Promise<boolean>((resolve) => {
    const close = (ok: boolean): void => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      open = null;
      resolve(ok);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      }
    };
    const buttons = answers.map((n) =>
      h('button', { type: 'button', className: 'btn btn-secondary pg-gate__answer', onClick: () => close(n === right) }, String(n)),
    );
    const titleId = `pg-gate-${Date.now()}`;
    const root = h(
      'div',
      { className: 'pg-screen pg-gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h(
        'div',
        { className: 'panel pg-gate__panel' },
        h('h2', { className: 'pg-menu-title', id: titleId }, t('ui.gate.title')),
        h('p', { className: 'pg-gate__question' }, t('ui.gate.question', { a, b })),
        h('div', { className: 'pg-gate__answers' }, ...buttons),
        h('button', { type: 'button', className: 'btn btn-secondary pg-gate__cancel', onClick: () => close(false) }, t('ui.gate.cancel')),
      ),
    );
    window.addEventListener('keydown', onKey, true);
    parent.appendChild(root);
    buttons[0]?.focus();
  });
  return open;
}

function shuffle(xs: number[]): number[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}
