const SPEED_UNIT_KEY = 'racing_speed_unit';

export type SpeedUnit = 'kmh' | 'mph';

export class Hud {
  private readonly timerEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly lapEl:   HTMLElement;
  private readonly hudEl:   HTMLElement;

  speedUnit: SpeedUnit =
    (localStorage.getItem(SPEED_UNIT_KEY) as SpeedUnit) || 'kmh';

  constructor() {
    this.timerEl = document.getElementById('timer')!;
    this.speedEl = document.getElementById('speed')!;
    this.lapEl   = document.getElementById('lap-counter')!;
    this.hudEl   = document.getElementById('hud-tl')!;

    document.querySelectorAll<HTMLButtonElement>('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        this.applySpeedUnit(btn.dataset.unit as SpeedUnit)
      );
    });
    this.applySpeedUnit(this.speedUnit);
  }

  applySpeedUnit(unit: SpeedUnit) {
    this.speedUnit = unit;
    localStorage.setItem(SPEED_UNIT_KEY, unit);
    document.querySelectorAll<HTMLButtonElement>('.unit-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.unit === unit);
    });
  }

  setVisible(v: boolean) {
    this.hudEl.style.visibility = v ? 'visible' : 'hidden';
  }

  setTimer(text: string) {
    this.timerEl.innerText = text;
  }

  setSpeed(velMag: number) {
    const ms = velMag * 0.05;
    this.speedEl.innerText = this.speedUnit === 'kmh'
      ? `${Math.round(ms * 3.6)} km/h`
      : `${Math.round(ms * 2.237)} mph`;
  }

  showLap(current: number, total: number) {
    this.lapEl.style.display = '';
    this.lapEl.innerText     = `Lap ${current} / ${total}`;
  }

  hideLap() {
    this.lapEl.style.display = 'none';
  }

  static formatTime(ms: number): string {
    const m   = Math.floor(ms / 60000).toString().padStart(2, '0');
    const s   = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const ms3 = Math.floor(ms % 1000).toString().padStart(3, '0');
    return `${m}:${s}:${ms3}`;
  }
}
