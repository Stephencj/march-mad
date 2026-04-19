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
  };
  body: {
    torsoWidth: number;
    torsoHeight: number;
    torsoDepth: number;
    shoulderBarWidth: number;
    shoulderBarHeight: number;
    shoulderBarDepth: number;
    shoulderCapRadius: number;
    hipWidth: number;
    hipHeight: number;
    hipDepth: number;
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
  };
  hair: {
    flatTopWidth: number;
    flatTopHeight: number;
    flatTopDepth: number;
    afroRadius: number;
    mohawkWidth: number;
    mohawkHeight: number;
    mohawkDepth: number;
    headbandRadius: number;
    headbandThickness: number;
    headbandColor: number;
  };
}

const DEFAULTS: PlayerBodyConfig = Object.freeze({
  __version: 1,
  head: Object.freeze({
    radius: 0.28,
    eyeRadius: 0.04,
  }),
  body: Object.freeze({
    torsoWidth: 0.28,
    torsoHeight: 0.4,
    torsoDepth: 0.16,
    shoulderBarWidth: 0.42,
    shoulderBarHeight: 0.06,
    shoulderBarDepth: 0.12,
    shoulderCapRadius: 0.08,
    hipWidth: 0.28,
    hipHeight: 0.1,
    hipDepth: 0.15,
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
  }),
  hair: Object.freeze({
    flatTopWidth: 0.34,
    flatTopHeight: 0.12,
    flatTopDepth: 0.28,
    afroRadius: 0.32,
    mohawkWidth: 0.06,
    mohawkHeight: 0.2,
    mohawkDepth: 0.26,
    headbandRadius: 0.285,
    headbandThickness: 0.06,
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
