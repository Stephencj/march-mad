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
import {
  animConfig,
  serializeAnim,
  applyAnimJSON,
  resetAnim,
  getDefaults as getAnimDefaults,
} from './anim-config';
import { pickSliderRange, type RangeTier } from './shared-ranges';
import { persistDetails, detailsKey } from './details-state';

const DEVUI_PREFIX = 'devui';

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

interface ColorSpec {
  label: string;
  /** Read the current value from the live config (integer, e.g. 0xff2222). */
  get: () => number;
  /** Write a new value back into the config (integer). */
  set: (v: number) => void;
  /** Default value to label "(default: #rrggbb)". */
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
  /** Map color picker DOM input → spec (integer ↔ hex string). */
  private colorBindings: Array<{ picker: HTMLInputElement; spec: ColorSpec }> = [];

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
    this.colorBindings = [];
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
    for (const { picker, spec } of this.colorBindings) {
      picker.value = numToHex(spec.get());
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
    for (const el of this.buildLevelSections()) {
      panel.appendChild(el);
    }
    panel.appendChild(this.buildPlayerSection());
    panel.appendChild(this.buildAnimationSection());
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
      resetAnim();
      this.syncFromConfig();
    }));
    buttonRow.appendChild(this.makeButton('Export', () => {
      const combined = JSON.stringify({
        balance: JSON.parse(serializeBalance()),
        level: JSON.parse(serializeLevel()),
        player: JSON.parse(serializePlayer()),
        animConfig: JSON.parse(serializeAnim()),
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

    // Dev page navigation — opens the standalone tuning pages. Use plain
    // <a> anchors so Ctrl/middle-click opens in a new tab/window; normal
    // click navigates in place (game state is lost, but this is dev-only).
    const pagesLabel = document.createElement('div');
    pagesLabel.textContent = 'DEV PAGES';
    Object.assign(pagesLabel.style, {
      fontSize: '10px',
      letterSpacing: '1.5px',
      color: '#888',
      marginTop: '10px',
    });
    header.appendChild(pagesLabel);

    const pagesRow = document.createElement('div');
    Object.assign(pagesRow.style, { display: 'flex', gap: '6px', marginTop: '4px' });
    pagesRow.appendChild(this.makePageLink('Anim Viewer', 'anim-viewer.html'));
    pagesRow.appendChild(this.makePageLink('Player', 'player-editor.html'));
    pagesRow.appendChild(this.makePageLink('Level', 'level-editor.html'));
    header.appendChild(pagesRow);

    return header;
  }

  private makePageLink(label: string, href: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.dataset.action = 'open-' + href.replace('.html', '');
    Object.assign(a.style, {
      flex: '1',
      padding: '6px 8px',
      background: '#1f2540',
      color: '#ffffff',
      border: '1px solid #444',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
      textAlign: 'center',
      textDecoration: 'none',
      fontFamily: 'sans-serif',
    });
    a.addEventListener('mouseenter', () => { a.style.background = '#2c3556'; });
    a.addEventListener('mouseleave', () => { a.style.background = '#1f2540'; });
    return a;
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
          if (parsed && typeof parsed === 'object' && (parsed.balance || parsed.level || parsed.player || parsed.animConfig)) {
            if (parsed.balance) applyBalanceJSON(JSON.stringify(parsed.balance));
            if (parsed.level) applyLevelJSON(JSON.stringify(parsed.level));
            if (parsed.player) applyPlayerJSON(JSON.stringify(parsed.player));
            if (parsed.animConfig) applyAnimJSON(JSON.stringify(parsed.animConfig));
          } else {
            // Legacy single-config import — try balance, then level, then player, then anim
            try { applyBalanceJSON(text); } catch {
              try { applyLevelJSON(text); } catch {
                try { applyPlayerJSON(text); } catch { applyAnimJSON(text); }
              }
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
    persistDetails(details, detailsKey(DEVUI_PREFIX, spec.title));
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
    ];
  }

  // ==========================================================================
  // PLAYER section — mirrors player-editor.html's grouping (HEAD / BODY /
  // LIMBS / SHOES / HAIR). Nested <details> because the overlay is dense.
  // ==========================================================================

  private buildPlayerSection(): HTMLElement {
    const root = document.createElement('details');
    root.open = true;
    Object.assign(root.style, { marginBottom: '12px' });
    const rootTitle = 'PLAYER (next match)';

    const summary = document.createElement('summary');
    summary.textContent = rootTitle;
    Object.assign(summary.style, {
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '13px',
      color: '#aaa',
      padding: '4px 0',
      letterSpacing: '1px',
    });
    root.appendChild(summary);

    const pd = getPlayerDefaults();

    // HEAD (open by default — landing point)
    const headSub = this.buildSubSection('HEAD', true, [rootTitle, 'HEAD']);
    const headSliders: SliderSpec[] = [
      { label: 'Head Radius', min: 0.18, max: 0.45, step: 0.01,
        get: () => playerConfig.head.radius,
        set: (v) => { playerConfig.head.radius = v; },
        defaultValue: pd.head.radius },
      { label: 'Eye Radius', min: 0.01, max: 0.1, step: 0.005,
        get: () => playerConfig.head.eyeRadius,
        set: (v) => { playerConfig.head.eyeRadius = v; },
        defaultValue: pd.head.eyeRadius },
    ];
    for (const s of headSliders) headSub.appendChild(this.buildSlider(s));
    root.appendChild(headSub);

    // BODY
    const bodySub = this.buildSubSection('BODY', false, [rootTitle, 'BODY']);
    const bodySliders: SliderSpec[] = [
      { label: 'Torso Width', min: 0.18, max: 0.45, step: 0.01,
        get: () => playerConfig.body.torsoWidth,
        set: (v) => { playerConfig.body.torsoWidth = v; },
        defaultValue: pd.body.torsoWidth },
      { label: 'Torso Height', min: 0.25, max: 0.6, step: 0.01,
        get: () => playerConfig.body.torsoHeight,
        set: (v) => { playerConfig.body.torsoHeight = v; },
        defaultValue: pd.body.torsoHeight },
      { label: 'Torso Depth', min: 0.08, max: 0.3, step: 0.01,
        get: () => playerConfig.body.torsoDepth,
        set: (v) => { playerConfig.body.torsoDepth = v; },
        defaultValue: pd.body.torsoDepth },
      { label: 'Shoulder Bar Width', min: 0.3, max: 0.6, step: 0.01,
        get: () => playerConfig.body.shoulderBarWidth,
        set: (v) => { playerConfig.body.shoulderBarWidth = v; },
        defaultValue: pd.body.shoulderBarWidth },
      { label: 'Shoulder Bar Height', min: 0.02, max: 0.15, step: 0.01,
        get: () => playerConfig.body.shoulderBarHeight,
        set: (v) => { playerConfig.body.shoulderBarHeight = v; },
        defaultValue: pd.body.shoulderBarHeight },
      { label: 'Shoulder Bar Depth', min: 0.05, max: 0.25, step: 0.01,
        get: () => playerConfig.body.shoulderBarDepth,
        set: (v) => { playerConfig.body.shoulderBarDepth = v; },
        defaultValue: pd.body.shoulderBarDepth },
      { label: 'Shoulder Cap Radius', min: 0.04, max: 0.16, step: 0.01,
        get: () => playerConfig.body.shoulderCapRadius,
        set: (v) => { playerConfig.body.shoulderCapRadius = v; },
        defaultValue: pd.body.shoulderCapRadius },
      { label: 'Hip Width', min: 0.18, max: 0.4, step: 0.01,
        get: () => playerConfig.body.hipWidth,
        set: (v) => { playerConfig.body.hipWidth = v; },
        defaultValue: pd.body.hipWidth },
      { label: 'Hip Height', min: 0.05, max: 0.2, step: 0.01,
        get: () => playerConfig.body.hipHeight,
        set: (v) => { playerConfig.body.hipHeight = v; },
        defaultValue: pd.body.hipHeight },
      { label: 'Hip Depth', min: 0.08, max: 0.25, step: 0.01,
        get: () => playerConfig.body.hipDepth,
        set: (v) => { playerConfig.body.hipDepth = v; },
        defaultValue: pd.body.hipDepth },
      // G2: lower belly lobe
      { label: 'Belly Lower Radius', min: 0, max: 0.3, step: 0.005,
        get: () => playerConfig.body.bellyLowerRadius,
        set: (v) => { playerConfig.body.bellyLowerRadius = v; },
        defaultValue: pd.body.bellyLowerRadius },
      { label: 'Belly Lower Scale X', min: 0.5, max: 2.0, step: 0.05,
        get: () => playerConfig.body.bellyLowerScaleX,
        set: (v) => { playerConfig.body.bellyLowerScaleX = v; },
        defaultValue: pd.body.bellyLowerScaleX },
      { label: 'Belly Lower Scale Y', min: 0.3, max: 1.4, step: 0.01,
        get: () => playerConfig.body.bellyLowerScaleY,
        set: (v) => { playerConfig.body.bellyLowerScaleY = v; },
        defaultValue: pd.body.bellyLowerScaleY },
      { label: 'Belly Lower Scale Z', min: 0.5, max: 2.5, step: 0.05,
        get: () => playerConfig.body.bellyLowerScaleZ,
        set: (v) => { playerConfig.body.bellyLowerScaleZ = v; },
        defaultValue: pd.body.bellyLowerScaleZ },
      { label: 'Belly Lower Y', min: -0.3, max: 0.2, step: 0.005,
        get: () => playerConfig.body.bellyLowerY,
        set: (v) => { playerConfig.body.bellyLowerY = v; },
        defaultValue: pd.body.bellyLowerY },
      { label: 'Belly Lower Z', min: -0.1, max: 0.25, step: 0.005,
        get: () => playerConfig.body.bellyLowerZ,
        set: (v) => { playerConfig.body.bellyLowerZ = v; },
        defaultValue: pd.body.bellyLowerZ },
      // G2: pec mounds
      { label: 'Pec Radius', min: 0, max: 0.15, step: 0.005,
        get: () => playerConfig.body.pecRadius,
        set: (v) => { playerConfig.body.pecRadius = v; },
        defaultValue: pd.body.pecRadius },
      { label: 'Pec Offset X', min: 0.04, max: 0.2, step: 0.005,
        get: () => playerConfig.body.pecOffsetX,
        set: (v) => { playerConfig.body.pecOffsetX = v; },
        defaultValue: pd.body.pecOffsetX },
      { label: 'Pec Y', min: 0.1, max: 0.5, step: 0.005,
        get: () => playerConfig.body.pecY,
        set: (v) => { playerConfig.body.pecY = v; },
        defaultValue: pd.body.pecY },
      { label: 'Pec Z', min: 0, max: 0.2, step: 0.005,
        get: () => playerConfig.body.pecZ,
        set: (v) => { playerConfig.body.pecZ = v; },
        defaultValue: pd.body.pecZ },
      { label: 'Pec Scale Y', min: 0.2, max: 1.5, step: 0.01,
        get: () => playerConfig.body.pecScaleY,
        set: (v) => { playerConfig.body.pecScaleY = v; },
        defaultValue: pd.body.pecScaleY },
      { label: 'Pec Scale Z', min: 0.5, max: 2.5, step: 0.05,
        get: () => playerConfig.body.pecScaleZ,
        set: (v) => { playerConfig.body.pecScaleZ = v; },
        defaultValue: pd.body.pecScaleZ },
      // G2: sloped shoulders (replaces shoulder-bar)
      { label: 'Shoulder Slope Radius', min: 0.04, max: 0.18, step: 0.005,
        get: () => playerConfig.body.shoulderSlopeRadius,
        set: (v) => { playerConfig.body.shoulderSlopeRadius = v; },
        defaultValue: pd.body.shoulderSlopeRadius },
      { label: 'Shoulder Slope Offset X', min: 0.02, max: 0.2, step: 0.005,
        get: () => playerConfig.body.shoulderSlopeOffsetX,
        set: (v) => { playerConfig.body.shoulderSlopeOffsetX = v; },
        defaultValue: pd.body.shoulderSlopeOffsetX },
      { label: 'Shoulder Slope Y', min: 0.2, max: 0.55, step: 0.005,
        get: () => playerConfig.body.shoulderSlopeY,
        set: (v) => { playerConfig.body.shoulderSlopeY = v; },
        defaultValue: pd.body.shoulderSlopeY },
      { label: 'Shoulder Slope Scale X', min: 0.5, max: 2.5, step: 0.05,
        get: () => playerConfig.body.shoulderSlopeScaleX,
        set: (v) => { playerConfig.body.shoulderSlopeScaleX = v; },
        defaultValue: pd.body.shoulderSlopeScaleX },
      { label: 'Shoulder Slope Scale Y', min: 0.2, max: 1.5, step: 0.01,
        get: () => playerConfig.body.shoulderSlopeScaleY,
        set: (v) => { playerConfig.body.shoulderSlopeScaleY = v; },
        defaultValue: pd.body.shoulderSlopeScaleY },
      { label: 'Shoulder Slope Scale Z', min: 0.3, max: 1.6, step: 0.05,
        get: () => playerConfig.body.shoulderSlopeScaleZ,
        set: (v) => { playerConfig.body.shoulderSlopeScaleZ = v; },
        defaultValue: pd.body.shoulderSlopeScaleZ },
      // G2: love handles
      { label: 'Love Handle Radius', min: 0, max: 0.16, step: 0.005,
        get: () => playerConfig.body.loveHandleRadius,
        set: (v) => { playerConfig.body.loveHandleRadius = v; },
        defaultValue: pd.body.loveHandleRadius },
      { label: 'Love Handle Offset X', min: 0.08, max: 0.3, step: 0.005,
        get: () => playerConfig.body.loveHandleOffsetX,
        set: (v) => { playerConfig.body.loveHandleOffsetX = v; },
        defaultValue: pd.body.loveHandleOffsetX },
      { label: 'Love Handle Y', min: -0.2, max: 0.2, step: 0.005,
        get: () => playerConfig.body.loveHandleY,
        set: (v) => { playerConfig.body.loveHandleY = v; },
        defaultValue: pd.body.loveHandleY },
      { label: 'Love Handle Scale X', min: 0.4, max: 1.6, step: 0.05,
        get: () => playerConfig.body.loveHandleScaleX,
        set: (v) => { playerConfig.body.loveHandleScaleX = v; },
        defaultValue: pd.body.loveHandleScaleX },
      { label: 'Love Handle Scale Y', min: 0.3, max: 1.4, step: 0.01,
        get: () => playerConfig.body.loveHandleScaleY,
        set: (v) => { playerConfig.body.loveHandleScaleY = v; },
        defaultValue: pd.body.loveHandleScaleY },
      { label: 'Love Handle Scale Z', min: 0.4, max: 1.8, step: 0.05,
        get: () => playerConfig.body.loveHandleScaleZ,
        set: (v) => { playerConfig.body.loveHandleScaleZ = v; },
        defaultValue: pd.body.loveHandleScaleZ },
      // G2: big ass
      { label: 'Butt Radius', min: 0, max: 0.3, step: 0.005,
        get: () => playerConfig.body.buttRadius,
        set: (v) => { playerConfig.body.buttRadius = v; },
        defaultValue: pd.body.buttRadius },
      { label: 'Butt Y', min: -0.2, max: 0.1, step: 0.005,
        get: () => playerConfig.body.buttY,
        set: (v) => { playerConfig.body.buttY = v; },
        defaultValue: pd.body.buttY },
      { label: 'Butt Z', min: -0.25, max: 0, step: 0.005,
        get: () => playerConfig.body.buttZ,
        set: (v) => { playerConfig.body.buttZ = v; },
        defaultValue: pd.body.buttZ },
      { label: 'Butt Scale X', min: 0.5, max: 2.0, step: 0.05,
        get: () => playerConfig.body.buttScaleX,
        set: (v) => { playerConfig.body.buttScaleX = v; },
        defaultValue: pd.body.buttScaleX },
      { label: 'Butt Scale Y', min: 0.3, max: 1.4, step: 0.01,
        get: () => playerConfig.body.buttScaleY,
        set: (v) => { playerConfig.body.buttScaleY = v; },
        defaultValue: pd.body.buttScaleY },
      { label: 'Butt Scale Z', min: 0.5, max: 2.0, step: 0.05,
        get: () => playerConfig.body.buttScaleZ,
        set: (v) => { playerConfig.body.buttScaleZ = v; },
        defaultValue: pd.body.buttScaleZ },
    ];
    for (const s of bodySliders) bodySub.appendChild(this.buildSlider(s));
    root.appendChild(bodySub);

    // LIMBS
    const limbsSub = this.buildSubSection('LIMBS', false, [rootTitle, 'LIMBS']);
    const limbsSliders: SliderSpec[] = [
      { label: 'Upper Arm: Top R', min: 0.02, max: 0.06, step: 0.005,
        get: () => playerConfig.limbs.upperArmRadiusTop,
        set: (v) => { playerConfig.limbs.upperArmRadiusTop = v; },
        defaultValue: pd.limbs.upperArmRadiusTop },
      { label: 'Upper Arm: Bot R', min: 0.02, max: 0.06, step: 0.005,
        get: () => playerConfig.limbs.upperArmRadiusBottom,
        set: (v) => { playerConfig.limbs.upperArmRadiusBottom = v; },
        defaultValue: pd.limbs.upperArmRadiusBottom },
      { label: 'Upper Arm: Length', min: 0.18, max: 0.42, step: 0.01,
        get: () => playerConfig.limbs.upperArmLength,
        set: (v) => { playerConfig.limbs.upperArmLength = v; },
        defaultValue: pd.limbs.upperArmLength },
      { label: 'Forearm: Top R', min: 0.015, max: 0.05, step: 0.005,
        get: () => playerConfig.limbs.forearmRadiusTop,
        set: (v) => { playerConfig.limbs.forearmRadiusTop = v; },
        defaultValue: pd.limbs.forearmRadiusTop },
      { label: 'Forearm: Bot R', min: 0.015, max: 0.05, step: 0.005,
        get: () => playerConfig.limbs.forearmRadiusBottom,
        set: (v) => { playerConfig.limbs.forearmRadiusBottom = v; },
        defaultValue: pd.limbs.forearmRadiusBottom },
      { label: 'Forearm: Length', min: 0.14, max: 0.36, step: 0.01,
        get: () => playerConfig.limbs.forearmLength,
        set: (v) => { playerConfig.limbs.forearmLength = v; },
        defaultValue: pd.limbs.forearmLength },
      { label: 'Upper Leg: Top R', min: 0.04, max: 0.1, step: 0.005,
        get: () => playerConfig.limbs.upperLegRadiusTop,
        set: (v) => { playerConfig.limbs.upperLegRadiusTop = v; },
        defaultValue: pd.limbs.upperLegRadiusTop },
      { label: 'Upper Leg: Bot R', min: 0.03, max: 0.09, step: 0.005,
        get: () => playerConfig.limbs.upperLegRadiusBottom,
        set: (v) => { playerConfig.limbs.upperLegRadiusBottom = v; },
        defaultValue: pd.limbs.upperLegRadiusBottom },
      { label: 'Upper Leg: Length', min: 0.22, max: 0.5, step: 0.01,
        get: () => playerConfig.limbs.upperLegLength,
        set: (v) => { playerConfig.limbs.upperLegLength = v; },
        defaultValue: pd.limbs.upperLegLength },
      { label: 'Lower Leg: Top R', min: 0.03, max: 0.09, step: 0.005,
        get: () => playerConfig.limbs.lowerLegRadiusTop,
        set: (v) => { playerConfig.limbs.lowerLegRadiusTop = v; },
        defaultValue: pd.limbs.lowerLegRadiusTop },
      { label: 'Lower Leg: Bot R', min: 0.04, max: 0.1, step: 0.005,
        get: () => playerConfig.limbs.lowerLegRadiusBottom,
        set: (v) => { playerConfig.limbs.lowerLegRadiusBottom = v; },
        defaultValue: pd.limbs.lowerLegRadiusBottom },
      { label: 'Lower Leg: Length', min: 0.22, max: 0.5, step: 0.01,
        get: () => playerConfig.limbs.lowerLegLength,
        set: (v) => { playerConfig.limbs.lowerLegLength = v; },
        defaultValue: pd.limbs.lowerLegLength },
    ];
    for (const s of limbsSliders) limbsSub.appendChild(this.buildSlider(s));
    root.appendChild(limbsSub);

    // SHOES (3 numeric + 1 color)
    const shoesSub = this.buildSubSection('SHOES', false, [rootTitle, 'SHOES']);
    const shoesSliders: SliderSpec[] = [
      { label: 'Shoes Width', min: 0.08, max: 0.22, step: 0.01,
        get: () => playerConfig.shoes.width,
        set: (v) => { playerConfig.shoes.width = v; },
        defaultValue: pd.shoes.width },
      { label: 'Shoes Height', min: 0.04, max: 0.16, step: 0.01,
        get: () => playerConfig.shoes.height,
        set: (v) => { playerConfig.shoes.height = v; },
        defaultValue: pd.shoes.height },
      { label: 'Shoes Depth', min: 0.12, max: 0.3, step: 0.01,
        get: () => playerConfig.shoes.depth,
        set: (v) => { playerConfig.shoes.depth = v; },
        defaultValue: pd.shoes.depth },
    ];
    for (const s of shoesSliders) shoesSub.appendChild(this.buildSlider(s));
    shoesSub.appendChild(this.buildColorRow({
      label: 'Shoes Color',
      get: () => playerConfig.shoes.color,
      set: (v) => { playerConfig.shoes.color = v; },
      defaultValue: pd.shoes.color,
    }));
    root.appendChild(shoesSub);

    // HAIR (9 numeric + 1 color)
    const hairSub = this.buildSubSection('HAIR', false, [rootTitle, 'HAIR']);
    const hairSliders: SliderSpec[] = [
      { label: 'Flat-Top: Width', min: 0.2, max: 0.5, step: 0.01,
        get: () => playerConfig.hair.flatTopWidth,
        set: (v) => { playerConfig.hair.flatTopWidth = v; },
        defaultValue: pd.hair.flatTopWidth },
      { label: 'Flat-Top: Height', min: 0.04, max: 0.25, step: 0.01,
        get: () => playerConfig.hair.flatTopHeight,
        set: (v) => { playerConfig.hair.flatTopHeight = v; },
        defaultValue: pd.hair.flatTopHeight },
      { label: 'Flat-Top: Depth', min: 0.18, max: 0.4, step: 0.01,
        get: () => playerConfig.hair.flatTopDepth,
        set: (v) => { playerConfig.hair.flatTopDepth = v; },
        defaultValue: pd.hair.flatTopDepth },
      { label: 'Afro Radius', min: 0.2, max: 0.5, step: 0.01,
        get: () => playerConfig.hair.afroRadius,
        set: (v) => { playerConfig.hair.afroRadius = v; },
        defaultValue: pd.hair.afroRadius },
      { label: 'Mohawk: Width', min: 0.02, max: 0.16, step: 0.01,
        get: () => playerConfig.hair.mohawkWidth,
        set: (v) => { playerConfig.hair.mohawkWidth = v; },
        defaultValue: pd.hair.mohawkWidth },
      { label: 'Mohawk: Height', min: 0.08, max: 0.4, step: 0.01,
        get: () => playerConfig.hair.mohawkHeight,
        set: (v) => { playerConfig.hair.mohawkHeight = v; },
        defaultValue: pd.hair.mohawkHeight },
      { label: 'Mohawk: Depth', min: 0.14, max: 0.36, step: 0.01,
        get: () => playerConfig.hair.mohawkDepth,
        set: (v) => { playerConfig.hair.mohawkDepth = v; },
        defaultValue: pd.hair.mohawkDepth },
      { label: 'Headband Radius', min: 0.2, max: 0.4, step: 0.005,
        get: () => playerConfig.hair.headbandRadius,
        set: (v) => { playerConfig.hair.headbandRadius = v; },
        defaultValue: pd.hair.headbandRadius },
      { label: 'Headband Thickness', min: 0.02, max: 0.15, step: 0.005,
        get: () => playerConfig.hair.headbandThickness,
        set: (v) => { playerConfig.hair.headbandThickness = v; },
        defaultValue: pd.hair.headbandThickness },
    ];
    for (const s of hairSliders) hairSub.appendChild(this.buildSlider(s));
    hairSub.appendChild(this.buildColorRow({
      label: 'Headband Color',
      get: () => playerConfig.hair.headbandColor,
      set: (v) => { playerConfig.hair.headbandColor = v; },
      defaultValue: pd.hair.headbandColor,
    }));
    root.appendChild(hairSub);

    persistDetails(root, detailsKey(DEVUI_PREFIX, rootTitle));
    return root;
  }

  private buildColorRow(spec: ColorSpec): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '6px 0',
      borderBottom: '1px solid #222',
    });

    const labelRow = document.createElement('div');
    Object.assign(labelRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    });

    const label = document.createElement('label');
    label.textContent = spec.label;
    Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
    labelRow.appendChild(label);

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = numToHex(spec.get());
    picker.dataset.role = `color-${spec.label}`;
    Object.assign(picker.style, {
      width: '60px',
      height: '24px',
      cursor: 'pointer',
      background: 'transparent',
      border: '1px solid #444',
      borderRadius: '3px',
    });
    picker.addEventListener('input', () => {
      spec.set(hexToNum(picker.value));
    });
    labelRow.appendChild(picker);

    row.appendChild(labelRow);

    const defaultLabel = document.createElement('div');
    defaultLabel.textContent = `default: ${numToHex(spec.defaultValue)}`;
    Object.assign(defaultLabel.style, { fontSize: '10px', color: '#666' });
    row.appendChild(defaultLabel);

    this.colorBindings.push({ picker, spec });
    return row;
  }

  // ==========================================================================
   // LEVEL sections — mirrors level-editor.html's coverage (COURT / HOOP /
   // COLORS / LIGHTING). Each section is its own <details> so users can
   // collapse to save vertical space in the dense overlay. COURT is open
   // by default (landing point); HOOP / COLORS / LIGHTING are collapsed.
   // Gameplay-coupled fields get a level-editor-style warning box at the
   // top of the section (complementing the per-field ⚠️ label badges).
  // ==========================================================================

  private buildLevelSections(): HTMLElement[] {
    const ld = getLevelDefaults();

    // COURT — 9 fields; Width and Length are gameplay-coupled (per level-editor).
    const courtSection = this.buildLevelSection('COURT (next match)', true);
    courtSection.appendChild(this.buildWarningBox(
      '⚠️ All values are gameplay-coupled — changes may break collision, scoring, or AI pathing',
    ));
    const courtSliders: SliderSpec[] = [
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
      { label: 'Center Circle Radius', min: 0.5, max: 4, step: 0.1,
        get: () => levelConfig.court.centerCircleRadius,
        set: (v) => { levelConfig.court.centerCircleRadius = v; },
        defaultValue: ld.court.centerCircleRadius },
      { label: 'Check-Ball Line', min: 0, max: 12, step: 0.5,
        get: () => levelConfig.court.checkBallLine,
        set: (v) => { levelConfig.court.checkBallLine = v; },
        defaultValue: ld.court.checkBallLine },
      { label: 'Line Height', min: 0.005, max: 0.1, step: 0.005,
        get: () => levelConfig.court.lineHeight,
        set: (v) => { levelConfig.court.lineHeight = v; },
        defaultValue: ld.court.lineHeight },
      { label: 'Plank Stripe Spacing', min: 0.1, max: 2, step: 0.05,
        get: () => levelConfig.court.plankStripeSpacing,
        set: (v) => { levelConfig.court.plankStripeSpacing = v; },
        defaultValue: ld.court.plankStripeSpacing },
    ];
    for (const s of courtSliders) courtSection.appendChild(this.buildSlider(s));

    // HOOP — all 6 fields gameplay-coupled per level-editor; collapsed by default.
    const hoopSection = this.buildLevelSection('HOOP (next match)', false);
    hoopSection.appendChild(this.buildWarningBox(
      '⚠️ All values gameplay-coupled — changes may break shot detection, AI, scoring',
    ));
    const hoopSliders: SliderSpec[] = [
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
    ];
    for (const s of hoopSliders) hoopSection.appendChild(this.buildSlider(s));

    // COLORS — 3 color pickers (floor / plank stripe / line). Collapsed by default.
    const colorsSection = this.buildLevelSection('COLORS (next match)', false);
    const colorSpecs: ColorSpec[] = [
      { label: 'Floor',
        get: () => levelConfig.colors.floor,
        set: (v) => { levelConfig.colors.floor = v; },
        defaultValue: ld.colors.floor },
      { label: 'Plank Stripe',
        get: () => levelConfig.colors.plankStripe,
        set: (v) => { levelConfig.colors.plankStripe = v; },
        defaultValue: ld.colors.plankStripe },
      { label: 'Line',
        get: () => levelConfig.colors.line,
        set: (v) => { levelConfig.colors.line = v; },
        defaultValue: ld.colors.line },
    ];
    for (const c of colorSpecs) colorsSection.appendChild(this.buildColorRow(c));

    // LIGHTING — 5 sliders. Collapsed by default.
    const lightingSection = this.buildLevelSection('LIGHTING (next match)', false);
    const lightingSliders: SliderSpec[] = [
      { label: 'Ambient Intensity', min: 0, max: 1.5, step: 0.05,
        get: () => levelConfig.lighting.ambientIntensity,
        set: (v) => { levelConfig.lighting.ambientIntensity = v; },
        defaultValue: ld.lighting.ambientIntensity },
      { label: 'Directional Intensity', min: 0, max: 2, step: 0.05,
        get: () => levelConfig.lighting.directionalIntensity,
        set: (v) => { levelConfig.lighting.directionalIntensity = v; },
        defaultValue: ld.lighting.directionalIntensity },
      { label: 'Directional X', min: -20, max: 20, step: 0.5,
        get: () => levelConfig.lighting.directionalX,
        set: (v) => { levelConfig.lighting.directionalX = v; },
        defaultValue: ld.lighting.directionalX },
      { label: 'Directional Y', min: 1, max: 40, step: 0.5,
        get: () => levelConfig.lighting.directionalY,
        set: (v) => { levelConfig.lighting.directionalY = v; },
        defaultValue: ld.lighting.directionalY },
      { label: 'Directional Z', min: -20, max: 20, step: 0.5,
        get: () => levelConfig.lighting.directionalZ,
        set: (v) => { levelConfig.lighting.directionalZ = v; },
        defaultValue: ld.lighting.directionalZ },
    ];
    for (const s of lightingSliders) lightingSection.appendChild(this.buildSlider(s));

    return [courtSection, hoopSection, colorsSection, lightingSection];
  }

  /** Build a top-level <details> section matching the visual style of
   *  buildSection() so COURT/HOOP/COLORS/LIGHTING look identical to MATCH. */
  private buildLevelSection(title: string, open: boolean): HTMLDetailsElement {
    const details = document.createElement('details');
    details.open = open;
    Object.assign(details.style, { marginBottom: '12px' });

    const summary = document.createElement('summary');
    summary.textContent = title;
    Object.assign(summary.style, {
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '13px',
      color: '#aaa',
      padding: '4px 0',
      letterSpacing: '1px',
    });
    details.appendChild(summary);
    persistDetails(details, detailsKey(DEVUI_PREFIX, title));
    return details;
  }

  /** Orange warning box matching level-editor.ts section-level warnings. */
  private buildWarningBox(text: string): HTMLElement {
    const warn = document.createElement('div');
    warn.textContent = text;
    Object.assign(warn.style, {
      fontSize: '10px',
      color: '#ff9800',
      marginBottom: '6px',
      padding: '4px',
      background: 'rgba(255, 152, 0, 0.1)',
      border: '1px solid rgba(255, 152, 0, 0.3)',
      borderRadius: '3px',
    });
    return warn;
  }

  // ==========================================================================
  // ANIMATION section — durations / amplitudes / poses. Uses a nested
  // <details> structure because there are hundreds of scalar fields.
  // ==========================================================================

  private buildAnimationSection(): HTMLElement {
    const root = document.createElement('details');
    root.open = false;
    Object.assign(root.style, { marginBottom: '12px' });

    const summary = document.createElement('summary');
    summary.textContent = 'ANIMATION';
    Object.assign(summary.style, {
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '13px',
      color: '#aaa',
      padding: '4px 0',
      letterSpacing: '1px',
    });
    root.appendChild(summary);

    root.appendChild(this.buildAnimDurations());
    root.appendChild(this.buildAnimAmplitudes());
    root.appendChild(this.buildAnimPoses());
    persistDetails(root, detailsKey(DEVUI_PREFIX, 'ANIMATION'));
    return root;
  }

  private buildSubSection(title: string, open = false, keyPath?: string[]): HTMLDetailsElement {
    const d = document.createElement('details');
    d.open = open;
    Object.assign(d.style, { marginLeft: '8px', marginBottom: '6px' });
    const s = document.createElement('summary');
    s.textContent = title;
    Object.assign(s.style, {
      cursor: 'pointer',
      fontWeight: '600',
      fontSize: '12px',
      color: '#c8c8c8',
      padding: '3px 0',
      letterSpacing: '1px',
    });
    d.appendChild(s);
    if (keyPath && keyPath.length > 0) {
      persistDetails(d, detailsKey(DEVUI_PREFIX, ...keyPath));
    }
    return d;
  }

  private buildAnimDurations(): HTMLElement {
    const section = this.buildSubSection('Durations', false, ['ANIMATION', 'Durations']);
    const d = getAnimDefaults();
    const keys = Object.keys(animConfig.durations) as Array<keyof typeof animConfig.durations>;
    for (const k of keys) {
      section.appendChild(this.buildSlider(
        animSlider(['durations', k as string], humanize(k as string), d.durations[k]),
      ));
    }
    return section;
  }

  private buildAnimAmplitudes(): HTMLElement {
    const section = this.buildSubSection('Amplitudes', false, ['ANIMATION', 'Amplitudes']);
    const d = getAnimDefaults();
    const animKeys = Object.keys(animConfig.amplitudes) as Array<keyof typeof animConfig.amplitudes>;
    for (const anim of animKeys) {
      const sub = this.buildSubSection(humanize(anim as string), false, ['ANIMATION', 'Amplitudes', anim as string]);
      const fields = animConfig.amplitudes[anim] as Record<string, number>;
      const defaultsForAnim = (d.amplitudes as unknown as Record<string, Record<string, number>>)[anim as string];
      for (const f of Object.keys(fields)) {
        sub.appendChild(this.buildSlider(
          animSlider(['amplitudes', anim as string, f], humanize(f), defaultsForAnim[f]),
        ));
      }
      section.appendChild(sub);
    }
    return section;
  }

  private buildAnimPoses(): HTMLElement {
    const section = this.buildSubSection('Poses', false, ['ANIMATION', 'Poses']);
    const d = getAnimDefaults();
    const animKeys = Object.keys(animConfig.poses) as Array<keyof typeof animConfig.poses>;
    for (const anim of animKeys) {
      const sub = this.buildSubSection(humanize(anim as string), false, ['ANIMATION', 'Poses', anim as string]);
      const fields = animConfig.poses[anim] as unknown as Record<string, number>;
      const defaultsForAnim = (d.poses as unknown as Record<string, Record<string, number>>)[anim as string];
      for (const f of Object.keys(fields)) {
        sub.appendChild(this.buildSlider(
          animSlider(['poses', anim as string, f], humanize(f), defaultsForAnim[f]),
        ));
      }
      section.appendChild(sub);
    }
    return section;
  }
}

// ----------------------------------------------------------------------------
// Helpers for ANIMATION section — field-name classification & dotted-path r/w.
// ----------------------------------------------------------------------------

// Color integer ↔ "#rrggbb" conversion (shared with player-editor.ts semantics).
function numToHex(n: number): string {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

function hexToNum(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

function humanize(name: string): string {
  // idleBob → "Idle Bob"; stealDuration → "Steal Duration"; rotX stays as "Rot X"
  const withSpaces = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function getAnimValue(path: string[]): number {
  let cur: any = animConfig;
  for (const p of path) cur = cur[p];
  return cur as number;
}

function setAnimValue(path: string[], v: number): void {
  let cur: any = animConfig;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = v;
}

function animSlider(path: string[], label: string, defaultValue: number): SliderSpec {
  // path is one of:
  //   ['durations', field]
  //   ['amplitudes', anim, field]
  //   ['poses', anim, field]
  const tier = path[0] as RangeTier;
  const last = path[path.length - 1];
  const range = pickSliderRange(tier, path, last, defaultValue);
  return {
    label,
    min: range.min,
    max: range.max,
    step: range.step,
    get: () => getAnimValue(path),
    set: (v: number) => { setAnimValue(path, v); },
    defaultValue,
  };
}
