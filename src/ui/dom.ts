/**
 * Tiny typed DOM helpers for the plain-DOM UI (GDD 2.15: no UI framework).
 *
 *   const btn = h('button', { className: 'btn', type: 'button', 'aria-label': t('ui.touch.pause'),
 *                             onClick: () => pause() }, t('ui.pause.title'));
 *
 * Listeners added through `onX` props live and die with the element: drop the element and they go too.
 * Listeners on long-lived targets (window, document) should use `listen()` and call the returned function
 * in dispose().
 */

type Primitive = string | number | boolean;
type Tag = keyof HTMLElementTagNameMap;

/** Resolves to A when X and Y are identical types, else B (used to detect `readonly`). */
type IfEquals<X, Y, A, B> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? A : B;

/** Writable, primitive-valued properties of an element (id, title, type, value, min, checked, disabled...). */
type WritablePrimitiveKeys<E> = {
  [P in keyof E]-?: E[P] extends Primitive
    ? IfEquals<{ [Q in P]: E[P] }, { -readonly [Q in P]: E[P] }, P, never>
    : never;
}[keyof E];

/** Element properties settable via props. Raw HTML is deliberately excluded: text goes in as text. */
type ElementProps<K extends Tag> = Partial<
  Pick<
    HTMLElementTagNameMap[K],
    Exclude<WritablePrimitiveKeys<HTMLElementTagNameMap[K]>, 'innerHTML' | 'outerHTML'>
  >
>;

/** `onClick`, `onKeydown`, `onPointerdown`... typed from HTMLElementEventMap (any casing works at runtime). */
type EventProps = {
  [E in keyof HTMLElementEventMap as `on${Capitalize<E>}`]?: (ev: HTMLElementEventMap[E]) => void;
};

type CssKey = Exclude<
  {
    [P in keyof CSSStyleDeclaration]: P extends string
      ? CSSStyleDeclaration[P] extends string
        ? P
        : never
      : never;
  }[keyof CSSStyleDeclaration],
  'cssText' | 'cssFloat'
>;

/** camelCase CSS properties plus `--custom` properties. Numbers are written as-is (add units yourself). */
export type StyleMap = { [P in CssKey]?: string | number } & {
  [custom: `--${string}`]: string | number | undefined;
};

export type Props<K extends Tag> = ElementProps<K> &
  EventProps & {
    className?: string;
    /** Object of CSS properties, or a cssText string. */
    style?: StyleMap | string;
    /** `data-*` attributes; null/undefined values are skipped. */
    dataset?: Record<string, Primitive | null | undefined>;
    /** Raw attributes. true → present, false/null/undefined → absent. */
    attrs?: Record<string, Primitive | null | undefined>;
    role?: string;
    /** ARIA attributes are always written as strings, so `false` becomes "false" (meaningful for aria-pressed). */
    [aria: `aria-${string}`]: Primitive | null | undefined;
  };

/** Text, numbers and nodes; null/undefined/false are skipped; arrays are flattened. */
export type Child = Node | string | number | null | undefined | false | readonly Child[];

/** Element builder. */
export function h<K extends Tag>(
  tag: K,
  props?: Props<K> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, ...children);
  return el;
}

/** Append children (strings become text nodes, never HTML). */
export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, ...(child as readonly Child[]));
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** Remove every child of a node. */
export function clear(node: ParentNode): void {
  node.replaceChildren();
}

/** Set the text of an element, skipping the DOM write when nothing changed (cheap for per-frame HUD updates). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Show or hide via the `hidden` attribute (styles.css makes `[hidden]` win over any display rule). */
export function setVisible(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}

export function show(el: HTMLElement): void {
  setVisible(el, true);
}

export function hide(el: HTMLElement): void {
  setVisible(el, false);
}

export function isVisible(el: HTMLElement): boolean {
  return !el.hidden && el.isConnected;
}

/** Text fields, sliders and selects keep their keys (player name entry, settings controls). */
export function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Focused buttons and links keep Space / Enter so they still activate (e.g. "Click to play"). */
export function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a[href], [role="button"]') !== null;
}

/** Space or Enter on a focused control: its own activation. Every other key (Tab too) belongs to the game. */
export function activatesControl(e: KeyboardEvent): boolean {
  return (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && isControl(e.target);
}

/** Append `child` to `parent`; the returned function removes it again. */
export function mount(parent: Node, child: Element): () => void {
  parent.appendChild(child);
  return () => child.remove();
}

/** The `#ui` overlay root from index.html (created if missing, e.g. in tests). */
export function uiRoot(): HTMLElement {
  let root = document.getElementById('ui');
  if (!root) {
    root = h('div', { id: 'ui' });
    document.body.appendChild(root);
  }
  return root;
}

/** addEventListener that returns its own remover; use for window/document/long-lived targets. */
export function listen<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  fn: (ev: WindowEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void;
export function listen<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  fn: (ev: DocumentEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void;
export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  fn: (ev: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void;
export function listen(
  target: EventTarget,
  type: string,
  fn: (ev: Event) => void,
  opts?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

// ---------------------------------------------------------------------------------------------------------

/** Properties that depend on others (a range input's value is clamped by min/max/step), so they go last. */
const LATE_PROPS = new Set(['value', 'checked', 'valueAsNumber', 'selectedIndex']);

function applyProps(el: HTMLElement, props: object): void {
  const late: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'className') el.className = String(value);
    else if (key === 'style') applyStyle(el, value);
    else if (key === 'dataset') applyDataset(el, value);
    else if (key === 'attrs') applyAttrs(el, value);
    else if (key === 'role' || key.startsWith('aria-')) {
      if (value === null) el.removeAttribute(key);
      else el.setAttribute(key, String(value));
    } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (LATE_PROPS.has(key)) late.push([key, value]);
    else setProp(el, key, value);
  }
  for (const [key, value] of late) setProp(el, key, value);
}

function setProp(el: HTMLElement, key: string, value: unknown): void {
  // Known DOM properties are assigned (keeps IDL semantics such as `disabled`, `tabIndex`); anything else
  // becomes an attribute.
  if (key in el) Reflect.set(el, key, value);
  else if (value === null || value === false) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? '' : String(value));
}

function applyStyle(el: HTMLElement, style: unknown): void {
  if (typeof style === 'string') {
    el.style.cssText = style;
    return;
  }
  if (!style || typeof style !== 'object') return;
  for (const [prop, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    el.style.setProperty(cssName(prop), String(value));
  }
}

function applyDataset(el: HTMLElement, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) el.dataset[k] = String(v);
  }
}

function applyAttrs(el: HTMLElement, attrs: unknown): void {
  if (!attrs || typeof attrs !== 'object') return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) el.removeAttribute(k);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

/** `backgroundColor` → `background-color`, `webkitUserSelect` → `-webkit-user-select`, `--x` unchanged. */
function cssName(prop: string): string {
  if (prop.startsWith('--') || prop.includes('-')) return prop;
  return prop.replace(/^(webkit|moz|ms)(?=[A-Z])/, '-$1').replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
