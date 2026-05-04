/**
 * Mutable player body proportions. `GamePlayer.createMesh` reads these on
 * each construction, so edits via the dev overlay or the player-editor page
 * take effect on the next player spawned (next match start, or the editor's
 * rebuild button).
 *
 * Animation-domain knobs (state durations, dribble frequency, dunk arc
 * parameters, blend curves) are NOT here — they're a separate iteration's
 * concern with their own playback UI.
 */

export interface PlayerBodyConfig {
  __version: number;
  head: {
    radius: number;
    eyeRadius: number;
    // Per-part position offsets (relative to parent). Exposed so users can
    // re-anchor features when they change head.radius, without writing code.
    positionY: number;       // head sphere Y on the neck (default 0.35)
    eyeOffsetX: number;      // ± distance from head centerline (0.1)
    eyeOffsetY: number;      // eye Y on head face (0.39)
    eyeOffsetZ: number;      // eye Z (how far forward on face) (0.24)
    // Face plane: a flat textured quad that hides the eye-spheres when a
    // captured/uploaded face image has been applied via setFaceImage().
    // Z is on the neck-group; head sphere centers at (0, head.positionY, 0)
    // with radius head.radius, so facePlaneZ should sit just past the front
    // of the head (default head.radius=0.28 → 0.27 hugs the front face).
    facePlaneSize: number;   // 0.5 — width/height of the face plane in meters
    facePlaneZ: number;      // 0.27 — z-offset on neckGroup; just past head sphere front
    headDepthScale: number;  // 0.85 — Z-axis scale on the head sphere; flattens the front-back curvature so the face plane hugs the skin
  };
  body: {
    torsoWidth: number;
    torsoHeight: number;
    torsoDepth: number;
    shoulderBarWidth: number;
    shoulderBarHeight: number;
    shoulderBarDepth: number;
    shoulderCapRadius: number;
    shoulderCapY: number;    // shoulder cap Y on body pivot (0.35)
    shoulderBarY: number;    // shoulder bar Y on body pivot (0.37)
    hipWidth: number;
    hipHeight: number;
    hipDepth: number;
    hipMeshY: number;        // hip mesh (groin) Y on body pivot (-0.05)
    // Beer belly: an ellipsoid bulging out the front of the torso, sized
    // and positioned so it overlaps the lower torso + waistband. Inherits
    // squash/stretch from body-pivot for free.
    bellyRadius: number;     // base sphere radius (0.18)
    bellyScaleY: number;     // vertical scale on the sphere (0.85 = squashed gut)
    bellyScaleZ: number;     // depth scale (1.4 = projects forward)
    bellyY: number;          // belly center Y on body-pivot (0.02)
    bellyZ: number;          // belly center Z (forward of torso) (0.06)
    // G2: Sagging belly second-lobe — old men's bellies hang low and sag.
    // Uses the same shared sphere geometry as the upper belly; only scale
    // + position differ.
    bellyLowerRadius: number;  // sphere radius for the lower lobe (0.16)
    bellyLowerScaleX: number;  // wider than upper lobe (1.2)
    bellyLowerScaleY: number;  // squashed vertically (0.65)
    bellyLowerScaleZ: number;  // project forward (1.2)
    bellyLowerY: number;       // below the existing belly (-0.10)
    bellyLowerZ: number;       // slightly forward (0.08)
    // G2: Soft pec mounds — under the shirt, hash-varied per player so some
    // are flat and others are noticeably saggy. Mirrored at ±pecOffsetX.
    pecRadius: number;         // sphere base radius (0.07)
    pecOffsetX: number;        // ±x from chest centerline (0.10)
    pecY: number;              // upper torso, just below shoulder bar (0.30)
    pecZ: number;              // forward of torso center (0.10)
    pecScaleY: number;         // vertical squash — wider than tall (0.55)
    pecScaleZ: number;         // project forward (1.4)
    // G2: Sloped shoulders — replaces the boxy shoulder-bar with two
    // ellipsoid wedges that taper from neck out to the shoulder caps.
    shoulderSlopeRadius: number;   // sphere base radius (0.10)
    shoulderSlopeOffsetX: number;  // ±x from neck centerline (0.10)
    shoulderSlopeY: number;        // Y on body-pivot (0.34)
    shoulderSlopeScaleX: number;   // extends outward toward shoulder (1.4)
    shoulderSlopeScaleY: number;   // squashed vertically (0.5)
    shoulderSlopeScaleZ: number;   // slightly less depth (0.8)
    // G2: Love handles — ellipsoid bulges on lower-side torso, half-buried
    // in the hip area. Mirrored at ±loveHandleOffsetX.
    loveHandleRadius: number;      // sphere base radius (0.08)
    loveHandleOffsetX: number;     // ±x from torso center (0.18)
    loveHandleY: number;           // waist crease on body-pivot (-0.04)
    loveHandleScaleX: number;      // slightly squashed (0.9)
    loveHandleScaleY: number;      // squashed vertically (0.7)
    loveHandleScaleZ: number;      // slight forward project (1.1)
    // G2: Big ass — squashed sphere on the back of the hips. Hash-varied
    // X-scale per player (0.85–1.25) so some dads have bigger butts.
    buttRadius: number;            // sphere base radius (0.16)
    buttY: number;                 // lower than belly, around hip-back (-0.06)
    buttZ: number;                 // BEHIND the torso (negative Z, -0.10)
    buttScaleX: number;            // wide (1.3)
    buttScaleY: number;            // squashed vertically (0.7)
    buttScaleZ: number;            // project rearward (1.3)
  };
  limbs: {
    upperArmRadiusTop: number;
    upperArmRadiusBottom: number;
    upperArmLength: number;
    forearmRadiusTop: number;
    forearmRadiusBottom: number;
    forearmLength: number;
    upperLegRadiusTop: number;
    upperLegRadiusBottom: number;
    upperLegLength: number;
    lowerLegRadiusTop: number;
    lowerLegRadiusBottom: number;
    lowerLegLength: number;
  };
  shoes: {
    width: number;
    height: number;
    depth: number;
    color: number;
    offsetY: number;         // shoe Y below ankle (-0.04)
    offsetZ: number;         // shoe Z forward of ankle (0.02)
  };
  hair: {
    flatTopWidth: number;
    flatTopHeight: number;
    flatTopDepth: number;
    flatTopY: number;        // flat-top Y on neckGroup (0.60)
    flatTopZ: number;        // flat-top Z (depth) on neckGroup (-0.03)
    afroRadius: number;
    afroY: number;           // afro Y on neckGroup (0.50)
    afroZ: number;           // afro Z (depth) on neckGroup (-0.06)
    mohawkWidth: number;
    mohawkHeight: number;
    mohawkDepth: number;
    mohawkY: number;         // mohawk Y on neckGroup (0.60)
    mohawkZ: number;         // mohawk Z (depth) on neckGroup (-0.03)
    headbandRadius: number;
    headbandThickness: number;
    headbandY: number;       // headband Y on neckGroup (0.48)
    headbandColor: number;
  };
}

