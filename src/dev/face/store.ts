/**
 * IndexedDB CRUD + JSON download/upload for FaceImages.
 *
 * Schema:
 *   DB: 'march-mad-faces'
 *   Object store: 'images' (keyPath: 'name')
 *
 * Mirrors the structure of `../mocap/clip-store.ts` — they're deliberately
 * kept as siblings rather than sharing code so each store can evolve its
 * own validation/migration story.
 */
import type { FaceImage } from './types';

const DB_NAME = 'march-mad-faces';
const DB_VERSION = 1;
const STORE = 'images';

/** Lightweight metadata returned from `listFaces()`. Includes `dataUrl` so
 *  consumers can render thumbnails without a second IDB hit per row. The
 *  data URLs are kept small (~50KB for 512x512 PNG) and there's a hard
 *  cap on saved entries (the user is the cap; UX, not engineering).
 *
 *  `has3D` is true iff the underlying FaceImage has a `mesh3d` field —
 *  consumers (face-editor library grid, dropdown listings) use this to
 *  show a "3D" badge / prefix without pulling the full mesh data. */
export interface FaceMeta {
  name: string;
  capturedAt: string;
  source: 'webcam' | 'upload' | string;
  dataUrl: string;
  has3D: boolean;
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

/** Save (or overwrite) a face by name. */
export async function saveFace(face: FaceImage): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const req = store.put(face);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('saveFace failed'));
  });
}

/** Load a single face, or null if not found. */
export async function loadFace(name: string): Promise<FaceImage | null> {
  const db = await openDB();
  return new Promise<FaceImage | null>((resolve, reject) => {
    const store = tx(db, 'readonly');
    const req = store.get(name);
    req.onsuccess = () => resolve((req.result as FaceImage | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('loadFace failed'));
  });
}

/** List all faces' metadata (with thumbnail data URL). */
export async function listFaces(): Promise<FaceMeta[]> {
  const db = await openDB();
  return new Promise<FaceMeta[]>((resolve, reject) => {
    const store = tx(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => {
      const faces = (req.result as FaceImage[]) ?? [];
      const meta: FaceMeta[] = faces.map((f) => ({
        name: f.name,
        capturedAt: f.capturedAt,
        source: f.source,
        dataUrl: f.dataUrl,
        has3D: !!f.mesh3d && Array.isArray(f.mesh3d.vertices) && f.mesh3d.vertices.length > 0,
      }));
      meta.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      resolve(meta);
    };
    req.onerror = () => reject(req.error ?? new Error('listFaces failed'));
  });
}

/** Remove a face by name. */
export async function deleteFace(name: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const req = store.delete(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteFace failed'));
  });
}

/** Trigger a browser download of `<name>.json`. */
export function exportFaceJSON(face: FaceImage): void {
  const json = JSON.stringify(face, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = face.name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'face-image';
  a.download = `${safe}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read + parse a user-supplied JSON file into a FaceImage. Throws on
 *  schema mismatch — the editor surfaces the message. */
export async function importFaceJSON(file: File): Promise<FaceImage> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Not valid JSON: ${msg}`);
  }
  if (!isFaceImage(parsed)) {
    throw new Error('JSON does not match FaceImage schema');
  }
  return parsed;
}

