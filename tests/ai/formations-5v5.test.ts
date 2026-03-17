import { describe, it, expect } from 'vitest';
import { FORMATIONS_5V5, getFormation5v5 } from '@/ai/formations-5v5';

describe('5v5 Formations', () => {
  it('has spread, tight, balanced, and triangle formations', () => {
    expect(Object.keys(FORMATIONS_5V5)).toContain('spread');
    expect(Object.keys(FORMATIONS_5V5)).toContain('tight');
    expect(Object.keys(FORMATIONS_5V5)).toContain('balanced');
    expect(Object.keys(FORMATIONS_5V5)).toContain('triangle');
  });

  it('each formation has exactly 5 positions', () => {
    for (const [name, positions] of Object.entries(FORMATIONS_5V5)) {
      expect(positions).toHaveLength(5);
    }
  });

  it('getFormation5v5 returns positions for a formation', () => {
    const pos = getFormation5v5('spread');
    expect(pos).toHaveLength(5);
    expect(pos[0]).toHaveProperty('x');
    expect(pos[0]).toHaveProperty('z');
  });

  it('defense formations mirror toward the hoop', () => {
    const def = getFormation5v5('balanced', true);
    expect(def).toHaveLength(5);
    // Defensive positions should be closer to hoop (lower z values)
    const avgZ = def.reduce((s, p) => s + p.z, 0) / 5;
    const offAvgZ = getFormation5v5('balanced', false).reduce((s, p) => s + p.z, 0) / 5;
    expect(avgZ).toBeLessThan(offAvgZ);
  });
});
