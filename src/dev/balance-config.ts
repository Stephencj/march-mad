/**
 * Mutable runtime knobs for game balance. Game systems read from this object
 * on every access, so changes via the dev overlay take effect immediately.
 *
 * To tune persistently: edit via the dev overlay (F1), Export the JSON, and
 * commit the file alongside any code changes.
 */

export interface BalanceConfig {
  __version: number;
  match: {
    winScore: number;
    shotClock: number;
    onFireDuration: number;
    foulPowerupCharge: number;
  };
  shooting: {
    baseAccuracy: {
      layup: number;
      midRange: number;
      threePointer: number;
      default: number;
    };
    normalRange: number;
    distancePenalty: number;
    contestPenalty: number;
  };
}

const DEFAULTS: BalanceConfig = Object.freeze({
  __version: 1,
  match: Object.freeze({
    winScore: 21,
    shotClock: 24,
    onFireDuration: 15,
    foulPowerupCharge: 15,
  }),
  shooting: Object.freeze({
    baseAccuracy: Object.freeze({
      layup: 0.85,
      midRange: 0.55,
      threePointer: 0.40,
      default: 0.50,
    }),
    normalRange: 8,
    distancePenalty: 1.2,
    contestPenalty: 0.80,
  }),
}) as BalanceConfig;

function cloneDefaults(): BalanceConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export const balanceConfig: BalanceConfig = cloneDefaults();

export function getDefaults(): BalanceConfig {
  return cloneDefaults();
}

export function serializeBalance(): string {
  return JSON.stringify(balanceConfig, null, 2);
}

/**
 * Merge a partial config (parsed from JSON) into the live singleton.
 * Only keys present in DEFAULTS are accepted; unknown keys are silently dropped
 * so stale exports from older versions don't break things. Numbers are coerced;
 * non-numeric values for numeric fields are skipped.
 */
export function applyBalanceJSON(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected an object');
  mergeInto(balanceConfig as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
}

export function resetBalance(): void {
  const fresh = cloneDefaults();
  mergeInto(balanceConfig as unknown as Record<string, unknown>, fresh as unknown as Record<string, unknown>);
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
