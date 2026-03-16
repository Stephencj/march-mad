import { describe, it, expect } from 'vitest';
import { BettingSystem } from '@/meta/betting';

describe('BettingSystem', () => {
  it('calculates odds based on seed difference (favorite < underdog)', () => {
    const betting = new BettingSystem();

    const odds = betting.calculateOdds(1, 16);
    expect(odds.favorite).toBeLessThan(odds.underdog);

    const closeOdds = betting.calculateOdds(7, 8);
    expect(closeOdds.favorite).toBeLessThan(closeOdds.underdog);
    // Close seeds should have closer odds than distant seeds
    expect(closeOdds.underdog - closeOdds.favorite).toBeLessThan(
      odds.underdog - odds.favorite,
    );
  });

  it('enforces 50% max bet (60 coins with 100 balance fails)', () => {
    const betting = new BettingSystem();
    betting.setBalance(100, 50);

    const result = betting.placeBet('team-a', 60, 0);
    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
    // Balance should be unchanged
    expect(betting.coins).toBe(100);
  });

  it('deducts coins on placement', () => {
    const betting = new BettingSystem();
    betting.setBalance(100, 50);

    const result = betting.placeBet('team-a', 30, 5);
    expect(result.success).toBe(true);
    expect(betting.coins).toBe(70);
    expect(betting.reputation).toBe(45);
    expect(betting.hasBet).toBe(true);
    expect(betting.betTeamId).toBe('team-a');
  });

  it('pays out on win (coins increase)', () => {
    const betting = new BettingSystem();
    betting.setBalance(100, 50);
    betting.placeBet('team-a', 30, 5);
    // After placing: coins = 70, rep = 45

    betting.resolveBet('team-a', 2.0, false);
    // Payout = 30 * 2.0 = 60
    // Coins = 70 + 60 = 130
    expect(betting.coins).toBe(130);
    expect(betting.hasBet).toBe(false);
  });

  it('loses coins+rep on loss', () => {
    const betting = new BettingSystem();
    betting.setBalance(100, 50);
    betting.placeBet('team-a', 30, 5);
    // After placing: coins = 70, rep = 45

    betting.resolveBet('team-b', 2.0, false);
    // Lost — coins stay at 70 (already deducted), rep = 45 - 3 = 42
    expect(betting.coins).toBe(70);
    expect(betting.reputation).toBe(42);
    expect(betting.hasBet).toBe(false);
  });

  it('applies 2x clutch bonus when subbed in and won (30 coins * 2.0 odds * 2x = 120 payout, total = 70 + 120 = 190)', () => {
    const betting = new BettingSystem();
    betting.setBalance(100, 50);
    betting.placeBet('team-a', 30, 5);
    // After placing: coins = 70

    betting.resolveBet('team-a', 2.0, true);
    // Payout = 30 * 2.0 * 2 = 120
    // Total coins = 70 + 120 = 190
    expect(betting.coins).toBe(190);
  });

  it('calculates cash-out amount (> 0 and < full payout)', () => {
    const betting = new BettingSystem();
    betting.setBalance(100, 50);
    betting.placeBet('team-a', 30, 5);

    const cashOutAmount = betting.getCashOutAmount(2.0, 30, 60);
    // 30 * 2.0 * (30/60) * 0.5 = 15
    expect(cashOutAmount).toBeGreaterThan(0);

    const fullPayout = 30 * 2.0;
    expect(cashOutAmount).toBeLessThan(fullPayout);

    // Verify cash-out applies
    const coinsBefore = betting.coins; // 70
    betting.cashOut(2.0, 30, 60);
    expect(betting.coins).toBe(coinsBefore + cashOutAmount);
    expect(betting.hasBet).toBe(false);
  });
});
