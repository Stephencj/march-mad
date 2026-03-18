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

  destroy(): void {
    this.container.removeChild(this.scoreEl);
    this.container.removeChild(this.clockEl);
    this.container.removeChild(this.shotClockEl);
    this.container.removeChild(this.powerupEl);
    this.container.removeChild(this.crowdEl);
    this.container.removeChild(this.subInEl);
  }
}
