import { describe, it, expect, beforeEach } from 'vitest';
import {
  levelConfig,
  serializeLevel,
  applyLevelJSON,
  resetLevel,
  getDefaults,
} from '@/dev/level-config';

describe('level-config', () => {
  beforeEach(() => {
    resetLevel();
  });

  it('starts at defaults', () => {
    const d = getDefaults();
    expect(levelConfig.court.width).toBe(d.court.width);
    expect(levelConfig.hoop.rimHeight).toBe(d.hoop.rimHeight);
    expect(levelConfig.colors.floor).toBe(d.colors.floor);
    expect(levelConfig.lighting.ambientIntensity).toBe(d.lighting.ambientIntensity);
  });

  it('serialize → applyLevelJSON → serialize round-trips', () => {
    levelConfig.court.width = 22;
    levelConfig.hoop.rimHeight = 3.5;
    const a = serializeLevel();
    resetLevel();
    applyLevelJSON(a);
    expect(serializeLevel()).toBe(a);
    expect(levelConfig.court.width).toBe(22);
    expect(levelConfig.hoop.rimHeight).toBe(3.5);
  });

  it('resetLevel restores DEFAULTS exactly', () => {
    levelConfig.court.width = 99;
    levelConfig.colors.floor = 0xff0000;
    resetLevel();
    const d = getDefaults();
    expect(levelConfig.court.width).toBe(d.court.width);
    expect(levelConfig.colors.floor).toBe(d.colors.floor);
  });

  it('partial JSON only touches listed fields', () => {
    const original = levelConfig.court.length;
    applyLevelJSON(JSON.stringify({ court: { width: 17 } }));
    expect(levelConfig.court.width).toBe(17);
    expect(levelConfig.court.length).toBe(original);
  });

  it('unknown sections and keys are dropped', () => {
    const before = serializeLevel();
    applyLevelJSON(JSON.stringify({
      court: { width: 15, fictionalKey: 'whatever' },
      bogusSection: { foo: 1 },
    }));
    expect(levelConfig.court.width).toBe(15);
    expect((levelConfig as any).bogusSection).toBeUndefined();
    expect((levelConfig.court as any).fictionalKey).toBeUndefined();
    expect(serializeLevel()).toBe(before);
  });

  it('non-numeric values for numeric fields are skipped', () => {
    const original = levelConfig.court.width;
    applyLevelJSON(JSON.stringify({ court: { width: 'not a number' } }));
    expect(levelConfig.court.width).toBe(original);
  });

  it('throws on invalid JSON', () => {
    expect(() => applyLevelJSON('{not json')).toThrow('Invalid JSON');
  });

  it('throws on non-object payloads', () => {
    expect(() => applyLevelJSON('42')).toThrow();
    expect(() => applyLevelJSON('null')).toThrow();
  });

  it('preserves singleton identity across reset', () => {
    const ref = levelConfig;
    levelConfig.court.width = 50;
    resetLevel();
    expect(ref).toBe(levelConfig);
    expect(ref.court.width).toBe(getDefaults().court.width);
  });

  it('hoop section is independently editable', () => {
    applyLevelJSON(JSON.stringify({ hoop: { homeZ: -10, awayZ: 10 } }));
    expect(levelConfig.hoop.homeZ).toBe(-10);
    expect(levelConfig.hoop.awayZ).toBe(10);
    expect(levelConfig.hoop.rimHeight).toBe(getDefaults().hoop.rimHeight);
  });
});
