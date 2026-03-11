import { Input, saveBindings, DEFAULT_BINDINGS } from '../utils/Input';

function formatKeyName(key: string): string {
  const map: Record<string, string> = {
    arrowup:    '↑',
    arrowdown:  '↓',
    arrowleft:  '←',
    arrowright: '→',
    escape:     'Esc',
    ' ':        'Space',
    enter:      'Enter',
    shift:      'Shift',
    control:    'Ctrl',
    alt:        'Alt',
    tab:        'Tab',
    backspace:  'Bksp',
    delete:     'Del',
  };
  return map[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export class Controls {
  private readonly input:          Input;
  private readonly menuScreen:     HTMLElement;
  private readonly controlsScreen: HTMLElement;

  private listeningAction:  string | null                         = null;
  private listeningHandler: ((e: KeyboardEvent) => void) | null  = null;

  onClose?: () => void;

  constructor(input: Input) {
    this.input          = input;
    this.menuScreen     = document.getElementById('menu-screen')!;
    this.controlsScreen = document.getElementById('controls-screen')!;

    document.getElementById('btn-controls')!
      .addEventListener('click', () => this.open());
    document.getElementById('btn-controls-close')!
      .addEventListener('click', () => this.close());
    document.getElementById('btn-controls-defaults')!
      .addEventListener('click', () => {
        Object.assign(input.bindings, DEFAULT_BINDINGS);
        saveBindings(input.bindings);
        this.refreshUI();
      });

    document.querySelectorAll<HTMLButtonElement>('.key-bind-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        this.startListening(btn, btn.dataset.action!)
      );
    });
  }

  open() {
    this.menuScreen.classList.remove('visible');
    this.controlsScreen.classList.add('visible');
    this.refreshUI();
  }

  close() {
    this.cancelListening();
    this.controlsScreen.classList.remove('visible');
    this.menuScreen.classList.add('visible');
    this.onClose?.();
  }

  buildHint(): string {
    const b = this.input.bindings;
    const f = formatKeyName;
    return `${f(b.throttle)}/Arrows · ${f(b.left)} ${f(b.right)} = Steer · ${f(b.reset)} = Reset · ${f(b.pause)} = Pause · Scroll = Zoom`;
  }

  private refreshUI() {
    const b = this.input.bindings;
    document.querySelectorAll<HTMLButtonElement>('.key-bind-btn').forEach(btn => {
      const action = btn.dataset.action as keyof typeof b;
      btn.textContent = formatKeyName(b[action]);
      btn.classList.remove('listening');
    });
  }

  private startListening(btn: HTMLButtonElement, action: string) {
    if (this.listeningAction) return;
    this.listeningAction = action;
    document.querySelectorAll('.key-bind-btn').forEach(b =>
      b.classList.remove('listening')
    );
    btn.classList.add('listening');
    btn.textContent = '…';

    this.listeningHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      // Arrow keys are permanent fallbacks and cannot be rebound
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        this.cancelListening();
        return;
      }
      (this.input.bindings as unknown as Record<string, string>)[action] = key;
      saveBindings(this.input.bindings);
      this.cancelListening();
    };
    window.addEventListener('keydown', this.listeningHandler, true);
  }

  private cancelListening() {
    if (this.listeningHandler) {
      window.removeEventListener('keydown', this.listeningHandler, true);
      this.listeningHandler = null;
    }
    this.listeningAction = null;
    this.refreshUI();
  }
}
