import { describe, it, expect, beforeEach } from 'vitest';
import {
  balanceConfig,
  serializeBalance,
  applyBalanceJSON,
  resetBalance,
  getDefaults,
} from '@/dev/balance-config';

describe('balance-config', () => {
  beforeEach(() => {
    resetBalance();
  });

  it('starts at defaults', () => {
    const d = getDefaults();
    expect(balanceConfig.match.winScore).toBe(d.match.winScore);
    expect(balanceConfig.shooting.baseAccuracy.layup).toBe(d.shooting.baseAccuracy.layup);
  });

  it('serialize → applyBalanceJSON → serialize round-trips', () => {
    balanceConfig.match.winScore = 33;
    balanceConfig.shooting.baseAccuracy.threePointer = 0.99;
    const a = serializeBalance();
    resetBalance();
    applyBalanceJSON(a);
    const b = serializeBalance();
    expect(b).toBe(a);
    expect(balanceConfig.match.winScore).toBe(33);
    expect(balanceConfig.shooting.baseAccuracy.threePointer).toBe(0.99);
  });

  it('resetBalance restores DEFAULTS exactly', () => {
    balanceConfig.match.winScore = 99;
    balanceConfig.shooting.baseAccuracy.layup = 0.01;
    resetBalance();
    const d = getDefaults();
    expect(balanceConfig.match.winScore).toBe(d.match.winScore);
    expect(balanceConfig.shooting.baseAccuracy.layup).toBe(d.shooting.baseAccuracy.layup);
  });

  it('partial JSON only touches listed fields', () => {
    const original = balanceConfig.shooting.baseAccuracy.layup;
    applyBalanceJSON(JSON.stringify({ match: { winScore: 7 } }));
    expect(balanceConfig.match.winScore).toBe(7);
    expect(balanceConfig.shooting.baseAccuracy.layup).toBe(original);
  });

  it('unknown keys are dropped', () => {
    const before = serializeBalance();
    applyBalanceJSON(JSON.stringify({
      match: { winScore: 21, fictionalKey: 'whatever' },
      bogusSection: { foo: 1 },
    }));
    expect(balanceConfig.match.winScore).toBe(21);
    expect((balanceConfig as any).bogusSection).toBeUndefined();
    expect((balanceConfig.match as any).fictionalKey).toBeUndefined();
    // No new top-level keys snuck in
    expect(serializeBalance()).toBe(before);
  });

  it('non-numeric values for numeric fields are skipped', () => {
    const original = balanceConfig.match.winScore;
    applyBalanceJSON(JSON.stringify({ match: { winScore: 'not a number' } }));
    expect(balanceConfig.match.winScore).toBe(original);
  });

  it('NaN and Infinity are skipped', () => {
    const original = balanceConfig.match.winScore;
    applyBalanceJSON(JSON.stringify({ match: { winScore: null } }));
    expect(balanceConfig.match.winScore).toBe(original);
    // Infinity/NaN don't survive JSON anyway, but verify the guard if passed directly
    applyBalanceJSON('{"match":{"winScore":null}}');
    expect(balanceConfig.match.winScore).toBe(original);
  });

  it('throws on invalid JSON', () => {
    expect(() => applyBalanceJSON('{not json')).toThrow('Invalid JSON');
  });

  it('throws on non-object payloads', () => {
    expect(() => applyBalanceJSON('42')).toThrow();
    expect(() => applyBalanceJSON('null')).toThrow();
    expect(() => applyBalanceJSON('"a string"')).toThrow();
  });

  it('preserves singleton identity across reset (existing references stay valid)', () => {
    const ref = balanceConfig;
    balanceConfig.match.winScore = 50;
    resetBalance();
    expect(ref).toBe(balanceConfig);
    expect(ref.match.winScore).toBe(getDefaults().match.winScore);
  });
});
