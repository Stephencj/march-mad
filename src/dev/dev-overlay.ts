import {
  balanceConfig,
  serializeBalance,
  applyBalanceJSON,
  resetBalance,
  getDefaults,
} from './balance-config';
import {
  levelConfig,
  serializeLevel,
  applyLevelJSON,
  resetLevel,
  getDefaults as getLevelDefaults,
} from './level-config';
import {
  playerConfig,
  serializePlayer,
  applyPlayerJSON,
  resetPlayer,
  getDefaults as getPlayerDefaults,
} from './player-config';

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Read the current value from the live balanceConfig. */
  get: () => number;
  /** Write a new value back into balanceConfig. */
  set: (v: number) => void;
  /** Default value to label "(default: X)". */
  defaultValue: number;
}

interface SectionSpec {
  title: string;
  sliders: SliderSpec[];
}

export class DevOverlay {
  private container: HTMLElement;
  private panel: HTMLElement | null = null;
  private visible = false;
  /** Map slider DOM input → spec, so re-syncing after import is one pass. */
  private bindings: Array<{ input: HTMLInputElement; numeric: HTMLInputElement; spec: SliderSpec }> = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.container.style.pointerEvents = 'auto';
    this.panel = this.buildPanel();
    this.container.appendChild(this.panel);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.container.style.pointerEvents = 'none';
    if (this.panel) {
      this.container.removeChild(this.panel);
      this.panel = null;
    }
    this.bindings = [];
  }

  destroy(): void {
    this.hide();
  }

  /** Re-read every slider from balanceConfig (used after Import / Reset). */
  private syncFromConfig(): void {
    for (const { input, numeric, spec } of this.bindings) {
      const v = spec.get();
      input.value = String(v);
      numeric.value = String(v);
    }
  }

  private buildPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.dataset.role = 'dev-overlay';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: '340px',
      height: '100%',
      background: 'rgba(15, 18, 32, 0.96)',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      overflowY: 'auto',
      padding: '16px',
      boxSizing: 'border-box',
      zIndex: '10000',
      borderLeft: '2px solid #e94560',
      pointerEvents: 'auto',
    });

    panel.appendChild(this.buildHeader());
    for (const section of this.buildSections()) {
      panel.appendChild(this.buildSection(section));
    }
    return panel;
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      marginBottom: '16px',
      paddingBottom: '12px',
      borderBottom: '1px solid #333',
    });

    const title = document.createElement('div');
    title.textContent = 'DEV OVERLAY';
    Object.assign(title.style, {
      fontSize: '16px',
      fontWeight: 'bold',
      letterSpacing: '2px',
      color: '#e94560',
    });
    header.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Press F1 to hide. Edits apply live.';
    Object.assign(hint.style, { fontSize: '11px', color: '#888' });
    header.appendChild(hint);

    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, { display: 'flex', gap: '6px', marginTop: '4px' });

    buttonRow.appendChild(this.makeButton('Reset', () => {
      resetBalance();
      resetLevel();
      resetPlayer();
      this.syncFromConfig();
    }));
    buttonRow.appendChild(this.makeButton('Export', () => {
      const combined = JSON.stringify({
        balance: JSON.parse(serializeBalance()),
        level: JSON.parse(serializeLevel()),
        player: JSON.parse(serializePlayer()),
      }, null, 2);
      const blob = new Blob([combined], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'march-mad-config.json';
      a.click();
      URL.revokeObjectURL(url);
    }));
    buttonRow.appendChild(this.makeButton('Import', () => this.importFromFile()));

    header.appendChild(buttonRow);
    return header;
  }

  private importFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          // Combined export uses { balance, level }; legacy/single-config exports
          // are accepted by trying balance first then level.
          let parsed: any;
          try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
          if (parsed && typeof parsed === 'object' && (parsed.balance || parsed.level || parsed.player)) {
            if (parsed.balance) applyBalanceJSON(JSON.stringify(parsed.balance));
            if (parsed.level) applyLevelJSON(JSON.stringify(parsed.level));
            if (parsed.player) applyPlayerJSON(JSON.stringify(parsed.player));
          } else {
            // Legacy single-config import — try balance, then level, then player
            try { applyBalanceJSON(text); } catch {
              try { applyLevelJSON(text); } catch { applyPlayerJSON(text); }
            }
          }
          this.syncFromConfig();
        } catch (err) {
          console.error('Failed to import config:', err);
        }
      });
    });
    input.click();
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.action = label.toLowerCase();
    Object.assign(btn.style, {
      flex: '1',
      padding: '6px 8px',
      background: '#1f2540',
      color: '#ffffff',
      border: '1px solid #444',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: 'sans-serif',
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private buildSection(spec: SectionSpec): HTMLElement {
    const details = document.createElement('details');
    details.open = true;
    Object.assign(details.style, { marginBottom: '12px' });

    const summary = document.createElement('summary');
    summary.textContent = spec.title;
    Object.assign(summary.style, {
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '13px',
      color: '#aaa',
      padding: '4px 0',
      letterSpacing: '1px',
    });
    details.appendChild(summary);

    for (const slider of spec.sliders) {
      details.appendChild(this.buildSlider(slider));
    }
    return details;
  }

  private buildSlider(spec: SliderSpec): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '6px 0',
      borderBottom: '1px solid #222',
    });

    const labelRow = document.createElement('div');
    Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

    const label = document.createElement('label');
    label.textContent = spec.label;
    Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
    labelRow.appendChild(label);

    const numeric = document.createElement('input');
    numeric.type = 'number';
    numeric.min = String(spec.min);
    numeric.max = String(spec.max);
    numeric.step = String(spec.step);
    numeric.value = String(spec.get());
    numeric.dataset.role = `numeric-${spec.label}`;
    Object.assign(numeric.style, {
      width: '70px',
      padding: '2px 4px',
      background: '#0d101e',
      color: '#fff',
      border: '1px solid #333',
      borderRadius: '3px',
      fontSize: '12px',
      fontFamily: 'monospace',
    });
    labelRow.appendChild(numeric);

    row.appendChild(labelRow);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.value = String(spec.get());
    slider.dataset.role = `slider-${spec.label}`;
    Object.assign(slider.style, { width: '100%' });
    row.appendChild(slider);

    const defaultLabel = document.createElement('div');
    defaultLabel.textContent = `default: ${spec.defaultValue}`;
    Object.assign(defaultLabel.style, { fontSize: '10px', color: '#666' });
    row.appendChild(defaultLabel);

    const apply = (raw: string) => {
      if (raw.trim() === '') return;
      const v = Number(raw);
      if (!Number.isFinite(v)) return;
      spec.set(v);
      slider.value = String(v);
      numeric.value = String(v);
    };

    slider.addEventListener('input', () => apply(slider.value));
    numeric.addEventListener('input', () => apply(numeric.value));

    this.bindings.push({ input: slider, numeric, spec });
    return row;
  }

  private buildSections(): SectionSpec[] {
    const d = getDefaults();
    return [
      {
        title: 'MATCH',
        sliders: [
          {
            label: 'Win Score',
            min: 1, max: 100, step: 1,
            get: () => balanceConfig.match.winScore,
            set: (v) => { balanceConfig.match.winScore = v; },
            defaultValue: d.match.winScore,
          },
          {
            label: 'Shot Clock',
            min: 1, max: 60, step: 1,
            get: () => balanceConfig.match.shotClock,
            set: (v) => { balanceConfig.match.shotClock = v; },
            defaultValue: d.match.shotClock,
          },
          {
            label: 'On Fire (s)',
            min: 0, max: 60, step: 1,
            get: () => balanceConfig.match.onFireDuration,
            set: (v) => { balanceConfig.match.onFireDuration = v; },
            defaultValue: d.match.onFireDuration,
          },
          {
            label: 'Foul Powerup Charge',
            min: 0, max: 50, step: 1,
            get: () => balanceConfig.match.foulPowerupCharge,
            set: (v) => { balanceConfig.match.foulPowerupCharge = v; },
            defaultValue: d.match.foulPowerupCharge,
          },
        ],
      },
      {
        title: 'SHOOTING',
        sliders: [
          {
            label: 'Layup Accuracy',
            min: 0, max: 1, step: 0.01,
            get: () => balanceConfig.shooting.baseAccuracy.layup,
            set: (v) => { balanceConfig.shooting.baseAccuracy.layup = v; },
            defaultValue: d.shooting.baseAccuracy.layup,
          },
          {
            label: 'Mid-Range Accuracy',
            min: 0, max: 1, step: 0.01,
            get: () => balanceConfig.shooting.baseAccuracy.midRange,
            set: (v) => { balanceConfig.shooting.baseAccuracy.midRange = v; },
            defaultValue: d.shooting.baseAccuracy.midRange,
          },
          {
            label: 'Three-Pointer Accuracy',
            min: 0, max: 1, step: 0.01,
            get: () => balanceConfig.shooting.baseAccuracy.threePointer,
            set: (v) => { balanceConfig.shooting.baseAccuracy.threePointer = v; },
            defaultValue: d.shooting.baseAccuracy.threePointer,
          },
          {
            label: 'Default Accuracy',
            min: 0, max: 1, step: 0.01,
            get: () => balanceConfig.shooting.baseAccuracy.default,
            set: (v) => { balanceConfig.shooting.baseAccuracy.default = v; },
            defaultValue: d.shooting.baseAccuracy.default,
          },
          {
            label: 'Normal Range (u)',
            min: 1, max: 30, step: 0.5,
            get: () => balanceConfig.shooting.normalRange,
            set: (v) => { balanceConfig.shooting.normalRange = v; },
            defaultValue: d.shooting.normalRange,
          },
          {
            label: 'Distance Penalty',
            min: 0, max: 5, step: 0.05,
            get: () => balanceConfig.shooting.distancePenalty,
            set: (v) => { balanceConfig.shooting.distancePenalty = v; },
            defaultValue: d.shooting.distancePenalty,
          },
          {
            label: 'Contest Penalty',
            min: 0, max: 1, step: 0.01,
            get: () => balanceConfig.shooting.contestPenalty,
            set: (v) => { balanceConfig.shooting.contestPenalty = v; },
            defaultValue: d.shooting.contestPenalty,
          },
        ],
      },
      ...this.buildLevelSections(),
      ...this.buildPlayerSections(),
    ];
  }

  private buildPlayerSections(): SectionSpec[] {
    const pd = getPlayerDefaults();
    return [
      {
        title: 'PLAYER (next match)',
        sliders: [
          { label: 'Head Radius', min: 0.18, max: 0.45, step: 0.01,
            get: () => playerConfig.head.radius,
            set: (v) => { playerConfig.head.radius = v; },
            defaultValue: pd.head.radius },
          { label: 'Torso Width', min: 0.18, max: 0.45, step: 0.01,
            get: () => playerConfig.body.torsoWidth,
            set: (v) => { playerConfig.body.torsoWidth = v; },
            defaultValue: pd.body.torsoWidth },
          { label: 'Torso Height', min: 0.25, max: 0.6, step: 0.01,
            get: () => playerConfig.body.torsoHeight,
            set: (v) => { playerConfig.body.torsoHeight = v; },
            defaultValue: pd.body.torsoHeight },
          { label: 'Upper Arm Length', min: 0.18, max: 0.42, step: 0.01,
            get: () => playerConfig.limbs.upperArmLength,
            set: (v) => { playerConfig.limbs.upperArmLength = v; },
            defaultValue: pd.limbs.upperArmLength },
          { label: 'Forearm Length', min: 0.14, max: 0.36, step: 0.01,
            get: () => playerConfig.limbs.forearmLength,
            set: (v) => { playerConfig.limbs.forearmLength = v; },
            defaultValue: pd.limbs.forearmLength },
          { label: 'Upper Leg Length', min: 0.22, max: 0.5, step: 0.01,
            get: () => playerConfig.limbs.upperLegLength,
            set: (v) => { playerConfig.limbs.upperLegLength = v; },
            defaultValue: pd.limbs.upperLegLength },
          { label: 'Lower Leg Length', min: 0.22, max: 0.5, step: 0.01,
            get: () => playerConfig.limbs.lowerLegLength,
            set: (v) => { playerConfig.limbs.lowerLegLength = v; },
            defaultValue: pd.limbs.lowerLegLength },
        ],
      },
    ];
  }

  private buildLevelSections(): SectionSpec[] {
    const ld = getLevelDefaults();
    return [
      {
        title: 'COURT (next match)',
        sliders: [
          { label: 'Width ⚠️', min: 8, max: 24, step: 0.5,
            get: () => levelConfig.court.width,
            set: (v) => { levelConfig.court.width = v; },
            defaultValue: ld.court.width },
          { label: 'Length ⚠️', min: 16, max: 40, step: 0.5,
            get: () => levelConfig.court.length,
            set: (v) => { levelConfig.court.length = v; },
            defaultValue: ld.court.length },
          { label: 'Paint Width', min: 2, max: 6, step: 0.1,
            get: () => levelConfig.court.paintWidth,
            set: (v) => { levelConfig.court.paintWidth = v; },
            defaultValue: ld.court.paintWidth },
          { label: 'Paint Length', min: 3, max: 9, step: 0.1,
            get: () => levelConfig.court.paintLength,
            set: (v) => { levelConfig.court.paintLength = v; },
            defaultValue: ld.court.paintLength },
          { label: 'Three-Point Radius', min: 4, max: 10, step: 0.05,
            get: () => levelConfig.court.threePointRadius,
            set: (v) => { levelConfig.court.threePointRadius = v; },
            defaultValue: ld.court.threePointRadius },
        ],
      },
      {
        title: 'HOOP ⚠️ (next match)',
        sliders: [
          { label: 'Home Z', min: -18, max: -6, step: 0.5,
            get: () => levelConfig.hoop.homeZ,
            set: (v) => { levelConfig.hoop.homeZ = v; },
            defaultValue: ld.hoop.homeZ },
          { label: 'Away Z', min: 6, max: 18, step: 0.5,
            get: () => levelConfig.hoop.awayZ,
            set: (v) => { levelConfig.hoop.awayZ = v; },
            defaultValue: ld.hoop.awayZ },
          { label: 'Rim Height', min: 2, max: 4, step: 0.05,
            get: () => levelConfig.hoop.rimHeight,
            set: (v) => { levelConfig.hoop.rimHeight = v; },
            defaultValue: ld.hoop.rimHeight },
          { label: 'Rim Radius', min: 0.2, max: 0.6, step: 0.01,
            get: () => levelConfig.hoop.rimRadius,
            set: (v) => { levelConfig.hoop.rimRadius = v; },
            defaultValue: ld.hoop.rimRadius },
          { label: 'Backboard Width', min: 1.5, max: 4, step: 0.05,
            get: () => levelConfig.hoop.backboardWidth,
            set: (v) => { levelConfig.hoop.backboardWidth = v; },
            defaultValue: ld.hoop.backboardWidth },
          { label: 'Backboard Height', min: 0.8, max: 2.5, step: 0.05,
            get: () => levelConfig.hoop.backboardHeight,
            set: (v) => { levelConfig.hoop.backboardHeight = v; },
            defaultValue: ld.hoop.backboardHeight },
        ],
      },
    ];
  }
}
