import { describe, it, expect } from 'vitest';
import { SIGNATURE_MOVES, getSignatureMove } from '@/data/signature-moves';

describe('signature moves data', () => {
  it('has at least 5 moves', () => {
    expect(SIGNATURE_MOVES.length).toBeGreaterThanOrEqual(5);
  });

  it('each move has name (truthy), cooldown (> 0), and effect (truthy)', () => {
    for (const move of SIGNATURE_MOVES) {
      expect(move.name).toBeTruthy();
      expect(move.cooldown).toBeGreaterThan(0);
      expect(move.effect).toBeTruthy();
    }
  });

  it('retrieves move by name — getSignatureMove("Ankle Breaker") returns truthy with cooldown > 0', () => {
    const move = getSignatureMove('Ankle Breaker');
    expect(move).toBeTruthy();
    expect(move!.cooldown).toBeGreaterThan(0);
  });
});
