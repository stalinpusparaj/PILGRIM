/**
 * Tiny promise wrapper over IndexedDB (GDD 2.15 "Storage"): one database `pilgrim`, one object store `saves`,
 * string keys, structured-clone values.
 *
 * When IndexedDB is missing or misbehaves (private mode, blocked site data, quota errors, a hung open), the
 * module warns once and switches to an in-memory map for the rest of the session, so callers never have to
 * handle storage errors. Every value read from or written to IndexedDB is mirrored in that map, which keeps
 * what this session has already seen available after a switch.
 */

const DB_NAME = 'pilgrim';
const DB_VERSION = 1;
const STORE = 'saves';
/** Some browsers never fire success or error when storage is blocked. */
const OPEN_TIMEOUT_MS = 4000;

const memory = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let fallback = false;
let warned = false;

/** Opens (once) and returns the database, or null when running on the in-memory fallback. */
export function open(): Promise<IDBDatabase | null> {
  if (fallback) return Promise.resolve(null);
  dbPromise ??= openDatabase();
  return dbPromise;
}

/** Stored value for `key`, or undefined. */
export async function get(key: string): Promise<unknown> {
  if (!fallback) {
    try {
      const value = await withStore('readonly', (store) => store.get(key));
      mirror(key, value);
      return value;
    } catch (err) {
      switchToMemory(err);
    }
  }
  return copy(memory.get(key));
}

/** Stores a structured-clone copy of `value`. Non-cloneable values (functions, DOM nodes) reject. */
export async function put(key: string, value: unknown): Promise<void> {
  if (!fallback) {
    try {
      await withStore('readwrite', (store) => store.put(value, key));
    } catch (err) {
      if (isDataCloneError(err)) throw err;
      switchToMemory(err);
    }
  }
  mirror(key, value);
}

export async function del(key: string): Promise<void> {
  if (!fallback) {
    try {
      await withStore('readwrite', (store) => store.delete(key));
    } catch (err) {
      switchToMemory(err);
    }
  }
  memory.delete(key);
}

export async function keys(): Promise<string[]> {
  if (!fallback) {
    try {
      const all = await withStore('readonly', (store) => store.getAllKeys());
      return all.filter((k): k is string => typeof k === 'string');
    } catch (err) {
      switchToMemory(err);
    }
  }
  return [...memory.keys()];
}

/** False once the session has fallen back to memory (saves will not survive a reload). */
export function isPersistent(): boolean {
  return !fallback;
}

/** Closes the connection. The next call reopens it. */
export function close(): void {
  const pending = dbPromise;
  dbPromise = null;
  void pending?.then((db) => db?.close());
}

// ------------------------------------------------------------------------------------------------ internals

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null, reason?: unknown): void => {
      if (settled) {
        db?.close(); // a late success after the timeout: not used
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!db) {
        dbPromise = null;
        switchToMemory(reason);
      }
      resolve(db);
    };
    const timer = setTimeout(() => finish(null, new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);

    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      finish(null, err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab is upgrading the schema, or the browser dropped the connection: reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      finish(db);
    };
    request.onerror = (ev) => {
      ev.preventDefault(); // handled here; keep it out of the console
      finish(null, request.error);
    };
    // onblocked: an older connection in another tab has not closed yet. The timeout covers a stuck tab.
  });
}

/** Runs one request in its own transaction; resolves with its result once the transaction completes. */
async function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  try {
    return await runOnce(mode, op);
  } catch (err) {
    // The connection was closing (version change, storage cleared): reopen once and retry.
    if (!(err instanceof DOMException && err.name === 'InvalidStateError')) throw err;
    dbPromise = null;
    return runOnce(mode, op);
  }
}

async function runOnce<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  if (!db) throw new Error('IndexedDB is not available');
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = op(tx.objectStore(STORE));
    request.onerror = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      reject(request.error ?? new Error('IndexedDB request failed'));
      try {
        tx.abort();
      } catch {
        // already finished
      }
    };
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function switchToMemory(reason: unknown): void {
  fallback = true;
  close();
  if (warned) return;
  warned = true;
  console.warn('[idb] IndexedDB is not available; saves will only last until the page is closed.', reason);
}

function mirror(key: string, value: unknown): void {
  if (value === undefined) memory.delete(key);
  else memory.set(key, copy(value));
}

function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isDataCloneError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'DataCloneError';
}
