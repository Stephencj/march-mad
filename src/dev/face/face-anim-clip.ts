/**
 * Phase 8 — Face animation clip types.
 *
 * A FaceAnimClip is a time-ordered sequence of MediaPipe ARKit blendshape
 * coefficient sets (e.g. `mouthSmileLeft: 0.62`). At playback time the
 * `BlendshapePuppet` mutates a 3D face mesh's vertex positions per frame to
 * reproduce the recorded expression sequence.
 *
 * Frames are stored sparsely — each frame only carries the names whose
 * coefficient is meaningfully non-zero (see `SPARSE_THRESHOLD` in the
 * recorder). MediaPipe emits all 52 ARKit blendshapes every frame, but the
 * vast majority are ~0 when the user's not actively expressing — storing
 * dense 52-key maps wastes ~4× the JSON size for no signal.
 *
 * Size budget: 60s of 30fps recording with average 6 active blendshapes per
 * frame is ~1800 frames × ~6 keys × ~25 bytes = ~270KB JSON. Comfortably
 * inside IndexedDB's per-record budget.
 */

export interface FaceAnimClip {
  __version: 1;
  /** Author-supplied name. Doubles as the IDB key — uniqueness enforced by
   *  the editor (overwrite confirm). */
  name: string;
  /** ISO timestamp of when the recording was finished. */
  capturedAt: string;
  /** Effective fps the clip was recorded at — `frames.length / duration`.
   *  Replay drives the clip at this fps so motion matches the original. */
  fps: number;
  /** Frames in time order. Each entry is a sparse map of ARKit blendshape
   *  name → coefficient (0..1). Names not present this frame are treated as
   *  0 by the puppet. Sparse to save storage; the dense array would be
   *  52 × 4 bytes × N frames even when most values are noise-floor zeros. */
  frames: Array<Record<string, number>>;
  /** Phase 8.2a: Optional source webcam Blob recorded synchronously with
   *  the blendshape frames. Stored as-is in IndexedDB (which natively
   *  supports Blob — no base64 needed). When exporting to JSON for
   *  portability, the Blob is base64-encoded into a `videoDataUrl` string
   *  on the JSON output (see exportFaceAnimJSON / importFaceAnimJSON).
   *  A 12-second 720p WebM is roughly 5 MB raw / ~6.7 MB base64-inflated. */
  videoBlob?: Blob;
  /** MIME type of `videoBlob` (e.g., 'video/webm;codecs=vp9' or
   *  'video/webm'). Tracked separately because Blob.type can be empty when
   *  MediaRecorder emits chunks without an explicit mimeType. */
  videoMimeType?: string;
  /** Approximate sync offset between video.t=0 and frames[0].t=0, in ms.
   *  MediaRecorder.start() and the first blendshape frame fire on
   *  consecutive event-loop ticks; offset is typically 0–30ms but recording
   *  it lets the replay sync precisely. Positive means the first blendshape
   *  frame arrived this many ms AFTER recorder.start(). */
  videoStartOffsetMs?: number;
}

/** Lightweight metadata shape returned by `listFaceAnims()`. Mirrors the
 *  pattern used by mocap clips and faces. Keeps thumbnails out of the way —
 *  face-anim clips don't have a natural thumbnail (they're sequences of
 *  blendshape coefficients), so consumers display name + frameCount + duration. */
export interface FaceAnimMeta {
  name: string;
  capturedAt: string;
  /** Total recorded frames. */
  frameCount: number;
  /** Recording duration in seconds (frameCount / fps). */
  durationSec: number;
  /** Effective fps as captured. */
  fps: number;
  /** Phase 8.2a: true when the clip carries a synchronized source video
   *  Blob alongside its blendshape frames. UI uses this to surface a
   *  "VIDEO" badge so the user can pick clips that support side-by-side
   *  comparison without round-tripping the full Blob. */
  hasVideo: boolean;
}

/** Validator for JSON imports — rejects junk early so a corrupt file doesn't
 *  silently produce a clip with NaN frames. Mirrors the shape-check style
 *  used by `isFaceImage` in face/store.ts.
 *
 *  Phase 8.2a: the optional `videoBlob` / `videoMimeType` / `videoStartOffsetMs`
 *  fields are tolerated when present and absent (backward compat with v1
 *  clips recorded before the video-sync feature). The JSON form also accepts
 *  `videoDataUrl: string` (base64-encoded Blob) — `importFaceAnimJSON`
 *  decodes that into `videoBlob` after validation. */
export function isFaceAnimClip(v: unknown): v is FaceAnimClip {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.__version !== 1) return false;
  if (typeof o.name !== 'string' || o.name.length === 0) return false;
  if (typeof o.capturedAt !== 'string') return false;
  if (typeof o.fps !== 'number' || !Number.isFinite(o.fps) || o.fps <= 0) return false;
  if (!Array.isArray(o.frames)) return false;
  // Spot-check the frames shape: each entry must be a plain object whose
  // values are numbers. We only check the first frame to keep this O(1) on
  // long clips; downstream replay will skip non-finite values defensively.
  if (o.frames.length > 0) {
    const first = o.frames[0];
    if (typeof first !== 'object' || first === null) return false;
    for (const k of Object.keys(first as object)) {
      const val = (first as Record<string, unknown>)[k];
      if (typeof val !== 'number') return false;
    }
  }
  // Phase 8.2a: tolerate (but don't require) the video-sync fields. When
  // present, type-check them — junk fields shouldn't poison the validator.
  if (o.videoMimeType !== undefined && typeof o.videoMimeType !== 'string') return false;
  if (
    o.videoStartOffsetMs !== undefined &&
    (typeof o.videoStartOffsetMs !== 'number' || !Number.isFinite(o.videoStartOffsetMs))
  ) {
    return false;
  }
  // `videoBlob` is only ever present on IDB-loaded records (Blobs don't
  // survive JSON serialization). `videoDataUrl` is the JSON-side carrier.
  // Either may be absent; if present, must be the right primitive type.
  if (
    'videoDataUrl' in o &&
    o.videoDataUrl !== undefined &&
    typeof o.videoDataUrl !== 'string'
  ) {
    return false;
  }
  return true;
}
