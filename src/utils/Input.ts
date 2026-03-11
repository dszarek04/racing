export interface KeyBindings {
  throttle: string;
  brake:    string;
  left:     string;
  right:    string;
  reset:    string;
  pause:    string;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  throttle: 'w',
  brake:    's',
  left:     'a',
  right:    'd',
  reset:    'r',
  pause:    'escape',
};

const STORAGE_KEY = 'racing_keybindings';

export function loadBindings(): KeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_BINDINGS, ...JSON.parse(raw) };
  } catch { /* corrupt storage */ }
  return { ...DEFAULT_BINDINGS };
}

export function saveBindings(b: KeyBindings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
}

export class Input {
  keys: Record<string, boolean> = {};
  throttle = 0;
  brake    = 0;
  left     = 0;
  right    = 0;
  interacted     = false;
  resetRequested = false;
  bindings: KeyBindings;

  constructor() {
    this.bindings = loadBindings();

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;

      const b = this.bindings;
      const driveKeys = [b.throttle, b.brake, b.left, b.right,
                         'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
      if (driveKeys.includes(key)) this.interacted = true;
      if (key === b.reset) this.resetRequested = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  update() {
    const lerp = (v: number, t: number, r: number) => v + (t - v) * r;
    const b = this.bindings;

    const wDown = this.keys[b.throttle] || this.keys['arrowup']    ? 1 : 0;
    const sDown = this.keys[b.brake]    || this.keys['arrowdown']  ? 1 : 0;
    const aDown = this.keys[b.left]     || this.keys['arrowleft']  ? 1 : 0;
    const dDown = this.keys[b.right]    || this.keys['arrowright'] ? 1 : 0;

    this.throttle = lerp(this.throttle, wDown, 0.2);
    this.brake    = lerp(this.brake,    sDown, 0.2);
    this.left     = lerp(this.left,     aDown, 0.3);
    this.right    = lerp(this.right,    dDown, 0.3);
  }
}
