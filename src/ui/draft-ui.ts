import { PlayerData } from '@/core/types';
import { MenuNavigator } from './menu-navigator';

export class DraftUI {
  private container: HTMLElement;
  private onPick: (player: PlayerData) => void;
  private onReroll: () => void;
  private navigator: MenuNavigator | null = null;

  constructor(
    container: HTMLElement,
    onPick: (player: PlayerData) => void,
    onReroll: () => void,
  ) {
    this.container = container;
    this.onPick = onPick;
    this.onReroll = onReroll;
  }

  setNavigator(nav: MenuNavigator): void {
    this.navigator = nav;
  }

  render(pool: PlayerData[], picks: PlayerData[], rerollsLeft: number): void {
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.classList.add('draft');

    // Header
    const heading = document.createElement('h2');
    heading.classList.add('draft__heading');
    heading.textContent = 'Draft Your Team';
    wrapper.appendChild(heading);

    // Picks tracker
    const picksSection = document.createElement('div');
    picksSection.classList.add('draft__picks');

    const picksLabel = document.createElement('h3');
    picksLabel.classList.add('draft__picks-label');
    picksLabel.textContent = `Picked: ${picks.length}/3`;
    picksSection.appendChild(picksLabel);

    for (const pick of picks) {
      const pickTag = document.createElement('span');
      pickTag.classList.add('draft__pick-tag');
      pickTag.textContent = pick.name;
      picksSection.appendChild(pickTag);
    }

    wrapper.appendChild(picksSection);

    // Reroll button
    const rerollBtn = document.createElement('button');
    rerollBtn.classList.add('draft__reroll-btn');
    rerollBtn.textContent = `Reroll (${rerollsLeft} left)`;
    rerollBtn.disabled = rerollsLeft <= 0;
    rerollBtn.addEventListener('click', () => this.onReroll());
    wrapper.appendChild(rerollBtn);

    // Player cards grid
    const grid = document.createElement('div');
    grid.classList.add('draft__grid');

    for (const player of pool) {
      const card = document.createElement('button');
      card.classList.add('draft__card');

      const nameEl = document.createElement('h4');
      nameEl.classList.add('draft__card-name');
      nameEl.textContent = player.name;
      card.appendChild(nameEl);

      const personality = document.createElement('p');
      personality.classList.add('draft__card-personality');
      personality.textContent = player.personality;
      card.appendChild(personality);

      const statsEl = document.createElement('ul');
      statsEl.classList.add('draft__card-stats');

      const statEntries: Array<[string, number]> = [
        ['SPD', player.stats.speed],
        ['SHT', player.stats.shooting],
        ['DEF', player.stats.defense],
        ['PAS', player.stats.passing],
        ['DNK', player.stats.dunkPower],
      ];

      for (const [abbr, val] of statEntries) {
        const li = document.createElement('li');
        li.classList.add('draft__card-stat');
        li.textContent = `${abbr}: ${val}`;
        statsEl.appendChild(li);
      }

      card.appendChild(statsEl);

      card.addEventListener('click', () => this.onPick(player));
      grid.appendChild(card);
    }

    wrapper.appendChild(grid);
    this.container.appendChild(wrapper);

    const cards = this.container.querySelectorAll('button');
    this.navigator?.register(Array.from(cards), 3);
  }

  hide(): void {
    this.navigator?.clear();
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}
