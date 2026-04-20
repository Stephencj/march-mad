import type { CrowdLevel } from '@/core/types';
import type { SubInStageName } from '@/systems/sub-in';

const CROWD_COLORS: Record<CrowdLevel, string> = {
  CALM: '#4caf50',
  ENGAGED: '#8bc34a',
  HYPED: '#ffeb3b',
  ROWDY: '#ff9800',
  CHAOS: '#f44336',
};

const SUB_IN_STYLES: Record<SubInStageName, { color: string; fontSize: string; fontWeight: string }> = {
  subtle: { color: '#ffffff', fontSize: '14px', fontWeight: 'normal' },
  pulsing: { color: '#ffc107', fontSize: '18px', fontWeight: 'bold' },
  urgent: { color: '#ff5722', fontSize: '22px', fontWeight: 'bold' },
  'last-stand': { color: '#f44336', fontSize: '28px', fontWeight: 'bold' },
};

export class HUD {
  private container: HTMLElement;
  private scoreEl: HTMLElement;
  private clockEl: HTMLElement;
  private shotClockEl: HTMLElement;
  private powerupEl: HTMLElement;
  private crowdEl: HTMLElement;
  private subInEl: HTMLElement;
  private chargeBarContainer: HTMLElement;
  private chargeBarFill: HTMLElement;
  private staminaBarContainer: HTMLElement;
  private staminaBarFill: HTMLElement;
  private controllerIcon: HTMLElement;
  private knockdownEl: HTMLElement;
  private buffBannerEl: HTMLElement;
  private buffHintEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scoreEl = document.createElement('div');
    this.scoreEl.dataset.hudRole = 'score';
    Object.assign(this.scoreEl.style, {
      position: 'absolute', top: '10px', left: '50%',
      transform: 'translateX(-50%)', fontSize: '32px',
      fontWeight: 'bold', color: 'white',
      textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
      fontFamily: 'sans-serif', zIndex: '10',
    });

    this.clockEl = document.createElement('div');
    this.clockEl.dataset.hudRole = 'clock';
    Object.assign(this.clockEl.style, {
      position: 'absolute', top: '50px', left: '50%',
      transform: 'translateX(-50%)', fontSize: '20px',
      color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
      fontFamily: 'sans-serif', zIndex: '10',
    });

    this.shotClockEl = document.createElement('div');
    this.shotClockEl.dataset.hudRole = 'shot-clock';
    Object.assign(this.shotClockEl.style, {
      position: 'absolute', top: '10px', right: '20px',
      fontSize: '24px', fontWeight: 'bold', color: 'white',
      textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
      fontFamily: 'sans-serif', zIndex: '10',
    });

    this.powerupEl = document.createElement('div');
    this.powerupEl.dataset.hudRole = 'powerup';
    this.powerupEl.style.display = 'none';

    this.crowdEl = document.createElement('div');
    this.crowdEl.dataset.hudRole = 'crowd';

    this.subInEl = document.createElement('div');
    this.subInEl.dataset.hudRole = 'sub-in';
    this.subInEl.style.display = 'none';

    this.container.appendChild(this.scoreEl);
    this.container.appendChild(this.clockEl);
    this.container.appendChild(this.shotClockEl);
    this.container.appendChild(this.powerupEl);
    this.container.appendChild(this.crowdEl);
    this.container.appendChild(this.subInEl);

    // Knockdown pip counter: HOME ●●●○○  AWAY ●○○○○ — under the clock.
    this.knockdownEl = document.createElement('div');
    this.knockdownEl.dataset.hudRole = 'knockdowns';
    Object.assign(this.knockdownEl.style, {
      position: 'absolute', top: '78px', left: '50%',
      transform: 'translateX(-50%)', fontSize: '13px',
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'monospace', letterSpacing: '1px',
      textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
      zIndex: '10', whiteSpace: 'pre',
    });
    this.container.appendChild(this.knockdownEl);
    this.updateKnockdowns(0, 0);

    // Buff hint — "Press V to go INVINCIBLE" when the human team has ≥3.
    this.buffHintEl = document.createElement('div');
    this.buffHintEl.dataset.hudRole = 'buff-hint';
    Object.assign(this.buffHintEl.style, {
      position: 'absolute', top: '102px', left: '50%',
      transform: 'translateX(-50%)', fontSize: '14px',
      color: '#ffd700', fontFamily: 'sans-serif',
      textShadow: '0 0 8px #ffd700',
      zIndex: '10', display: 'none',
    });
    this.container.appendChild(this.buffHintEl);

    // Buff banner — giant centered "INVINCIBLE" / "MUTANT" during the 30s.
    this.buffBannerEl = document.createElement('div');
    this.buffBannerEl.dataset.hudRole = 'buff-banner';
    Object.assign(this.buffBannerEl.style, {
      position: 'absolute', top: '130px', left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '28px', fontWeight: 'bold',
      color: '#ffd700', fontFamily: 'sans-serif',
      letterSpacing: '2px',
      textShadow: '0 0 16px #ffd700, 0 0 32px #ffd700',
      zIndex: '10', display: 'none',
    });
    this.container.appendChild(this.buffBannerEl);

