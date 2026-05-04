/**
 * IndexedDB CRUD + JSON import/export for `FaceAnimClip` records.
 *
 * Mirrors the structure of `./store.ts` (faces) and `../mocap/clip-store.ts`
 * (pose clips) — kept as a sibling rather than a generic helper so each
 * store can evolve its own validation/migration story.
 *
 * Schema:
 *   DB: 'march-mad-face-anims'
 *   Object store: 'clips' (keyPath: 'name')
 */
import {
  isFaceAnimClip,
  type FaceAnimClip,
  type FaceAnimMeta,
} from './face-anim-clip';

const DB_NAME = 'march-mad-face-anims';
const DB_VERSION = 1;
const STORE = 'clips';

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

/** Save (or overwrite) a face-anim clip by name.
 *
 *  Phase 8.2a: when `clip.videoBlob` is present, IndexedDB stores the Blob
 *  natively via the structured-clone algorithm — no base64 round-trip
 *  needed. A 12-second 720p WebM (~5 MB) is well within IDB's per-record
 *  budget; modern browsers grant IDB tens to hundreds of MB even before
 *  prompting for persistent storage. */
export async function saveFaceAnim(clip: FaceAnimClip): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    // The clip object — including any `videoBlob` — is passed through to
    // structured-clone; the browser handles Blob serialization for us.
    const req = store.put(clip);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('saveFaceAnim failed'));
  });
}

