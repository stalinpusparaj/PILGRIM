import { defineConfig, type Plugin } from 'vite';

// The project has no @types/node (dev-dependency allowlist, GDD 2.3): Node built-ins are loaded by a
// non-literal dynamic import and typed with the few members used here (as in tests/smoke.spec.ts).
interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface FsPromises {
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  rm(path: string, options: { force: boolean }): Promise<void>;
}
interface PathModule {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
}
async function nodeBuiltin<T>(name: string): Promise<T> {
  const mod: T = await import(name);
  return mod;
}

/** Folder metadata Finder / Explorer leave behind (the names tools/lib/sniff.mjs recognises). */
const OS_METADATA = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/**
 * Vite copies public/ into dist/ as-is, dotfiles included. check-assets ignores genuine OS metadata in
 * public/ (DECISIONS #67), so this removes any file with those names from the build output: a binary
 * .DS_Store (which can list local file names) or anything saved under such a name never ships.
 */
function stripOsMetadata(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'pilgrim:strip-os-metadata',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const [fs, path] = await Promise.all([
        nodeBuiltin<FsPromises>('node:fs/promises'),
        nodeBuiltin<PathModule>('node:path'),
      ]);
      const sweep = async (dir: string): Promise<void> => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await sweep(full);
          else if (entry.isFile() && OS_METADATA.has(entry.name)) await fs.rm(full, { force: true });
        }
      };
      await sweep(path.resolve(root, outDir)); // outDir may be relative to the root or absolute
    },
  };
}

// Build flags (GDD 2.1): VITE_DEMO, VITE_STORE_URL, IGNORANCE_EPILOGUE.
// `vite build --mode demo` reads .env.demo (VITE_DEMO=true).
export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'IGNORANCE_'],
  plugins: [stripOsMetadata()],
  // 5173 when free; otherwise the next free port (another project's dev server may hold 5173).
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
