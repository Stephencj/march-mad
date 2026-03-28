interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  team: 'home' | 'away';
}

export class FreeplayPanel {
  visible = false;
  private container: HTMLElement;
  private panel: HTMLDivElement | null = null;
  private onToggle: (playerId: string, enabled: boolean) => void;
  private playerStates = new Map<string, boolean>();
  private humanId = '';
  private players: PlayerInfo[] = [];

  constructor(container: HTMLElement, onToggle: (playerId: string, enabled: boolean) => void) {
    this.container = container;
    this.onToggle = onToggle;
  }

  setup(players: PlayerInfo[], humanPlayerId: string): void {
    this.humanId = humanPlayerId;
    this.players = players;
    for (const p of players) {
      if (p.id !== humanPlayerId) {
        this.playerStates.set(p.id, true);
      }
    }
    this.render();
  }

  private render(): void {
    if (this.panel) this.container.removeChild(this.panel);

    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'absolute', top: '60px', right: '10px', width: '240px',
      background: 'rgba(10, 10, 30, 0.85)', borderRadius: '8px', padding: '12px',
      fontFamily: 'monospace', fontSize: '12px', color: '#ffffff',
      pointerEvents: 'auto', zIndex: '1000', maxHeight: '80vh', overflowY: 'auto',
    });

    const title = document.createElement('div');
    title.textContent = 'FREEPLAY DEBUG';
    Object.assign(title.style, { fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#e94560', textAlign: 'center' });
    this.panel.appendChild(title);

    const humanTeam = this.players.find(h => h.id === this.humanId)?.team;
    const teammates = this.players.filter(p => p.id !== this.humanId && p.team === humanTeam);
    const opponents = this.players.filter(p => p.team !== humanTeam);

    this.panel.appendChild(this.createBulkToggle('All Teammates AI', 'teammates', teammates));
    this.panel.appendChild(this.createBulkToggle('All Opponents AI', 'opponents', opponents));

    const sep = document.createElement('hr');
    Object.assign(sep.style, { border: 'none', borderTop: '1px solid #333', margin: '8px 0' });
    this.panel.appendChild(sep);

    if (teammates.length > 0) {
      this.panel.appendChild(this.createHeader('YOUR TEAM'));
      for (const p of teammates) this.panel.appendChild(this.createPlayerRow(p));
    }
    if (opponents.length > 0) {
      this.panel.appendChild(this.createHeader('OPPONENTS'));
      for (const p of opponents) this.panel.appendChild(this.createPlayerRow(p));
    }

    this.container.appendChild(this.panel);
    this.panel.style.display = this.visible ? 'block' : 'none';
  }

  private createHeader(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, { fontSize: '11px', color: '#888', marginTop: '8px', marginBottom: '4px', fontWeight: 'bold' });
    return h;
  }

  private createBulkToggle(label: string, type: string, players: PlayerInfo[]): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' });

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.color = '#ccc';

    const btn = document.createElement('button');
    btn.dataset.bulk = type;
    btn.textContent = 'ON';
    Object.assign(btn.style, { background: '#2ecc71', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', minWidth: '36px' });

    let allOn = true;
    btn.addEventListener('click', () => {
      allOn = !allOn;
      for (const p of players) {
        this.playerStates.set(p.id, allOn);
        this.onToggle(p.id, allOn);
      }
      btn.textContent = allOn ? 'ON' : 'OFF';
      btn.style.background = allOn ? '#2ecc71' : '#e74c3c';
      this.updatePlayerButtons();
    });

    row.appendChild(lbl);
    row.appendChild(btn);
    return row;
  }

  private createPlayerRow(player: PlayerInfo): HTMLElement {
    const row = document.createElement('div');
    row.dataset.playerId = player.id;
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' });

    const lbl = document.createElement('span');
    lbl.textContent = `${player.position} ${player.name}`;
    Object.assign(lbl.style, { color: '#aaa', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' });

    const btn = document.createElement('button');
    btn.dataset.aiToggle = player.id;
    const isOn = this.playerStates.get(player.id) ?? true;
    btn.textContent = isOn ? 'ON' : 'OFF';
    Object.assign(btn.style, { background: isOn ? '#2ecc71' : '#e74c3c', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', minWidth: '36px' });

    btn.addEventListener('click', () => {
      const current = this.playerStates.get(player.id) ?? true;
      const newState = !current;
      this.playerStates.set(player.id, newState);
      this.onToggle(player.id, newState);
      btn.textContent = newState ? 'ON' : 'OFF';
      btn.style.background = newState ? '#2ecc71' : '#e74c3c';
    });

    row.appendChild(lbl);
    row.appendChild(btn);
    return row;
  }

  private updatePlayerButtons(): void {
    if (!this.panel) return;
    const toggles = this.panel.querySelectorAll('[data-ai-toggle]') as NodeListOf<HTMLButtonElement>;
    for (const btn of toggles) {
      const id = btn.dataset.aiToggle!;
      const isOn = this.playerStates.get(id) ?? true;
      btn.textContent = isOn ? 'ON' : 'OFF';
      btn.style.background = isOn ? '#2ecc71' : '#e74c3c';
    }
  }

  show(): void { this.visible = true; if (this.panel) this.panel.style.display = 'block'; }
  hide(): void { this.visible = false; if (this.panel) this.panel.style.display = 'none'; }
  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  destroy(): void {
    if (this.panel) { this.container.removeChild(this.panel); this.panel = null; }
  }
}
