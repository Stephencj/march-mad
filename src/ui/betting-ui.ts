import { TeamData } from '@/core/types';

export interface BetSelection {
  teamId: string;
  coins: number;
  rep: number;
}

export class BettingUI {
  private container: HTMLElement;
  private onBet: (bet: BetSelection) => void;
  private onCashOut: () => void;

  constructor(
    container: HTMLElement,
    onBet: (bet: BetSelection) => void,
    onCashOut: () => void,
  ) {
    this.container = container;
    this.onBet = onBet;
    this.onCashOut = onCashOut;
  }

  showMatchup(
    teamA: TeamData,
    teamB: TeamData,
    odds: { teamA: number; teamB: number },
    maxCoins: number,
    maxRep: number,
  ): void {
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.classList.add('betting');

    const heading = document.createElement('h2');
    heading.classList.add('betting__heading');
    heading.textContent = 'Place Your Bet';
    wrapper.appendChild(heading);

    // Coin slider
    const coinGroup = this.createSliderGroup('Coins', 'bet-coins', 0, maxCoins);
    wrapper.appendChild(coinGroup.group);

    // Rep slider
    const repGroup = this.createSliderGroup('Rep', 'bet-rep', 0, maxRep);
    wrapper.appendChild(repGroup.group);

    // Team buttons
    const btnRow = document.createElement('div');
    btnRow.classList.add('betting__teams');

    const teamABtn = document.createElement('button');
    teamABtn.classList.add('betting__team-btn');
    teamABtn.textContent = `${teamA.name} (${odds.teamA.toFixed(2)}x)`;
    teamABtn.addEventListener('click', () => {
      this.onBet({
        teamId: teamA.id,
        coins: Number(coinGroup.slider.value),
        rep: Number(repGroup.slider.value),
      });
    });
    btnRow.appendChild(teamABtn);

    const vsLabel = document.createElement('span');
    vsLabel.classList.add('betting__vs');
    vsLabel.textContent = 'vs';
    btnRow.appendChild(vsLabel);

    const teamBBtn = document.createElement('button');
    teamBBtn.classList.add('betting__team-btn');
    teamBBtn.textContent = `${teamB.name} (${odds.teamB.toFixed(2)}x)`;
    teamBBtn.addEventListener('click', () => {
      this.onBet({
        teamId: teamB.id,
        coins: Number(coinGroup.slider.value),
        rep: Number(repGroup.slider.value),
      });
    });
    btnRow.appendChild(teamBBtn);

    wrapper.appendChild(btnRow);
    this.container.appendChild(wrapper);
  }

  showCashOut(amount: number): void {
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.classList.add('betting', 'betting--cashout');

    const label = document.createElement('p');
    label.classList.add('betting__cashout-label');
    label.textContent = `Cash out: ${amount} coins`;
    wrapper.appendChild(label);

    const btn = document.createElement('button');
    btn.classList.add('betting__cashout-btn');
    btn.textContent = 'Cash Out';
    btn.addEventListener('click', () => this.onCashOut());
    wrapper.appendChild(btn);

    this.container.appendChild(wrapper);
  }

  hide(): void {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  private createSliderGroup(
    labelText: string,
    id: string,
    min: number,
    max: number,
  ): { group: HTMLElement; slider: HTMLInputElement } {
    const group = document.createElement('div');
    group.classList.add('betting__slider-group');

    const label = document.createElement('label');
    label.classList.add('betting__slider-label');
    label.textContent = labelText;
    label.setAttribute('for', id);
    group.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.classList.add('betting__slider');
    slider.min = String(min);
    slider.max = String(max);
    slider.value = '0';
    group.appendChild(slider);

    const valueDisplay = document.createElement('span');
    valueDisplay.classList.add('betting__slider-value');
    valueDisplay.textContent = '0';
    slider.addEventListener('input', () => {
      valueDisplay.textContent = slider.value;
    });
    group.appendChild(valueDisplay);

    return { group, slider };
  }
}
