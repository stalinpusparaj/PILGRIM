/**
 * Character Lab dev panel (plain DOM via `h()`, developer-only English as allowed for dev tools). It only
 * renders controls and forwards user intent to the Lab through `LabPanelHandlers`; the Lab owns all state.
 */
import { h, setText, setVisible } from '../ui/dom';
import type { AnimName, ProcClip } from './anim/types';
import type { CharacterRecipe } from './CharacterFactory';
import type { PaletteId } from './palette';
import {
  BUILD_KEYS,
  BUILD_RANGE,
  BURDEN_RANGE,
  EXPRESSIONS,
  colourKeys,
  getBuild,
  getColour,
  recipeLabel,
  toColourInput,
  type BuildKey,
  type Expression,
} from './lab-recipe';
import { PANEL_CSS } from './lab-style';

export type LabView = 'turntable' | 'lineup';
export type LabShot = 'close' | 'gameplay' | 'wide';
/** Button groups whose active item is highlighted. */
export type LabGroup = 'recipe' | 'view' | 'shot' | 'anim' | 'overlay' | 'expr';

export interface LabPanelHandlers {
  selectRecipe(id: string): void;
  setView(v: LabView): void;
  setShot(s: LabShot): void;
  step(dir: -1 | 1): void;
  setCrowd(on: boolean): void;
  setCrowdPalette(id: PaletteId): void;
  setRotate(on: boolean): void;
  play(name: AnimName): void;
  overlay(name: AnimName | null): void;
  setRepeat(on: boolean): void;
  setMoveSpeed(v: number): void;
  setExpression(e: Expression): void;
  setRandomFaces(on: boolean): void;
  setTalking(on: boolean): void;
  setBurden(s: number): void;
  setColour(key: string, hex: string): void;
  setBuild(key: BuildKey, v: number): void;
  resetRecipe(): void;
  copyJson(): void;
}

export interface LabPanelOptions {
  recipes: readonly CharacterRecipe[];
  clips: readonly ProcClip[];
  palettes: readonly PaletteId[];
  crowdPalette: PaletteId;
  moveSpeed: number;
}

const NONE = '__none__';
export const MOVE_SPEED_RANGE = { min: 0, max: 6, step: 0.1 } as const;

interface Slider {
  row: HTMLElement;
  input: HTMLInputElement;
  value: HTMLElement;
}

export class LabPanel {
  readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly body: HTMLElement;
  private readonly groups = new Map<LabGroup, Map<string, HTMLButtonElement>>();
  private readonly readouts = new Map<string, HTMLElement>();
  private readonly readoutBox = h('div', { className: 'lab-readouts' });
  private readonly status = h('div', { className: 'lab-status', role: 'status', 'aria-live': 'polite' });
  private readonly colourBox = h('div', { className: 'lab-grid2' });
  private readonly buildBox = h('div');
  private readonly jsonArea = h('textarea', {
    className: 'lab-json',
    readOnly: true,
    rows: 10,
    hidden: true,
  });
  private readonly nav: HTMLElement;
  private readonly lineupFaces: HTMLElement;
  private readonly burden: Slider;
  private readonly speed: Slider;
  private disposed = false;

