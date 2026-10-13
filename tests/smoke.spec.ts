import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 0 smoke test: the game boots and renders with a clean console, the asset guard works (GDD 2.3),
 * a remapped key survives a reload, and rebinding never leaves an action without a key (GDD 2.6).
 */
test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------------------------------------
// Loose typings for what the page exposes (window.__pilgrim is set by src/main.ts) and for the few Node
// built-ins used here. The project deliberately has no @types/node (dev-dependency allowlist, GDD 2.3).
// ---------------------------------------------------------------------------------------------------------

interface PilgrimHandle {
  ready?: boolean;
  engine?: { stats?: { drawCalls?: number } };
  services?: { get(key: string): unknown };
}
type PilgrimWindow = Window & { __pilgrim?: PilgrimHandle };

interface InputHandle {
  rebind(action: string, code: string, slot?: number): boolean;
  getBindings(action: string): string[];
  resetBindings(): void;
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
interface ChildProcessModule {
  spawnSync(
    command: string,
    args: readonly string[],
    options: { cwd: string; encoding: 'utf8'; timeout: number },
  ): SpawnResult;
}
interface FsModule {
  writeFileSync(path: string, data: Uint8Array): void;
  rmSync(path: string, options: { force: boolean }): void;
}
interface UrlModule {
  fileURLToPath(url: URL): string;
}
interface ProcessModule {
  default: { execPath: string };
}

/** Loads a Node built-in by name (a non-literal import, so the type checker needs no Node typings). */
async function nodeBuiltin<T>(name: string): Promise<T> {
  const mod: T = await import(name);
  return mod;
}

const ROOT_URL = new URL('../', import.meta.url);
const SETTINGS_KEY = 'pilgrim.settings.v1';
/** A real PNG signature plus the start of an IHDR chunk: enough for magic-number sniffing. */
const PNG_PROBE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

async function runCheckAssets(): Promise<{ code: number | null; output: string }> {
  const [{ spawnSync }, { fileURLToPath }, proc] = await Promise.all([
    nodeBuiltin<ChildProcessModule>('node:child_process'),
    nodeBuiltin<UrlModule>('node:url'),
    nodeBuiltin<ProcessModule>('node:process'),
  ]);
  const script = fileURLToPath(new URL('tools/check-assets.mjs', ROOT_URL));
  const result = spawnSync(proc.default.execPath, [script], {
    cwd: fileURLToPath(ROOT_URL),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as PilgrimWindow).__pilgrim?.ready === true, undefined, {
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------------------------------------------

test('boots, renders a frame and logs no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));

  await page.goto('/');
  await waitForReady(page);
  await expect(page.locator('canvas#game')).toBeVisible();
  await page.waitForFunction(() => ((window as PilgrimWindow).__pilgrim?.engine?.stats?.drawCalls ?? 0) > 0);
  // Let ~30 more frames run so late errors (async init, first resize, quality benchmark) are caught too.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = (): void => {
          if (++frames >= 30) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

  expect(errors, errors.join('\n')).toEqual([]);
});

test('check-assets passes, fails on a stray PNG in public/, and passes again once it is removed', async () => {
  const fs = await nodeBuiltin<FsModule>('node:fs');
  const { fileURLToPath } = await nodeBuiltin<UrlModule>('node:url');
  const probe = fileURLToPath(new URL('public/__probe.png', ROOT_URL));

  const clean = await runCheckAssets();
  expect(clean.code, clean.output).toBe(0);

  try {
    fs.writeFileSync(probe, PNG_PROBE);
    const dirty = await runCheckAssets();
    expect(dirty.code, dirty.output).toBe(1);
    expect(dirty.output).toContain('__probe.png');
  } finally {
    fs.rmSync(probe, { force: true });
  }

  const after = await runCheckAssets();
  expect(after.code, after.output).toBe(0);
});

test('a remapped key survives a reload', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page);
  await page.evaluate(() => {
    const input = (window as PilgrimWindow).__pilgrim?.services?.get('input') as InputHandle;
    input.rebind('jump', 'KeyJ');
  });
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', SETTINGS_KEY), {
      message: `the rebind was not persisted to localStorage "${SETTINGS_KEY}"`,
    })
    .toContain('KeyJ');

  await page.reload();
  await waitForReady(page);
  try {
    const bindings = await page.evaluate(() => {
      const input = (window as PilgrimWindow).__pilgrim?.services?.get('input') as InputHandle;
      return input.getBindings('jump');
    });
    expect(bindings).toContain('KeyJ');
  } finally {
    // Leave defaults behind for anything that reuses this browser profile.
    await page.evaluate(() => {
      const input = (window as PilgrimWindow).__pilgrim?.services?.get('input') as InputHandle | undefined;
      input?.resetBindings();
    });
  }
});

test('rebinding never leaves an action without a key', async ({ page }) => {
  // Errors, and the dev warning Settings logs when it has to correct a stored value (e.g. an empty list).
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('[settings]')) warnings.push(msg.text());
  });
  await page.goto('/');
  await waitForReady(page);
  try {
    const result = await page.evaluate(() => {
      const input = (window as PilgrimWindow).__pilgrim?.services?.get('input') as InputHandle;
      const keys = (): Record<string, string[]> =>
        Object.fromEntries(['jump', 'skip', 'use', 'pray'].map((a) => [a, input.getBindings(a)]));
      // Jump onto E: Use would have no key left (Space stays with Skip), so it is refused.
      const toE = input.rebind('jump', 'KeyE');
      const afterRefusal = keys();
      // Adding Q as a second Use key would strand Pray: refused too.
      const addQ = input.rebind('use', 'KeyQ', 1);
      // Use onto Q swaps: Pray takes E.
      const swap = input.rebind('use', 'KeyQ');
      return { toE, afterRefusal, addQ, swap, afterSwap: keys() };
    });
    expect(result.toE).toBe(false);
    expect(result.afterRefusal).toEqual({ jump: ['Space'], skip: ['Space'], use: ['KeyE'], pray: ['KeyQ'] });
    expect(result.addQ).toBe(false);
    expect(result.swap).toBe(true);
    expect(result.afterSwap).toEqual({ jump: ['Space'], skip: ['Space'], use: ['KeyQ'], pray: ['KeyE'] });

    // The stored overrides give back exactly the live bindings.
    await page.reload();
    await waitForReady(page);
    const reloaded = await page.evaluate(() => {
      const input = (window as PilgrimWindow).__pilgrim?.services?.get('input') as InputHandle;
      return { use: input.getBindings('use'), pray: input.getBindings('pray') };
    });
    expect(reloaded).toEqual({ use: ['KeyQ'], pray: ['KeyE'] });
    expect(warnings, warnings.join('\n')).toEqual([]);
  } finally {
    await page.evaluate(() => {
      const input = (window as PilgrimWindow).__pilgrim?.services?.get('input') as InputHandle | undefined;
      input?.resetBindings();
    });
  }
});
