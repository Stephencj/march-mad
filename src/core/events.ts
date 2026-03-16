export interface GameEventMap {
  score: { team: 'home' | 'away'; points: number; shotType: string };
  foul: { team: 'home' | 'away' };
  powerup: { type: string; team: 'home' | 'away' };
  'crowd-change': { level: string };
  'possession-change': { team: 'home' | 'away' };
  'game-over': { winner: 'home' | 'away'; homeScore: number; awayScore: number };
  [key: string]: any;
}

type EventHandler<T = any> = (data: T) => void;

export class EventBus<TMap extends Record<string, any> = GameEventMap> {
  private listeners = new Map<string, Set<EventHandler>>();

  on<K extends keyof TMap & string>(event: K, handler: EventHandler<TMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off<K extends keyof TMap & string>(event: K, handler: EventHandler<TMap[K]>): void {
    this.listeners.get(event)?.delete(handler);
  }

  once<K extends keyof TMap & string>(event: K, handler: EventHandler<TMap[K]>): void {
    const wrapper: EventHandler = (data) => {
      this.off(event, wrapper as EventHandler<TMap[K]>);
      handler(data);
    };
    this.on(event, wrapper as EventHandler<TMap[K]>);
  }

  emit<K extends keyof TMap & string>(event: K, data: TMap[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(data));
  }
}

export const gameEvents = new EventBus();
