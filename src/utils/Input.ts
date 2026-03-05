export class Input {
  public keys: Record<string, boolean> = {};
  public throttle = 0.0;
  public brake = 0.0;
  public left = 0.0;
  public right = 0.0;
  public interacted = false;
  public resetRequested = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;
      // only count drive-related keys as interaction for timer start
      if ([ 'w','a','s','d','arrowup','arrowdown','arrowleft','arrowright' ].includes(key)) {
        this.interacted = true;
      }
      if (e.key.toLowerCase() === 'r') this.resetRequested = true;
    });
    window.addEventListener('keyup', (e) => this.keys[e.key.toLowerCase()] = false);
  }

  update() {
    // Smooth input interpolation for keyboard (simulating analog triggers)
    const smooth = (val: number, target: number, rate: number) => val + (target - val) * rate;
    
    const w = this.keys['w'] || this.keys['arrowup'] ? 1.0 : 0.0;
    const s = this.keys['s'] || this.keys['arrowdown'] ? 1.0 : 0.0;
    const a = this.keys['a'] || this.keys['arrowleft'] ? 1.0 : 0.0;
    const d = this.keys['d'] || this.keys['arrowright'] ? 1.0 : 0.0;

    this.throttle = smooth(this.throttle, w, 0.2);
    this.brake = smooth(this.brake, s, 0.2);
    this.left = smooth(this.left, a, 0.3);
    this.right = smooth(this.right, d, 0.3);
  }
}