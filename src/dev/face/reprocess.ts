/**
 * Phase F3 — Reprocess an existing FaceImage through the Phase 8.5
 * feature-sampling pipeline.
 *
 * The Phase 8.5 samplers (skin tone, lip color, brows, beard, eye shape,
 * eyelashes, nose, hair, hat) populate optional fields on
 * `FaceImage.mesh3d` at scan-accept time. Faces saved BEFORE Phase C
 * landed are missing every one of these fields and render with all-
 * defaults on the rig. This module re-runs the same sampler orchestration
 * on a FaceImage's persisted angle data so old scans pick up the new
 * richness without re-scanning.
 *
 * Usage:
 *   const result = await reprocessFace(face);
 *   await saveFace(result.face);  // persist
 *   console.log(result.diagnostics, result.warnings);
 *
 * The same orchestration runs at scan-accept time (face-editor.ts calls
 * `reprocessFace` on a FaceImage built with raw scan-time angles +
 * already-computed headShape/eyeColors) and at reprocess time (face-editor
 * Reprocess button calls it on a stored FaceImage). One code path = one
 * place to fix bugs.
 *
 * Design choice (Option A from the F3 plan): we DO NOT re-sample iris
 * colors or recompute headShape from scratch. The caller owns those —
 * they're already on Phase 8.4 scans, and the front-Z headShape is the
 * same calc whether we run it here or upstream. We DO refine aspectDH
 * from a profile pose if available (cheap landmark-only math) and DO
 * pass-through any pre-existing eyeColors unchanged.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { FaceImage } from './types';
import { unflattenLandmarks } from './mesh-builder';
import { loadImageToCanvas, type SampleContext } from './sample-utils';
import { sampleSkinTone } from './skin-tone';
import { sampleLipColor } from './lip-color';
import { sampleBrowProminence, sampleBrowShape } from './brow';
import { sampleBeard } from './beard';
import { sampleEyeShape } from './eye-shape';
import { sampleEyelashes } from './eyelash';
import { sampleNose } from './nose-shape';
import { detectHairAndHat } from './hair-hat';
import { refineHeadShapeFromProfile } from './head-shape';

export interface ReprocessDiagnostics {
  skinTone: boolean;
  lipColor: boolean;
  brows: boolean;
  browShape: boolean;
  beard: boolean;
  eyeShape: boolean;
  eyelashes: boolean;
  noseShape: boolean;
  hair: boolean;
  hat: boolean;
  headShapeRefined: boolean;
}

export interface ReprocessResult {
  /** Deep-clone of input with mesh3d augmented. Caller passes to saveFace(). */
  face: FaceImage;
  /** Which samplers populated their fields. */
  diagnostics: ReprocessDiagnostics;
  /** Warnings for samplers that returned null with a probable cause. */
  warnings: string[];
}

/**
 * Run the Phase 8.5 sampler pipeline on a FaceImage's stored mesh3d.angles.
 *
 * Throws if input has no mesh3d.angles (old FaceImage from before Phase
 * 7.6) — caller should surface a helpful message. Per-sampler failures
 * are caught internally and reported via diagnostics + warnings; one
 * sampler going down doesn't kill the whole reprocess.
 */
