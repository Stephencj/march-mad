import { MenuNavigator } from './menu-navigator';

type MenuScreen = 'main' | 'tournament-select' | 'full-game-select' | 'venue-select' | 'settings';

export const CONTROLS_DATA: [string, string, string, string, string][] = [
  // [Action, Keyboard, Xbox, PlayStation, Nintendo]
  ['Movement',      'WASD',          'Left Stick',  'Left Stick',  'Left Stick'],
  ['Shoot / Dunk',  'SPACE (hold)',  'A (hold)',    '× (hold)',    'B (hold)'],
  ['Pass',          'E',             'X',           '□',           'Y'],
  ['Steal',         'Q',             'B',           '○',           'A'],
  ['Guard',         'G',             'LT',          'L2',          'ZL'],
  ['Jump',          'F',             'Y',           '△',           'X'],
  ['Jump Block',    'SHIFT + F',     'LB',          'L1',          'L'],
  ['Sprint',        'SHIFT (hold)',  'RT (hold)',   'R2 (hold)',   'ZR (hold)'],
  ['Switch Player', 'TAB',           'RB',          'R1',          'R'],
  ['Pause',         'ESC',           'Menu',        'Options',     '+'],
];

export class MenuUI {
  private container: HTMLElement;
  private onAction: (action: string, data?: unknown) => void;
  private navigator: MenuNavigator | null = null;

  constructor(container: HTMLElement, onAction: (action: string, data?: unknown) => void) {
    this.container = container;
    this.onAction = onAction;
  }

  setNavigator(nav: MenuNavigator): void {
    this.navigator = nav;
  }

  show(screen: MenuScreen): void {
    this.hide();
    this.container.style.pointerEvents = 'auto';

    switch (screen) {
      case 'main':
        this.renderMainMenu();
        break;
      case 'tournament-select':
        this.renderTournamentMenu();
        break;
      case 'full-game-select':
        this.renderFullGameMenu();
        break;
      case 'venue-select':
        this.renderVenueMenu();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  }

  hide(): void {
    this.navigator?.clear();
    this.container.style.pointerEvents = 'none';
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  private createWrapper(): HTMLDivElement {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      background: 'rgba(10, 10, 20, 0.92)',
      position: 'absolute',
      top: '0',
      left: '0',
    });
    return wrapper;
  }

