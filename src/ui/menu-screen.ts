/**
 * Small shared pieces for the GDD 2.14 menu screens (Title, Opening, Pause, Chapters, Credits, Demo end):
 * live-translated text (`Texts`), the menu button, full-screen layers and the reduce-motion check.
 * Every screen imports its look from menus.css and menu-panels.css through this module.
 */
import './menus.css';
import './menu-panels.css';
import { events } from '../core/Events';
import { t, type TranslateParams } from '../core/I18n';
import { services } from '../core/Services';
import type { SfxId } from '../audio/types';
import '../audio/events';
import { h } from './dom';

type Params = TranslateParams | (() => TranslateParams);

interface TextEntry {
  readonly el: Element;
  readonly key: string;
  readonly params?: Params;
  /** Attribute to write instead of the text content (aria-label, title...). */
  readonly attr?: string;
}

/**
 * Text bound to i18n keys. Every bound element is re-translated on 'lang:changed', so a screen switches language
 * live (the title's "English | தமிழ்" toggle). `onChange` runs after a refresh for anything not bound here.
 */
export class Texts {
  private readonly entries: TextEntry[] = [];
  private readonly off: () => void;

  constructor(private readonly onChange?: () => void) {
    this.off = events.on('lang:changed', () => this.refresh());
  }

  /** Sets the element's text from `key` now and on every language change. Returns the element. */
  text<E extends Element>(el: E, key: string, params?: Params): E {
    const entry: TextEntry = params === undefined ? { el, key } : { el, key, params };
    this.entries.push(entry);
    apply(entry);
    return el;
  }

  /** Same for an attribute (aria-label, title). */
  attr<E extends Element>(el: E, name: string, key: string, params?: Params): E {
    const entry: TextEntry = params === undefined ? { el, key, attr: name } : { el, key, params, attr: name };
    this.entries.push(entry);
    apply(entry);
    return el;
  }

  /** Forget the bindings of an element that is being thrown away. */
  unbind(el: Element): void {
    for (let i = this.entries.length - 1; i >= 0; i--)
      if (this.entries[i]!.el === el) this.entries.splice(i, 1);
  }

  refresh(): void {
    for (const e of this.entries) apply(e);
    this.onChange?.();
  }

  dispose(): void {
    this.off();
    this.entries.length = 0;
  }
}

function apply(e: TextEntry): void {
  const params = typeof e.params === 'function' ? e.params() : e.params;
  const text = t(e.key, params);
  if (e.attr) {
    if (e.el.getAttribute(e.attr) !== text) e.el.setAttribute(e.attr, text);
  } else if (e.el.textContent !== text) {
    e.el.textContent = text;
  }
}

export interface MenuButtonOptions {
  onClick: () => void;
  /** Gold primary button (bigger on phones); the menu focuses it first. */
  primary?: boolean;
  className?: string;
  params?: Params;
}

/** A chunky menu button with live-translated text, marked as a Menu item. */
export function menuButton(texts: Texts, key: string, o: MenuButtonOptions): HTMLButtonElement {
  const kind = o.primary ? 'pg-mbtn--primary' : 'btn-secondary';
  const button = h('button', {
    type: 'button',
    className: `btn pg-mbtn ${kind}${o.className ? ` ${o.className}` : ''}`,
    dataset: { menuItem: '', primary: o.primary ? '' : null, key },
    onClick: () => o.onClick(),
  });
  texts.text(button, key, o.params);
  return button;
}

/** A full-screen layer for one screen. `label` names a modal dialog for screen readers. */
export function screenLayer(className: string, labelId?: string): HTMLDivElement {
  return h('div', {
    className: `pg-screen ${className}`,
    role: labelId ? 'dialog' : undefined,
    'aria-modal': labelId ? 'true' : null,
    'aria-labelledby': labelId ?? null,
  });
}

let idCounter = 0;
/** Unique element ids for aria-labelledby. */
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function playSfx(id: SfxId, volume?: number): void {
  events.emit('sfx', volume === undefined ? { id } : { id, volume });
}

/** Settings > Reduce camera motion, or the OS preference: no drifting, sliding or long fades. */
export function reduceMotion(): boolean {
  if (services.tryGet('settings')?.data.reduceMotion) return true;
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Next frame then the one after: lets a freshly mounted element commit its start style before a transition. */
export function afterPaint(fn: () => void): () => void {
  let id = requestAnimationFrame(() => {
    id = requestAnimationFrame(fn);
  });
  return () => cancelAnimationFrame(id);
}
