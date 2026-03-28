export class MenuNavigator {
  focusedIndex = 0;
  active = false;

  private items: HTMLElement[] = [];
  private columns = 1;
  private backHandler: (() => void) | null = null;

  private prevDpadUp = false;
  private prevDpadDown = false;
  private prevDpadLeft = false;
  private prevDpadRight = false;
  private prevA = false;
  private prevB = false;
  private stickRepeatTimer = 0;

  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  register(items: HTMLElement[], columns = 1): void {
    this.clear();
    this.items = items;
    this.columns = columns;
    this.focusedIndex = 0;
    this.active = true;
    this.applyFocus();
    this.attachKeyboard();
  }

  clear(): void {
    this.removeFocus();
    this.items = [];
    this.active = false;
    this.backHandler = null;
    this.detachKeyboard();
  }

  setBackHandler(fn: () => void): void {
    this.backHandler = fn;
  }

  navigate(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (!this.active || this.items.length === 0) return;

    this.removeFocus();
    const rows = Math.ceil(this.items.length / this.columns);
    const row = Math.floor(this.focusedIndex / this.columns);
    const col = this.focusedIndex % this.columns;

    switch (direction) {
      case 'up': {
        const newRow = (row - 1 + rows) % rows;
        this.focusedIndex = Math.min(newRow * this.columns + col, this.items.length - 1);
        break;
      }
      case 'down': {
        const newRow = (row + 1) % rows;
        this.focusedIndex = Math.min(newRow * this.columns + col, this.items.length - 1);
        break;
      }
      case 'left': {
        this.focusedIndex = (this.focusedIndex - 1 + this.items.length) % this.items.length;
        break;
      }
      case 'right': {
        this.focusedIndex = (this.focusedIndex + 1) % this.items.length;
        break;
      }
    }

    this.applyFocus();
  }

  select(): void {
    if (!this.active || !this.items[this.focusedIndex]) return;
    this.items[this.focusedIndex].click();
  }

  back(): void {
    this.backHandler?.();
  }

  update(pad: Gamepad | null): void {
    if (!this.active || !pad) return;

    const dpadUp = pad.buttons[12]?.pressed ?? false;
    const dpadDown = pad.buttons[13]?.pressed ?? false;
    const dpadLeft = pad.buttons[14]?.pressed ?? false;
    const dpadRight = pad.buttons[15]?.pressed ?? false;
    const aBtn = pad.buttons[0]?.pressed ?? false;
    const bBtn = pad.buttons[1]?.pressed ?? false;

    if (dpadUp && !this.prevDpadUp) this.navigate('up');
    if (dpadDown && !this.prevDpadDown) this.navigate('down');
    if (dpadLeft && !this.prevDpadLeft) this.navigate('left');
    if (dpadRight && !this.prevDpadRight) this.navigate('right');
    if (aBtn && !this.prevA) this.select();
    if (bBtn && !this.prevB) this.back();

    this.prevDpadUp = dpadUp;
    this.prevDpadDown = dpadDown;
    this.prevDpadLeft = dpadLeft;
    this.prevDpadRight = dpadRight;
    this.prevA = aBtn;
    this.prevB = bBtn;

    const stickY = pad.axes[1] ?? 0;
    const stickX = pad.axes[0] ?? 0;
    if (Math.abs(stickY) > 0.5 || Math.abs(stickX) > 0.5) {
      this.stickRepeatTimer -= 1 / 60;
      if (this.stickRepeatTimer <= 0) {
        if (stickY < -0.5) this.navigate('up');
        else if (stickY > 0.5) this.navigate('down');
        else if (stickX < -0.5) this.navigate('left');
        else if (stickX > 0.5) this.navigate('right');
        this.stickRepeatTimer = 0.2;
      }
    } else {
      this.stickRepeatTimer = 0;
    }
  }

  private applyFocus(): void {
    const el = this.items[this.focusedIndex];
    if (el) {
      el.classList.add('menu-focused');
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private removeFocus(): void {
    for (const item of this.items) {
      item.classList.remove('menu-focused');
    }
  }

  private attachKeyboard(): void {
    this.keyListener = (e: KeyboardEvent) => {
      if (!this.active) return;
      switch (e.code) {
        case 'ArrowUp': e.preventDefault(); this.navigate('up'); break;
        case 'ArrowDown': e.preventDefault(); this.navigate('down'); break;
        case 'ArrowLeft': e.preventDefault(); this.navigate('left'); break;
        case 'ArrowRight': e.preventDefault(); this.navigate('right'); break;
        case 'Enter': e.preventDefault(); this.select(); break;
        case 'Escape': e.preventDefault(); this.back(); break;
      }
    };
    document.addEventListener('keydown', this.keyListener);
  }

  private detachKeyboard(): void {
    if (this.keyListener) {
      document.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }
}
