/**
 * Bet modal — reusable overlay shown before a match. Reads the active
 * wallet's life savings, offers tiered wager buttons (5 / 10 / 25 / 50 /
 * All In), and calls back with the chosen amount. Dad-league copy.
 *
 * Used by:
 *   - Quick Game flow (after venue pick, before match starts)
 *   - Bracket flow (between-matches on the bracket view)
 */
import { BET_TIERS, ALL_IN, type SessionWallet } from '@/meta/profile';

interface BetModalOpts {
  wallet: SessionWallet;
  matchLabel: string; // e.g. "Pickup Game — Rec Center" or "Round of 16 — Dave's Brewers vs HR Dept Hammers"
  onConfirm: (amount: number) => void;
  onCancel?: () => void;
  allowSkip?: boolean; // if true, shows "Play For Free" button (bracket flow allows this)
}

export class BetModal {
  private overlay: HTMLDivElement | null = null;
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  show(opts: BetModalOpts): void {
    this.hide();

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      background: 'rgba(5, 8, 18, 0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '9000', pointerEvents: 'auto',
      fontFamily: 'sans-serif',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#16213e',
      border: '2px solid #e94560',
      borderRadius: '12px',
      padding: '28px 36px',
      minWidth: '420px',
      maxWidth: '520px',
      boxShadow: '0 0 40px rgba(233, 69, 96, 0.4)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
    });

    const title = document.createElement('div');
    title.textContent = 'PLACE YOUR BET';
    Object.assign(title.style, {
      fontSize: '28px', fontWeight: 'bold', color: '#ffffff',
      letterSpacing: '2px', textShadow: '0 0 12px #e94560',
      marginBottom: '4px',
    });
    card.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = opts.matchLabel;
    Object.assign(subtitle.style, {
      fontSize: '13px', color: '#aaa', textAlign: 'center', marginBottom: '16px',
    });
    card.appendChild(subtitle);

    const savings = document.createElement('div');
    savings.textContent = `${opts.wallet.getDisplayName()} · Life Savings: $${opts.wallet.getCash()}`;
    Object.assign(savings.style, {
      fontSize: '14px', color: '#e6ffe6',
      padding: '8px 16px',
      background: 'rgba(46, 139, 80, 0.18)',
      border: '1px solid #2e8b50',
      borderRadius: '8px',
      marginBottom: '16px',
    });
    card.appendChild(savings);

    const hint = document.createElement('div');
    hint.textContent = 'Win = +bet · Loss = -bet · No take-backsies.';
    Object.assign(hint.style, { fontSize: '11px', color: '#888', marginBottom: '12px' });
    card.appendChild(hint);

    // Tier buttons
    const cash = opts.wallet.getCash();
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
      gap: '8px', width: '100%', marginBottom: '16px',
    });
    for (const tier of BET_TIERS) {
      const btn = this.makeTierButton(`$${tier}`, tier <= cash);
      btn.addEventListener('click', () => {
        this.hide();
        opts.onConfirm(tier);
      });
      grid.appendChild(btn);
    }
    const allInBtn = this.makeTierButton(`All In ($${cash})`, cash > 0);
    allInBtn.style.gridColumn = 'span 5';
    allInBtn.style.fontWeight = 'bold';
    allInBtn.style.background = cash > 0 ? '#c41e3a' : '#444';
    allInBtn.style.borderColor = cash > 0 ? '#ff6b85' : '#555';
    allInBtn.addEventListener('click', () => {
      if (cash <= 0) return;
      this.hide();
      opts.onConfirm(opts.wallet.resolveBet(ALL_IN));
    });
    card.appendChild(grid);
    card.appendChild(allInBtn);

    // Skip / Cancel row
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      display: 'flex', gap: '8px', marginTop: '14px', width: '100%',
    });
    if (opts.allowSkip) {
      const skip = this.makeSecondaryButton('Play For Free');
      skip.addEventListener('click', () => {
        this.hide();
        opts.onConfirm(0);
      });
      footer.appendChild(skip);
    }
    if (opts.onCancel) {
      const cancel = this.makeSecondaryButton('Back');
      cancel.addEventListener('click', () => {
        this.hide();
        opts.onCancel?.();
      });
      footer.appendChild(cancel);
    }
    if (footer.children.length > 0) card.appendChild(footer);

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

  isOpen(): boolean {
    return this.overlay !== null;
  }

  private makeTierButton(label: string, enabled: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '14px 8px',
      background: enabled ? '#1f2540' : '#1a1d2e',
      color: enabled ? '#ffffff' : '#555',
      border: `1px solid ${enabled ? '#e94560' : '#333'}`,
      borderRadius: '6px',
      cursor: enabled ? 'pointer' : 'not-allowed',
      fontSize: '15px',
      fontFamily: 'sans-serif',
      fontWeight: '500',
    });
    btn.disabled = !enabled;
    if (enabled) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#2c3556';
        btn.style.borderColor = '#ff6b85';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = '#1f2540';
        btn.style.borderColor = '#e94560';
      });
    }
    return btn;
  }

  private makeSecondaryButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: '1',
      padding: '10px 14px',
      background: 'transparent',
      color: '#ccc',
      border: '1px solid #555',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '13px',
      fontFamily: 'sans-serif',
    });
    return btn;
  }
}
