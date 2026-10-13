import { defineConfig } from '@playwright/test';

/**
 * Smoke tests run headless in the installed Google Chrome (no browser download; DECISIONS #6) against the
 * Vite dev server. The Chrome flags keep WebGL alive headless: ANGLE on Metal (GPU) on macOS, SwiftShader
 * (software GL) elsewhere, with the GPU blocklist ignored so CI and older GPUs still get a context.
 */

// The project has no @types/node (dev-dependency allowlist, GDD 2.3), so read the platform defensively.
const platform = (globalThis as unknown as { process?: { platform?: string } }).process?.platform;

const chromeArgs =
  platform === 'darwin'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// A dedicated port (not Vite's default 5173), and never reuse a running server: another project's dev
// server on a shared port would otherwise be tested by mistake.
const PORT = 5317;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: chromeArgs },
  },
  webServer: {
    // Generate the icons first so favicon.svg and the manifest exist even when Playwright is run directly.
    command: `node tools/gen-icons.mjs && npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
