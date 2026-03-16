import { SIGNATURE_MOVES } from '@/data/signature-moves';
import { PlayerStats } from '@/core/types';

export interface CreatedPlayer {
  name: string;
  jerseyNumber: number;
  stats: PlayerStats;
  signatureMove: string;
}

export class PlayerCreatorUI {
  private container: HTMLElement;
  private onComplete: (player: CreatedPlayer) => void;

  constructor(container: HTMLElement, onComplete: (player: CreatedPlayer) => void) {
    this.container = container;
    this.onComplete = onComplete;
  }

  show(availablePoints: number): void {
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.classList.add('player-creator');

    const heading = document.createElement('h2');
    heading.classList.add('player-creator__heading');
    heading.textContent = 'Create Your Player';
    wrapper.appendChild(heading);

    // Name input
    const nameGroup = document.createElement('div');
    nameGroup.classList.add('player-creator__field');
    const nameLabel = document.createElement('label');
    nameLabel.classList.add('player-creator__label');
    nameLabel.textContent = 'Name';
    nameLabel.setAttribute('for', 'pc-name');
    nameGroup.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'pc-name';
    nameInput.classList.add('player-creator__input');
    nameInput.placeholder = 'Enter player name';
    nameGroup.appendChild(nameInput);
    wrapper.appendChild(nameGroup);

    // Jersey number
    const jerseyGroup = document.createElement('div');
    jerseyGroup.classList.add('player-creator__field');
    const jerseyLabel = document.createElement('label');
    jerseyLabel.classList.add('player-creator__label');
    jerseyLabel.textContent = 'Jersey Number';
    jerseyLabel.setAttribute('for', 'pc-jersey');
    jerseyGroup.appendChild(jerseyLabel);
    const jerseyInput = document.createElement('input');
    jerseyInput.type = 'number';
    jerseyInput.id = 'pc-jersey';
    jerseyInput.classList.add('player-creator__input');
    jerseyInput.min = '0';
    jerseyInput.max = '99';
    jerseyInput.value = '23';
    jerseyGroup.appendChild(jerseyInput);
    wrapper.appendChild(jerseyGroup);

    // Stat sliders
    const pointsDisplay = document.createElement('p');
    pointsDisplay.classList.add('player-creator__points');
    pointsDisplay.textContent = `Points remaining: ${availablePoints}`;
    wrapper.appendChild(pointsDisplay);

    const statNames: Array<{ key: keyof PlayerStats; label: string }> = [
      { key: 'speed', label: 'Speed' },
      { key: 'shooting', label: 'Shooting' },
      { key: 'defense', label: 'Defense' },
      { key: 'passing', label: 'Passing' },
      { key: 'dunkPower', label: 'Dunk Power' },
    ];

    let pointsUsed = 0;
    const sliders: Map<keyof PlayerStats, HTMLInputElement> = new Map();

    const statsContainer = document.createElement('div');
    statsContainer.classList.add('player-creator__stats');

    for (const stat of statNames) {
      const group = document.createElement('div');
      group.classList.add('player-creator__stat-group');

      const label = document.createElement('label');
      label.classList.add('player-creator__stat-label');
      label.textContent = stat.label;
      label.setAttribute('for', `pc-stat-${stat.key}`);
      group.appendChild(label);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `pc-stat-${stat.key}`;
      slider.classList.add('player-creator__slider');
      slider.min = '1';
      slider.max = '10';
      slider.value = '1';
      group.appendChild(slider);

      const valueLabel = document.createElement('span');
      valueLabel.classList.add('player-creator__stat-value');
      valueLabel.textContent = '1';
      group.appendChild(valueLabel);

      slider.addEventListener('input', () => {
        valueLabel.textContent = slider.value;
        recalcPoints();
      });

      sliders.set(stat.key, slider);
      statsContainer.appendChild(group);
    }

    wrapper.appendChild(statsContainer);

    const recalcPoints = (): void => {
      pointsUsed = 0;
      for (const s of sliders.values()) {
        pointsUsed += Number(s.value) - 1; // base of 1 is free
      }
      const remaining = availablePoints - pointsUsed;
      pointsDisplay.textContent = `Points remaining: ${remaining}`;
    };

    // Signature move picker
    const moveGroup = document.createElement('div');
    moveGroup.classList.add('player-creator__field');
    const moveLabel = document.createElement('label');
    moveLabel.classList.add('player-creator__label');
    moveLabel.textContent = 'Signature Move';
    moveLabel.setAttribute('for', 'pc-move');
    moveGroup.appendChild(moveLabel);

    const moveSelect = document.createElement('select');
    moveSelect.id = 'pc-move';
    moveSelect.classList.add('player-creator__select');

    for (const move of SIGNATURE_MOVES) {
      const option = document.createElement('option');
      option.value = move.name;
      option.textContent = move.name;
      moveSelect.appendChild(option);
    }

    moveGroup.appendChild(moveSelect);
    wrapper.appendChild(moveGroup);

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.classList.add('player-creator__btn');
    confirmBtn.textContent = 'Create Player';
    confirmBtn.addEventListener('click', () => {
      const stats: PlayerStats = {
        speed: Number(sliders.get('speed')!.value),
        shooting: Number(sliders.get('shooting')!.value),
        defense: Number(sliders.get('defense')!.value),
        passing: Number(sliders.get('passing')!.value),
        dunkPower: Number(sliders.get('dunkPower')!.value),
      };

      this.onComplete({
        name: nameInput.value || 'Player',
        jerseyNumber: Number(jerseyInput.value),
        stats,
        signatureMove: moveSelect.value,
      });
    });
    wrapper.appendChild(confirmBtn);

    this.container.appendChild(wrapper);
  }

  hide(): void {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}