function isFaceImage(v: unknown): v is FaceImage {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.__version !== 1) return false;
  if (typeof o.name !== 'string') return false;
  if (typeof o.capturedAt !== 'string') return false;
  if (o.source !== 'webcam' && o.source !== 'upload') return false;
  if (typeof o.dataUrl !== 'string') return false;
  if (!o.dataUrl.startsWith('data:image/')) return false;
  // bbox can be null OR an object with 4 numbers.
  if (o.bbox !== null) {
    const b = o.bbox as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') return false;
    for (const k of ['left', 'top', 'right', 'bottom']) {
      if (typeof b[k] !== 'number') return false;
    }
  }
  // Phase 7.7: faceLandmarks is optional. When present it must be a number
  // array of length 478*2 = 956 (or 0 — matches the mesh3d "degenerate
  // canceled scan" allowance for forward-compat). We don't validate the
  // numeric range; downstream consumers tolerate landmarks slightly outside
  // [0,1] and clamp where it matters (mask draw, plane transform).
  if (o.faceLandmarks !== undefined) {
    if (!Array.isArray(o.faceLandmarks)) return false;
    const arr = o.faceLandmarks as unknown[];
    if (arr.length !== 0 && arr.length !== 956) return false;
    if (arr.length % 2 !== 0) return false;
    // Spot-check the first entry is a number — saves a full scan while
    // still rejecting `[null, null, ...]` style mangling.
    if (arr.length > 0 && typeof arr[0] !== 'number') return false;
  }
  // Phase 7.6: mesh3d is optional. When present, validate the shape so a
  // mangled JSON import can't sneak past — but keep it loose enough that
  // a future schema bump (e.g. blendshape baseline) doesn't break round-trip.
  if (o.mesh3d !== undefined) {
    const m = o.mesh3d as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return false;
    if (!Array.isArray(m.vertices)) return false;
    if (!Array.isArray(m.uvs)) return false;
    if (!Array.isArray(m.angles)) return false;
    // Spot-check: vertices is 478 * 3 = 1434, uvs is 478 * 2 = 956. Allow
    // either to be empty (degenerate "scan canceled mid-build" case in
    // future flows) but if non-empty, sizes must match.
    const verts = m.vertices as unknown[];
    const uvs = m.uvs as unknown[];
    if (verts.length > 0 && verts.length !== 1434) return false;
    if (uvs.length > 0 && uvs.length !== 956) return false;
    // Phase 7.8: optional headShape block. Reject if present but malformed —
    // we want a bad import to fail loud, but a missing block is fine
    // (older 3D scans predate this field).
    if (m.headShape !== undefined) {
      const hs = m.headShape as Record<string, unknown> | null;
      if (!hs || typeof hs !== 'object') return false;
      if (typeof hs.aspectWH !== 'number' || !Number.isFinite(hs.aspectWH)) return false;
      if (typeof hs.aspectDH !== 'number' || !Number.isFinite(hs.aspectDH)) return false;
      // Phase 8.5 added aspectDHSource. Optional, but if present must be
      // one of the two known string tags.
      if (hs.aspectDHSource !== undefined) {
        if (hs.aspectDHSource !== 'front-z' && hs.aspectDHSource !== 'profile') return false;
      }
    }
    // Phase 8.4: optional eyeColors block. Same loud-fail-on-malformed
    // rule as headShape. Both ints must be finite (we don't enforce a
    // 0..0xFFFFFF range — Three.js's `Color.setHex` masks high bits, so a
    // legitimate-but-out-of-range value still renders something sensible).
    if (m.eyeColors !== undefined) {
      const ec = m.eyeColors as Record<string, unknown> | null;
      if (!ec || typeof ec !== 'object') return false;
      if (typeof ec.left !== 'number' || !Number.isFinite(ec.left)) return false;
      if (typeof ec.right !== 'number' || !Number.isFinite(ec.right)) return false;
    }
    // Phase 8.5 — additional sampler outputs. All optional; loud-fail on
    // malformed shapes, silent-pass when absent (existing scans without
    // these fields validate fine).
    if (m.skinTone !== undefined && (typeof m.skinTone !== 'number' || !Number.isFinite(m.skinTone))) {
      return false;
    }
    if (m.skinPatches !== undefined) {
      const sp = m.skinPatches as Record<string, unknown> | null;
      if (!sp || typeof sp !== 'object') return false;
      for (const k of ['forehead', 'cheekL', 'cheekR', 'chin']) {
        const v = sp[k];
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return false;
      }
    }
    if (m.lipColor !== undefined) {
      const lc = m.lipColor as Record<string, unknown> | null;
      if (!lc || typeof lc !== 'object') return false;
      if (typeof lc.upper !== 'number' || !Number.isFinite(lc.upper)) return false;
      if (typeof lc.lower !== 'number' || !Number.isFinite(lc.lower)) return false;
    }
    if (m.brows !== undefined) {
      const br = m.brows as Record<string, unknown> | null;
      if (!br || typeof br !== 'object') return false;
      for (const side of ['left', 'right']) {
        const s = br[side] as Record<string, unknown> | undefined;
        if (!s || typeof s !== 'object') return false;
        if (typeof s.color !== 'number' || !Number.isFinite(s.color)) return false;
        if (typeof s.intensity !== 'number' || !Number.isFinite(s.intensity)) return false;
      }
    }
    if (m.beard !== undefined) {
      const bd = m.beard as Record<string, unknown> | null;
      if (!bd || typeof bd !== 'object') return false;
      // We don't enforce all-9-keys-present (forward-compat for adding /
      // dropping regions); just validate any keys that ARE present.
      for (const key of Object.keys(bd)) {
        const v = bd[key] as Record<string, unknown> | undefined;
        if (!v || typeof v !== 'object') return false;
        if (typeof v.density !== 'number' || !Number.isFinite(v.density)) return false;
        if (v.hairColor !== undefined) {
          if (typeof v.hairColor !== 'number' || !Number.isFinite(v.hairColor)) return false;
        }
      }
    }
    if (m.browShape !== undefined) {
      const bs = m.browShape as Record<string, unknown> | null;
      if (!bs || typeof bs !== 'object') return false;
      for (const side of ['left', 'right']) {
        const arr = bs[side];
        if (!Array.isArray(arr)) return false;
        for (const pt of arr as unknown[]) {
          if (!Array.isArray(pt) || pt.length !== 2) return false;
          if (typeof pt[0] !== 'number' || typeof pt[1] !== 'number') return false;
        }
      }
    }
    if (m.eyeShape !== undefined) {
      const es = m.eyeShape as Record<string, unknown> | null;
      if (!es || typeof es !== 'object') return false;
      for (const side of ['left', 'right']) {
        if (es[side] === undefined) continue; // each side optional
        const s = es[side] as Record<string, unknown> | null;
        if (!s || typeof s !== 'object') return false;
        for (const k of ['upperCurve', 'lowerCurve']) {
          const c = s[k];
          if (!Array.isArray(c) || c.length !== 3) return false;
          for (const v of c) if (typeof v !== 'number') return false;
        }
        if (typeof s.opennessRatio !== 'number' || !Number.isFinite(s.opennessRatio)) return false;
      }
    }
    if (m.eyelashes !== undefined) {
      const el = m.eyelashes as Record<string, unknown> | null;
      if (!el || typeof el !== 'object') return false;
      if (typeof el.prominent !== 'boolean') return false;
      if (typeof el.color !== 'number' || !Number.isFinite(el.color)) return false;
      if (typeof el.confidence !== 'number' || !Number.isFinite(el.confidence)) return false;
    }
    if (m.noseShape !== undefined) {
      const ns = m.noseShape as Record<string, unknown> | null;
      if (!ns || typeof ns !== 'object') return false;
      for (const k of ['lengthRatio', 'widthRatio', 'protrusionRatio']) {
        if (typeof ns[k] !== 'number' || !Number.isFinite(ns[k] as number)) return false;
      }
    }
    if (m.hair !== undefined) {
      const h = m.hair as Record<string, unknown> | null;
      if (!h || typeof h !== 'object') return false;
      const validStyles = ['bald', 'receding', 'flat-top', 'afro', 'mohawk', 'headband'];
      if (typeof h.style !== 'string' || !validStyles.includes(h.style)) return false;
      if (typeof h.color !== 'number' || !Number.isFinite(h.color)) return false;
    }
    if (m.hat !== undefined) {
      const h = m.hat as Record<string, unknown> | null;
      if (!h || typeof h !== 'object') return false;
      if (h.detected !== true) return false;
      const validTypes = ['cap-forward', 'cap-backward', 'beanie'];
      if (typeof h.type !== 'string' || !validTypes.includes(h.type)) return false;
      if (typeof h.color !== 'number' || !Number.isFinite(h.color)) return false;
    }
  }
  return true;
}
