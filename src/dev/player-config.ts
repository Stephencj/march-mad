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

const DEFAULTS: PlayerBodyConfig = Object.freeze({
  __version: 1,
  head: Object.freeze({
    radius: 0.28,
    eyeRadius: 0.04,
    positionY: 0.35,
    eyeOffsetX: 0.1,
    eyeOffsetY: 0.39,
    eyeOffsetZ: 0.24,
  }),
  body: Object.freeze({
    torsoWidth: 0.28,
    torsoHeight: 0.4,
    torsoDepth: 0.16,
    shoulderBarWidth: 0.42,
    shoulderBarHeight: 0.06,
    shoulderBarDepth: 0.12,
    shoulderCapRadius: 0.08,
    shoulderCapY: 0.35,
    shoulderBarY: 0.37,
    hipWidth: 0.28,
    hipHeight: 0.1,
    hipDepth: 0.15,
    hipMeshY: -0.05,
  }),
  limbs: Object.freeze({
    upperArmRadiusTop: 0.035,
    upperArmRadiusBottom: 0.04,
    upperArmLength: 0.28,
    forearmRadiusTop: 0.03,
    forearmRadiusBottom: 0.035,
    forearmLength: 0.22,
    upperLegRadiusTop: 0.06,
    upperLegRadiusBottom: 0.05,
    upperLegLength: 0.35,
    lowerLegRadiusTop: 0.05,
    lowerLegRadiusBottom: 0.06,
    lowerLegLength: 0.35,
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
