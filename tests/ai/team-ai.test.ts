import { describe, it, expect } from 'vitest';
import { TeamAI, TeamPlay, TeamContext, FORMATIONS } from '@/ai/team-ai';

function makeContext(overrides: Partial<TeamContext> = {}): TeamContext {
  return {
    possession: 'home',
    scoreDiff: 0,
    clockSeconds: 120,
    ...overrides,
  };
}

describe('TeamAI', () => {
  it('Run & Gun favors fast tempo', () => {
    const ai = new TeamAI('Run & Gun');
    let fastCount = 0;
    for (let i = 0; i < 50; i++) {
      const play = ai.choosePlay(makeContext());
      if (play.tempo === 'fast') fastCount++;
    }
    expect(fastCount).toBeGreaterThan(25);
  });

  it('Fortress favors tight defensive formation', () => {
    const ai = new TeamAI('Fortress');
    let tightCount = 0;
    for (let i = 0; i < 50; i++) {
      const play = ai.choosePlay(makeContext());
      if (play.formation === 'tight') tightCount++;
    }
    expect(tightCount).toBeGreaterThan(25);
  });

  it('Sharpshooters spread the floor', () => {
    const ai = new TeamAI('Sharpshooters');
    let spreadCount = 0;
    for (let i = 0; i < 50; i++) {
      const play = ai.choosePlay(makeContext());
      if (play.formation === 'spread') spreadCount++;
    }
    expect(spreadCount).toBeGreaterThan(25);
  });

  it('Inside Beasts prefer the paint zone', () => {
    const ai = new TeamAI('Inside Beasts');
    let paintCount = 0;
    for (let i = 0; i < 50; i++) {
      const play = ai.choosePlay(makeContext());
      if (play.preferredZone === 'paint') paintCount++;
    }
    expect(paintCount).toBeGreaterThan(25);
  });

  it('Chaos team is unpredictable (multiple tempos across 50 trials)', () => {
    const ai = new TeamAI('Chaos');
    const tempos = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const play = ai.choosePlay(makeContext());
      tempos.add(play.tempo);
    }
    expect(tempos.size).toBeGreaterThanOrEqual(2);
  });

  it('getFormationPositions returns 3 positions with x,z coordinates', () => {
    const positions = TeamAI.getFormationPositions('spread');
    expect(positions).toHaveLength(3);
    for (const pos of positions) {
      expect(pos).toHaveProperty('x');
      expect(pos).toHaveProperty('z');
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.z).toBe('number');
    }
  });
});
