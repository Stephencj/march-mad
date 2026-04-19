/**
 * Mutable court/hoop/lighting knobs. `createFullCourt` and related factories
 * read from this singleton on every call, so edits via the dev overlay and
 * the level editor page take effect the next time a court is built.
 *
 * Gameplay coupling: `court.width`, `court.length`, `hoop.homeZ`, `hoop.awayZ`,
 * and `hoop.rimHeight` are referenced by gameplay systems (player bounds,
 * AI pathing, scoring). Edits to these can break gameplay — the editor
 * surfaces them with a warning badge.
 */

export interface LevelConfig {
  __version: number;
  court: {
    width: number;
    length: number;
    paintWidth: number;
    paintLength: number;
    threePointRadius: number;
    centerCircleRadius: number;
    checkBallLine: number;
    lineHeight: number;
    plankStripeSpacing: number;
  };
  hoop: {
    homeZ: number;
    awayZ: number;
    rimHeight: number;
    rimRadius: number;
    backboardWidth: number;
    backboardHeight: number;
  };
  colors: {
    floor: number;
    plankStripe: number;
    line: number;
  };
  lighting: {
    ambientIntensity: number;
    directionalIntensity: number;
    directionalX: number;
    directionalY: number;
    directionalZ: number;
  };
}

const DEFAULTS: LevelConfig = Object.freeze({
  __version: 1,
  court: Object.freeze({
    width: 15,
    length: 28,
    paintWidth: 3.6,
    paintLength: 5.8,
    threePointRadius: 6.75,
    centerCircleRadius: 1.8,
    checkBallLine: 5,
    lineHeight: 0.02,
    plankStripeSpacing: 0.5,
  }),
  hoop: Object.freeze({
    homeZ: -13,
    awayZ: 13,
    rimHeight: 3.05,
    rimRadius: 0.35,
    backboardWidth: 2.7,
    backboardHeight: 1.58,
  }),
  colors: Object.freeze({
    floor: 0xe8b960,
    plankStripe: 0xd4a84b,
    line: 0xffffff,
  }),
  lighting: Object.freeze({
    ambientIntensity: 0.6,
    directionalIntensity: 0.8,
    directionalX: 5,
    directionalY: 20,
    directionalZ: 0,
  }),
}) as LevelConfig;

function cloneDefaults(): LevelConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export const levelConfig: LevelConfig = cloneDefaults();

export function getDefaults(): LevelConfig {
  return cloneDefaults();
}

export function serializeLevel(): string {
  return JSON.stringify(levelConfig, null, 2);
}

/**
 * Merge a partial config (parsed from JSON) into the live singleton.
 * Only keys present in DEFAULTS are accepted; unknown keys are silently dropped.
 */
export function applyLevelJSON(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected an object');
  mergeInto(levelConfig as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
}

export function resetLevel(): void {
  const fresh = cloneDefaults();
  mergeInto(levelConfig as unknown as Record<string, unknown>, fresh as unknown as Record<string, unknown>);
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
