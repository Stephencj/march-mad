/**
 * Prompt offered to a guest after their first match — save their in-progress
 * life savings as a real profile, or keep playing as guest (losing it on reload).
 */
import type { SessionWallet } from '@/meta/profile';

interface SaveProfilePromptOpts {
  wallet: SessionWallet;
  matchDelta: number; // +N for a win, -N for a loss, 0 for "no bet" flow (skipped)
  onSaved: (name: string) => void;
  onSkipped: () => void;
}

export class SaveProfilePrompt {
  private overlay: HTMLDivElement | null = null;
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  show(opts: SaveProfilePromptOpts): void {
    this.hide();

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      background: 'rgba(5, 8, 18, 0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '9100', pointerEvents: 'auto',
      fontFamily: 'sans-serif',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#16213e',
      border: '2px solid #2e8b50',
      borderRadius: '12px',
      padding: '28px 36px',
      minWidth: '440px',
      maxWidth: '520px',
      boxShadow: '0 0 40px rgba(46, 139, 80, 0.4)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
    });

    const title = document.createElement('div');
    title.textContent = 'SAVE YOUR LIFE SAVINGS?';
    Object.assign(title.style, {
      fontSize: '24px', fontWeight: 'bold', color: '#ffffff',
      letterSpacing: '2px', marginBottom: '10px',
      textShadow: '0 0 12px #2e8b50',
    });
    card.appendChild(title);

    const delta = opts.matchDelta;
    const deltaLine = document.createElement('div');
    if (delta > 0) {
      deltaLine.textContent = `You just won $${delta}. Don't let it disappear when you close the game.`;
      deltaLine.style.color = '#90ee90';
    } else if (delta < 0) {
      deltaLine.textContent = `Down $${Math.abs(delta)}. Want a shot at winning it back across multiple sessions?`;
      deltaLine.style.color = '#ffaa55';
    } else {
      deltaLine.textContent = "Want to track your life savings across sessions?";
      deltaLine.style.color = '#aaa';
    }
    Object.assign(deltaLine.style, {
      fontSize: '13px', fontFamily: 'sans-serif',
      textAlign: 'center', marginBottom: '14px', maxWidth: '400px',
    });
    card.appendChild(deltaLine);

    const cashLine = document.createElement('div');
    cashLine.textContent = `Current Life Savings: $${opts.wallet.getCash()}`;
    Object.assign(cashLine.style, {
      fontSize: '14px', color: '#e6ffe6',
      padding: '8px 16px', marginBottom: '16px',
      background: 'rgba(46, 139, 80, 0.18)',
      border: '1px solid #2e8b50',
      borderRadius: '8px',
    });
    card.appendChild(cashLine);

    const blurb = document.createElement('div');
    blurb.textContent = 'What do the guys call you?';
    Object.assign(blurb.style, { fontSize: '13px', color: '#aaa', marginBottom: '8px' });
    card.appendChild(blurb);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'Dave, Bob from Accounting, DadZone...';
    Object.assign(input.style, {
      width: '340px', padding: '8px 12px', fontSize: '15px',
      fontFamily: 'sans-serif', background: '#0d101e',
      border: '1px solid #2e8b50', borderRadius: '6px',
      color: '#ffffff', textAlign: 'center', marginBottom: '16px',
    });
    card.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', width: '100%' });

    const save = document.createElement('button');
    save.textContent = 'Save Profile';
    Object.assign(save.style, {
      flex: '1', padding: '12px', background: '#2e8b50',
      color: '#fff', border: '1px solid #3dcc6d',
      borderRadius: '6px', cursor: 'pointer',
      fontSize: '14px', fontWeight: 'bold', fontFamily: 'sans-serif',
    });
    const doSave = () => {
      const name = input.value.trim() || 'Player';
      this.hide();
      opts.onSaved(name);
    };
    save.addEventListener('click', doSave);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSave();
    });
    row.appendChild(save);

    const skip = document.createElement('button');
    skip.textContent = 'Keep Playing As Guest';
    Object.assign(skip.style, {
      flex: '1', padding: '12px', background: 'transparent',
      color: '#ccc', border: '1px solid #555',
      borderRadius: '6px', cursor: 'pointer',
      fontSize: '13px', fontFamily: 'sans-serif',
    });
    skip.addEventListener('click', () => {
      this.hide();
      opts.onSkipped();
    });
    row.appendChild(skip);

    card.appendChild(row);
    overlay.appendChild(card);
    this.host.appendChild(overlay);
    this.overlay = overlay;
  }

  hide(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
  }
}
