import { COUNTDOWN } from '../config';
import { Input } from '../utils/Input';
import { AudioEngine } from '../utils/AudioEngine';

type CDPhase = 'lighting' | 'holding' | 'go';

export type CountdownResult =
  | { type: 'dq' }
  | { type: 'go'; penaltyMs: number }
  | null;

export class Countdown {
  private phase:         CDPhase = 'lighting';
  private timer          = 0;
  private lights         = 0;
  private holdDuration   = 0;
  private falseStart     = false;
  private bannerTimer    = 0;
  penaltyMs              = 0;

  private readonly overlay:  HTMLElement;
  private readonly banner:   HTMLElement;
  private readonly lightEls: HTMLElement[];

  constructor() {
    this.overlay   = document.getElementById('countdown-overlay')!;
    this.banner    = document.getElementById('false-start-banner')!;
    this.lightEls  = [1, 2, 3, 4, 5].map(i =>
      document.getElementById(`cdl${i}`)!
    );
  }

  start() {
    this.phase        = 'lighting';
    this.timer        = 0;
    this.lights       = 0;
    this.holdDuration =
      COUNTDOWN.HOLD_MIN + Math.random() * (COUNTDOWN.HOLD_MAX - COUNTDOWN.HOLD_MIN);
    this.falseStart   = false;
    this.penaltyMs    = 0;
    this.bannerTimer  = 0;
    this.lightEls.forEach(el => (el.className = 'cdlight'));
    this.banner.style.display  = 'none';
    this.overlay.style.display = '';
  }

  hide() {
    this.overlay.style.display = 'none';
    this.banner.style.display  = 'none';
  }

  /** Returns a result when the countdown resolves, or null while still running. */
  update(dt: number, input: Input, audio: AudioEngine): CountdownResult {
    this.timer += dt;

    // Check for false start (movement before lights go out)
    if (!this.falseStart && (this.phase === 'lighting' || this.phase === 'holding')) {
      const b     = input.bindings;
      const moved =
        !!(input.keys[b.throttle] || input.keys['arrowup'] ||
           input.keys[b.brake]    || input.keys['arrowdown']);

      if (moved) {
        this.falseStart = true;
        if (this.phase === 'lighting') {
          // DQ — moved before all 5 lights were lit
          this.hide();
          return { type: 'dq' };
        } else {
          // Penalty — moved during hold phase (all 5 lit)
          this.banner.innerHTML    = `FALSE START<br>+${COUNTDOWN.FALSE_PENALTY} SEC PENALTY`;
          this.banner.style.display = '';
          this.penaltyMs   = COUNTDOWN.FALSE_PENALTY * 1000;
          this.bannerTimer = COUNTDOWN.BANNER_DURATION;
          this.overlay.style.display = 'none';
          return { type: 'go', penaltyMs: this.penaltyMs };
        }
      }
    }

    // Animate lights
    if (this.phase === 'lighting') {
      const target = Math.floor(this.timer / COUNTDOWN.LIGHT_INTERVAL);
      while (this.lights < Math.min(target, 5)) {
        this.lights++;
        this.lightEls[this.lights - 1].classList.add('red');
      }
      if (this.lights >= 5) {
        this.phase = 'holding';
        this.timer = 0;
      }

    } else if (this.phase === 'holding') {
      if (this.timer >= this.holdDuration) {
        this.phase = 'go';
        this.timer = 0;
        this.lightEls.forEach(el => {
          el.classList.remove('red');
          el.classList.add('green');
        });
        audio.playHorn();
      }

    } else {
      // 'go' phase — brief moment to show green lights, then race begins
      if (this.timer >= COUNTDOWN.GO_DISPLAY_TIME) {
        this.overlay.style.display = 'none';
        return { type: 'go', penaltyMs: this.penaltyMs };
      }
    }

    // Count down false-start banner
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerTimer          = 0;
        this.banner.style.display = 'none';
      }
    }

    return null;
  }
}
