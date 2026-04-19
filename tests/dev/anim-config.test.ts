import { describe, it, expect, beforeEach } from 'vitest';
import {
  animConfig,
  serializeAnim,
  applyAnimJSON,
  resetAnim,
  getDefaults,
} from '@/dev/anim-config';

describe('anim-config', () => {
  beforeEach(() => {
    resetAnim();
  });

  it('starts at defaults', () => {
    const d = getDefaults();
    expect(animConfig.durations.shootDuration).toBe(d.durations.shootDuration);
    expect(animConfig.amplitudes.jump.apexHeight).toBe(d.amplitudes.jump.apexHeight);
    expect(animConfig.poses.idle.kneeLRotX).toBe(d.poses.idle.kneeLRotX);
    expect(animConfig.poses.guard.shoulderLRotX).toBe(d.poses.guard.shoulderLRotX);
  });

  it('defaults match the values that used to be hardcoded in player.ts', () => {
    const d = getDefaults();
    expect(d.durations.stealDuration).toBe(0.6);
    expect(d.durations.shootDuration).toBe(0.4);
    expect(d.durations.dunkDuration).toBe(1.2);
    expect(d.durations.passDuration).toBe(0.35);
    expect(d.durations.jumpDuration).toBe(0.6);
    expect(d.durations.fallDuration).toBe(0.8);
    expect(d.amplitudes.walk.strideAmp).toBe(0.6);
    expect(d.amplitudes.sprint.strideAmp).toBe(0.8);
    expect(d.amplitudes.jump.apexHeight).toBe(1.8);
    expect(d.amplitudes.dunk.apexHeight).toBe(1.2);
    expect(d.poses.idle.kneeLRotX).toBe(0.05);
    expect(d.poses.guard.kneeLRotX).toBe(0.4);
    expect(d.poses.shoot.releaseShoulderR).toBe(-2.6);
  });

  it('serialize → applyAnimJSON → serialize round-trips', () => {
    animConfig.durations.shootDuration = 0.7;
    animConfig.amplitudes.jump.apexHeight = 2.5;
    animConfig.poses.idle.kneeLRotX = 0.22;
    const a = serializeAnim();
    resetAnim();
    applyAnimJSON(a);
    expect(serializeAnim()).toBe(a);
    expect(animConfig.durations.shootDuration).toBe(0.7);
    expect(animConfig.amplitudes.jump.apexHeight).toBe(2.5);
    expect(animConfig.poses.idle.kneeLRotX).toBe(0.22);
  });

  it('resetAnim restores DEFAULTS exactly', () => {
    animConfig.durations.shootDuration = 99;
    animConfig.amplitudes.dunk.apexHeight = 99;
    animConfig.poses.guard.kneeLRotX = 99;
    resetAnim();
    const d = getDefaults();
    expect(animConfig.durations.shootDuration).toBe(d.durations.shootDuration);
    expect(animConfig.amplitudes.dunk.apexHeight).toBe(d.amplitudes.dunk.apexHeight);
    expect(animConfig.poses.guard.kneeLRotX).toBe(d.poses.guard.kneeLRotX);
  });

  it('partial JSON only touches listed fields', () => {
    const originalStride = animConfig.amplitudes.walk.strideAmp;
    applyAnimJSON(JSON.stringify({ durations: { shootDuration: 0.55 } }));
    expect(animConfig.durations.shootDuration).toBe(0.55);
    expect(animConfig.amplitudes.walk.strideAmp).toBe(originalStride);
  });

  it('unknown sections and keys are dropped', () => {
    const before = serializeAnim();
    applyAnimJSON(JSON.stringify({
      durations: { shootDuration: 0.4, fictionalKey: 'whatever' },
      bogusSection: { foo: 1 },
    }));
    expect(animConfig.durations.shootDuration).toBe(0.4);
    expect((animConfig as any).bogusSection).toBeUndefined();
    expect((animConfig.durations as any).fictionalKey).toBeUndefined();
    expect(serializeAnim()).toBe(before);
  });

  it('non-numeric values for numeric fields are skipped', () => {
    const original = animConfig.durations.shootDuration;
    applyAnimJSON(JSON.stringify({ durations: { shootDuration: 'not a number' } }));
    expect(animConfig.durations.shootDuration).toBe(original);
  });

  it('throws on invalid JSON', () => {
    expect(() => applyAnimJSON('{not json')).toThrow('Invalid JSON');
  });

  it('throws on non-object payloads', () => {
    expect(() => applyAnimJSON('42')).toThrow();
    expect(() => applyAnimJSON('null')).toThrow();
  });

  it('preserves singleton identity across reset', () => {
    const ref = animConfig;
    animConfig.durations.shootDuration = 1.0;
    resetAnim();
    expect(ref).toBe(animConfig);
    expect(ref.durations.shootDuration).toBe(getDefaults().durations.shootDuration);
  });

  it('durations, amplitudes, and poses are independently editable', () => {
    applyAnimJSON(JSON.stringify({
      durations: { dunkDuration: 1.5 },
      amplitudes: { jump: { apexHeight: 2.2 } },
      poses: { guard: { kneeLRotX: 0.55 } },
    }));
    expect(animConfig.durations.dunkDuration).toBe(1.5);
    expect(animConfig.amplitudes.jump.apexHeight).toBe(2.2);
    expect(animConfig.poses.guard.kneeLRotX).toBe(0.55);
    expect(animConfig.durations.shootDuration).toBe(getDefaults().durations.shootDuration);
  });
});
