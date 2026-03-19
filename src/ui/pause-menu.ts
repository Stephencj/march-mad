import { CONTROLS_DATA } from './menus';

export class PauseMenu {
  private container: HTMLElement;
  private onAction: (action: string) => void;
  private overlay: HTMLDivElement | null = null;

  constructor(container: HTMLElement, onAction: (action: string) => void) {
    this.container = container;
    this.onAction = onAction;
  }

  show(): void {
    if (this.overlay) return;
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(10, 10, 20, 0.85)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '100',
      fontFamily: 'sans-serif',
      pointerEvents: 'auto',
    });
    this.container.appendChild(this.overlay);
    this.renderPauseView();
  }

  hide(): void {
    if (this.overlay) {
      this.container.removeChild(this.overlay);
      this.overlay = null;
    }
  }

  get isVisible(): boolean {
    return this.overlay !== null;
  }

  private clearOverlay(): void {
    if (!this.overlay) return;
    while (this.overlay.firstChild) {
      this.overlay.removeChild(this.overlay.firstChild);
    }
  }

  private createButton(label: string, isPrimary: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      backgroundColor: isPrimary ? '#e94560' : 'transparent',
      border: isPrimary ? 'none' : '2px solid #444',
      color: '#ffffff',
      borderRadius: '8px',
      cursor: 'pointer',
      width: '200px',
      padding: '12px 0',
      margin: '8px 0',
      fontSize: '18px',
      fontWeight: 'bold',
    });
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  renderPauseView(): void {
    this.clearOverlay();
    if (!this.overlay) return;

    const title = document.createElement('h1');
    title.textContent = 'PAUSED';
    Object.assign(title.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffffff',
      margin: '0 0 32px 0',
      textShadow: '0 0 20px #e94560',
    });
    this.overlay.appendChild(title);

    this.overlay.appendChild(this.createButton('Resume', true, () => this.onAction('resume')));
    this.overlay.appendChild(this.createButton('Controls', false, () => this.renderControlsView()));
    this.overlay.appendChild(this.createButton('Main Menu', false, () => this.renderConfirmQuit()));
  }

  renderControlsView(): void {
    this.clearOverlay();
    if (!this.overlay) return;

    const title = document.createElement('h1');
    title.textContent = 'CONTROLS';
    Object.assign(title.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffffff',
      margin: '0 0 32px 0',
      textShadow: '0 0 20px #e94560',
    });
    this.overlay.appendChild(title);

    for (const [action, key] of CONTROLS_DATA) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: '320px',
        padding: '6px 0',
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#cccccc',
      });
      const labelEl = document.createElement('span');
      labelEl.textContent = action;
      labelEl.style.color = '#ffffff';
      const keyEl = document.createElement('span');
      keyEl.textContent = key;
      keyEl.style.color = '#aaaaaa';
      row.appendChild(labelEl);
      row.appendChild(keyEl);
      this.overlay.appendChild(row);
    }

    const spacer = document.createElement('div');
    spacer.style.height = '24px';
    this.overlay.appendChild(spacer);

    this.overlay.appendChild(this.createButton('Back', false, () => this.renderPauseView()));
  }

  renderConfirmQuit(): void {
    this.clearOverlay();
    if (!this.overlay) return;

    const title = document.createElement('h1');
    title.textContent = 'Quit current game?';
    Object.assign(title.style, {
      fontSize: '28px',
      fontWeight: 'bold',
      color: '#ffffff',
      margin: '0 0 32px 0',
    });
    this.overlay.appendChild(title);

    this.overlay.appendChild(this.createButton('Quit', true, () => this.onAction('quit')));
    this.overlay.appendChild(this.createButton('Cancel', false, () => this.renderPauseView()));
  }
}
