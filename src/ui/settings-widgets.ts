/**
 * DOM for the Settings rows (settings-rows.ts specs): option buttons for choices and big sliders.
 *
 * - Choice rows are a radiogroup of buttons with a roving tabindex: Tab / Up / Down land on the selected
 *   option, Left / Right (keyboard or pad) pick the next option at once, a tap or click picks that option.
 * - Slider rows are native range inputs (keyboard, screen readers and touch drag for free), restyled big in
 *   settings.css. Left / Right step them (the pad sends the same keys, see settings-nav.ts); Up / Down are left
 *   to the screen's focus navigation. A volume slider asks for a preview sound when it is released.
 * - Every row writes straight to Settings (live, saved); sync() re-reads the values after `settings:changed`.
 *
 * Listeners are attached to the row's own elements, so they go when the row is removed.
 */
import { events } from '../core/Events';
import { h, setText } from './dom';
import type { ChoiceSpec, RowSpec, SliderSpec, VolumeKey } from './settings-rows';

export interface Widget {
  readonly el: HTMLElement;
  /** Re-read the value (and hint) from Settings. */
  sync(): void;
}

export interface WidgetHost {
  /** A volume slider was released (or stepped with keys / the pad). */
  volumeReleased(key: VolumeKey): void;
}

let uid = 0;

export function buildWidget(spec: RowSpec, host: WidgetHost): Widget {
  if (spec.kind === 'note') {
    const text = h('p', { className: 'pg-set-row__hint', role: 'status' });
    const el = h(
      'div',
      { className: 'pg-set-row' },
      h('p', { className: 'pg-set-row__label' }, spec.label),
      text,
    );
    const sync = (): void => setText(text, spec.text());
    sync();
    return { el, sync };
  }
  return spec.kind === 'choice' ? choiceWidget(spec) : sliderWidget(spec, host);
}

// ------------------------------------------------------------------------------------------------ choice

function choiceWidget(spec: ChoiceSpec): Widget {
  const labelId = `pg-set-label-${spec.id}-${++uid}`;
  const hintId = `pg-set-hint-${spec.id}-${uid}`;
  const hint = h('p', { className: 'pg-set-row__hint', id: hintId, hidden: true });
  const buttons = spec.options.map((opt) =>
    h(
      'button',
      {
        type: 'button',
        className: 'pg-set-opt',
        role: 'radio',
        'aria-checked': 'false',
        tabIndex: -1,
        attrs: { lang: opt.lang },
        dataset: { focusId: `${spec.id}:${opt.id}`, value: opt.id },
        onClick: () => pick(opt.id),
      },
      opt.label,
    ),
  );
  const group = h(
    'div',
    {
      className: 'pg-set-seg',
      role: 'radiogroup',
      'aria-labelledby': labelId,
      'aria-describedby': spec.hint ? hintId : null,
      onKeydown: (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (delta === 0) return;
        e.preventDefault();
        e.stopPropagation(); // handled here: the screen's arrow navigation must not move focus too
        const i = spec.options.findIndex((o) => o.id === spec.get());
        const next = spec.options[Math.min(spec.options.length - 1, Math.max(0, i + delta))];
        if (next && next.id !== spec.get()) pick(next.id);
        focusChecked();
      },
    },
    buttons,
  );
  const el = h(
    'div',
    { className: 'pg-set-row', dataset: { row: spec.id } },
    h(
      'div',
      { className: 'pg-set-row__head' },
      h('span', { className: 'pg-set-row__label', id: labelId }, spec.label),
    ),
    group,
    hint,
  );

  function focusChecked(): void {
    buttons.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
  }

  function pick(id: string): void {
    if (id !== spec.get()) {
      spec.set(id);
      events.emit('sfx', { id: 'ui_click' });
    }
    sync(); // also when Settings refused or clamped the value
  }

  function sync(): void {
    const value = spec.get();
    for (const b of buttons) {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!buttons.some((b) => b.tabIndex === 0) && buttons[0]) buttons[0].tabIndex = 0;
    const text = spec.hint?.() ?? null;
    hint.hidden = text === null;
    setText(hint, text ?? '');
  }

  sync();
  return { el, sync };
}

// ------------------------------------------------------------------------------------------------ slider

function sliderWidget(spec: SliderSpec, host: WidgetHost): Widget {
  const inputId = `pg-set-input-${spec.id}-${++uid}`;
  const value = h('span', { className: 'pg-set-row__value', 'aria-hidden': 'true' });
  const input = h('input', {
    type: 'range',
    id: inputId,
    className: 'pg-set-range',
    min: String(spec.min),
    max: String(spec.max),
    step: String(spec.step),
    dataset: { focusId: spec.id },
    onInput: () => apply(),
    onChange: () => {
      apply();
      if (spec.volume) host.volumeReleased(spec.volume);
    },
    onKeydown: (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (delta === 0) return;
      // Stepped by hand so keyboard and pad (synthetic keys have no default action) behave the same.
      e.preventDefault();
      e.stopPropagation();
      step(delta);
    },
  });
  const el = h(
    'div',
    { className: 'pg-set-row pg-set-row--slider', dataset: { row: spec.id } },
    h(
      'div',
      { className: 'pg-set-row__head' },
      h('label', { className: 'pg-set-row__label', htmlFor: inputId }, spec.label),
      value,
    ),
    input,
  );

  function step(delta: number): void {
    const before = input.value;
    if (delta > 0) input.stepUp();
    else input.stepDown();
    if (input.value === before) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function apply(): void {
    const v = Number(input.value);
    if (Number.isFinite(v) && v !== spec.get()) spec.set(v);
    show(spec.get());
  }

  function show(v: number): void {
    const text = spec.format(v);
    setText(value, text);
    input.setAttribute('aria-valuetext', text);
    const pct = spec.max > spec.min ? ((v - spec.min) / (spec.max - spec.min)) * 100 : 0;
    input.style.setProperty('--pct', `${pct.toFixed(2)}%`);
  }

  function sync(): void {
    const v = spec.get();
    if (Number(input.value) !== v) input.value = String(v);
    show(v);
  }

  sync();
  return { el, sync };
}