    this.chargeBarContainer = document.createElement('div');
    Object.assign(this.chargeBarContainer.style, {
      position: 'absolute', bottom: '60px', left: '50%',
      transform: 'translateX(-50%)', width: '200px', height: '16px',
      backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '8px',
      border: '2px solid rgba(255,255,255,0.4)',
      overflow: 'hidden', zIndex: '10', display: 'none',
    });

    this.chargeBarFill = document.createElement('div');
    Object.assign(this.chargeBarFill.style, {
      height: '100%', width: '0%', borderRadius: '6px',
      transition: 'width 0.05s linear',
    });
    this.chargeBarContainer.appendChild(this.chargeBarFill);
    container.appendChild(this.chargeBarContainer);

    this.staminaBarContainer = document.createElement('div');
    Object.assign(this.staminaBarContainer.style, {
      position: 'absolute', bottom: '20px', left: '20px',
      width: '120px', height: '12px',
      backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '6px',
      border: '2px solid rgba(255,255,255,0.3)',
      overflow: 'hidden', zIndex: '10',
    });

    this.staminaBarFill = document.createElement('div');
    Object.assign(this.staminaBarFill.style, {
      height: '100%', width: '100%', borderRadius: '4px',
      backgroundColor: '#4caf50',
      transition: 'width 0.1s linear',
    });
    this.staminaBarContainer.appendChild(this.staminaBarFill);
    container.appendChild(this.staminaBarContainer);

