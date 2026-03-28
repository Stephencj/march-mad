export class HapticManager {
  private actuator: GamepadHapticActuator | null = null;

  setVibrationActuator(actuator: GamepadHapticActuator | null): void {
    this.actuator = actuator;
  }

  private rumble(intensity: number, duration: number): void {
    this.actuator?.playEffect('dual-rumble', {
      duration,
      strongMagnitude: intensity,
      weakMagnitude: intensity,
    });
  }

  onShoot(): void {
    this.rumble(0.3, 100);
  }

  onScore(): void {
    this.rumble(0.7, 200);
  }

  onBlock(): void {
    this.rumble(0.5, 150);
  }

  onSteal(): void {
    this.rumble(0.5, 150);
  }

  onPowerupPickup(): void {
    this.rumble(0.4, 100);
    setTimeout(() => this.rumble(0.8, 200), 150);
  }

  onFoul(): void {
    this.rumble(0.6, 300);
  }

  onCharge(level: number): void {
    const intensity = 0.1 + level * 0.4;
    this.rumble(intensity, 50);
  }
}