  private createPrimaryButton(label: string, subtitle: string, action: string): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      background: '#e94560',
      color: '#ffffff',
      fontSize: '18px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      padding: '16px 40px',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      pointerEvents: 'auto',
      margin: '8px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minWidth: '220px',
    });

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);

    if (subtitle) {
      const sub = document.createElement('span');
      sub.textContent = subtitle;
      Object.assign(sub.style, {
        fontSize: '12px',
        color: '#aaa',
        marginTop: '4px',
        fontWeight: 'normal',
      });
      btn.appendChild(sub);
    }

    btn.addEventListener('click', () => this.onAction(action));
    return btn;
  }

  private createSecondaryButton(label: string, action: string): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      background: 'transparent',
      color: '#aaa',
      fontSize: '16px',
      fontFamily: 'sans-serif',
      padding: '12px 32px',
      borderRadius: '8px',
      border: '1px solid #444',
      cursor: 'pointer',
      pointerEvents: 'auto',
      margin: '8px',
    });
    btn.textContent = label;
    btn.addEventListener('click', () => this.onAction(action));
    return btn;
  }

  private renderMainMenu(): void {
    const wrapper = this.createWrapper();

    const title = document.createElement('h1');
    title.textContent = 'MARCH MAD';
    Object.assign(title.style, {
      fontSize: '64px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 40px 0',
      textShadow: '0 0 20px #e94560, 0 0 40px #e94560',
      letterSpacing: '4px',
    });
    wrapper.appendChild(title);

    wrapper.appendChild(this.createPrimaryButton('Pickup Game', '3 Minutes Before The Wife Calls', 'quick-game'));
    wrapper.appendChild(this.createPrimaryButton('Bracket Run', 'Office-League Bracket', 'tournament'));
    wrapper.appendChild(this.createPrimaryButton('Full Game', 'All Four Quarters — Bring Ibuprofen', 'full-game'));
    wrapper.appendChild(this.createSecondaryButton('Controls', 'settings'));
    wrapper.appendChild(this.createSecondaryButton('Freeplay', 'freeplay'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
  }

  private renderVenueMenu(): void {
    const wrapper = this.createWrapper();

    const title = document.createElement('h1');
    title.textContent = 'PICK YOUR COURT';
    Object.assign(title.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 32px 0',
      textShadow: '0 0 20px #e94560',
    });
    wrapper.appendChild(title);

    wrapper.appendChild(this.createPrimaryButton('High School Gym', 'Rented Saturday — fluorescents + banners', 'venue-gym'));
    wrapper.appendChild(this.createPrimaryButton('Rec Center',      'Cinderblock walls, folding chairs, scuffed floor', 'venue-rec'));
    wrapper.appendChild(this.createPrimaryButton('Suburban Park',   'Cracked blacktop, chain-link, lawn chairs, open sky', 'venue-park'));
    wrapper.appendChild(this.createSecondaryButton('Back', 'back-to-main'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
    this.navigator?.setBackHandler(() => this.show('main'));
  }

  private renderTournamentMenu(): void {
    const wrapper = this.createWrapper();

    const title = document.createElement('h1');
    title.textContent = 'TOURNAMENT';
    Object.assign(title.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 32px 0',
      textShadow: '0 0 20px #e94560',
    });
    wrapper.appendChild(title);

    wrapper.appendChild(this.createPrimaryButton('8 Teams', '', 'tournament-8'));
    wrapper.appendChild(this.createPrimaryButton('16 Teams', '', 'tournament-16'));
    wrapper.appendChild(this.createPrimaryButton('64 Teams', '', 'tournament-64'));
    wrapper.appendChild(this.createSecondaryButton('Back', 'back-to-main'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
    this.navigator?.setBackHandler(() => this.show('main'));
  }

  private renderFullGameMenu(): void {
    const wrapper = this.createWrapper();

    const title = document.createElement('h1');
    title.textContent = 'FULL GAME';
    Object.assign(title.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 32px 0',
      textShadow: '0 0 20px #e94560',
    });
    wrapper.appendChild(title);

    wrapper.appendChild(this.createPrimaryButton('8 Min Quarters', '', 'fullgame-8'));
    wrapper.appendChild(this.createPrimaryButton('10 Min Quarters', '', 'fullgame-10'));
    wrapper.appendChild(this.createPrimaryButton('12 Min Quarters', '', 'fullgame-12'));
    wrapper.appendChild(this.createSecondaryButton('Back', 'back-to-main'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
    this.navigator?.setBackHandler(() => this.show('main'));
  }

  private renderSettings(): void {
    const wrapper = this.createWrapper();

    const heading = document.createElement('h2');
    heading.textContent = 'CONTROLS';
    Object.assign(heading.style, {
      fontSize: '36px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 24px 0',
      textShadow: '0 0 10px #e94560',
    });
    wrapper.appendChild(heading);

    for (const entry of CONTROLS_DATA) {
      const action = entry[0];
      const key = entry[1];
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', justifyContent: 'space-between',
        width: '100%', maxWidth: '320px',
        padding: '6px 0', fontFamily: 'monospace', fontSize: '14px',
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
      wrapper.appendChild(row);
    }

    // Divider
    const divider = document.createElement('hr');
    Object.assign(divider.style, {
      width: '100%', maxWidth: '320px',
      border: 'none', borderTop: '1px solid #444',
      margin: '16px 0',
    });
    wrapper.appendChild(divider);

    // Volume sliders (keep existing)
    wrapper.appendChild(this.createVolumeSlider('SFX Volume', 'sfx-volume'));
    wrapper.appendChild(this.createVolumeSlider('Music Volume', 'music-volume'));

    wrapper.appendChild(this.createSecondaryButton('Back', 'back'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
    this.navigator?.setBackHandler(() => this.show('main'));
  }

  private createVolumeSlider(labelText: string, id: string): HTMLElement {
    const group = document.createElement('div');
    Object.assign(group.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      margin: '8px',
    });

    const label = document.createElement('label');
    label.textContent = labelText;
    Object.assign(label.style, {
      color: '#aaa',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      marginBottom: '4px',
    });
    label.setAttribute('for', id);
    group.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.min = '0';
    slider.max = '100';
    slider.value = '75';
    Object.assign(slider.style, {
      pointerEvents: 'auto',
    });
    group.appendChild(slider);

    return group;
  }
}
