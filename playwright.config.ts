import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

/**
 * Smoke tests run headless in the installed Google Chrome (no browser download; DECISIONS #6) against the
 * Vite dev server. The Chrome flags keep WebGL alive headless: ANGLE on Metal (GPU) on macOS, SwiftShader
 * (software GL) elsewhere, with the GPU blocklist ignored so CI and older GPUs still get a context.
 */

// The project has no @types/node (dev-dependency allowlist, GDD 2.3), so reach Node through typed globals.
interface NodeGlobals {
  process?: { platform?: string; env?: Record<string, string | undefined> };
  require?: (id: string) => unknown;
}
const node = globalThis as unknown as NodeGlobals;
const platform = node.process?.platform;

const chromeArgs =
  platform === 'darwin'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// A dedicated port (not Vite's default 5173), and never reuse a running server: another project's dev
// server on a shared port would otherwise be tested by mistake.
// PILGRIM_TEST_PORT moves the test server off 5317 when that port is taken by something else.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const PORT = Number(env?.['PILGRIM_TEST_PORT']) || 5317;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Google Chrome, wherever macOS put it: Playwright's 'chrome' channel only looks at /Applications/Google
 * Chrome.app, but the app may be renamed (e.g. "Google Chrome 2.app") after an update. CHROME_PATH overrides.
 */
function findChrome(): { channel?: 'chrome'; executablePath?: string } {
  const env = node.process?.env?.['CHROME_PATH'];
  if (env) return { executablePath: env };
  if (platform !== 'darwin') return { channel: 'chrome' };
  const stock = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try {
    if (existsSync(stock)) return { channel: 'chrome' };
    const app = readdirSync('/Applications').find((n: string) => /^(Google )?Chrome.*\.app$/.test(n));
    if (app) return { executablePath: `/Applications/${app}/Contents/MacOS/Google Chrome` };
  } catch {
    /* fall through */
  }
  return { channel: 'chrome' };
}
const chrome = findChrome();

export default defineConfig({
  testDir: 'tests',
  // The Tamil phone QA sweep (tests/qa-tamil.spec.ts, ~30 min) runs only on demand: QA=1 npx playwright test qa-tamil.
  testIgnore: env?.['QA'] ? [] : ['**/qa-tamil.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    ...(chrome.channel ? { channel: chrome.channel } : {}),
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: chromeArgs,
      ...(chrome.executablePath ? { executablePath: chrome.executablePath } : {}),
    },
  },
  webServer: {
    // Generate the icons first so favicon.svg and the manifest exist even when Playwright is run directly.
    command: `node tools/gen-icons.mjs && npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