/** Load a single clip by name, or null if not found. */
export async function loadFaceAnim(name: string): Promise<FaceAnimClip | null> {
  const db = await openDB();
  return new Promise<FaceAnimClip | null>((resolve, reject) => {
    const store = tx(db, 'readonly');
    const req = store.get(name);
    req.onsuccess = () => resolve((req.result as FaceAnimClip | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('loadFaceAnim failed'));
  });
}

/** List clip metadata for the dropdown UI. Sorted by capturedAt desc.
 *
 *  Phase 8.2a: includes `hasVideo` so consumers (Face Mirror clip list,
 *  anim-viewer/player-editor pickers) can render a "VIDEO" badge or
 *  enable the source-video toggle without round-tripping the full Blob.
 *  Note `getAll()` returns the full record including any `videoBlob`,
 *  so the metadata transform below intentionally drops the heavy field. */
export async function listFaceAnims(): Promise<FaceAnimMeta[]> {
  const db = await openDB();
  return new Promise<FaceAnimMeta[]>((resolve, reject) => {
    const store = tx(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => {
      const clips = (req.result as FaceAnimClip[]) ?? [];
      const meta: FaceAnimMeta[] = clips.map((c) => ({
        name: c.name,
        capturedAt: c.capturedAt,
        frameCount: c.frames.length,
        durationSec: c.fps > 0 ? c.frames.length / c.fps : 0,
        fps: c.fps,
        hasVideo: c.videoBlob instanceof Blob && c.videoBlob.size > 0,
      }));
      meta.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      resolve(meta);
    };
    req.onerror = () => reject(req.error ?? new Error('listFaceAnims failed'));
  });
}

/** Remove a clip by name. */
export async function deleteFaceAnim(name: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const req = store.delete(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteFaceAnim failed'));
  });
}

/** Encode a Blob into a base64 data URL for JSON export. Chunks the
 *  base64 conversion to avoid `String.fromCharCode(...largeArray)`
 *  blowing the call stack on Chrome (~125k arg limit). 32KB chunks keep
 *  us comfortably under that on every browser we target.
 *
 *  Phase 8.2a: a 12s 720p WebM is ~5 MB raw → ~6.7 MB base64; the chunked
 *  loop runs ~205 iterations and finishes in single-digit ms. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32 KB — well under the call-stack-arg ceiling
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode(...slice);
  }
  const b64 = btoa(bin);
  // Use the Blob's recorded type when available so the data URL round-trips
  // back to the same MIME on import. Default to webm — that's what the
  // mirror's MediaRecorder emits.
  const mime = blob.type || 'video/webm';
  return `data:${mime};base64,${b64}`;
}

/** Trigger a browser download of `<name>.json`.
 *
 *  Phase 8.2a: when the clip carries a `videoBlob`, base64-encode it into
 *  `videoDataUrl` on the JSON output. The Blob itself is stripped — Blobs
 *  don't JSON-serialize natively (`JSON.stringify(blob)` returns `{}`).
 *  For long recordings the resulting JSON is multi-MB; we log the size so
 *  the user isn't surprised by the download. */
export function exportFaceAnimJSON(clip: FaceAnimClip): void {
  // Build the JSON payload. The async path only runs when video is present;
  // the fast path stays synchronous so older video-less clips don't pay
  // for the encode.
  if (clip.videoBlob) {
    void exportWithVideo(clip);
    return;
  }
  triggerJsonDownload(clip.name, JSON.stringify(stripVideoFields(clip), null, 1));
}

async function exportWithVideo(clip: FaceAnimClip): Promise<void> {
  const dataUrl = await blobToDataUrl(clip.videoBlob!);
  // Output shape: spread the clip (sans Blob) then attach the data URL.
  const out = {
    ...stripVideoFields(clip),
    videoMimeType: clip.videoMimeType ?? clip.videoBlob?.type ?? 'video/webm',
    videoStartOffsetMs: clip.videoStartOffsetMs ?? 0,
    videoDataUrl: dataUrl,
  };
  const json = JSON.stringify(out, null, 1);
  // Log file size — for a 12s clip this is ~7 MB, which feels heavy but
  // is acceptable for a per-clip debug export. Documented in the task brief.
  // eslint-disable-next-line no-console
  console.log(
    `[face-anim] exporting "${clip.name}" with embedded video — ` +
      `JSON size: ${(json.length / (1024 * 1024)).toFixed(2)} MB ` +
      `(video Blob: ${(clip.videoBlob!.size / (1024 * 1024)).toFixed(2)} MB)`,
  );
  triggerJsonDownload(clip.name, json);
}

/** Strip the runtime-only Blob field from a clip so it can be JSON-serialized. */
function stripVideoFields(clip: FaceAnimClip): Omit<FaceAnimClip, 'videoBlob'> {
  // Destructure-and-discard pattern — the eslint disable keeps the unused
  // `_videoBlob` from tripping the no-unused-vars rule.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { videoBlob: _videoBlob, ...rest } = clip;
  return rest;
}

function triggerJsonDownload(clipName: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = clipName.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'face-anim';
  a.download = `${safe}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read + parse a user-supplied JSON file into a FaceAnimClip.
 *
 *  Phase 8.2a: when the JSON carries a `videoDataUrl` (base64-encoded
 *  source video), decode it back to a Blob and attach as `videoBlob` so
 *  IDB / replay paths see the same shape as a freshly-recorded clip. */
export async function importFaceAnimJSON(file: File): Promise<FaceAnimClip> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Not valid JSON: ${msg}`);
  }
  if (!isFaceAnimClip(parsed)) {
    throw new Error('JSON does not match FaceAnimClip schema');
  }
  const clip = parsed as FaceAnimClip & { videoDataUrl?: string };
  if (clip.videoDataUrl) {
    try {
      // fetch() handles the data: URL → Blob conversion natively, including
      // base64 decode. Equivalent to a manual atob+Uint8Array+Blob ctor but
      // shorter and the browser's implementation is well-tested.
      const resp = await fetch(clip.videoDataUrl);
      const blob = await resp.blob();
      clip.videoBlob = blob;
      if (!clip.videoMimeType) clip.videoMimeType = blob.type || 'video/webm';
    } catch (err) {
      // Don't fail the whole import — the blendshape clip is still useful
      // even if the embedded video can't be reconstructed.
      console.warn('importFaceAnimJSON: failed to decode videoDataUrl', err);
    }
    // Drop the data URL — the Blob is the canonical in-memory form.
    delete clip.videoDataUrl;
  }
  return clip;
}

export { isFaceAnimClip };
