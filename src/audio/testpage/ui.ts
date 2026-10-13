/**
 * Small DOM helpers for the music test page (dev tool: plain English, built with src/ui/dom.ts h() and the
 * .panel / .btn classes from src/ui/styles.css).
 */
import { h, type Child, type StyleMap } from '../../ui/dom';

/** Compact buttons: the page has ~80 of them, the 56 px game buttons would not fit on a phone. */
const SMALL: StyleMap = {
  minHeight: '44px',
  minWidth: '44px',
  padding: '0.3em 0.75em',
  fontSize: 'var(--fs-small)',
  boxShadow: '0 3px 0 var(--shadow-solid)',
};

const ROW: StyleMap = { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' };

export function section(title: string, ...children: Child[]): HTMLElement {
  return h(
    'section',
    {
      className: 'panel',
      style: {
        width: 'min(1100px, 100%)',
        maxWidth: '100%',
        maxHeight: 'none',
        overflow: 'visible',
        display: 'grid',
        gap: '12px',
      },
    },
    h('h2', { style: { margin: '0' } }, title),
    ...children,
  );
}

export function row(...children: Child[]): HTMLDivElement {
  return h('div', { style: ROW }, ...children);
}

export function note(text: string): HTMLParagraphElement {
  return h('p', { style: { margin: '0', color: 'var(--ink-soft)', fontSize: 'var(--fs-small)' } }, text);
}

export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  return h(
    'button',
    { className: primary ? 'btn' : 'btn btn-secondary', type: 'button', style: SMALL, onClick },
    label,
  );
}

/** Gold = on, cream = off. Writes the DOM only when the state changes (called from the update timer). */
export function setPressed(btn: HTMLButtonElement, on: boolean): void {
  const value = on ? 'true' : 'false';
  if (btn.getAttribute('aria-pressed') === value) return;
  btn.classList.toggle('btn-secondary', !on);
  btn.setAttribute('aria-pressed', value);
}

/** Blue ring for "selected" (independent of pressed). */
export function setOutlined(el: HTMLElement, on: boolean): void {
  const want = on ? '4px solid var(--focus)' : '';
  if (el.style.outline !== want) el.style.outline = want;
}

export interface Slider {
  readonly el: HTMLLabelElement;
  readonly input: HTMLInputElement;
  set(v: number): void;
  get(): number;
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
  digits = 2,
): Slider {
  const out = h('output', { style: { minWidth: '3.2em', fontVariantNumeric: 'tabular-nums' } });
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    style: { flex: '1', minWidth: '120px', accentColor: 'var(--accent-deep)' },
    onInput: () => {
      out.value = Number(input.value).toFixed(digits);
      onInput(Number(input.value));
    },
  });
  out.value = value.toFixed(digits);
  const el = h(
    'label',
    { style: { ...ROW, flexWrap: 'nowrap', minWidth: 'min(320px, 100%)', flex: '1' } },
    h('span', { style: { minWidth: '6.5em' } }, label),
    input,
    out,
  );
  return {
    el,
    input,
    set(v: number) {
      input.value = String(v);
      out.value = v.toFixed(digits);
    },
    get: () => Number(input.value),
  };
}

export function select<T extends string>(
  label: string,
  options: readonly T[],
  value: T,
  onChange: (v: T) => void,
): { el: HTMLLabelElement; input: HTMLSelectElement } {
  const input = h(
    'select',
    {
      style: { minHeight: '44px', padding: '0 0.5em', borderRadius: 'var(--radius-sm)', color: 'var(--ink)' },
      onChange: () => {
        const v = options.find((o) => o === input.value);
        if (v !== undefined) onChange(v);
      },
    },
    options.map((o) => h('option', { value: o, selected: o === value }, o)),
  );
  return { el: h('label', { style: ROW }, h('span', null, label), input), input };
}
