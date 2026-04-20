import { MenuNavigator } from './menu-navigator';
import {
  loadProfiles,
  getActiveProfile,
  setActiveProfileId,
  createProfile,
  deleteProfile,
  type Profile,
} from '@/meta/profile';

type MenuScreen = 'main' | 'tournament-select' | 'full-game-select' | 'venue-select' | 'profile' | 'profile-create' | 'settings';

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
      case 'profile':
        this.renderProfileMenu();
        break;
      case 'profile-create':
        this.renderProfileCreate();
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

    // Life-savings display — small badge above the Play buttons
    const savingsBadge = this.buildLifeSavingsBadge();
    if (savingsBadge) wrapper.appendChild(savingsBadge);

    wrapper.appendChild(this.createPrimaryButton('Pickup Game', '3 Minutes Before The Wife Calls', 'quick-game'));
    wrapper.appendChild(this.createPrimaryButton('Bracket Run', 'Office-League Bracket', 'tournament'));
    wrapper.appendChild(this.createPrimaryButton('Full Game', 'All Four Quarters — Bring Ibuprofen', 'full-game'));
    wrapper.appendChild(this.createSecondaryButton('Profile', 'profile'));
    wrapper.appendChild(this.createSecondaryButton('Controls', 'settings'));
    wrapper.appendChild(this.createSecondaryButton('Freeplay', 'freeplay'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
  }

  /**
   * Pill above the main-menu Play buttons showing the active profile (or Guest)
   * and their life savings. Returns null if there's nothing to show (shouldn't
   * happen — we always either have a profile or a guest).
   */
  private buildLifeSavingsBadge(): HTMLElement | null {
    const active = getActiveProfile();
    const label = active ? active.name : 'Guest';
    const cash = active?.cash ?? 100; // guest starts at 100; match-side SessionWallet is authoritative during play
    const badge = document.createElement('div');
    Object.assign(badge.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 16px',
      marginBottom: '16px',
      background: 'rgba(26, 87, 42, 0.32)',
      border: '1px solid #2e8b50',
      borderRadius: '8px',
      fontFamily: 'sans-serif',
      color: '#e6ffe6',
      fontSize: '15px',
      letterSpacing: '0.5px',
    });
    const name = document.createElement('span');
    name.textContent = label;
    name.style.color = '#ffffff';
    name.style.fontWeight = 'bold';
    const sep = document.createElement('span');
    sep.textContent = '·';
    sep.style.color = '#888';
    const savings = document.createElement('span');
    savings.textContent = `Life Savings: $${cash}`;
    badge.appendChild(name);
    badge.appendChild(sep);
    badge.appendChild(savings);
    return badge;
  }

  private renderProfileMenu(): void {
    const wrapper = this.createWrapper();

    const title = document.createElement('h1');
    title.textContent = 'PROFILE';
    Object.assign(title.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 24px 0',
      textShadow: '0 0 20px #e94560',
    });
    wrapper.appendChild(title);

    const active = getActiveProfile();
    if (active) {
      const panel = document.createElement('div');
      Object.assign(panel.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        padding: '16px 24px',
        marginBottom: '20px',
        background: 'rgba(46, 139, 80, 0.18)',
        border: '1px solid #2e8b50',
        borderRadius: '10px',
        color: '#e6ffe6',
        fontFamily: 'sans-serif',
        minWidth: '280px',
      });
      const name = document.createElement('div');
      name.textContent = active.name;
      Object.assign(name.style, { fontSize: '22px', fontWeight: 'bold', color: '#ffffff' });
      panel.appendChild(name);
      const savings = document.createElement('div');
      savings.textContent = `Life Savings: $${active.cash}`;
      Object.assign(savings.style, { fontSize: '16px' });
      panel.appendChild(savings);
      const record = document.createElement('div');
      record.textContent = `${active.wins} W · ${active.losses} L`;
      Object.assign(record.style, { fontSize: '13px', color: '#aaa' });
      panel.appendChild(record);
      wrapper.appendChild(panel);
    } else {
      const guestBlurb = document.createElement('div');
      guestBlurb.textContent = 'Playing as GUEST — your life savings will disappear when you close the game.';
      Object.assign(guestBlurb.style, {
        fontSize: '13px', color: '#ffaa55', fontFamily: 'sans-serif',
        marginBottom: '20px', textAlign: 'center', maxWidth: '400px',
      });
      wrapper.appendChild(guestBlurb);
    }

    // List of existing saved profiles (besides active) to switch to
    const saved = loadProfiles().filter(p => p.id !== active?.id);
    if (saved.length > 0) {
      const label = document.createElement('div');
      label.textContent = 'Switch to:';
      Object.assign(label.style, { fontSize: '13px', color: '#aaa', fontFamily: 'sans-serif', margin: '8px 0 4px 0' });
      wrapper.appendChild(label);
      for (const p of saved) {
        const row = this.buildProfileSwitchRow(p);
        wrapper.appendChild(row);
      }
    }

    wrapper.appendChild(this.createPrimaryButton('Create New Profile', 'Save your life savings', 'profile-create'));
    if (active) {
      wrapper.appendChild(this.createSecondaryButton('Play As Guest', 'profile-play-as-guest'));
      wrapper.appendChild(this.createSecondaryButton('Delete This Profile', 'profile-delete-active'));
    }
    wrapper.appendChild(this.createSecondaryButton('Back', 'back-to-main'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
    this.navigator?.setBackHandler(() => this.show('main'));
  }

  private buildProfileSwitchRow(p: Profile): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px 16px', marginBottom: '6px',
      background: 'rgba(31, 37, 64, 0.6)', border: '1px solid #444',
      borderRadius: '6px', fontFamily: 'sans-serif', color: '#ddd',
      minWidth: '320px', fontSize: '14px',
    });
    const info = document.createElement('span');
    info.textContent = `${p.name}  ·  $${p.cash}  ·  ${p.wins}W ${p.losses}L`;
    info.style.flex = '1';
    row.appendChild(info);
    const btn = document.createElement('button');
    btn.textContent = 'Switch';
    Object.assign(btn.style, {
      padding: '4px 10px', background: '#2e8b50', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
    });
    btn.addEventListener('click', () => {
      setActiveProfileId(p.id);
      this.show('profile');
    });
    row.appendChild(btn);
    return row;
  }

  private renderProfileCreate(): void {
    const wrapper = this.createWrapper();

    const title = document.createElement('h1');
    title.textContent = 'NEW PROFILE';
    Object.assign(title.style, {
      fontSize: '48px', fontWeight: 'bold', color: '#ffffff',
      fontFamily: 'sans-serif', margin: '0 0 24px 0',
      textShadow: '0 0 20px #e94560',
    });
    wrapper.appendChild(title);

    const blurb = document.createElement('div');
    blurb.textContent = 'What do the guys call you?';
    Object.assign(blurb.style, {
      fontSize: '14px', color: '#aaa', fontFamily: 'sans-serif', marginBottom: '12px',
    });
    wrapper.appendChild(blurb);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'e.g. Dave, DadZone, Bob from Accounting';
    Object.assign(input.style, {
      width: '320px', padding: '10px 14px', fontSize: '16px',
      fontFamily: 'sans-serif', background: '#16213e',
      border: '2px solid #e94560', borderRadius: '6px',
      color: '#ffffff', marginBottom: '20px', textAlign: 'center',
    });
    wrapper.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const confirm = this.createPrimaryButton('Start With $100', 'Life savings at stake', 'profile-create-confirm');
    confirm.addEventListener('click', (e) => {
      // Intercept and use the input value instead of triggering a plain action
      e.stopImmediatePropagation();
      const name = input.value.trim() || 'Player';
      createProfile(name);
      this.show('profile');
    });
    wrapper.appendChild(confirm);

    wrapper.appendChild(this.createSecondaryButton('Back', 'profile'));

    this.container.appendChild(wrapper);

    const buttons = wrapper.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
    this.navigator?.setBackHandler(() => this.show('profile'));

    // Allow Enter to submit
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = input.value.trim() || 'Player';
        createProfile(name);
        this.show('profile');
      }
    });
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
