/**
 * The project has no @types/node (dev-dependency allowlist, GDD 2.3). The Playwright config needs two
 * functions from node:fs to find Google Chrome wherever macOS put it; declare just those.
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}
