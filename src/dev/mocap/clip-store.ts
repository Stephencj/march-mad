/**
 * IndexedDB CRUD + JSON download/upload for MocapClips.
 *
 * Schema:
 *   DB: 'march-mad-mocap'
 *   Object store: 'clips' (keyPath: 'name')
 *
 * No external library — raw IDB is fine for one store with five operations.
 */
import type { MocapClip } from './types';

const DB_NAME = 'march-mad-mocap';
const DB_VERSION = 1;
const STORE = 'clips';

export interface ClipMeta {
  name: string;
  targetAnim: string;
  capturedAt: string;
  frameCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Save (or overwrite) a clip by name. */
export async function saveClip(clip: MocapClip): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const req = store.put(clip);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('saveClip failed'));
  });
}

/** Load a single clip, or null if not found. */
export async function loadClip(name: string): Promise<MocapClip | null> {
  const db = await openDB();
  return new Promise<MocapClip | null>((resolve, reject) => {
    const store = tx(db, 'readonly');
    const req = store.get(name);
    req.onsuccess = () => resolve((req.result as MocapClip | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('loadClip failed'));
  });
}

/** List all clips' metadata (no frame payload — keeps the list cheap). */
export async function listClips(): Promise<ClipMeta[]> {
  const db = await openDB();
  return new Promise<ClipMeta[]>((resolve, reject) => {
    const store = tx(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => {
      const clips = (req.result as MocapClip[]) ?? [];
      const meta: ClipMeta[] = clips.map((c) => ({
        name: c.name,
        targetAnim: c.targetAnim,
        capturedAt: c.capturedAt,
        frameCount: c.frames?.length ?? 0,
      }));
      // Newest-first.
      meta.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      resolve(meta);
    };
    req.onerror = () => reject(req.error ?? new Error('listClips failed'));
  });
}

/** Remove a clip by name. */
export async function deleteClip(name: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const req = store.delete(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteClip failed'));
  });
}

/** Trigger a browser download of `<name>.json`. */
export function exportClipJSON(clip: MocapClip): void {
  const json = JSON.stringify(clip, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Sanitize the filename — IndexedDB will accept anything but the OS won't.
  const safe = clip.name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'mocap-clip';
  a.download = `${safe}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke async so Firefox / Safari have time to finish the download dialog.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read + parse a user-supplied JSON file into a MocapClip. Throws on
 *  schema mismatch — the editor surfaces the message. */
export async function importClipJSON(file: File): Promise<MocapClip> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Not valid JSON: ${msg}`);
  }
  if (!isMocapClip(parsed)) {
    throw new Error('JSON does not match MocapClip schema');
  }
  return parsed;
}

function isMocapClip(v: unknown): v is MocapClip {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.__version !== 1) return false;
  if (typeof o.name !== 'string') return false;
  if (typeof o.targetAnim !== 'string') return false;
  if (typeof o.orientation !== 'string') return false;
  if (typeof o.fps !== 'number') return false;
  if (typeof o.capturedAt !== 'string') return false;
  if (!Array.isArray(o.frames)) return false;
  // Light frame validation — the inner shape is too big to fully verify
  // without slowing imports of large clips.
  if (o.frames.length > 0) {
    const f = o.frames[0] as Record<string, unknown>;
    if (typeof f.t !== 'number') return false;
    if (!Array.isArray(f.world)) return false;
  }
  return true;
}
