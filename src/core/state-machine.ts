import type { AppState } from './types';

export interface StateTransition {
  from: AppState;
  to: AppState;
}

type StateCallback = (from: AppState, to: AppState) => void;

export class GameStateMachine {
  current: AppState = 'MainMenu';
  private transitions: Set<string>;
  private enterCallbacks = new Map<AppState, StateCallback[]>();
  private exitCallbacks = new Map<AppState, StateCallback[]>();

  constructor(validTransitions: StateTransition[]) {
    this.transitions = new Set(
      validTransitions.map((t) => `${t.from}->${t.to}`)
    );
  }

  transition(to: AppState): boolean {
    const key = `${this.current}->${to}`;
    if (!this.transitions.has(key)) return false;

    const from = this.current;
    this.exitCallbacks.get(from)?.forEach((cb) => cb(from, to));
    this.current = to;
    this.enterCallbacks.get(to)?.forEach((cb) => cb(from, to));
    return true;
  }

  onEnter(state: AppState, callback: StateCallback): void {
    if (!this.enterCallbacks.has(state)) {
      this.enterCallbacks.set(state, []);
    }
    this.enterCallbacks.get(state)!.push(callback);
  }

  onExit(state: AppState, callback: StateCallback): void {
    if (!this.exitCallbacks.has(state)) {
      this.exitCallbacks.set(state, []);
    }
    this.exitCallbacks.get(state)!.push(callback);
  }

  canTransitionTo(to: AppState): boolean {
    return this.transitions.has(`${this.current}->${to}`);
  }
}
