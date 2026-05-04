/**
 * Persisted face-image record. One per saved entry in the
 * `march-mad-faces` IndexedDB store. The `name` doubles as the IDB key, so
 * it must be unique (the editor surfaces overwrite confirmation).
 *
 * Phase 7 just persists the cropped image + the bounding box that
 * FaceLandmarker reported on the original capture (translated into the
 * cropped image's local 0..1 coords). Phase 8 will reuse `bbox` to know
 * where the eyes/mouth land for live puppeting.
 *
 * Phase 7.6 adds the optional `mesh3d` field — when present, the entry was
 * captured via the multi-pose 3D Scan flow and carries enough data to
 * reconstruct a full 478-vertex face mesh (geometry + UVs) plus the four
 * side captures reserved for a future multi-angle texture blend (Phase 7.7).
 * The flat-image path keeps `dataUrl` as the front-pose photo so existing
 * library thumbnails and the flat fallback render unchanged.
 */
export interface FaceImage {
  __version: 1;
  /** Author-supplied name (used as IDB key). */
  name: string;
  /** ISO timestamp. */
  capturedAt: string;
  /** Source: 'webcam' (snapshot) | 'upload' (file). */
  source: 'webcam' | 'upload';
  /** PNG data URL of the cropped face image (square aspect). For 3D-scan
   *  entries this is the FRONT-pose photo, used both as the flat fallback
   *  and the texture for the 3D mesh. */
  dataUrl: string;
  /** Detected face bounding box on the original capture, in the cropped
   *  image's local coords (0..1). Useful for Phase 8 to know where the
   *  eyes/mouth land. May be null if FaceLandmarker didn't detect a face
   *  (e.g. on stylized AI-generated images that don't read as faces). */
  bbox: { left: number; top: number; right: number; bottom: number } | null;
  /**
   * Phase 7.7: 478 landmark x,y positions (image-space, 0..1) detected on
   * the cropped face image at capture time. Flat array, [x0,y0,x1,y1,...]
   * — length 478 * 2 = 956. Coordinates are in the cropped image's local
   * 0..1 space (matching `bbox`), NOT the raw input frame. Optional because:
   *   - Old saves predate this field
   *   - Stylized AI-generated uploads where FaceLandmarker fails
   * When present, drives precise face-mask + plane-anatomy alignment in
   * `setFaceImage`. When absent, runtime falls back to the radial-fade
   * + centered-plane behavior.
   */
  faceLandmarks?: number[];
  /** OPTIONAL Phase 7.6 3D mesh data. Present iff the entry was captured
   *  via the multi-pose 3D Scan flow. Stored as plain number arrays for
   *  JSON portability (Float32Array doesn't survive structured-clone via
   *  IDB cleanly across browsers, and JSON export needs human-readable). */
  mesh3d?: {
    /** Front-pose vertex positions, raw (pre-normalization) MediaPipe
     *  landmark space. 478 * 3 = 1434 numbers, [x0,y0,z0,x1,y1,z1,...].
     *  Mesh-builder converts to Three.js coords on load. */
    vertices: number[];
    /** Front-pose UVs, image-space (0..1). 478 * 2 = 956 numbers,
     *  [u0,v0,u1,v1,...]. Mesh-builder flips V to match THREE.TextureLoader. */
    uvs: number[];
    /** All five captured angles (front + 4 sides). The front entry is
     *  redundant with `vertices`/`uvs`/`dataUrl` but kept here for
     *  uniformity; future Phase 7.7 multi-angle blend reads the side
     *  captures' image+landmark pairs to project lateral skin into the
     *  texture. v1 only USES the front entry — the sides are storage. */
    angles: Array<{
      poseName: 'front' | 'left' | 'right' | 'up' | 'down' | 'profile-left' | 'profile-right';
      imageDataUrl: string;
      /** 478 normalized landmarks at this angle, flat: 478 * 3. */
      landmarks: number[];
    }>;
    /** Phase 7.8: head proportions inferred from the front-pose landmarks
     *  at scan time. Used by `setFaceMesh3D` to scale the head sphere
     *  per-face so the underlying silhouette (visible behind/around the
     *  mesh from non-front angles) matches the user's actual head
     *  proportions. Optional for backward compatibility — old scans
     *  without it use the rig's default spherical head. */
    headShape?: {
      /** width/height aspect — face cheek-to-cheek width over forehead-to-chin
       *  height. Typical 0.70–0.85 (people have taller-than-wide faces). */
      aspectWH: number;
      /** depth/height aspect — nose-tip Z depth relative to ear-line over
       *  face height. Typical 0.55–0.85 (deep-set vs flat profiles). */
      aspectDH: number;
      /** Phase 8.5: which capture this aspectDH was inferred from. The
       *  profile-based measurement is more accurate (true X-axis depth);
       *  front-z is a relative-Z fallback used when no profile pose is
       *  available. */
      aspectDHSource?: 'front-z' | 'profile';
    };
    /** Phase 8.4: iris colors sampled from the front-pose photo at scan
     *  accept time. Stored as packed 0xRRGGBB ints. Optional — old saves
     *  and AI-uploads fall back to default brown irises. */
    eyeColors?: { left: number; right: number };
    /** Phase 8.5: skin tone sampled from forehead/cheek/chin patches.
     *  `skinTone` is the combined surviving-patch mean; `skinPatches`
     *  preserves per-patch values for future region-local tuning. */
    skinTone?: number;
    skinPatches?: {
      forehead: number | null;
      cheekL: number | null;
      cheekR: number | null;
      chin: number | null;
    };
    /** Phase 8.5: lip color, separate upper/lower. */
    lipColor?: { upper: number; lower: number };
    /** Phase 8.5: brow color + how prominent (0..1) per side. */
    brows?: {
      left: { color: number; intensity: number };
      right: { color: number; intensity: number };
    };
    /** Phase 8.5: beard / facial-hair zones — color + density per region.
     *  Density 0..1 is the fraction of textured-darker-than-skin pixels in
     *  the region. Always populated for every region (default density 0)
     *  when present, so consumers don't need to null-check each zone. */
    beard?: Record<BeardRegion, { hairColor?: number; density: number }>;
    /** Phase 8.5: brow shape — 5 sample points per side, in face-local
     *  0..1 coords. */
    browShape?: {
      left: Array<[number, number]>;
      right: Array<[number, number]>;
    };
    /** Phase 8.5: eye shape — quadratic fit per lid + openness ratio. */
    eyeShape?: {
      left?: {
        upperCurve: [number, number, number];
        lowerCurve: [number, number, number];
        opennessRatio: number;
      };
      right?: {
        upperCurve: [number, number, number];
        lowerCurve: [number, number, number];
        opennessRatio: number;
      };
    };
    /** Phase 8.5: eyelash detection — only set when prominent. */
    eyelashes?: { prominent: boolean; color: number; confidence: number };
    /** Phase 8.5: nose proportions, all normalized to face dimensions. */
    noseShape?: {
      lengthRatio: number;
      widthRatio: number;
      protrusionRatio: number;
    };
    /** Phase 8.5: hair color + classified style (one of the rig's 6
     *  procedural styles). Mutually exclusive with `hat`. */
    hair?: {
      style: 'bald' | 'receding' | 'flat-top' | 'afro' | 'mohawk' | 'headband';
      color: number;
    };
    /** Phase 8.5: hat presence + type. When set, hides hair. */
    hat?: {
      detected: true;
      type: 'cap-forward' | 'cap-backward' | 'beanie';
      color: number;
    };
    /** Phase H1 — stylized per-feature crops baked from the front photo +
     *  landmarks. Each crop is a small posterized PNG ready for the H2
     *  Mii-style renderer to paste onto a textured plane. Optional because
     *  old saves predate baking; reprocess will populate it. Per-feature
     *  fields beard/mustache/hat are themselves optional inside the bundle
     *  — the baker omits them when the photo region didn't yield enough
     *  signal (e.g. clean-shaven user → no beard crop). */
    featureImages?: FeatureImagesBundle;
  };
}

