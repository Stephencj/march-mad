import { describe, it, expect, beforeEach } from 'vitest';
import {
  playerConfig,
  serializePlayer,
  applyPlayerJSON,
  resetPlayer,
  getDefaults,
} from '@/dev/player-config';

describe('player-config', () => {
  beforeEach(() => {
    resetPlayer();
  });

  it('starts at defaults', () => {
    const d = getDefaults();
    expect(playerConfig.head.radius).toBe(d.head.radius);
    expect(playerConfig.body.torsoWidth).toBe(d.body.torsoWidth);
    expect(playerConfig.limbs.upperArmLength).toBe(d.limbs.upperArmLength);
    expect(playerConfig.hair.afroRadius).toBe(d.hair.afroRadius);
  });

  it('serialize → applyPlayerJSON → serialize round-trips', () => {
    playerConfig.head.radius = 0.45;
    playerConfig.limbs.upperArmLength = 0.5;
    const a = serializePlayer();
    resetPlayer();
    applyPlayerJSON(a);
    expect(serializePlayer()).toBe(a);
    expect(playerConfig.head.radius).toBe(0.45);
    expect(playerConfig.limbs.upperArmLength).toBe(0.5);
  });

  it('resetPlayer restores DEFAULTS exactly', () => {
    playerConfig.head.radius = 99;
    playerConfig.body.torsoWidth = 99;
    resetPlayer();
    const d = getDefaults();
    expect(playerConfig.head.radius).toBe(d.head.radius);
    expect(playerConfig.body.torsoWidth).toBe(d.body.torsoWidth);
  });

  it('partial JSON only touches listed fields', () => {
    const original = playerConfig.body.torsoHeight;
    applyPlayerJSON(JSON.stringify({ head: { radius: 0.31 } }));
    expect(playerConfig.head.radius).toBe(0.31);
    expect(playerConfig.body.torsoHeight).toBe(original);
  });

  it('unknown sections and keys are dropped', () => {
    const before = serializePlayer();
    applyPlayerJSON(JSON.stringify({
      head: { radius: 0.28, fictionalKey: 'whatever' },
      bogusSection: { foo: 1 },
    }));
    expect(playerConfig.head.radius).toBe(0.28);
    expect((playerConfig as any).bogusSection).toBeUndefined();
    expect((playerConfig.head as any).fictionalKey).toBeUndefined();
    expect(serializePlayer()).toBe(before);
  });

  it('non-numeric values for numeric fields are skipped', () => {
    const original = playerConfig.head.radius;
    applyPlayerJSON(JSON.stringify({ head: { radius: 'not a number' } }));
    expect(playerConfig.head.radius).toBe(original);
  });

  it('throws on invalid JSON', () => {
    expect(() => applyPlayerJSON('{not json')).toThrow('Invalid JSON');
  });

  it('throws on non-object payloads', () => {
    expect(() => applyPlayerJSON('42')).toThrow();
    expect(() => applyPlayerJSON('null')).toThrow();
  });

  it('preserves singleton identity across reset', () => {
    const ref = playerConfig;
    playerConfig.head.radius = 1.0;
    resetPlayer();
    expect(ref).toBe(playerConfig);
    expect(ref.head.radius).toBe(getDefaults().head.radius);
  });

  it('hair, shoes, and limbs are independently editable', () => {
    applyPlayerJSON(JSON.stringify({
      hair: { afroRadius: 0.5 },
      shoes: { color: 0xff0000 },
      limbs: { upperArmLength: 0.4 },
    }));
    expect(playerConfig.hair.afroRadius).toBe(0.5);
    expect(playerConfig.shoes.color).toBe(0xff0000);
    expect(playerConfig.limbs.upperArmLength).toBe(0.4);
    expect(playerConfig.head.radius).toBe(getDefaults().head.radius);
  });
});