export async function reprocessFace(face: FaceImage): Promise<ReprocessResult> {
  // 1. Validate input.
  if (!face.mesh3d || !Array.isArray(face.mesh3d.angles) || face.mesh3d.angles.length === 0) {
    throw new Error(
      'Cannot reprocess: this face has no mesh3d.angles — was it saved before Phase 7.6 (3D scan)?',
    );
  }
  const frontFlat = face.mesh3d.angles.find((a) => a.poseName === 'front');
  if (!frontFlat) {
    throw new Error(
      'Cannot reprocess: mesh3d.angles has no front-pose entry — required for sampler input.',
    );
  }
  if (!frontFlat.landmarks || frontFlat.landmarks.length < 478 * 3) {
    throw new Error(
      `Cannot reprocess: front-pose landmarks length ${frontFlat.landmarks?.length ?? 0} ` +
        '(expected 1434 = 478 × 3).',
    );
  }

  // 2. Deep-clone so we don't mutate the input. Spread is fine here —
  //    mesh3d is plain JSON-shaped data (no class instances, no functions).
  const cloned: FaceImage = JSON.parse(JSON.stringify(face));
  // After clone, narrow mesh3d again for TypeScript.
  if (!cloned.mesh3d) throw new Error('reprocessFace: mesh3d lost in clone');

  // 3. Re-inflate front-pose landmarks for samplers.
  const lm: NormalizedLandmark[] = unflattenLandmarks(frontFlat.landmarks);

  // 4. Track diagnostics + warnings. We start every flag at false and flip
  //    it on successful sampler return.
  const diagnostics: ReprocessDiagnostics = {
    skinTone: false,
    lipColor: false,
    brows: false,
    browShape: false,
    beard: false,
    eyeShape: false,
    eyelashes: false,
    noseShape: false,
    hair: false,
    hat: false,
    headShapeRefined: false,
  };
  const warnings: string[] = [];

  // 5. Run the orchestration. This is the same logic as face-editor.ts's
  //    meshAcceptBtn handler from before refactoring — kept here as the
  //    single source of truth.
  let skinTone: number | undefined;
  let skinPatchesOut:
    | { forehead: number | null; cheekL: number | null; cheekR: number | null; chin: number | null }
    | undefined;
  let lipColorOut: { upper: number; lower: number } | undefined;
  let browsOut:
    | { left: { color: number; intensity: number }; right: { color: number; intensity: number } }
    | undefined;
  let browShapeOut:
    | { left: Array<[number, number]>; right: Array<[number, number]> }
    | undefined;
  let beardOut: ReturnType<typeof sampleBeard> | null = null;
  let eyeShapeOut: ReturnType<typeof sampleEyeShape> | null = null;
  let eyelashesOut: { prominent: boolean; color: number; confidence: number } | undefined;
  let noseShapeOut:
    | { lengthRatio: number; widthRatio: number; protrusionRatio: number }
    | undefined;
  let hairOut:
    | {
        style: 'bald' | 'receding' | 'flat-top' | 'afro' | 'mohawk' | 'headband';
        color: number;
      }
    | undefined;
  let hatOut:
    | { detected: true; type: 'cap-forward' | 'cap-backward' | 'beanie'; color: number }
    | undefined;
  let aspectDHRefined: number | undefined;
  let aspectDHSource: 'front-z' | 'profile' | undefined;

  try {
    // Build the canvas-context once per image. The optional profile
    // contexts feed the eyelash sampler's confidence boost when at least
    // one profile pose is present in the stored angles.
    const sCtx: SampleContext = await loadImageToCanvas(frontFlat.imageDataUrl);
    const profileLeftFlat = cloned.mesh3d.angles.find((a) => a.poseName === 'profile-left');
    const profileRightFlat = cloned.mesh3d.angles.find((a) => a.poseName === 'profile-right');
    let profileLeftCtx: SampleContext | undefined;
    let profileRightCtx: SampleContext | undefined;
    let profileLeftLandmarks: NormalizedLandmark[] | undefined;
    let profileRightLandmarks: NormalizedLandmark[] | undefined;
    try {
      if (profileLeftFlat) {
        profileLeftCtx = await loadImageToCanvas(profileLeftFlat.imageDataUrl);
        profileLeftLandmarks = unflattenLandmarks(profileLeftFlat.landmarks);
      }
    } catch {
      profileLeftCtx = undefined;
      profileLeftLandmarks = undefined;
    }
    try {
      if (profileRightFlat) {
        profileRightCtx = await loadImageToCanvas(profileRightFlat.imageDataUrl);
        profileRightLandmarks = unflattenLandmarks(profileRightFlat.landmarks);
      }
    } catch {
      profileRightCtx = undefined;
      profileRightLandmarks = undefined;
    }

    // Per-sampler best-effort wrapper. Modules are designed to return null
    // on failure rather than throw, but this is belt-and-suspenders for
    // the rare unhandled exception.
    const safe = <T>(fn: () => T): T | null => {
      try {
        return fn();
      } catch (err) {
        console.warn('reprocess: sampler threw, skipping', err);
        return null;
      }
    };

    // Face-local bbox from the four core landmarks (normalized image
    // coords). Samplers needing face-local coords (brow shape, eye shape,
    // nose) divide by this.
    const faceBbox = safe(() => {
      const xs = [lm[10].x, lm[152].x, lm[234].x, lm[454].x];
      const ys = [lm[10].y, lm[152].y, lm[234].y, lm[454].y];
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
    });
    if (!faceBbox) {
      throw new Error('reprocess: face bbox construction failed (missing core landmarks)');
    }

    const skinResult = safe(() => sampleSkinTone(sCtx, lm));
    skinTone = skinResult?.tone;
    skinPatchesOut = skinResult?.patches;
    diagnostics.skinTone = skinTone !== undefined;
    if (skinTone === undefined) {
      warnings.push(
        'skin-tone sampler returned null — all 4 patches likely rejected (poor lighting, ' +
          'heavy makeup, or face partly occluded). Downstream samplers that depend on skin ' +
          'tone (lip, brow prominence, beard, eyelashes, hair/hat) will be skipped.',
      );
    }
    const skinToneVal = skinTone ?? null;

    const lipColorRaw =
      skinToneVal !== null ? safe(() => sampleLipColor(sCtx, lm, skinToneVal)) : null;
    lipColorOut = lipColorRaw ?? undefined;
    diagnostics.lipColor = !!lipColorOut;
    if (skinToneVal !== null && !lipColorOut) {
      warnings.push('lip-color sampler returned null (lip pixels indistinguishable from skin).');
    }

    const browsRaw = safe(() => sampleBrowProminence(sCtx, lm, skinToneVal));
    browsOut = browsRaw ?? undefined;
    diagnostics.brows = !!browsOut;

    const browShapeRaw = safe(() => sampleBrowShape(lm, faceBbox));
    browShapeOut = browShapeRaw ?? undefined;
    diagnostics.browShape = !!browShapeOut;

    beardOut = skinToneVal !== null ? safe(() => sampleBeard(sCtx, lm, skinToneVal)) : null;
    diagnostics.beard = !!beardOut;

    eyeShapeOut = safe(() => sampleEyeShape(lm, faceBbox));
    diagnostics.eyeShape = !!eyeShapeOut;

    if (skinToneVal !== null) {
      const eyelashRaw = safe(() =>
        sampleEyelashes(sCtx, lm, faceBbox, skinToneVal, {
          profileLeftCtx,
          profileLeftLandmarks,
          profileRightCtx,
          profileRightLandmarks,
        }),
      );
      eyelashesOut = eyelashRaw ?? undefined;
    }
    diagnostics.eyelashes = !!eyelashesOut;

    const noseRaw = safe(() => sampleNose(lm, faceBbox));
    noseShapeOut = noseRaw ?? undefined;
    diagnostics.noseShape = !!noseShapeOut;

    if (skinToneVal !== null) {
      const hairHat = safe(() => detectHairAndHat(sCtx, lm, faceBbox, skinToneVal)) ?? {};
      hairOut = hairHat.hair;
      hatOut = hairHat.hat;
    }
    diagnostics.hair = !!hairOut;
    diagnostics.hat = !!hatOut;

    // Refine aspectDH from a profile pose if available. We pass the
    // already-stored aspectDH as the fallback (the function returns null
    // if no profile pose exists, in which case we leave headShape alone).
    const currentAspectDH = cloned.mesh3d.headShape?.aspectDH ?? 0.25;
    const refined = refineHeadShapeFromProfile(cloned.mesh3d.angles, currentAspectDH);
    if (refined) {
      // Same clamp [0.10, 0.65] used at scan-accept time so consumers
      // don't have to handle wildly different ranges between sources.
      aspectDHRefined = Math.max(0.1, Math.min(0.65, refined.aspectDH));
      aspectDHSource = refined.aspectDHSource;
      diagnostics.headShapeRefined = aspectDHSource === 'profile';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`feature pipeline threw: ${msg} — saving with partial data`);
    console.warn('reprocess: feature pipeline threw, saving with partial data', err);
  }

  // 6. Augment mesh3d on the cloned face. We REPLACE prior values for
  //    fields we resampled (so a re-run on a partially-Phase-8.5 face
  //    refreshes them) and PASS THROUGH eyeColors / vertices / uvs /
  //    angles / faceLandmarks unchanged.
  const m = cloned.mesh3d;

  // Helper: assign-or-delete based on whether we got a value. We delete
  // any prior value when the new sample is undefined so a degraded re-
  // sample doesn't leave stale data behind. (Exception: headShape.aspectDH
  // — we only OVERWRITE if we got a profile refine. Front-Z value stays.)
  if (skinTone !== undefined) m.skinTone = skinTone;
  else delete m.skinTone;
  if (skinPatchesOut) m.skinPatches = skinPatchesOut;
  else delete m.skinPatches;
  if (lipColorOut) m.lipColor = lipColorOut;
  else delete m.lipColor;
  if (browsOut) m.brows = browsOut;
  else delete m.brows;
  if (browShapeOut) m.browShape = browShapeOut;
  else delete m.browShape;
  if (beardOut) m.beard = beardOut;
  else delete m.beard;
  if (eyeShapeOut) m.eyeShape = eyeShapeOut;
  else delete m.eyeShape;
  if (eyelashesOut) m.eyelashes = eyelashesOut;
  else delete m.eyelashes;
  if (noseShapeOut) m.noseShape = noseShapeOut;
  else delete m.noseShape;
  if (hairOut) m.hair = hairOut;
  else delete m.hair;
  if (hatOut) m.hat = hatOut;
  else delete m.hat;

  // headShape: only override aspectDH if we got a profile refine. Keep
  // aspectWH as-is. If no headShape exists at all (degenerate input),
  // leave it absent rather than fabricating one — `setFaceMesh3D` falls
  // back to the rig default sphere.
  if (aspectDHRefined !== undefined && m.headShape) {
    m.headShape = {
      ...m.headShape,
      aspectDH: aspectDHRefined,
      aspectDHSource: aspectDHSource ?? m.headShape.aspectDHSource,
    };
  }

  // eyeColors: pass through unchanged. The clone already has it.

  return { face: cloned, diagnostics, warnings };
}