/**
 * Phase H1 — a single baked feature crop. The dataUrl is a small PNG
 * (RGBA) of the stylized photo region for one feature; srcBbox records the
 * pixel rectangle on the source photo that fed the crop (handy for
 * debugging or re-baking at higher fidelity later); center3D / size3D are
 * the mesh-local rest position + rest size for this feature, computed from
 * the landmark set used for the bbox. The H2 renderer mounts a PlaneGeometry
 * at center3D sized to size3D and textures it with the dataUrl.
 *
 * 3D coords follow the existing buildFaceMesh convention:
 *   x_three = x_mp - 0.5
 *   y_three = -(y_mp - 0.5)
 *   z_three = -z_mp
 */
export interface FaceFeatureCrop {
  /** PNG data URL of the stylized crop (RGBA). */
  dataUrl: string;
  /** Pixel bbox on the source photo this crop was sampled from. */
  srcBbox: { x: number; y: number; w: number; h: number };
  /** Mesh-local 3D rest center derived from landmarks (Three.js coords). */
  center3D: { x: number; y: number; z: number };
  /** Mesh-local 3D rest size (width, height) derived from the bbox. */
  size3D: { w: number; h: number };
}

export interface FeatureImagesBundle {
  leftEye: FaceFeatureCrop;
  rightEye: FaceFeatureCrop;
  leftBrow: FaceFeatureCrop;
  rightBrow: FaceFeatureCrop;
  nose: FaceFeatureCrop;
  mouth: FaceFeatureCrop;
  beard?: FaceFeatureCrop;
  mustache?: FaceFeatureCrop;
  hat?: FaceFeatureCrop;
  /** Phase H2c — composite face plate. ONE alpha-composited PNG covering
   *  the face area (chin to forehead) with skin tone as the base, plus
   *  nose / beard / mustache regions baked in with soft-edge masks. When
   *  present, the renderer mounts this as a single textured plane on the
   *  cranium front and SKIPS individual nose/beard/mustache planes (which
   *  read as photo-rectangle artifacts). Eyes/brows/mouth still mount as
   *  alpha-masked overlay planes on TOP of the plate. Optional for
   *  backward compatibility — old saves without it fall back to the per-
   *  feature plane layout. */
  facePlate?: FaceFeatureCrop;
}

/** Beard / facial-hair region tags. Used as keys on `mesh3d.beard`. */
export type BeardRegion =
  | 'chin'
  | 'underChin'
  | 'mustache'
  | 'cheekL'
  | 'cheekR'
  | 'sideburnL'
  | 'sideburnR'
  | 'jawlineL'
  | 'jawlineR';
