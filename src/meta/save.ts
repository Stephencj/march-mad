const PLAYER_KEY = 'march-mad-player';
const TOURNAMENT_KEY = 'march-mad-tournament';

export class SaveSystem {
  savePlayerData(data: any): void {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(data));
  }

  loadPlayerData(): any | null {
    const raw = localStorage.getItem(PLAYER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  saveTournamentState(state: any): void {
    localStorage.setItem(TOURNAMENT_KEY, JSON.stringify(state));
  }

  loadTournamentState(): any | null {
    const raw = localStorage.getItem(TOURNAMENT_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  clearTournament(): void {
    localStorage.removeItem(TOURNAMENT_KEY);
  }

  clearAll(): void {
    localStorage.removeItem(PLAYER_KEY);
    localStorage.removeItem(TOURNAMENT_KEY);
  }
}
