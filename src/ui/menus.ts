type MenuScreen = 'main' | 'tournament-select' | 'settings';

export class MenuUI {
  private container: HTMLElement;
  private onAction: (action: string, data?: unknown) => void;

  constructor(container: HTMLElement, onAction: (action: string, data?: unknown) => void) {
    this.container = container;
    this.onAction = onAction;
  }

  show(screen: MenuScreen): void {
    this.hide();

    switch (screen) {
      case 'main':
        this.renderMainMenu();
        break;
      case 'tournament-select':
        this.renderTournamentSelect();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  }

  hide(): void {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  private renderMainMenu(): void {
    const wrapper = document.createElement('div');
    wrapper.classList.add('menu', 'menu--main');

    const title = document.createElement('h1');
    title.classList.add('menu__title');
    title.textContent = 'MARCH MADNESS';
    wrapper.appendChild(title);

    // Quick Play button — secondary style, 3v3 half court
    const quickPlayBtn = document.createElement('button');
    quickPlayBtn.classList.add('menu__btn', 'menu__btn--secondary');
    quickPlayBtn.addEventListener('click', () => this.onAction('quick-play'));
    const quickPlayLabel = document.createElement('span');
    quickPlayLabel.classList.add('menu__btn-label');
    quickPlayLabel.textContent = 'QUICK PLAY';
    quickPlayBtn.appendChild(quickPlayLabel);
    const quickPlaySub = document.createElement('span');
    quickPlaySub.classList.add('menu__btn-subtitle');
    quickPlaySub.textContent = '3v3 Half Court';
    quickPlayBtn.appendChild(quickPlaySub);
    wrapper.appendChild(quickPlayBtn);

    // Main Game button — primary style, 5v5 full court
    const mainGameBtn = document.createElement('button');
    mainGameBtn.classList.add('menu__btn', 'menu__btn--primary');
    mainGameBtn.addEventListener('click', () => this.onAction('main-game'));
    const mainGameLabel = document.createElement('span');
    mainGameLabel.classList.add('menu__btn-label');
    mainGameLabel.textContent = 'MAIN GAME';
    mainGameBtn.appendChild(mainGameLabel);
    const mainGameSub = document.createElement('span');
    mainGameSub.classList.add('menu__btn-subtitle');
    mainGameSub.textContent = '5v5 Full Court';
    mainGameBtn.appendChild(mainGameSub);
    wrapper.appendChild(mainGameBtn);

    // Settings button
    const settingsBtn = document.createElement('button');
    settingsBtn.classList.add('menu__btn', 'menu__btn--secondary');
    settingsBtn.textContent = 'Settings';
    settingsBtn.addEventListener('click', () => this.onAction('settings'));
    wrapper.appendChild(settingsBtn);

    this.container.appendChild(wrapper);
  }

  private renderTournamentSelect(): void {
    const wrapper = document.createElement('div');
    wrapper.classList.add('menu', 'menu--tournament-select');

    const heading = document.createElement('h2');
    heading.classList.add('menu__heading');
    heading.textContent = 'Select Tournament';
    wrapper.appendChild(heading);

    const tiers: Array<{ key: string; label: string; teams: number; time: string }> = [
      { key: 'casual', label: 'Casual', teams: 8, time: '~15 min' },
      { key: 'sweet16', label: 'Sweet 16', teams: 16, time: '~30 min' },
      { key: 'season', label: 'Season', teams: 64, time: 'Multi-session' },
    ];

    const grid = document.createElement('div');
    grid.classList.add('menu__tier-grid');

    for (const tier of tiers) {
      const card = document.createElement('button');
      card.classList.add('menu__tier-card');

      const cardTitle = document.createElement('h3');
      cardTitle.classList.add('menu__tier-title');
      cardTitle.textContent = tier.label;
      card.appendChild(cardTitle);

      const teamsInfo = document.createElement('p');
      teamsInfo.classList.add('menu__tier-info');
      teamsInfo.textContent = `${tier.teams} teams`;
      card.appendChild(teamsInfo);

      const timeInfo = document.createElement('p');
      timeInfo.classList.add('menu__tier-time');
      timeInfo.textContent = tier.time;
      card.appendChild(timeInfo);

      card.addEventListener('click', () => this.onAction('select-tier', tier.key));
      grid.appendChild(card);
    }

    wrapper.appendChild(grid);
    this.container.appendChild(wrapper);
  }

  private renderSettings(): void {
    const wrapper = document.createElement('div');
    wrapper.classList.add('menu', 'menu--settings');

    const heading = document.createElement('h2');
    heading.classList.add('menu__heading');
    heading.textContent = 'Settings';
    wrapper.appendChild(heading);

    // SFX volume slider
    wrapper.appendChild(this.createVolumeSlider('SFX Volume', 'sfx-volume'));

    // Music volume slider
    wrapper.appendChild(this.createVolumeSlider('Music Volume', 'music-volume'));

    const backBtn = document.createElement('button');
    backBtn.classList.add('menu__btn', 'menu__btn--secondary');
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.onAction('back'));
    wrapper.appendChild(backBtn);

    this.container.appendChild(wrapper);
  }

  private createVolumeSlider(labelText: string, id: string): HTMLElement {
    const group = document.createElement('div');
    group.classList.add('menu__slider-group');

    const label = document.createElement('label');
    label.classList.add('menu__slider-label');
    label.textContent = labelText;
    label.setAttribute('for', id);
    group.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.classList.add('menu__slider');
    slider.min = '0';
    slider.max = '100';
    slider.value = '75';
    group.appendChild(slider);

    return group;
  }
}
