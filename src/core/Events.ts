/**
 * Typed event bus. Systems talk through this (GDD 2.15 "Engine rules").
 *
 * Modules add their own events with declaration merging instead of editing this file:
 *
 *   declare module '../core/Events' {
 *     interface EventMap { 'promise:collected': { id: string } }
 *   }
 *
 * Use `void` for events without a payload.
 */
export interface EventMap {
  'engine:ready': void;
  'game:pause': { reason: string };
  'game:resume': void;
  'settings:changed': { key: string };
  'lang:changed': { lang: string };
  'input:device': { device: 'kbm' | 'pad' | 'touch' };
  'quality:changed': { level: 'low' | 'medium' | 'high' };
  'context:lost': void;
  'context:restored': void;
  'resize': { width: number; height: number };
  // Gameplay events named in GDD 2.15. Payloads are fixed here so every phase agrees.
  'burden:dropped': void;
  'hope:changed': { value: number; delta: number };
  'detour:entered': { id: string };
  'waystone:read': { id: string };
  'dialogue:end': { id: string };
}

export type EventName = keyof EventMap;
type Handler<K extends EventName> = EventMap[K] extends void ? () => void : (payload: EventMap[K]) => void;
type EmitArgs<K extends EventName> = EventMap[K] extends void ? [] : [payload: EventMap[K]];

export class EventBus {
  private handlers = new Map<EventName, Set<(payload?: unknown) => void>>();

  /** Subscribe. Returns an unsubscribe function; call it in dispose(). */
  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const h = fn as (payload?: unknown) => void;
    set.add(h);
    return () => set!.delete(h);
  }

  once<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const off = this.on(name, ((payload?: unknown) => {
      off();
      (fn as (payload?: unknown) => void)(payload);
    }) as Handler<K>);
    return off;
  }

  emit<K extends EventName>(name: K, ...args: EmitArgs<K>): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(args[0]);
      } catch (err) {
        console.error(`[events] handler for "${name}" threw`, err);
      }
    }
  }

  /** Number of live handlers, used by dispose/leak tests. */
  count(name?: EventName): number {
    if (name) return this.handlers.get(name)?.size ?? 0;
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }
}

export const events = new EventBus();
