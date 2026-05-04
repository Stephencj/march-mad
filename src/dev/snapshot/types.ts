// =============================================================================
// SnapshotAPI — the in-page contract a CLI driver (scripts/snapshot.cjs) uses
// to position the camera, drive scene-specific knobs, and grab a PNG out of
// the WebGL canvas.
//
// Each page that has a 3D canvas installs `window.__snapshot` matching this
// interface. Optional methods are present only when the corresponding
// capability flag is true. The driver checks `capabilities` before calling
// optional methods.
// =============================================================================

/** Logical anchor for camera framing. Each page is responsible for resolving
 *  the anchor to a world-space point on its own rig. Pages that don't have
 *  a particular anchor should fall back to the closest reasonable point. */
export type SnapshotCameraTarget =
  | 'head'
  | 'torso'
  | 'feet'
  | 'hand-left'
  | 'hand-right'
  | { x: number; y: number; z: number };

export interface SnapshotCameraOpts {
  /** Logical or world-space anchor. Default: 'head'. */
  target?: SnapshotCameraTarget;
  /** Yaw radians around the target's Y axis. 0 = looking at +Z (front of player). */
  yaw: number;
  /** Pitch radians; 0 = level. Positive tilts the camera up (looks down). */
  pitch: number;
  /** Distance in meters from the target. */
  dist: number;
}

export interface SnapshotCapabilities {
  face: boolean;
  anim: boolean;
  beer: boolean;
  mocap: boolean;
  level: boolean;
}

export interface SnapshotAPI {
  /** Resolves once the page has finished mounting its scene + rig. */
  ready(): Promise<void>;
  /** Position the camera around a logical anchor. */
  setCamera(opts: SnapshotCameraOpts): Promise<void>;
  /** Capture the canvas as a base64 PNG data URL. The CLI driver decodes
   *  and writes to disk. Returns null on failure. */
  capture(): Promise<string | null>;
  /** The page's logical scene name — e.g. 'anim-viewer', 'player-editor'. */
  readonly scene: string;
  /** Capability flags so the driver knows what's safe to call. */
  readonly capabilities: SnapshotCapabilities;

  // ── Optional, presence gated by capabilities ──
  /** Apply the named face from IDB to the rig (face capability). */
  setFace?(name: string): Promise<void>;
  /** Drive a single ARKit blendshape value [0..1] (face capability). */
  setBlendshape?(name: string, value: number): void;
  /** Reset every active blendshape to 0 (face capability). */
  resetBlendshapes?(): void;
  /** Switch the rig to a named animation state. When `opts.freeze` is true,
   *  hold the rig at frame 0 — caller must use stepFrames to advance. */
  setAnimState?(state: string, opts?: { freeze?: boolean }): void;
  /** When frozen, manually tick the rig N frames at fixed dt (1/60s). */
  stepFrames?(n: number): Promise<void>;
  /** Toggle the player's beer can mesh visibility (beer capability). */
  setBeer?(visible: boolean): void;
}

declare global {
  interface Window {
    __snapshot?: SnapshotAPI;
  }
}