  constructor(
    private readonly on: LabPanelHandlers,
    opts: LabPanelOptions,
  ) {
    this.style = h('style', { id: 'pilgrim-lab-style' }, PANEL_CSS);
    document.head.appendChild(this.style);

    const upper = opts.clips.filter((c) => c.layer === 'upper');
    const clipLabel = (c: ProcClip): string => (c.loop ? c.name : `${c.name} ▸`);

    this.nav = h(
      'div',
      { className: 'lab-row' },
      this.button('◀ Prev', () => on.step(-1)),
      this.button('Next ▶', () => on.step(1)),
    );
    this.lineupFaces = this.toggle('Random faces', true, (v) => on.setRandomFaces(v));
    this.burden = this.slider('Burden size', BURDEN_RANGE, 1, (v) => on.setBurden(v));
    this.speed = this.slider('Move speed m/s', MOVE_SPEED_RANGE, opts.moveSpeed, (v) => on.setMoveSpeed(v));
    const talkRow = this.toggle('Talking', false, (v) => on.setTalking(v));

    const paletteSelect = h(
      'select',
      { className: 'lab-select', 'aria-label': 'Crowd tint palette' },
      opts.palettes.map((id) => h('option', { value: id, selected: id === opts.crowdPalette }, id)),
    );
    paletteSelect.addEventListener('change', () => on.setCrowdPalette(paletteSelect.value as PaletteId));

    const hide = this.button('Hide', () => {
      const hidden = !this.body.hidden;
      setVisible(this.body, !hidden);
      setText(hide, hidden ? 'Show' : 'Hide');
    });

    this.body = h(
      'div',
      { className: 'lab-body' },
      this.readoutBox,
      this.section(
        'View',
        this.group(
          'view',
          [
            ['turntable', 'Turntable'],
            ['lineup', 'Lineup'],
          ],
          (v) => on.setView(v as LabView),
        ),
        this.group(
          'shot',
          [
            ['close', 'Close-up'],
            ['gameplay', 'Gameplay'],
            ['wide', 'Wide'],
          ],
          (v) => on.setShot(v as LabShot),
        ),
        this.nav,
        this.toggle('Rotate turntable', true, (v) => on.setRotate(v)),
        this.lineupFaces,
        h(
          'div',
          { className: 'lab-row' },
          this.toggle('Crowd of 100', false, (v) => on.setCrowd(v)),
          paletteSelect,
        ),
      ),
      this.section(
        'Recipes',
        this.group(
          'recipe',
          opts.recipes.map((r): [string, string] => [r.id, recipeLabel(r)]),
          (id) => on.selectRecipe(id),
          'lab-list',
        ),
      ),
      this.section(
        'Animation',
        h('div', { className: 'lab-sub' }, 'Play (full body)'),
        this.group(
          'anim',
          opts.clips.map((c): [string, string] => [c.name, clipLabel(c)]),
          (n) => on.play(n as AnimName),
        ),
        h('div', { className: 'lab-sub' }, 'Upper-body overlay'),
        this.group(
          'overlay',
          [[NONE, 'none'], ...upper.map((c): [string, string] => [c.name, clipLabel(c)])],
          (n) => on.overlay(n === NONE ? null : (n as AnimName)),
        ),
        this.toggle('Repeat one-shots (▸)', true, (v) => on.setRepeat(v)),
        this.speed.row,
      ),
      this.section(
        'Face',
        this.group(
          'expr',
          EXPRESSIONS.map((e): [string, string] => [e, e]),
          (e) => on.setExpression(e as Expression),
        ),
        talkRow,
        this.burden.row,
      ),
      this.section('Colours', this.colourBox),
      this.section('Build', this.buildBox),
      this.section(
        'Recipe JSON',
        h(
          'div',
          { className: 'lab-row' },
          this.button('Copy recipe JSON', () => on.copyJson()),
          this.button('Reset recipe', () => on.resetRecipe()),
        ),
        this.status,
        this.jsonArea,
      ),
    );

    this.root = h(
      'div',
      { className: 'lab', role: 'region', 'aria-label': 'Character Lab' },
      h('div', { className: 'lab-head' }, h('strong', null, 'Character Lab'), hide),
      this.body,
    );
    document.body.appendChild(this.root);
    this.setActive('overlay', NONE);
  }