    this.controllerIcon = document.createElement('div');
    Object.assign(this.controllerIcon.style, {
      position: 'absolute',
      bottom: '10px',
      right: '10px',
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#888888',
      display: 'none',
      zIndex: '10',
    });
    container.appendChild(this.controllerIcon);
  }

  updateScore(home: number, away: number): void {
    this.scoreEl.textContent = '';

    const homeSpan = document.createElement('span');
    homeSpan.textContent = String(home);

    const sep = document.createElement('span');
    sep.textContent = ' - ';

    const awaySpan = document.createElement('span');
    awaySpan.textContent = String(away);

    this.scoreEl.appendChild(homeSpan);
    this.scoreEl.appendChild(sep);
    this.scoreEl.appendChild(awaySpan);
  }

  updateClock(seconds: number): void {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const formatted = `${mins}:${String(secs).padStart(2, '0')}`;
    this.clockEl.textContent = formatted;
  }

  updateShotClock(seconds: number): void {
    const display = Math.ceil(seconds);
    this.shotClockEl.textContent = String(display);
    this.shotClockEl.style.color = seconds < 5 ? '#f44336' : '';
  }

  /**
   * Pip display under the clock for each team's knockdown count. Pips fill
   * on each knockdown (0-5); color ramps toward gold at 3 and magenta at 5.
   */
  updateKnockdowns(home: number, away: number): void {
    const pip = (n: number): string => {
      const filled = '●'.repeat(Math.min(n, 5));
      const empty = '○'.repeat(Math.max(0, 5 - n));
      return filled + empty;
    };
    const colorFor = (n: number): string => {
      if (n >= 5) return '#ff00ff';
      if (n >= 3) return '#ffd700';
      return 'rgba(255,255,255,0.85)';
    };
    this.knockdownEl.textContent = '';
    const homeSpan = document.createElement('span');
    homeSpan.textContent = `HOME ${pip(home)}`;
    homeSpan.style.color = colorFor(home);
    const sepSpan = document.createElement('span');
    sepSpan.textContent = '    ';
    const awaySpan = document.createElement('span');
    awaySpan.textContent = `${pip(away)} AWAY`;
    awaySpan.style.color = colorFor(away);
    this.knockdownEl.appendChild(homeSpan);
    this.knockdownEl.appendChild(sepSpan);
    this.knockdownEl.appendChild(awaySpan);
  }

  /** Show the "Press V to go INVINCIBLE" prompt when count ≥3 and not already active. */
  showBuffHint(text: string): void {
    this.buffHintEl.textContent = text;
    this.buffHintEl.style.display = 'block';
  }
  hideBuffHint(): void {
    this.buffHintEl.style.display = 'none';
  }

  /** Show the large centered banner while a buff is active. */
  showBuffBanner(text: string, color = '#ffd700'): void {
    this.buffBannerEl.textContent = text;
    this.buffBannerEl.style.color = color;
    this.buffBannerEl.style.textShadow = `0 0 16px ${color}, 0 0 32px ${color}`;
    this.buffBannerEl.style.display = 'block';
  }
  hideBuffBanner(): void {
    this.buffBannerEl.style.display = 'none';
  }

  updateChargeBar(isCharging: boolean, chargeLevel: number): void {
    if (!isCharging) {
      this.chargeBarContainer.style.display = 'none';
      return;
    }
    this.chargeBarContainer.style.display = 'block';
    const pct = Math.min(chargeLevel * 100, 100);
    this.chargeBarFill.style.width = `${pct}%`;
    if (chargeLevel >= 0.8) {
      this.chargeBarFill.style.backgroundColor = '#4caf50';
    } else {
      this.chargeBarFill.style.backgroundColor = '#ff9800';
    }
  }

  updateStaminaBar(stamina: number): void {
    const pct = Math.min(stamina * 100, 100);
    this.staminaBarFill.style.width = `${pct}%`;
    if (stamina > 0.5) {
      this.staminaBarFill.style.backgroundColor = '#4caf50';
    } else if (stamina > 0.2) {
      this.staminaBarFill.style.backgroundColor = '#ffeb3b';
    } else {
      this.staminaBarFill.style.backgroundColor = '#f44336';
    }
  }

  showPowerup(type: string, remaining: number): void {
    this.powerupEl.textContent = '';
    this.powerupEl.style.display = '';

    const typeSpan = document.createElement('span');
    typeSpan.textContent = type;

    const timeSpan = document.createElement('span');
    timeSpan.textContent = ` (${remaining}s)`;

    this.powerupEl.appendChild(typeSpan);
    this.powerupEl.appendChild(timeSpan);
  }

  hidePowerup(): void {
    this.powerupEl.style.display = 'none';
    this.powerupEl.textContent = '';
  }

  updateCrowdLevel(level: CrowdLevel): void {
    this.crowdEl.textContent = level;
    this.crowdEl.style.color = CROWD_COLORS[level];
  }

  showSubInPrompt(stage: SubInStageName): void {
    const style = SUB_IN_STYLES[stage];

    this.subInEl.textContent = '';
    this.subInEl.style.display = '';
    this.subInEl.style.color = style.color;
    this.subInEl.style.fontSize = style.fontSize;
    this.subInEl.style.fontWeight = style.fontWeight;

    const label = document.createElement('span');
    label.textContent = 'SUB IN';
    this.subInEl.appendChild(label);
  }

  hideSubInPrompt(): void {
    this.subInEl.style.display = 'none';
    this.subInEl.textContent = '';
  }

  showPowerupPickup(type: string): void {
    // Create a floating notification that auto-removes after 2 seconds
    const notif = document.createElement('div');
    notif.textContent = type.toUpperCase().replace('-', ' ') + '!';
    // Style: centered, big bold text, colored based on type, fades out
    Object.assign(notif.style, {
      position: 'absolute',
      top: '40%',
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '28px',
      fontWeight: 'bold',
      color: '#ffd700',
      textShadow: '0 0 10px rgba(255,215,0,0.8)',
      pointerEvents: 'none',
      transition: 'opacity 0.5s',
      zIndex: '100',
    });
    this.container.appendChild(notif);

    setTimeout(() => { notif.style.opacity = '0'; }, 1500);
    setTimeout(() => { notif.remove(); }, 2000);
  }

  showSplash(text: string, color = '#ffffff'): void {
    const splash = document.createElement('div');
    splash.textContent = text;
    Object.assign(splash.style, {
      position: 'absolute',
      top: '35%',
      left: '50%',
      transform: 'translateX(-50%) scale(1)',
      fontSize: '48px',
      fontWeight: 'bold',
      color: color,
      textShadow: `0 0 20px ${color}, 0 0 40px ${color}`,
      fontFamily: 'sans-serif',
      pointerEvents: 'none',
      zIndex: '20',
      transition: 'opacity 0.5s, transform 0.5s',
      opacity: '1',
    });
    this.container.appendChild(splash);

    // Hold for 1 second, THEN fade
    setTimeout(() => {
      splash.style.transform = 'translateX(-50%) scale(1.3)';
      splash.style.opacity = '0';
    }, 1000);
    // Remove after 2 seconds total
    setTimeout(() => splash.remove(), 2000);
  }

  updateControllerIcon(type: 'xbox' | 'playstation' | 'nintendo' | null): void {
    if (!type) {
      this.controllerIcon.style.display = 'none';
      return;
    }
    this.controllerIcon.style.display = 'block';
    const labels: Record<string, string> = {
      xbox: '🎮 Xbox',
      playstation: '🎮 PlayStation',
      nintendo: '🎮 Nintendo',
    };
    this.controllerIcon.textContent = labels[type] ?? '';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  show(): void {
    this.container.style.display = '';
  }

  destroy(): void {
    this.container.removeChild(this.scoreEl);
    this.container.removeChild(this.clockEl);
    this.container.removeChild(this.shotClockEl);
    this.container.removeChild(this.powerupEl);
    this.container.removeChild(this.crowdEl);
    this.container.removeChild(this.subInEl);
  }
}
