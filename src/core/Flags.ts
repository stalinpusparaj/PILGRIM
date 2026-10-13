/**
 * Build flags (GDD 2.1) and debug URL parameters (GDD 2.15).
 *
 * Build flags come from Vite's `import.meta.env` and are constants after bundling, so code like
 * `if (buildFlags.DEMO)` is tree-shaken. URL parameters are parsed once at startup.
 */
import { services } from './Services';

export interface BuildFlags {
  DEMO: boolean;
  IGNORANCE_EPILOGUE: boolean;
  STORE_URL: string;
  DEV: boolean;
}

export interface UrlParams {
  chapter: string | null;
  waystone: string | null;
  debug: boolean;
  god: boolean;
  skipIntro: boolean;
  lab: boolean;
  music: string | null;
}

/** Everything above, bundled for the service registry. */
export interface FlagsService {
  readonly build: BuildFlags;
  readonly url: UrlParams;
  readonly debug: boolean;
}

declare module './Services' {
  interface ServiceMap {
    flags: FlagsService;
  }
}

/** Ids in the URL (chapter, waystone, music) are short slugs; anything else is ignored. */
const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

function envString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Only absolute http(s) store links are accepted; anything else becomes ''. */
function safeHttpUrl(raw: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export const buildFlags: BuildFlags = Object.freeze({
  DEMO: envString(import.meta.env.VITE_DEMO) === 'true',
  IGNORANCE_EPILOGUE: envString(import.meta.env.IGNORANCE_EPILOGUE) === 'true',
  STORE_URL: safeHttpUrl(envString(import.meta.env.VITE_STORE_URL)),
  DEV: import.meta.env.DEV === true,
});

function idParam(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  return ID_PATTERN.test(value) ? value : null;
}

/** Booleans accept `1` or `true` (any case). Anything else, or absence, is false. */
function boolParam(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  if (raw === null) return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * Parses debug URL params. Pure: pass a search string (with or without the leading `?`);
 * defaults to the current page's `location.search`.
 */
export function parseUrlParams(search?: string): UrlParams {
  const source = search ?? (typeof location !== 'undefined' ? location.search : '');
  const params = new URLSearchParams(source);
  return {
    chapter: idParam(params, 'chapter'),
    waystone: idParam(params, 'waystone'),
    debug: boolParam(params, 'debug'),
    god: boolParam(params, 'god'),
    skipIntro: boolParam(params, 'skipIntro'),
    lab: boolParam(params, 'lab'),
    music: idParam(params, 'music'),
  };
}

const parsed = parseUrlParams();

/** Dev builds, or any build opened with `?debug=1`. Gates the F1 panel, Lab and place mode. */
export const debugEnabled: boolean = buildFlags.DEV || parsed.debug;

/**
 * The page's URL params. Every param is a debug feature (GDD 2.15), so outside dev builds they are
 * ignored unless `?debug=1` is present; a player cannot jump chapters by editing the URL.
 */
export const urlParams: UrlParams = Object.freeze(
  debugEnabled
    ? parsed
    : { chapter: null, waystone: null, debug: false, god: false, skipIntro: false, lab: false, music: null },
);

services.register('flags', Object.freeze({ build: buildFlags, url: urlParams, debug: debugEnabled }));