/**
 * Defaults — weekend-warrior office-league aesthetic. These values define
 * "Average Middle-Aged Dad" as the baseline: wider torso and deeper belly,
 * slightly slumped shoulders, thinner arms relative to the body, stockier
 * short legs. The old athletic proportions live in the git history (from
 * before the theme pivot); the Mutant transformation in Phase 10 will
 * temporarily revert toward those as the "college-athlete self."
 */
const DEFAULTS: PlayerBodyConfig = Object.freeze({
  __version: 3,
  head: Object.freeze({
    radius: 0.28,
    eyeRadius: 0.04,
    positionY: 0.32,          // sits lower (slight slump, shorter neck)
    eyeOffsetX: 0.1,
    eyeOffsetY: 0.36,         // eyes track with lower head
    eyeOffsetZ: 0.24,
    facePlaneSize: 0.62,      // slightly larger than head diameter (0.56) — head sphere is now hidden when a face is set, so the plane dominates the silhouette
    facePlaneZ: 0.22,         // just inside the new front of the squashed sphere (radius * headDepthScale = 0.238)
    headDepthScale: 0.85,     // squashes head front-to-back so the face plane sits flush across its full width
  }),
  body: Object.freeze({
    torsoWidth: 0.36,         // wider — dad torso
    torsoHeight: 0.36,        // shorter — beer belly drops the ribcage
    torsoDepth: 0.24,         // much deeper — beer belly
    shoulderBarWidth: 0.46,   // slightly wider than athletic to match torso
    shoulderBarHeight: 0.06,
    shoulderBarDepth: 0.13,
    shoulderCapRadius: 0.09,
    shoulderCapY: 0.31,       // slumped shoulders — a couple notches lower
    shoulderBarY: 0.33,       // slumped
    hipWidth: 0.34,           // broader hips
    hipHeight: 0.12,          // more padding
    hipDepth: 0.2,            // deeper — carries the gut
    hipMeshY: -0.07,
    bellyRadius: 0.18,        // a little wider than half-torso so it pokes the sides
    bellyScaleY: 0.85,        // slightly squashed vertically — it's a paunch, not a melon
    bellyScaleZ: 1.4,         // projects forward (this is the bit you see in profile)
    bellyY: 0.02,             // lower-mid torso, drops into the waistband
    bellyZ: 0.06,             // bulges forward of torso center
    // G2: lower-belly sag lobe
    bellyLowerRadius: 0.16,
    bellyLowerScaleX: 1.2,
    bellyLowerScaleY: 0.65,
    bellyLowerScaleZ: 1.2,
    bellyLowerY: -0.10,
    bellyLowerZ: 0.08,
    // G2: pec mounds
    pecRadius: 0.07,
    pecOffsetX: 0.10,
    pecY: 0.30,
    pecZ: 0.10,
    pecScaleY: 0.55,
    pecScaleZ: 1.4,
    // G2: sloped shoulders (replaces boxy shoulder-bar)
    shoulderSlopeRadius: 0.10,
    shoulderSlopeOffsetX: 0.10,
    shoulderSlopeY: 0.34,
    shoulderSlopeScaleX: 1.4,
    shoulderSlopeScaleY: 0.5,
    shoulderSlopeScaleZ: 0.8,
    // G2: love handles
    loveHandleRadius: 0.08,
    loveHandleOffsetX: 0.18,
    loveHandleY: -0.04,
    loveHandleScaleX: 0.9,
    loveHandleScaleY: 0.7,
    loveHandleScaleZ: 1.1,
    // G2: big ass
    buttRadius: 0.16,
    buttY: -0.06,
    buttZ: -0.10,
    buttScaleX: 1.3,
    buttScaleY: 0.7,
    buttScaleZ: 1.3,
  }),
  limbs: Object.freeze({
    upperArmRadiusTop: 0.04,      // slightly thicker but not muscular
    upperArmRadiusBottom: 0.04,   // same — no tapering = soft arm
    upperArmLength: 0.26,         // shorter
    forearmRadiusTop: 0.035,
    forearmRadiusBottom: 0.04,    // widens toward wrist (the opposite of athletic)
    forearmLength: 0.2,           // shorter
    upperLegRadiusTop: 0.08,      // thicker thighs
    upperLegRadiusBottom: 0.06,
    upperLegLength: 0.3,          // shorter
    lowerLegRadiusTop: 0.06,
    lowerLegRadiusBottom: 0.065,  // calves that fill the socks
    lowerLegLength: 0.3,          // shorter
  }),
  shoes: Object.freeze({
    width: 0.14,
    height: 0.08,
    depth: 0.2,
    color: 0xffffff,
    offsetY: -0.04,
    offsetZ: 0.02,
  }),
  hair: Object.freeze({
    flatTopWidth: 0.34,
    flatTopHeight: 0.12,
    flatTopDepth: 0.28,
    flatTopY: 0.60,
    flatTopZ: -0.03,
    afroRadius: 0.32,
    afroY: 0.50,
    afroZ: -0.06,
    mohawkWidth: 0.06,
    mohawkHeight: 0.2,
    mohawkDepth: 0.26,
    mohawkY: 0.60,
    mohawkZ: -0.03,
    headbandRadius: 0.285,
    headbandThickness: 0.06,
    headbandY: 0.48,
    headbandColor: 0xff2222,
  }),
}) as PlayerBodyConfig;

function cloneDefaults(): PlayerBodyConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export const playerConfig: PlayerBodyConfig = cloneDefaults();

export function getDefaults(): PlayerBodyConfig {
  return cloneDefaults();
}

export function serializePlayer(): string {
  return JSON.stringify(playerConfig, null, 2);
}

export function applyPlayerJSON(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected an object');
  mergeInto(playerConfig as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
}

export function resetPlayer(): void {
  const fresh = cloneDefaults();
  mergeInto(playerConfig as unknown as Record<string, unknown>, fresh as unknown as Record<string, unknown>);
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) continue;
    const tv = target[key];
    const sv = source[key];
    if (typeof tv === 'number') {
      if (typeof sv === 'number' && Number.isFinite(sv)) target[key] = sv;
    } else if (tv && typeof tv === 'object' && sv && typeof sv === 'object') {
      mergeInto(tv as Record<string, unknown>, sv as Record<string, unknown>);
    }
  }
}