  /** Rebuilds the recipe-specific controls (colour pickers, build sliders, burden slider). */
  showRecipe(recipe: CharacterRecipe, burdenSize: number): void {
    this.colourBox.replaceChildren(
      ...colourKeys(recipe).map((key) => {
        const input = h('input', { type: 'color', value: toColourInput(getColour(recipe, key)) });
        input.setAttribute('aria-label', `${key} colour`);
        input.addEventListener('input', () => this.on.setColour(key, input.value));
        return h('label', { className: 'lab-colour' }, input, h('span', null, key));
      }),
    );
    this.buildBox.replaceChildren(
      ...BUILD_KEYS.map(
        (key) => this.slider(key, BUILD_RANGE, getBuild(recipe, key), (v) => this.on.setBuild(key, v)).row,
      ),
    );
    setVisible(this.burden.row, recipe.burden === true);
    this.setSlider(this.burden, burdenSize);
    this.jsonArea.hidden = true;
    setText(this.status, '');
  }

  setView(view: LabView): void {
    this.setActive('view', view);
    setVisible(this.nav, view === 'lineup');
    setVisible(this.lineupFaces, view === 'lineup');
  }

  setActive(group: LabGroup, value: string | null): void {
    const items = this.groups.get(group);
    if (!items) return;
    const key = value ?? NONE;
    for (const [v, btn] of items) {
      const on = v === key;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  setMoveSpeed(v: number): void {
    this.setSlider(this.speed, v);
  }

  /** Label/value rows refreshed by the Lab a few times a second (DOM writes only when text changes). */
  setReadouts(rows: ReadonlyArray<readonly [string, string]>): void {
    for (const [label, value] of rows) {
      let el = this.readouts.get(label);
      if (!el) {
        el = h('span', { className: 'lab-v' });
        this.readouts.set(label, el);
        this.readoutBox.append(
          h('div', { className: 'lab-kv' }, h('span', { className: 'lab-k' }, label), el),
        );
      }
      setText(el, value);
    }
  }

  setStatus(text: string): void {
    setText(this.status, text);
  }

  /** Shows text selected in a textarea for a manual Ctrl+C (clipboard unavailable). */
  showJson(text: string): void {
    this.jsonArea.value = text;
    this.jsonArea.hidden = false;
    this.jsonArea.focus();
    this.jsonArea.select();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
    this.style.remove();
    this.groups.clear();
    this.readouts.clear();
  }

  // ---------------------------------------------------------------- builders

  private button(label: string, fn: () => void): HTMLButtonElement {
    return h('button', { type: 'button', className: 'lab-btn', onClick: fn }, label);
  }

  private group(
    name: LabGroup,
    items: ReadonlyArray<readonly [string, string]>,
    pick: (value: string) => void,
    className = 'lab-wrap',
  ): HTMLElement {
    const map = new Map<string, HTMLButtonElement>();
    const box = h('div', { className });
    for (const [value, label] of items) {
      const btn = this.button(label, () => pick(value));
      btn.setAttribute('aria-pressed', 'false');
      map.set(value, btn);
      box.append(btn);
    }
    this.groups.set(name, map);
    return box;
  }

  private section(title: string, ...children: HTMLElement[]): HTMLElement {
    return h('details', { className: 'lab-sec', open: true }, h('summary', null, title), ...children);
  }

  private toggle(label: string, initial: boolean, fn: (v: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox', checked: initial });
    input.addEventListener('change', () => fn(input.checked));
    return h('label', { className: 'lab-ctl' }, input, h('span', null, label));
  }

  private slider(
    label: string,
    range: { min: number; max: number; step: number },
    initial: number,
    fn: (v: number) => void,
  ): Slider {
    const input = h('input', {
      type: 'range',
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      value: String(initial),
    });
    input.setAttribute('aria-label', label);
    const value = h('span', { className: 'lab-v' }, initial.toFixed(2));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setText(value, v.toFixed(2));
      fn(v);
    });
    const row = h(
      'label',
      { className: 'lab-ctl lab-slider' },
      h('span', { className: 'lab-k' }, label),
      input,
      value,
    );
    return { row, input, value };
  }

  private setSlider(s: Slider, v: number): void {
    s.input.value = String(v);
    setText(s.value, v.toFixed(2));
  }
}
