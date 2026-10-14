/**
 * Portraits for FRIENDS MET, from `src/ui/Portraits.ts` (the dialogue panel's generated heads):
 *  - `portraitUrl(recipeId, expression?) → string | null` (renders on the GPU, cached there), or
 *  - `Portraits.get(recipeId, expression?) → Promise<string>`, if the module offers that shape instead.
 * The module is found with `import.meta.glob`, so the Satchel builds and runs without it (cards then keep their
 * coloured initial badge), and it is loaded lazily, the first time FRIENDS MET needs a face.
 *
 * Only recipes that exist in content/characters/recipes.json are asked for (an unknown id would come back as a
 * plain villager's face). Renders that are not cached yet are spread one per animation frame, so opening the
 * page never stalls a frame; `cancelPortraits()` drops the pending ones (they resolve to null).
 */
type PortraitCall = (recipe: string, expr: string) => unknown;

interface Backend {
  /** True when the module renders synchronously (one render per frame here). */
  sync: boolean;
  call: PortraitCall;
  cached: ((recipe: string, expr: string) => boolean) | null;
  known: (recipe: string) => boolean;
}

const modules = import.meta.glob('./Portraits.ts');
let backend: Promise<Backend | null> | null = null;

interface Job {
  run: () => void;
  cancel: () => void;
}
const queue: Job[] = [];
let raf = 0;

function fnOf(holder: unknown, name: string): PortraitCall | null {
  if ((typeof holder !== 'object' && typeof holder !== 'function') || holder === null) return null;
  const f: unknown = Reflect.get(holder, name);
  if (typeof f !== 'function') return null;
  return (recipe, expr) => Reflect.apply(f, holder, [recipe, expr]) as unknown;
}

function loadBackend(): Promise<Backend | null> {
  backend ??= (async (): Promise<Backend | null> => {
    const load = Object.values(modules)[0];
    if (!load) return null;
    try {
      const [mod, gen] = await Promise.all([load(), import('../gen/CharacterFactory')]);
      const known = (recipe: string): boolean => Object.hasOwn(gen.CharacterFactory.recipes(), recipe);
      const url = fnOf(mod, 'portraitUrl');
      if (url) {
        const has = fnOf(mod, 'hasPortrait');
        return { sync: true, call: url, cached: has ? (r, e) => has(r, e) === true : null, known };
      }
      const get =
        fnOf(typeof mod === 'object' && mod !== null ? Reflect.get(mod, 'Portraits') : null, 'get') ??
        fnOf(typeof mod === 'object' && mod !== null ? Reflect.get(mod, 'default') : null, 'get');
      return get ? { sync: false, call: get, cached: null, known } : null;
    } catch (err) {
      console.warn('[satchel] portraits unavailable', err);
      return null;
    }
  })();
  return backend;
}

function asUrl(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pump(): void {
  if (raf !== 0 || queue.length === 0) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    queue.shift()?.run();
    pump();
  });
}

/** A portrait data URL for a character recipe, or null (no module, unknown recipe, cancelled, or an error). */
export async function loadPortrait(recipe: string, expr: string): Promise<string | null> {
  const b = await loadBackend();
  if (!b || !b.known(recipe)) return null;
  const attempt = async (): Promise<string | null> => {
    try {
      return asUrl(await b.call(recipe, expr));
    } catch {
      return null;
    }
  };
  if (!b.sync || b.cached?.(recipe, expr)) return attempt();
  return new Promise<string | null>((resolve) => {
    queue.push({ run: () => void attempt().then(resolve), cancel: () => resolve(null) });
    pump();
  });
}

/** Drops portraits still waiting for their frame (the Satchel closed or changed page). */
export function cancelPortraits(): void {
  if (raf !== 0) cancelAnimationFrame(raf);
  raf = 0;
  for (const job of queue.splice(0)) job.cancel();
}
